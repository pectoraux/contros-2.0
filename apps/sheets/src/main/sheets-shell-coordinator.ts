/**
 * SheetsShellCoordinator — owns the per-renderer workbook session lifecycle.
 *
 * RESOURCE OWNERSHIP (Increment 4C):
 *   Every newly created resource (snapshot, engine handle) has an explicit
 *   owner. The operation owns the resource from creation until either:
 *     (a) the session registry atomically takes ownership (success), OR
 *     (b) the operation explicitly releases it (failure/teardown).
 *
 *   This is implemented with structured try/finally blocks:
 *     - After snapshot creation: operation owns the snapshot
 *     - After service.open(): operation owns the engine handle
 *     - On ANY failure (including teardown) between creation and transfer:
 *       close handle, remove snapshot, do NOT register/replace session
 *
 * TEARDOWN SERIALIZATION (Increment 4C):
 *   Teardown first invalidates the epoch, then acquires each session's
 *   mutation lock before closing its engine handle. This prevents teardown
 *   from closing a handle while a save/recovery operation is still using it.
 */

import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { existsSync, statSync, unlinkSync } from 'node:fs'
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

// ── ShellWorkbookSession ──

export interface ShellWorkbookSession {
  readonly sessionId: string
  readonly originalPath: string
  readonly snapshotPath: string
  readonly diskFingerprint: string
  readonly suggestSaveAs?: string | undefined
  readonly csvImport?: boolean | undefined
  readonly restoreTarget?: string | undefined
  readonly restoreTargetSha?: string | undefined
  readonly engineHandle: EngineSessionHandle
  readonly domainSession: WorkbookSession
  readonly metadata: import('@genoffice/runtime-contracts').WorkbookMetadata
  readonly locale: string
  readonly recoveryEpoch: number
}

// ── Coordinator deps ──

export interface SheetsShellCoordinatorDeps {
  readonly service: SpreadsheetService
}

// ── Internal: renderer lifecycle ──

interface RendererState {
  readonly sessions: Map<string, ShellWorkbookSession>
  epoch: number
  readonly locks: Map<string, Promise<unknown>>
}

// ── Resource ownership helper ──

/**
 * Tracks owned resources during an operation. On cleanup, releases them
 * in reverse order: engine handle first, then snapshot.
 */
class OwnedResources {
  private snapshotPath: string | undefined
  private engineHandle: EngineSessionHandle | undefined

  setSnapshot(path: string): void { this.snapshotPath = path }
  setEngineHandle(handle: EngineSessionHandle): void { this.engineHandle = handle }

  /** Release all owned resources. Called on failure/teardown. */
  async release(service: SpreadsheetService): Promise<void> {
    if (this.engineHandle) {
      try { await service.close(this.engineHandle) } catch { /* best-effort */ }
      this.engineHandle = undefined
    }
    if (this.snapshotPath) {
      try { await rm(this.snapshotPath, { force: true }) } catch { /* best-effort */ }
      this.snapshotPath = undefined
    }
  }

  /** Transfer ownership to the session registry. Called on success. */
  transfer(): { snapshotPath: string; engineHandle: EngineSessionHandle } {
    const result = {
      snapshotPath: this.snapshotPath!,
      engineHandle: this.engineHandle!,
    }
    this.snapshotPath = undefined
    this.engineHandle = undefined
    return result
  }
}

// ── Coordinator ──

export class SheetsShellCoordinator {
  private readonly tabs = new Map<number, RendererState>()

  constructor(private readonly deps: SheetsShellCoordinatorDeps) {}

  // ── Session registry ──

  registerRenderer(wcId: number, webContents: WebContents): void {
    if (!this.tabs.has(wcId)) {
      this.tabs.set(wcId, { sessions: new Map(), epoch: 0, locks: new Map() })
    }
    webContents.once('destroyed', () => { void this.teardown(wcId) })
  }

  getSession(wcId: number, sessionId: string): ShellWorkbookSession {
    const state = this.tabs.get(wcId)
    if (!state) throw new InvalidSessionError(`Unknown renderer: ${wcId}`)
    const session = state.sessions.get(sessionId)
    if (!session) throw new InvalidSessionError(`Unknown workbook session: ${sessionId}`)
    return session
  }

  wcIdFromEvent(event: IpcMainInvokeEvent): number { return event.sender.id }

  // ── Epoch helpers ──

  private isAlive(wcId: number, startEpoch: number): boolean {
    const state = this.tabs.get(wcId)
    return !!state && state.epoch === startEpoch
  }

  private checkEpoch(wcId: number, startEpoch: number): void {
    if (!this.isAlive(wcId, startEpoch))
      throw new InvalidSessionError(`Renderer ${wcId} was torn down during operation`)
  }

  // ── Per-session mutation lock ──

  private withSessionLock<T>(wcId: number, sessionId: string, fn: () => Promise<T>): Promise<T> {
    const state = this.tabs.get(wcId)
    if (!state) throw new InvalidSessionError(`Unknown renderer: ${wcId}`)
    const prev = state.locks.get(sessionId) ?? Promise.resolve()
    const next = prev.then(() => fn(), () => fn())
    state.locks.set(sessionId, next.catch(() => {}))
    return next
  }

  // ── Open (resource ownership model) ──

  async openWorkbook(
    wcId: number,
    callerWindow: BrowserWindow | undefined,
    options: { queuedPath?: string | undefined; locale: string },
  ): Promise<{ sessionId: string; session: ShellWorkbookSession } | null> {
    let state = this.tabs.get(wcId)
    if (!state) {
      state = { sessions: new Map(), epoch: 0, locks: new Map() }
      this.tabs.set(wcId, state)
    }
    const startEpoch = state.epoch

    // ── 1. Resolve path ──
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

    // ── 2. Prepare file ──
    const prepared = await this.prepareWorkbookForOpen(path, callerWindow)
    this.checkEpoch(wcId, startEpoch)

    // ── 3. Create snapshot — operation now owns it ──
    const snapshotPath = await this.snapshotWorkbook(prepared.openPath)
    this.checkEpoch(wcId, startEpoch)

    // RESOURCE OWNERSHIP: from this point, the operation owns the snapshot
    // and (after service.open) the engine handle. On ANY failure, they
    // must be released. On success, ownership transfers to the session.
    const owned = new OwnedResources()
    owned.setSnapshot(snapshotPath)

    try {
      // ── 4. Read bytes + service.open() ──
      const bytes = await readFile(snapshotPath)
      const fileName = prepared.openPath.split(/[\\/]/).pop() ?? 'workbook.xlsx'
      const openResult = await this.deps.service.open(new Uint8Array(bytes), options.locale, fileName)
      owned.setEngineHandle(openResult.engineHandle) // operation now owns the handle
      this.checkEpoch(wcId, startEpoch)

      // ── 5. Compute disk fingerprint ──
      const diskFingerprint = await this.sha256File(snapshotPath)
      const restoreTargetSha = prepared.restoreTarget
        ? await this.sha256File(prepared.restoreTarget).catch(() => undefined)
        : undefined

      // ── 6. Build session + register ──
      this.checkEpoch(wcId, startEpoch)
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

      // ── 7. Atomically register (ownership transfers) ──
      this.checkEpoch(wcId, startEpoch)
      state = this.tabs.get(wcId)!
      state.sessions.set(sessionId, shellSession)
      owned.transfer() // ownership transferred to session registry

      return { sessionId, session: shellSession }
    } catch (error) {
      // ANY failure after resource creation — release owned resources
      await owned.release(this.deps.service)
      throw error
    }
  }

  // ── Read operations ──

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

  // ── Save (resource ownership model) ──

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
        externalChange = await this.computeExternalChangeStatus(session.restoreTarget, session.restoreTargetSha ?? '')
        this.checkEpoch(wcId, startEpoch)
        targetPath = session.restoreTarget
      } else {
        externalChange = await this.computeExternalChangeStatus(session.originalPath, session.diskFingerprint)
        this.checkEpoch(wcId, startEpoch)
        targetPath = session.originalPath
      }

      // ── 2. service.save() ──
      const result = await this.deps.service.save(session.domainSession, session.engineHandle, request, externalChange)
      this.checkEpoch(wcId, startEpoch)
      if (!result.ok || !result.data) return result

      // ── 3. Persist bytes ──
      await writeFile(targetPath, result.data)
      this.checkEpoch(wcId, startEpoch)

      // ── 4. Clear recovery ──
      this.clearWorkbookRecovery(targetPath)
      if (session.suggestSaveAs !== undefined) this.clearWorkbookRecovery(session.suggestSaveAs)
      if (session.restoreTarget !== undefined) this.clearWorkbookRecovery(session.restoreTarget)

      // ── 5. Create fresh snapshot — operation now owns it ──
      const newSnapshotPath = await this.snapshotWorkbook(targetPath)
      this.checkEpoch(wcId, startEpoch)

      // RESOURCE OWNERSHIP: from here, the operation owns the new snapshot
      // and (after service.open) the new engine handle. On ANY failure,
      // they must be released. On success, ownership transfers to the
      // replacement session.
      const owned = new OwnedResources()
      owned.setSnapshot(newSnapshotPath)

      try {
        // ── 6. Open new engine session ──
        const newBytes = await readFile(newSnapshotPath)
        const fileName = targetPath.split(/[\\/]/).pop() ?? 'workbook.xlsx'
        const newOpenResult = await this.deps.service.open(new Uint8Array(newBytes), session.locale, fileName)
        owned.setEngineHandle(newOpenResult.engineHandle) // operation owns the handle
        this.checkEpoch(wcId, startEpoch)

        // ── 7. Compute new fingerprint ──
        const newDiskFingerprint = await this.sha256File(newSnapshotPath)
        this.checkEpoch(wcId, startEpoch)

        // ── 8. Construct replacement (SAME sessionId + locale) ──
        const replacementSession: ShellWorkbookSession = {
          sessionId,
          originalPath: targetPath,
          snapshotPath: newSnapshotPath,
          diskFingerprint: newDiskFingerprint,
          engineHandle: newOpenResult.engineHandle,
          domainSession: newOpenResult.session,
          metadata: newOpenResult.metadata,
          locale: session.locale,
          recoveryEpoch: session.recoveryEpoch + 1,
        }

        // ── 9. Atomically replace (ownership transfers) ──
        this.checkEpoch(wcId, startEpoch)
        const currentState = this.tabs.get(wcId)
        if (!currentState || currentState.epoch !== startEpoch) {
          // Renderer torn down — release owned resources (handle + snapshot)
          await owned.release(this.deps.service)
          throw new InvalidSessionError(`Renderer ${wcId} was torn down during save`)
        }

        currentState.sessions.set(sessionId, replacementSession)
        owned.transfer() // ownership transferred to replacement session

        // ── 10. Close old handle (best-effort, AFTER replacement installed) ──
        try { await this.deps.service.close(session.engineHandle) } catch { /* best-effort */ }

        // ── 11. Remove old snapshot ──
        await rm(session.snapshotPath, { force: true })

        return result
      } catch (error) {
        // ANY failure after new resources created — release them
        await owned.release(this.deps.service)
        throw error
      }
    })
  }

  // ── Recovery ──

  async writeRecovery(wcId: number, sessionId: string, request: SaveRequest): Promise<{ ok: boolean }> {
    let startRecoveryEpoch: number
    try { startRecoveryEpoch = this.getSession(wcId, sessionId).recoveryEpoch } catch { return { ok: false } }

    return this.withSessionLock(wcId, sessionId, async () => {
      let session: ShellWorkbookSession
      try { session = this.getSession(wcId, sessionId) } catch { return { ok: false } }

      if (session.suggestSaveAs !== undefined || session.restoreTarget !== undefined) return { ok: false }

      try {
        const result = await this.deps.service.writeRecovery(session.domainSession, session.engineHandle, request)
        const currentSession = this.tabs.get(wcId)?.sessions.get(sessionId)
        if (!currentSession || currentSession.recoveryEpoch !== startRecoveryEpoch) return { ok: false }

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
    // Acquire the session lock so we don't close a handle while a mutation is using it
    await this.withSessionLock(wcId, sessionId, async () => {
      await this.closeSession(wcId, sessionId)
    })
  }

  // ── Teardown (serialized with mutations) ──

  /**
   * Teardown first invalidates the epoch, then acquires each session's
   * mutation lock before closing its engine handle. This prevents teardown
   * from closing a handle while a save/recovery operation is still using it.
   */
  async teardown(wcId: number): Promise<void> {
    const state = this.tabs.get(wcId)
    if (!state) return

    // ── 1. Invalidate the epoch ──
    // Any in-flight operation will detect the epoch change at its next
    // checkEpoch() and abort. But we still need to wait for operations
    // that are currently inside service.save() or service.open() — they
    // won't check the epoch until AFTER the service call returns.
    state.epoch++

    // ── 2. Acquire each session's lock before closing ──
    // This ensures we don't close a handle while a mutation (save/recovery)
    // is still using it. The mutation will complete (or abort at checkEpoch),
    // then the lock releases, then we close.
    const sessionIds = [...state.sessions.keys()]
    await Promise.all(sessionIds.map(async (sid) => {
      await this.withSessionLock(wcId, sid, async () => {
        await this.closeSession(wcId, sid)
      })
    }))

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

  // ── ExternalChangeStatus ──

  private async computeExternalChangeStatus(filePath: string, storedFingerprint: string): Promise<ExternalChangeStatus> {
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
    path: string, parent: BrowserWindow | undefined,
  ): Promise<{ openPath: string; suggestSaveAs?: string; csvImport?: boolean; restoreTarget?: string }> {
    const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
    if (extension !== 'csv' && extension !== 'xls') {
      const recovery = this.pendingRecoveryFor(path)
      if (recovery) {
        const options = {
          type: 'question' as const, buttons: ['Restore', 'Discard'], defaultId: 0, cancelId: 1,
          message: 'Crash recovery copy found',
          detail: 'Unsaved work from a previous session was found. Restore it?',
        }
        const answer = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
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
      // .xls conversion — DEFERRED
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

  private recoveryDir(): string { return join(app.getPath('userData'), 'sheets-autosave') }

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
      if (statSync(copy).mtimeMs <= statSync(filePath).mtimeMs) { unlinkSync(copy); return null }
      return copy
    } catch { return null }
  }
}
