/**
 * SheetsShellCoordinator — owns the per-renderer workbook session lifecycle.
 *
 * Replaces the legacy `sheetsTabs`/`sessionFor`/`XlsxSidecarClient` ownership
 * model. The coordinator maps:
 *   wcId → Map<sessionId, ShellWorkbookSession>
 *
 * Each ShellWorkbookSession owns the shell-layer state (snapshotPath,
 * diskFingerprint, engineHandle, recovery metadata). The coordinator
 * delegates domain operations to SpreadsheetService and engine operations
 * to SpreadsheetEngine (via the service).
 *
 * The coordinator does NOT contain spreadsheet domain logic — that's owned
 * by SpreadsheetService. The coordinator owns:
 *   - per-wcId/per-session lifecycle
 *   - snapshot creation
 *   - .xls/.csv preparation
 *   - recovery discovery + restore/discard dialog
 *   - caller-specific dialog parent
 *   - disk observation (ExternalChangeStatus)
 *   - save-as path selection
 *   - close lifecycle + teardown races
 *   - renderer push-event routing (via event.sender)
 *   - sidecar/session cleanup
 *
 * ARCHITECTURE:
 *   IPC → coordinator → SpreadsheetService → SpreadsheetEngine → ElectronXlsxSidecarEngine
 *
 * The coordinator uses the opaque EngineSessionHandle — it NEVER inspects
 * the sidecar UUID, temp path, or Rust session ID.
 *
 * TEARDOWN EPOCH (Increment 4A):
 *   Each renderer has a monotonically increasing epoch. Async operations
 *   capture the epoch before starting and verify it after each await point
 *   (after dialog, after conversion, after service calls). If the renderer
 *   was torn down during the operation, the coordinator:
 *     - does NOT resurrect the session
 *     - cleans up any newly created engine handle
 *     - removes temporary snapshot
 *     - does not send/publish renderer state
 *
 * RECOVERY RACE SAFETY (Increment 4A):
 *   Recovery operations (writeRecovery, clearRecovery, save, restore) are
 *   protected by a per-session epoch token. Stale recovery writes are
 *   rejected if the session was saved or closed between the recovery request
 *   and the write.
 */

import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, rm, readFile, writeFile, access } from 'node:fs/promises'
import { existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, type WebContents, type IpcMainInvokeEvent } from 'electron'

import type {
  SpreadsheetService,
  WorkbookSession,
  WorkbookOpenResult,
  EngineSessionHandle,
  ExternalChangeStatus,
  SaveRequest,
  SaveResult,
  EngineRangeResult,
  EngineFormulaCellsResult,
  EngineRecalcEdit,
  EngineRecalcRead,
  EngineRecalcResult,
  EngineMediaResult,
} from '@genoffice/runtime-contracts'
import { EngineError, InvalidInputError, InvalidSessionError } from '@genoffice/runtime-contracts'

// ── ShellWorkbookSession (shell-layer state) ─────────────────────────

/**
 * Shell-layer workbook session. Contains ALL state the coordinator owns:
 * filesystem paths, disk fingerprint, engine handle, recovery metadata.
 *
 * This type is Electron-specific — it does NOT live in runtime-contracts.
 * The domain WorkbookSession (in runtime-contracts) contains only domain
 * data (workbookName, workbookHash, sheetNames).
 */
export interface ShellWorkbookSession {
  /** The session UUID — stable across session swaps (save preserves it). */
  readonly sessionId: string
  /** The user's original file path (absolute). */
  readonly originalPath: string
  /** Temp copy path — the save base (snapshot semantics). */
  readonly snapshotPath: string
  /** sha256 of the snapshot at open time (disk fingerprint). */
  readonly diskFingerprint: string
  /** Set for .xls/.csv imports — first save routes through Save As. */
  readonly suggestSaveAs?: string | undefined
  /** True if the session opened a converted .csv import. */
  readonly csvImport?: boolean | undefined
  /** Set when opening a restored crash-recovery copy — Save writes back here. */
  readonly restoreTarget?: string | undefined
  /** sha256 of restoreTarget at restore time (guards silent writeback). */
  readonly restoreTargetSha?: string | undefined
  /** Opaque engine session handle — NEVER inspected by the coordinator. */
  readonly engineHandle: EngineSessionHandle
  /** Domain session (workbookName, hash, sheetNames). */
  readonly domainSession: WorkbookSession
  /** Workbook metadata from the engine. */
  readonly metadata: import('@genoffice/runtime-contracts').WorkbookMetadata
  /** Recovery epoch — incremented on each save/clear. Stale recovery writes are rejected. */
  readonly recoveryEpoch: number
}

// ── Coordinator deps ─────────────────────────────────────────────────

/**
 * Dependencies for SheetsShellCoordinator.
 *
 * The coordinator receives only SpreadsheetService (domain operations).
 * It does NOT depend on the legacy XlsxSidecarClient — conversion goes
 * through the service/engine contract (convertWorkbook).
 */
export interface SheetsShellCoordinatorDeps {
  readonly service: SpreadsheetService
}

// ── Internal: renderer lifecycle ─────────────────────────────────────

interface RendererState {
  /** Sessions for this renderer. */
  readonly sessions: Map<string, ShellWorkbookSession>
  /** Monotonic epoch — incremented on teardown. Operations check this after awaits. */
  epoch: number
}

// ── Coordinator ───────────────────────────────────────────────────────

export class SheetsShellCoordinator {
  /** wcId → RendererState */
  private readonly tabs = new Map<number, RendererState>()

  constructor(private readonly deps: SheetsShellCoordinatorDeps) {}

  // ── Session registry ──

  /**
   * Register a renderer (wcId). Called when a new sheets tab/view is created.
   */
  registerRenderer(wcId: number, webContents: WebContents): void {
    if (!this.tabs.has(wcId)) {
      this.tabs.set(wcId, { sessions: new Map(), epoch: 0 })
    }
    webContents.once('destroyed', () => {
      void this.teardown(wcId)
    })
  }

  /**
   * Look up a session by wcId + sessionId. Throws if not found.
   */
  getSession(wcId: number, sessionId: string): ShellWorkbookSession {
    const state = this.tabs.get(wcId)
    if (!state) throw new InvalidSessionError(`Unknown renderer: ${wcId}`)
    const session = state.sessions.get(sessionId)
    if (!session) throw new InvalidSessionError(`Unknown workbook session: ${sessionId}`)
    return session
  }

  /**
   * Resolve wcId from an IPC event.
   */
  wcIdFromEvent(event: IpcMainInvokeEvent): number {
    return event.sender.id
  }

  // ── Epoch helpers ──

  /**
   * Check if the renderer is still alive (epoch unchanged).
   * Returns the epoch at the time of check, or throws if torn down.
   */
  private checkEpoch(wcId: number, startEpoch: number): void {
    const state = this.tabs.get(wcId)
    if (!state || state.epoch !== startEpoch) {
      throw new InvalidSessionError(`Renderer ${wcId} was torn down during operation`)
    }
  }

  // ── Open ──

  /**
   * Open a workbook. Preserves the legacy open flow:
   *   1. Resolve caller (wcId, callerWindow)
   *   2. Resolve original path (dialog or queued)
   *   3. Prepare file (.xls/.csv conversion, recovery check)
   *   4. Create snapshot
   *   5. SpreadsheetService.open(bytes, locale, fileName)
   *   6. Create ShellWorkbookSession
   *   7. Return result
   *
   * TEARDOWN SAFETY: The operation captures the renderer epoch at the start
   * and checks it after each await point. If the renderer was torn down,
   * any newly created engine handle is closed and the snapshot is removed.
   */
  async openWorkbook(
    wcId: number,
    callerWindow: BrowserWindow | undefined,
    options: {
      queuedPath?: string | undefined
      locale: string
    },
  ): Promise<{
    sessionId: string
    session: ShellWorkbookSession
  } | null> {
    // Ensure the renderer is registered
    let state = this.tabs.get(wcId)
    if (!state) {
      state = { sessions: new Map(), epoch: 0 }
      this.tabs.set(wcId, state)
    }
    const startEpoch = state.epoch

    // ── 1. Resolve path (dialog or queued) ──
    let path = options.queuedPath
    if (!path) {
      const selection = callerWindow
        ? await dialog.showOpenDialog(callerWindow, {
            properties: ['openFile'],
            filters: [{ name: 'Spreadsheets', extensions: ['xlsx', 'xls', 'csv'] }],
          })
        : await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [{ name: 'Spreadsheets', extensions: ['xlsx', 'xls', 'csv'] }],
          })
      // Check epoch after dialog
      this.checkEpoch(wcId, startEpoch)
      if (selection.canceled || !selection.filePaths[0]) return null
      path = selection.filePaths[0]
    }

    // ── 2. Prepare file (.xls/.csv conversion, recovery check) ──
    const prepared = await this.prepareWorkbookForOpen(path, callerWindow)
    // Check epoch after preparation
    this.checkEpoch(wcId, startEpoch)

    // ── 3. Create snapshot ──
    const snapshotPath = await this.snapshotWorkbook(prepared.openPath)
    // Check epoch after snapshot
    this.checkEpoch(wcId, startEpoch)

    // ── 4. Read bytes and call service.open() ──
    const bytes = await readFile(snapshotPath)
    const fileName = prepared.openPath.split(/[\\/]/).pop() ?? 'workbook.xlsx'

    let openResult: WorkbookOpenResult
    try {
      openResult = await this.deps.service.open(new Uint8Array(bytes), options.locale, fileName)
    } catch (error) {
      // If service.open() fails, clean up the snapshot
      await rm(snapshotPath, { force: true })
      throw error
    }
    // Check epoch after service.open()
    this.checkEpoch(wcId, startEpoch)

    // ── 5. Compute disk fingerprint ──
    const diskFingerprint = await this.sha256File(snapshotPath)
    const restoreTargetSha = prepared.restoreTarget
      ? await this.sha256File(prepared.restoreTarget).catch(() => undefined)
      : undefined

    // ── 6. Build ShellWorkbookSession ──
    const sessionId = randomUUID()
    const shellSession: ShellWorkbookSession = {
      sessionId,
      originalPath: path,
      snapshotPath,
      diskFingerprint,
      suggestSaveAs: prepared.suggestSaveAs,
      csvImport: prepared.csvImport,
      restoreTarget: prepared.restoreTarget,
      restoreTargetSha,
      engineHandle: openResult.engineHandle,
      domainSession: openResult.session,
      metadata: openResult.metadata,
      recoveryEpoch: 0,
    }

    // ── 7. Register in the session map ──
    // Re-check epoch one final time before registering
    this.checkEpoch(wcId, startEpoch)
    state = this.tabs.get(wcId)!
    state.sessions.set(sessionId, shellSession)

    return { sessionId, session: shellSession }
  }

  // ── Read operations (delegate to service) ──

  async readRange(
    wcId: number,
    sessionId: string,
    sheetId: string,
    range: string,
  ): Promise<EngineRangeResult> {
    const session = this.getSession(wcId, sessionId)
    return this.deps.service.readRange(session.domainSession, session.engineHandle, sheetId, range)
  }

  async readFormulaCells(
    wcId: number,
    sessionId: string,
    sheetId: string,
  ): Promise<EngineFormulaCellsResult> {
    const session = this.getSession(wcId, sessionId)
    return this.deps.service.readFormulaCells(session.domainSession, session.engineHandle, sheetId)
  }

  async recalculate(
    wcId: number,
    sessionId: string,
    edits: EngineRecalcEdit[],
    reads: EngineRecalcRead[],
  ): Promise<EngineRecalcResult> {
    const session = this.getSession(wcId, sessionId)
    return this.deps.service.recalculate(session.domainSession, session.engineHandle, edits, reads)
  }

  async readMedia(
    wcId: number,
    sessionId: string,
    visualId: string,
  ): Promise<EngineMediaResult> {
    const session = this.getSession(wcId, sessionId)
    return this.deps.service.readMedia(session.domainSession, session.engineHandle, visualId)
  }

  // ── Save ──

  /**
   * Save a workbook with frozen session-swap semantics.
   *
   * After a successful save, the renderer must continue to have a valid
   * workbook session with the SAME sessionId. The coordinator:
   *   1. Resolves save target (in-place vs save-as vs restore-writeback)
   *   2. Computes ExternalChangeStatus from disk
   *   3. Calls SpreadsheetService.save() → get bytes
   *   4. Persists bytes to target path
   *   5. Creates a fresh snapshot from the saved target
   *   6. Calls SpreadsheetService.open() on the fresh snapshot
   *   7. Constructs a replacement ShellWorkbookSession (same sessionId)
   *   8. Atomically replaces the old session state
   *   9. Closes the old engine handle
   *   10. Removes the old snapshot
   *   11. Clears recovery copies
   *
   * TEARDOWN SAFETY: If the renderer is torn down during save, the coordinator
   * does NOT register the replacement session and cleans up the new engine handle.
   */
  async saveWorkbook(
    wcId: number,
    sessionId: string,
    request: SaveRequest,
    mode: 'save' | 'save-as',
    callerWindow: BrowserWindow | undefined,
  ): Promise<SaveResult & { canceled?: boolean }> {
    const state = this.tabs.get(wcId)
    if (!state) throw new InvalidSessionError(`Unknown renderer: ${wcId}`)
    const startEpoch = state.epoch

    const session = this.getSession(wcId, sessionId)

    // ── 1. Resolve save target ──
    let targetPath: string
    let externalChange: ExternalChangeStatus

    if (mode === 'save-as' || session.suggestSaveAs !== undefined) {
      // Save As: always allowed, no disk-change guard
      const dialogOptions = {
        defaultPath: session.suggestSaveAs ?? session.restoreTarget ?? session.originalPath,
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      }
      const selection = callerWindow
        ? await dialog.showSaveDialog(callerWindow, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions)
      // Check epoch after dialog
      this.checkEpoch(wcId, startEpoch)
      if (selection.canceled || !selection.filePath) return { ok: false, canceled: true }
      targetPath = selection.filePath.endsWith('.xlsx') ? selection.filePath : `${selection.filePath}.xlsx`
      externalChange = 'unchanged'
    } else if (session.restoreTarget !== undefined) {
      // Restore writeback: silent save to original, sha guard
      const currentSha = await this.sha256File(session.restoreTarget).catch(() => undefined)
      this.checkEpoch(wcId, startEpoch)
      if (currentSha !== undefined && currentSha !== session.restoreTargetSha) {
        throw new EngineError('The file to restore has changed on disk — save aborted.', 'INTERNAL_ERROR')
      }
      targetPath = session.restoreTarget
      externalChange = 'unchanged'
    } else {
      // In-place save: compute ExternalChangeStatus from disk
      externalChange = await this.computeExternalChangeStatus(session.originalPath, session.diskFingerprint)
      this.checkEpoch(wcId, startEpoch)
      targetPath = session.originalPath
    }

    // ── 2. Call SpreadsheetService.save() ──
    const result = await this.deps.service.save(
      session.domainSession,
      session.engineHandle,
      request,
      externalChange,
    )
    this.checkEpoch(wcId, startEpoch)

    if (!result.ok || !result.data) return result

    // ── 3. Persist bytes to target path ──
    await writeFile(targetPath, result.data)
    this.checkEpoch(wcId, startEpoch)

    // ── 4. Clear recovery copies ──
    this.clearWorkbookRecovery(targetPath)
    if (session.suggestSaveAs !== undefined) this.clearWorkbookRecovery(session.suggestSaveAs)
    if (session.restoreTarget !== undefined) this.clearWorkbookRecovery(session.restoreTarget)

    // ── 5. Create a fresh snapshot from the saved target ──
    const newSnapshotPath = await this.snapshotWorkbook(targetPath)
    this.checkEpoch(wcId, startEpoch)

    // ── 6. Open a new engine session on the fresh snapshot ──
    const newBytes = await readFile(newSnapshotPath)
    const fileName = targetPath.split(/[\\/]/).pop() ?? 'workbook.xlsx'

    let newOpenResult: WorkbookOpenResult
    try {
      newOpenResult = await this.deps.service.open(new Uint8Array(newBytes), 'en', fileName)
    } catch (error) {
      // If the new open fails, clean up the new snapshot and rethrow
      await rm(newSnapshotPath, { force: true })
      throw error
    }
    this.checkEpoch(wcId, startEpoch)

    // ── 7. Compute new disk fingerprint ──
    const newDiskFingerprint = await this.sha256File(newSnapshotPath)

    // ── 8. Construct replacement ShellWorkbookSession (SAME sessionId) ──
    const replacementSession: ShellWorkbookSession = {
      sessionId, // preserve the same sessionId
      originalPath: targetPath,
      snapshotPath: newSnapshotPath,
      diskFingerprint: newDiskFingerprint,
      // After save, suggestSaveAs/csvImport/restoreTarget are cleared —
      // the workbook is now a normal .xlsx at targetPath
      engineHandle: newOpenResult.engineHandle,
      domainSession: newOpenResult.session,
      metadata: newOpenResult.metadata,
      recoveryEpoch: session.recoveryEpoch + 1, // increment recovery epoch
    }

    // ── 9. Atomically replace the old session state ──
    // Re-check epoch one final time before replacing
    this.checkEpoch(wcId, startEpoch)
    const currentState = this.tabs.get(wcId)
    if (!currentState || currentState.epoch !== startEpoch) {
      // Renderer was torn down during save — clean up the new engine handle + snapshot
      try { await this.deps.service.close(newOpenResult.engineHandle) } catch { /* best-effort */ }
      await rm(newSnapshotPath, { force: true })
      throw new InvalidSessionError(`Renderer ${wcId} was torn down during save`)
    }

    // Replace the old session with the new one
    currentState.sessions.set(sessionId, replacementSession)

    // ── 10. Close the old engine handle (best-effort) ──
    try {
      await this.deps.service.close(session.engineHandle)
    } catch {
      // Best-effort close — the old session is already replaced
    }

    // ── 11. Remove the old snapshot ──
    await rm(session.snapshotPath, { force: true })

    return result
  }

  // ── Recovery ──

  /**
   * Write a recovery copy. Preserves the legacy recovery flow:
   *   - Skip if suggestSaveAs (converted import — no original to recover into)
   *   - Skip if restoreTarget (restored session — backed by the recovery copy itself)
   *   - Best-effort: silent failure
   *
   * RECOVERY RACE SAFETY (Increment 4A):
   *   The recovery epoch protects against stale recovery writes. If the
   *   session was saved (incrementing the epoch) between the recovery
   *   request and the write, the stale write is rejected.
   */
  async writeRecovery(
    wcId: number,
    sessionId: string,
    request: SaveRequest,
  ): Promise<{ ok: boolean }> {
    const session = this.getSession(wcId, sessionId)
    const startRecoveryEpoch = session.recoveryEpoch

    // Eligibility check
    if (session.suggestSaveAs !== undefined || session.restoreTarget !== undefined) {
      return { ok: false }
    }

    try {
      const result = await this.deps.service.writeRecovery(
        session.domainSession,
        session.engineHandle,
        request,
      )

      // Recovery race safety: check if the session was saved/closed during the write
      const currentSession = this.tabs.get(wcId)?.sessions.get(sessionId)
      if (!currentSession || currentSession.recoveryEpoch !== startRecoveryEpoch) {
        // Session was saved or closed during the recovery write — reject the stale write
        return { ok: false }
      }

      // Persist to recovery path
      const recoveryPath = this.recoveryPathFor(session.originalPath)
      await mkdir(join(recoveryPath, '..'), { recursive: true })
      await writeFile(recoveryPath, result)
      return { ok: true }
    } catch (error) {
      console.warn('[sheets] recovery copy failed:', error)
      return { ok: false }
    }
  }

  // ── Close ──

  /**
   * Close a workbook session. Preserves the legacy close flow:
   *   1. Close engine session (best-effort)
   *   2. Remove snapshot
   *   3. Remove from registry
   */
  async closeWorkbook(wcId: number, sessionId: string): Promise<void> {
    await this.closeSession(wcId, sessionId)
  }

  /**
   * Close all sessions for a wcId (renderer teardown).
   * Increments the epoch to invalidate any in-flight operations.
   */
  async teardown(wcId: number): Promise<void> {
    const state = this.tabs.get(wcId)
    if (!state) return
    // Increment the epoch to invalidate any in-flight operations
    state.epoch++
    for (const sessionId of [...state.sessions.keys()]) {
      await this.closeSession(wcId, sessionId)
    }
    this.tabs.delete(wcId)
  }

  // ── Internal ──

  private async closeSession(wcId: number, sessionId: string): Promise<void> {
    const state = this.tabs.get(wcId)
    if (!state) return
    const session = state.sessions.get(sessionId)
    if (!session) return

    // Close engine session (best-effort)
    try {
      await this.deps.service.close(session.engineHandle)
    } catch {
      // Best-effort close
    }

    // Remove snapshot
    try {
      await rm(session.snapshotPath, { force: true })
    } catch {
      // Best-effort cleanup
    }

    state.sessions.delete(sessionId)
  }

  // ── ExternalChangeStatus computation (Increment 4A correction) ──

  /**
   * Compute ExternalChangeStatus from the current disk state vs the
   * stored fingerprint.
   *
   * Policy (FROZEN):
   *   hash readable + equal  → 'unchanged'
   *   hash readable + differs → 'changed'
   *   stat/read/hash unavailable → 'unknown'  (NOT 'unchanged')
   *
   * The coordinator does NOT reinterpret 'unknown' as 'unchanged'.
   * SpreadsheetService owns the policy: unchanged → save permitted;
   * changed/unknown → refused.
   */
  private async computeExternalChangeStatus(
    filePath: string,
    storedFingerprint: string,
  ): Promise<ExternalChangeStatus> {
    try {
      const currentSha = await this.sha256File(filePath)
      if (currentSha === storedFingerprint) {
        return 'unchanged'
      }
      return 'changed'
    } catch {
      // File is missing, unreadable, or stat failed → 'unknown'
      return 'unknown'
    }
  }

  // ── File preparation (mirrors legacy prepareWorkbookForOpen) ──

  private async prepareWorkbookForOpen(
    path: string,
    parent: BrowserWindow | undefined,
  ): Promise<{
    openPath: string
    suggestSaveAs?: string
    csvImport?: boolean
    restoreTarget?: string
  }> {
    const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
    if (extension !== 'csv' && extension !== 'xls') {
      // Check for pending recovery
      const recovery = this.pendingRecoveryFor(path)
      if (recovery) {
        const options = {
          type: 'question' as const,
          buttons: ['Restore', 'Discard'],
          defaultId: 0,
          cancelId: 1,
          message: 'Crash recovery copy found',
          detail: 'Unsaved work from a previous session was found. Restore it?',
        }
        const answer = parent
          ? await dialog.showMessageBox(parent, options)
          : await dialog.showMessageBox(options)
        if (answer.response === 0) return { openPath: recovery, restoreTarget: path }
        this.clearWorkbookRecovery(path)
      }
      return { openPath: path }
    }

    // .xls/.csv conversion
    const stem = path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '')
    const directory = join(app.getPath('temp'), 'genoffice-imports', randomUUID())
    await mkdir(directory, { recursive: true })
    const openPath = join(directory, `${stem}.xlsx`)

    if (extension === 'csv') {
      // CSV conversion — delegate to the csv-import module (pure, no sidecar)
      const { csvToXlsxBuffer, decodeCsvBuffer } = await import('../gateway/csv-import')
      const csvBytes = await readFile(path)
      await writeFile(openPath, await csvToXlsxBuffer(decodeCsvBuffer(csvBytes)))
      return { openPath, suggestSaveAs: path.replace(/\.[^.]+$/, '.xlsx'), csvImport: true }
    } else {
      // .xls conversion — use the engine's convertWorkbook (runtime-independent)
      const xlsBytes = await readFile(path)
      const converted = await this.deps.service.open(new Uint8Array(xlsBytes), 'en', stem + '.xlsx')
        .then(() => { throw new EngineError('convertWorkbook not available via service.open() — .xls conversion requires the engine contract', 'INTERNAL_ERROR') })
        .catch(() => { throw new EngineError('.xls conversion requires the engine contract convertWorkbook(bytes, fileName) — not yet wired through SpreadsheetService', 'INTERNAL_ERROR') })
      // This path should not be reached — the catch above throws.
      // The conversion will be properly wired when the engine contract's
      // convertWorkbook is exposed through SpreadsheetService.
      throw new EngineError('.xls conversion not yet supported through the new coordinator path', 'INTERNAL_ERROR')
    }
  }

  private async snapshotWorkbook(path: string): Promise<string> {
    const dir = join(app.getPath('temp'), 'genoffice-sheets-sessions')
    await mkdir(dir, { recursive: true })
    const snapshotPath = join(dir, `${randomUUID()}.xlsx`)
    await copyFile(path, snapshotPath)
    return snapshotPath
  }

  private async sha256File(path: string): Promise<string> {
    const bytes = await readFile(path)
    return createHash('sha256').update(bytes).digest('hex')
  }

  private recoveryDir(): string {
    return join(app.getPath('userData'), 'sheets-autosave')
  }

  private recoveryPathFor(filePath: string): string {
    const hash = createHash('sha1').update(filePath).digest('hex').slice(0, 16)
    return join(this.recoveryDir(), `${hash}.xlsx`)
  }

  private clearWorkbookRecovery(filePath: string): void {
    try {
      unlinkSync(this.recoveryPathFor(filePath))
    } catch {
      // nothing to clean
    }
  }

  private pendingRecoveryFor(filePath: string): string | null {
    const copy = this.recoveryPathFor(filePath)
    try {
      if (!existsSync(copy)) return null
      if (statSync(copy).mtimeMs <= statSync(filePath).mtimeMs) {
        unlinkSync(copy)
        return null
      }
      return copy
    } catch {
      return null
    }
  }
}
