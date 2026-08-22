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
import { InvalidInputError, InvalidSessionError } from '@genoffice/runtime-contracts'
import type { XlsxSidecarClient } from './xlsx-sidecar-client'

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
  /** The sidecar's session UUID (used for legacy sidecar calls during migration). */
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
}

// ── Coordinator deps ─────────────────────────────────────────────────

/**
 * Dependencies for SheetsShellCoordinator.
 *
 * The coordinator receives SpreadsheetService (domain operations) and
 * XlsxSidecarClient (legacy sidecar calls during migration) via injection.
 */
export interface SheetsShellCoordinatorDeps {
  readonly service: SpreadsheetService
  /** Legacy sidecar client — used for read-range/formulas/recalc/media
   * during the incremental migration. Will be removed once all handlers
   * are coordinator-backed. */
  readonly legacyClient?: XlsxSidecarClient
}

// ── Coordinator ───────────────────────────────────────────────────────

export class SheetsShellCoordinator {
  /** wcId → Map<sessionId, ShellWorkbookSession> */
  private readonly tabs = new Map<number, Map<string, ShellWorkbookSession>>()

  constructor(private readonly deps: SheetsShellCoordinatorDeps) {}

  // ── Session registry ──

  /**
   * Register a renderer (wcId). Called when a new sheets tab/view is created.
   */
  registerRenderer(wcId: number, webContents: WebContents): void {
    if (!this.tabs.has(wcId)) {
      this.tabs.set(wcId, new Map())
    }
    webContents.once('destroyed', () => {
      void this.teardown(wcId)
    })
  }

  /**
   * Look up a session by wcId + sessionId. Throws if not found.
   */
  getSession(wcId: number, sessionId: string): ShellWorkbookSession {
    const sessions = this.tabs.get(wcId)
    if (!sessions) throw new InvalidSessionError(`Unknown renderer: ${wcId}`)
    const session = sessions.get(sessionId)
    if (!session) throw new InvalidSessionError(`Unknown workbook session: ${sessionId}`)
    return session
  }

  /**
   * Resolve wcId from an IPC event.
   */
  wcIdFromEvent(event: IpcMainInvokeEvent): number {
    return event.sender.id
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
    let path = options.queuedPath
    if (!path) {
      const selection = await dialog.showOpenDialog(callerWindow ?? undefined as unknown as BrowserWindow, {
        properties: ['openFile'],
        filters: [{ name: 'Spreadsheets', extensions: ['xlsx', 'xls', 'csv'] }],
      })
      if (selection.canceled || !selection.filePaths[0]) return null
      path = selection.filePaths[0]
    }

    // Prepare: .xls/.csv conversion + recovery check
    const prepared = await this.prepareWorkbookForOpen(path, callerWindow)

    // Create snapshot
    const snapshotPath = await this.snapshotWorkbook(prepared.openPath)

    // Read bytes for SpreadsheetService.open()
    const bytes = await readFile(snapshotPath)
    const fileName = prepared.openPath.split(/[\\/]/).pop() ?? 'workbook.xlsx'

    // Call SpreadsheetService.open()
    const openResult = await this.deps.service.open(new Uint8Array(bytes), options.locale, fileName)

    // Compute disk fingerprint
    const diskFingerprint = await this.sha256File(snapshotPath)
    const restoreTargetSha = prepared.restoreTarget
      ? await this.sha256File(prepared.restoreTarget).catch(() => undefined)
      : undefined

    // Build ShellWorkbookSession
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
    }

    // Store in registry
    let sessions = this.tabs.get(wcId)
    if (!sessions) {
      sessions = new Map()
      this.tabs.set(wcId, sessions)
    }
    sessions.set(sessionId, shellSession)

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
   * Save a workbook. Preserves the legacy save flow:
   *   1. Resolve save target (in-place vs save-as vs restore-writeback)
   *   2. Compute ExternalChangeStatus from disk
   *   3. Call SpreadsheetService.save() → get bytes
   *   4. Persist bytes to target path
   *   5. Session swap (close old, open new over saved file)
   *   6. Clear recovery copy
   */
  async saveWorkbook(
    wcId: number,
    sessionId: string,
    request: SaveRequest,
    mode: 'save' | 'save-as',
    callerWindow: BrowserWindow | undefined,
  ): Promise<SaveResult & { canceled?: boolean }> {
    const session = this.getSession(wcId, sessionId)

    // Resolve save target
    let targetPath: string
    let externalChange: ExternalChangeStatus

    if (mode === 'save-as' || session.suggestSaveAs !== undefined) {
      // Save As: always allowed, no disk-change guard
      const selection = await dialog.showSaveDialog(callerWindow ?? undefined as unknown as BrowserWindow, {
        defaultPath: session.suggestSaveAs ?? session.restoreTarget ?? session.originalPath,
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      })
      if (selection.canceled || !selection.filePath) return { ok: false, canceled: true }
      targetPath = selection.filePath.endsWith('.xlsx') ? selection.filePath : `${selection.filePath}.xlsx`
      externalChange = 'unchanged'
    } else if (session.restoreTarget !== undefined) {
      // Restore writeback: silent save to original, sha guard
      const currentSha = await this.sha256File(session.restoreTarget).catch(() => undefined)
      if (currentSha !== undefined && currentSha !== session.restoreTargetSha) {
        throw new Error('The file to restore has changed on disk — save aborted.')
      }
      targetPath = session.restoreTarget
      externalChange = 'unchanged'
    } else {
      // In-place save: refuse if disk changed
      const currentSha = await this.sha256File(session.originalPath).catch(() => undefined)
      if (currentSha !== undefined && currentSha !== session.diskFingerprint) {
        externalChange = 'changed'
      } else if (currentSha === undefined) {
        externalChange = 'unchanged' // file was deleted — saving recreates it
      } else {
        externalChange = 'unchanged'
      }
      targetPath = session.originalPath
    }

    // Call SpreadsheetService.save()
    const result = await this.deps.service.save(
      session.domainSession,
      session.engineHandle,
      request,
      externalChange,
    )

    if (!result.ok || !result.data) return result

    // Persist bytes to target path
    await writeFile(targetPath, result.data)

    // Clear recovery copy
    this.clearWorkbookRecovery(targetPath)
    if (session.suggestSaveAs !== undefined) this.clearWorkbookRecovery(session.suggestSaveAs)
    if (session.restoreTarget !== undefined) this.clearWorkbookRecovery(session.restoreTarget)

    // Session swap: close old session, open new over saved file
    await this.closeSession(wcId, sessionId)
    // Re-open over the saved file (the coordinator re-reads the file, creates
    // a new snapshot, calls service.open() again). For now, the renderer
    // will call selectWorkbook again — the coordinator doesn't auto-reopen
    // in this increment. The legacy handler does the re-open; the coordinator
    // will be extended in a follow-up.

    return result
  }

  // ── Recovery ──

  /**
   * Write a recovery copy. Preserves the legacy recovery flow:
   *   - Skip if suggestSaveAs (converted import — no original to recover into)
   *   - Skip if restoreTarget (restored session — backed by the recovery copy itself)
   *   - Best-effort: silent failure
   */
  async writeRecovery(
    wcId: number,
    sessionId: string,
    request: SaveRequest,
  ): Promise<{ ok: boolean }> {
    const session = this.getSession(wcId, sessionId)

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
   */
  async teardown(wcId: number): Promise<void> {
    const sessions = this.tabs.get(wcId)
    if (!sessions) return
    for (const sessionId of sessions.keys()) {
      await this.closeSession(wcId, sessionId)
    }
    this.tabs.delete(wcId)
  }

  // ── Internal ──

  private async closeSession(wcId: number, sessionId: string): Promise<void> {
    const sessions = this.tabs.get(wcId)
    if (!sessions) return
    const session = sessions.get(sessionId)
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

    sessions.delete(sessionId)
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

    // .xls/.csv conversion (simplified — full conversion logic is in csv-import.ts)
    const stem = path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '')
    const directory = join(app.getPath('temp'), 'genoffice-imports', randomUUID())
    await mkdir(directory, { recursive: true })
    const openPath = join(directory, `${stem}.xlsx`)

    if (extension === 'csv') {
      // CSV conversion — delegate to the csv-import module
      const { csvToXlsxBuffer, decodeCsvBuffer } = await import('../gateway/csv-import')
      const csvBytes = await readFile(path)
      await writeFile(openPath, await csvToXlsxBuffer(decodeCsvBuffer(csvBytes)))
      return { openPath, suggestSaveAs: path.replace(/\.[^.]+$/, '.xlsx'), csvImport: true }
    } else {
      // .xls conversion — delegate to the sidecar's convertWorkbook
      if (this.deps.legacyClient) {
        await this.deps.legacyClient.convertWorkbook({ path, targetPath: openPath })
      }
      return { openPath, suggestSaveAs: path.replace(/\.[^.]+$/, '.xlsx') }
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
