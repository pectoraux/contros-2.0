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
 * TEARDOWN EPOCH (Increment 4A/4B):
 *   Each renderer has a monotonically increasing epoch. Async operations
 *   capture the epoch before starting and verify it after each await point.
 *   If the renderer was torn down during the operation, the coordinator:
 *     - does NOT resurrect the session
 *     - cleans up any newly created engine handle (try/finally)
 *     - removes temporary snapshot
 *     - does not send/publish renderer state
 *
 * RECOVERY RACE SAFETY (Increment 4B):
 *   Recovery writes are serialized via a per-session mutation lock. The
 *   lock ensures recovery persistence and save/replacement cannot overlap
 *   incorrectly. After successful save, NO stale recovery write may
 *   recreate the recovery file.
 *
 * LOCALE PRESERVATION (Increment 4B):
 *   The session stores the locale used at open time. The save replacement
 *   calls service.open() with the SAME locale, not a hardcoded 'en'.
 */

import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
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
  /** Locale used at open time — preserved across session swaps. */
  readonly locale: string
  /** Recovery epoch — incremented on each save. Stale recovery writes are rejected. */
  readonly recoveryEpoch: number
}

// ── Coordinator deps ─────────────────────────────────────────────────

export interface SheetsShellCoordinatorDeps {
  readonly service: SpreadsheetService
}

// ── Internal: renderer lifecycle ─────────────────────────────────────

interface RendererState {
  readonly sessions: Map<string, ShellWorkbookSession>
  /** Monotonic epoch — incremented on teardown. Operations check this after awaits. */
  epoch: number
  /** Per-session mutation locks — ensures recovery and save cannot overlap. */
  readonly locks: Map<string, Promise<unknown>>
}

// ── Coordinator ───────────────────────────────────────────────────────

export class SheetsShellCoordinator {
  private readonly tabs = new Map<number, RendererState>()

  constructor(private readonly deps: SheetsShellCoordinatorDeps) {}

  // ── Session registry ──

  registerRenderer(wcId: number, webContents: WebContents): void {
    if (!this.tabs.has(wcId)) {
      this.tabs.set(wcId, { sessions: new Map(), epoch: 0, locks: new Map() })
    }
    webContents.once('destroyed', () => {
      void this.teardown(wcId)
    })
  }

  getSession(wcId: number, sessionId: string): ShellWorkbookSession {
    const state = this.tabs.get(wcId)
    if (!state) throw new InvalidSessionError(`Unknown renderer: ${wcId}`)
    const session = state.sessions.get(sessionId)
    if (!session) throw new InvalidSessionError(`Unknown workbook session: ${sessionId}`)
    return session
  }

  wcIdFromEvent(event: IpcMainInvokeEvent): number {
    return event.sender.id
  }

  // ── Epoch helpers ──

  private isAlive(wcId: number, startEpoch: number): boolean {
    const state = this.tabs.get(wcId)
    return !!state && state.epoch === startEpoch
  }

  private checkEpoch(wcId: number, startEpoch: number): void {
    if (!this.isAlive(wcId, startEpoch)) {
      throw new InvalidSessionError(`Renderer ${wcId} was torn down during operation`)
    }
  }

  // ── Per-session mutation lock (Increment 4B) ──

  /**
   * Serialize mutations on a session. Recovery writes and saves cannot
   * overlap incorrectly — the stale one waits for the other to complete
   * before checking the epoch.
   */
  private withSessionLock<T>(wcId: number, sessionId: string, fn: () => Promise<T>): Promise<T> {
    const state = this.tabs.get(wcId)
    if (!state) throw new InvalidSessionError(`Unknown renderer: ${wcId}`)
    const prev = state.locks.get(sessionId) ?? Promise.resolve()
    const next = prev.then(() => fn(), () => fn())
    state.locks.set(sessionId, next.catch(() => {}))
    return next
  }

  // ── Open ──

  /**
   * Open a workbook with structured resource cleanup.
   *
   * TEARDOWN SAFETY (Increment 4B):
   *   After service.open() succeeds, if the renderer was torn down,
   *   the newly created engine handle is closed and the snapshot removed.
   *   Uses try/finally to guarantee cleanup on ANY post-creation failure.
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
    // Ensure renderer is registered
    let state = this.tabs.get(wcId)
    if (!state) {
      state = { sessions: new Map(), epoch: 0, locks: new Map() }
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
      this.checkEpoch(wcId, startEpoch)
      if (selection.canceled || !selection.filePaths[0]) return null
      path = selection.filePaths[0]
    }

    // ── 2. Prepare file (.xls/.csv conversion, recovery check) ──
    const prepared = await this.prepareWorkbookForOpen(path, callerWindow)
    this.checkEpoch(wcId, startEpoch)

    // ── 3. Create snapshot ──
    const snapshotPath = await this.snapshotWorkbook(prepared.openPath)
    this.checkEpoch(wcId, startEpoch)

    // ── 4. Read bytes and call service.open() ──
    // STRUCTURED CLEANUP: if anything after this point fails (including
    // teardown), we must close the engine handle AND remove the snapshot.
    const bytes = await readFile(snapshotPath)
    const fileName = prepared.openPath.split(/[\\/]/).pop() ?? 'workbook.xlsx'

    let openResult: WorkbookOpenResult | undefined
    try {
      openResult = await this.deps.service.open(new Uint8Array(bytes), options.locale, fileName)
      this.checkEpoch(wcId, startEpoch)
    } catch (error) {
      // service.open() failed OR teardown occurred — clean up snapshot
      await rm(snapshotPath, { force: true })
      // If openResult was set (service.open succeeded but teardown happened
      // at checkEpoch), close the engine handle
      if (openResult) {
        try { await this.deps.service.close(openResult.engineHandle) } catch { /* best-effort */ }
      }
      throw error
    }

    // At this point: service.open() succeeded, epoch is still valid.
    // openResult is guaranteed to be defined.
    // ── 5. Compute disk fingerprint ──
    try {
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
        locale: options.locale,
        recoveryEpoch: 0,
      }

      // ── 7. Register in the session map ──
      this.checkEpoch(wcId, startEpoch)
      state = this.tabs.get(wcId)!
      state.sessions.set(sessionId, shellSession)

      return { sessionId, session: shellSession }
    } catch (error) {
      // Any post-open failure — close engine handle and remove snapshot
      try { await this.deps.service.close(openResult.engineHandle) } catch { /* best-effort */ }
      await rm(snapshotPath, { force: true })
      throw error
    }
  }

  // ── Read operations (delegate to service) ──

  async readRange(wcId: number, sessionId: string, sheetId: string, range: string): Promise<EngineRangeResult> {
    const session = this.getSession(wcId, sessionId)
    return this.deps.service.readRange(session.domainSession, session.engineHandle, sheetId, range)
  }

  async readFormulaCells(wcId: number, sessionId: string, sheetId: string): Promise<EngineFormulaCellsResult> {
    const session = this.getSession(wcId, sessionId)
    return this.deps.service.readFormulaCells(session.domainSession, session.engineHandle, sheetId)
  }

  async recalculate(wcId: number, sessionId: string, edits: EngineRecalcEdit[], reads: EngineRecalcRead[]): Promise<EngineRecalcResult> {
    const session = this.getSession(wcId, sessionId)
    return this.deps.service.recalculate(session.domainSession, session.engineHandle, edits, reads)
  }

  async readMedia(wcId: number, sessionId: string, visualId: string): Promise<EngineMediaResult> {
    const session = this.getSession(wcId, sessionId)
    return this.deps.service.readMedia(session.domainSession, session.engineHandle, visualId)
  }

  // ── Save ──

  /**
   * Save with frozen session-swap semantics + locale preservation.
   *
   * LOCALE PRESERVATION (Increment 4B):
   *   The replacement service.open() call uses the SAME locale stored
   *   in the session at open time — not a hardcoded 'en'.
   */
  async saveWorkbook(
    wcId: number,
    sessionId: string,
    request: SaveRequest,
    mode: 'save' | 'save-as',
    callerWindow: BrowserWindow | undefined,
  ): Promise<SaveResult & { canceled?: boolean }> {
    return this.withSessionLock(wcId, sessionId, async () => {
      const state = this.tabs.get(wcId)
      if (!state) throw new InvalidSessionError(`Unknown renderer: ${wcId}`)
      const startEpoch = state.epoch

      const session = this.getSession(wcId, sessionId)

      // ── 1. Resolve save target + ExternalChangeStatus ──
      let targetPath: string
      let externalChange: ExternalChangeStatus

      if (mode === 'save-as' || session.suggestSaveAs !== undefined) {
        const dialogOptions = {
          defaultPath: session.suggestSaveAs ?? session.restoreTarget ?? session.originalPath,
          filters: [{ name: 'Excel', extensions: ['xlsx'] }],
        }
        const selection = callerWindow
          ? await dialog.showSaveDialog(callerWindow, dialogOptions)
          : await dialog.showSaveDialog(dialogOptions)
        this.checkEpoch(wcId, startEpoch)
        if (selection.canceled || !selection.filePath) return { ok: false, canceled: true }
        targetPath = selection.filePath.endsWith('.xlsx') ? selection.filePath : `${selection.filePath}.xlsx`
        externalChange = 'unchanged'
      } else if (session.restoreTarget !== undefined) {
        // Restore writeback: compute ExternalChangeStatus for restoreTarget
        externalChange = await this.computeExternalChangeStatus(
          session.restoreTarget,
          session.restoreTargetSha ?? '',
        )
        this.checkEpoch(wcId, startEpoch)
        // For restore: changed or unknown → refuse (the service will refuse)
        // unchanged → proceed
        targetPath = session.restoreTarget
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
      // LOCALE PRESERVATION: use session.locale, NOT hardcoded 'en'
      const newBytes = await readFile(newSnapshotPath)
      const fileName = targetPath.split(/[\\/]/).pop() ?? 'workbook.xlsx'

      let newOpenResult: WorkbookOpenResult
      try {
        newOpenResult = await this.deps.service.open(new Uint8Array(newBytes), session.locale, fileName)
      } catch (error) {
        await rm(newSnapshotPath, { force: true })
        throw error
      }
      this.checkEpoch(wcId, startEpoch)

      // ── 7. Compute new disk fingerprint ──
      const newDiskFingerprint = await this.sha256File(newSnapshotPath)

      // ── 8. Construct replacement ShellWorkbookSession (SAME sessionId + locale) ──
      const replacementSession: ShellWorkbookSession = {
        sessionId,
        originalPath: targetPath,
        snapshotPath: newSnapshotPath,
        diskFingerprint: newDiskFingerprint,
        engineHandle: newOpenResult.engineHandle,
        domainSession: newOpenResult.session,
        metadata: newOpenResult.metadata,
        locale: session.locale, // preserve locale
        recoveryEpoch: session.recoveryEpoch + 1,
      }

      // ── 9. Atomically replace ──
      this.checkEpoch(wcId, startEpoch)
      const currentState = this.tabs.get(wcId)
      if (!currentState || currentState.epoch !== startEpoch) {
        try { await this.deps.service.close(newOpenResult.engineHandle) } catch { /* best-effort */ }
        await rm(newSnapshotPath, { force: true })
        throw new InvalidSessionError(`Renderer ${wcId} was torn down during save`)
      }

      currentState.sessions.set(sessionId, replacementSession)

      // ── 10. Close old engine handle (best-effort) ──
      try { await this.deps.service.close(session.engineHandle) } catch { /* best-effort */ }

      // ── 11. Remove old snapshot ──
      await rm(session.snapshotPath, { force: true })

      return result
    })
  }

  // ── Recovery ──

  /**
   * Write a recovery copy with serialized mutation safety.
   *
   * RECOVERY RACE SAFETY (Increment 4B):
   *   Uses the per-session mutation lock so recovery persistence and
   *   save/replacement cannot overlap. After successful save, the epoch
   *   is incremented, and the stale recovery write detects this inside
   *   the lock (after save completes) and refuses to write.
   */
  async writeRecovery(
    wcId: number,
    sessionId: string,
    request: SaveRequest,
  ): Promise<{ ok: boolean }> {
    // Capture the recovery epoch BEFORE entering the lock, from the
    // session as it exists NOW. If a save replaces the session while
    // this recovery waits for the lock, the epoch will have changed
    // by the time we check inside the lock.
    let startRecoveryEpoch: number
    try {
      startRecoveryEpoch = this.getSession(wcId, sessionId).recoveryEpoch
    } catch {
      return { ok: false }
    }

    return this.withSessionLock(wcId, sessionId, async () => {
      let session: ShellWorkbookSession
      try {
        session = this.getSession(wcId, sessionId)
      } catch {
        return { ok: false }
      }

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

        // Recovery race safety: re-check epoch AFTER the service call.
        // Because we're inside the lock, any save that started before us
        // has already completed (incrementing the epoch). Any save that
        // starts after us will wait until we finish.
        const currentSession = this.tabs.get(wcId)?.sessions.get(sessionId)
        if (!currentSession || currentSession.recoveryEpoch !== startRecoveryEpoch) {
          // Session was saved (epoch incremented) — stale recovery, do NOT write
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
    })
  }

  // ── Close ──

  async closeWorkbook(wcId: number, sessionId: string): Promise<void> {
    await this.closeSession(wcId, sessionId)
  }

  async teardown(wcId: number): Promise<void> {
    const state = this.tabs.get(wcId)
    if (!state) return
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

    try { await this.deps.service.close(session.engineHandle) } catch { /* best-effort */ }
    try { await rm(session.snapshotPath, { force: true }) } catch { /* best-effort */ }
    state.sessions.delete(sessionId)
  }

  // ── ExternalChangeStatus computation ──

  /**
   * Compute ExternalChangeStatus from the current disk state vs the
   * stored fingerprint.
   *
   * Policy (FROZEN):
   *   hash readable + equal  → 'unchanged'
   *   hash readable + differs → 'changed'
   *   stat/read/hash unavailable → 'unknown'  (NOT 'unchanged')
   *
   * Applies to BOTH in-place and restore-target saves (Increment 4B).
   */
  private async computeExternalChangeStatus(
    filePath: string,
    storedFingerprint: string,
  ): Promise<ExternalChangeStatus> {
    try {
      const currentSha = await this.sha256File(filePath)
      if (currentSha === storedFingerprint) return 'unchanged'
      return 'changed'
    } catch {
      return 'unknown'
    }
  }

  // ── File preparation ──

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

    const stem = path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '')
    const directory = join(app.getPath('temp'), 'genoffice-imports', randomUUID())
    await mkdir(directory, { recursive: true })
    const openPath = join(directory, `${stem}.xlsx`)

    if (extension === 'csv') {
      const { csvToXlsxBuffer, decodeCsvBuffer } = await import('../gateway/csv-import')
      const csvBytes = await readFile(path)
      await writeFile(openPath, await csvToXlsxBuffer(decodeCsvBuffer(csvBytes)))
      return { openPath, suggestSaveAs: path.replace(/\.[^.]+$/, '.xlsx'), csvImport: true }
    } else {
      // .xls conversion — DEFERRED (Increment 4B)
      // The engine contract has convertWorkbook(bytes, fileName) but it is
      // not yet exposed through SpreadsheetService. Until wired, .xls
      // conversion through the coordinator path is not supported.
      throw new EngineError(
        '.xls conversion not yet supported through the coordinator path — ' +
          'requires SpreadsheetEngine.convertWorkbook to be wired through SpreadsheetService',
        'INTERNAL_ERROR',
      )
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
    try { unlinkSync(this.recoveryPathFor(filePath)) } catch { /* nothing to clean */ }
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
