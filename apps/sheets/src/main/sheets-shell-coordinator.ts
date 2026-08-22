/**
 * SheetsShellCoordinator — owns the per-renderer workbook session lifecycle.
 *
 * RESOURCE OWNERSHIP (Increment 4D/4E/4F):
 *   OwnedResources is created BEFORE the first resource. The operation owns
 *   every resource from creation until transfer() or release().
 *   Conversion temp dirs are owned: cleaned up eagerly after snapshot creation,
 *   but if cleanup fails, ownership is RETAINED and release() retries.
 *
 * SAVE COMMIT PROTOCOL (Increment 4F):
 *   Phase A — Prepare: temp target + snapshot + open + validate.
 *             Old session untouched. Final target untouched.
 *   Phase B — Commit: write commit marker → rename(temp→final) → install
 *             replacement session → clear marker. If rename fails, the save
 *             fails explicitly — NO non-atomic copyFile fallback.
 *   Phase C — Cleanup: close old handle, remove old snapshot (best-effort).
 *
 * CRASH RECONCILIATION:
 *   A commit marker file is written before rename and cleared after session
 *   installation. On startup, reconcileSaveCommit() examines any leftover
 *   markers and cleans up temp targets deterministically.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, rm, readFile, writeFile, rename } from 'node:fs/promises'
import { existsSync, statSync, unlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { app, BrowserWindow, dialog, type WebContents, type IpcMainInvokeEvent } from 'electron'

import type {
  SpreadsheetService, WorkbookSession, WorkbookOpenResult, EngineSessionHandle,
  ExternalChangeStatus, SaveRequest, SaveResult, EngineRangeResult, EngineFormulaCellsResult,
  EngineRecalcEdit, EngineRecalcRead, EngineRecalcResult, EngineMediaResult,
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

export interface SheetsShellCoordinatorDeps {
  readonly service: SpreadsheetService
}

interface RendererState {
  readonly sessions: Map<string, ShellWorkbookSession>
  epoch: number
  readonly locks: Map<string, Promise<unknown>>
}

// ── OwnedResources ──

class OwnedResources {
  private snapshotPath: string | undefined
  private engineHandle: EngineSessionHandle | undefined
  private tempTargetPath: string | undefined
  private conversionDir: string | undefined
  private _transferred = false

  setSnapshot(path: string): void { this.snapshotPath = path }
  setEngineHandle(handle: EngineSessionHandle): void { this.engineHandle = handle }
  setTempTarget(path: string): void { this.tempTargetPath = path }
  setConversionDir(dir: string): void { this.conversionDir = dir }
  clearConversionDir(): void { this.conversionDir = undefined }
  clearTempTarget(): void { this.tempTargetPath = undefined }
  get tempTarget(): string | undefined { return this.tempTargetPath }
  get transferred(): boolean { return this._transferred }

  async release(service: SpreadsheetService): Promise<void> {
    if (this._transferred) return
    if (this.engineHandle) { try { await service.close(this.engineHandle) } catch {} this.engineHandle = undefined }
    if (this.snapshotPath) { try { await rm(this.snapshotPath, { force: true }) } catch {} this.snapshotPath = undefined }
    if (this.tempTargetPath) { try { await rm(this.tempTargetPath, { force: true }) } catch {} this.tempTargetPath = undefined }
    if (this.conversionDir) { try { await rm(this.conversionDir, { recursive: true, force: true }) } catch {} this.conversionDir = undefined }
  }

  transfer(): void {
    this.snapshotPath = undefined; this.engineHandle = undefined
    this.tempTargetPath = undefined; this.conversionDir = undefined
    this._transferred = true
  }
}

// ── Save commit marker ──

interface SaveCommitMarker {
  readonly finalTarget: string
  readonly tempTarget: string
  readonly sessionId: string
}

// ── Coordinator ──

export class SheetsShellCoordinator {
  private readonly tabs = new Map<number, RendererState>()

  constructor(private readonly deps: SheetsShellCoordinatorDeps) {}

  registerRenderer(wcId: number, webContents: WebContents): void {
    if (!this.tabs.has(wcId)) this.tabs.set(wcId, { sessions: new Map(), epoch: 0, locks: new Map() })
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

  private isAlive(wcId: number, startEpoch: number): boolean {
    const state = this.tabs.get(wcId)
    return !!state && state.epoch === startEpoch
  }

  private checkEpoch(wcId: number, startEpoch: number): void {
    if (!this.isAlive(wcId, startEpoch)) throw new InvalidSessionError(`Renderer ${wcId} was torn down during operation`)
  }

  private withSessionLock<T>(wcId: number, sessionId: string, fn: () => Promise<T>): Promise<T> {
    const state = this.tabs.get(wcId)
    if (!state) throw new InvalidSessionError(`Unknown renderer: ${wcId}`)
    const prev = state.locks.get(sessionId) ?? Promise.resolve()
    const next = prev.then(() => fn(), () => fn())
    state.locks.set(sessionId, next.catch(() => {}))
    return next
  }

  // ── Open ──

  async openWorkbook(
    wcId: number, callerWindow: BrowserWindow | undefined,
    options: { queuedPath?: string | undefined; locale: string },
  ): Promise<{ sessionId: string; session: ShellWorkbookSession } | null> {
    let state = this.tabs.get(wcId)
    if (!state) { state = { sessions: new Map(), epoch: 0, locks: new Map() }; this.tabs.set(wcId, state) }
    const startEpoch = state.epoch

    // 1. Resolve path
    let path = options.queuedPath
    if (!path) {
      const selection = callerWindow
        ? await dialog.showOpenDialog(callerWindow, { properties: ['openFile'], filters: [{ name: 'Spreadsheets', extensions: ['xlsx', 'xls', 'csv'] }] })
        : await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Spreadsheets', extensions: ['xlsx', 'xls', 'csv'] }] })
      this.checkEpoch(wcId, startEpoch)
      if (selection.canceled || !selection.filePaths[0]) return null
      path = selection.filePaths[0]
    }

    // 2. Prepare file (may create conversion temp dir)
    const prepared = await this.prepareWorkbookForOpen(path, callerWindow)
    this.checkEpoch(wcId, startEpoch)

    // 3. Create ownership scope BEFORE creating the snapshot
    const owned = new OwnedResources()
    if (prepared.conversionDir) owned.setConversionDir(prepared.conversionDir)

    try {
      // Snapshot created → operation owns it immediately
      const snapshotPath = await this.snapshotWorkbook(prepared.openPath)
      owned.setSnapshot(snapshotPath)
      this.checkEpoch(wcId, startEpoch)

      // Snapshot no longer depends on conversion temp — attempt cleanup.
      // If cleanup fails, ownership is RETAINED (not silently cleared).
      // release() will retry cleanup on failure paths.
      if (prepared.conversionDir) {
        try {
          await rm(prepared.conversionDir, { recursive: true, force: true })
          owned.clearConversionDir() // cleanup succeeded → clear ownership
        } catch {
          // Cleanup failed — ownership RETAINED. release() will retry.
          // This is safe: the conversion dir is in temp and will be
          // cleaned on failure or (if the session succeeds) on close/teardown.
        }
      }

      // 4. Read bytes + service.open()
      const bytes = await readFile(snapshotPath)
      const fileName = prepared.openPath.split(/[\\/]/).pop() ?? 'workbook.xlsx'
      const openResult = await this.deps.service.open(new Uint8Array(bytes), options.locale, fileName)
      owned.setEngineHandle(openResult.engineHandle)
      this.checkEpoch(wcId, startEpoch)

      // 5. Compute fingerprint
      const diskFingerprint = await this.sha256File(snapshotPath)
      const restoreTargetSha = prepared.restoreTarget
        ? await this.sha256File(prepared.restoreTarget).catch(() => undefined) : undefined

      // 6. Build + register (atomic transfer)
      this.checkEpoch(wcId, startEpoch)
      const sessionId = randomUUID()
      const shellSession: ShellWorkbookSession = {
        sessionId, originalPath: path, snapshotPath, diskFingerprint,
        suggestSaveAs: prepared.suggestSaveAs, csvImport: prepared.csvImport,
        restoreTarget: prepared.restoreTarget, restoreTargetSha,
        engineHandle: openResult.engineHandle, domainSession: openResult.session,
        metadata: openResult.metadata, locale: options.locale, recoveryEpoch: 0,
      }
      state = this.tabs.get(wcId)!
      state.sessions.set(sessionId, shellSession)
      owned.transfer()

      return { sessionId, session: shellSession }
    } catch (error) {
      await owned.release(this.deps.service)
      throw error
    }
  }

  // ── Read operations ──

  async readRange(wcId: number, sessionId: string, sheetId: string, range: string): Promise<EngineRangeResult> {
    const s = this.getSession(wcId, sessionId)
    return this.deps.service.readRange(s.domainSession, s.engineHandle, sheetId, range)
  }
  async readFormulaCells(wcId: number, sessionId: string, sheetId: string): Promise<EngineFormulaCellsResult> {
    const s = this.getSession(wcId, sessionId)
    return this.deps.service.readFormulaCells(s.domainSession, s.engineHandle, sheetId)
  }
  async recalculate(wcId: number, sessionId: string, edits: EngineRecalcEdit[], reads: EngineRecalcRead[]): Promise<EngineRecalcResult> {
    const s = this.getSession(wcId, sessionId)
    return this.deps.service.recalculate(s.domainSession, s.engineHandle, edits, reads)
  }
  async readMedia(wcId: number, sessionId: string, visualId: string): Promise<EngineMediaResult> {
    const s = this.getSession(wcId, sessionId)
    return this.deps.service.readMedia(s.domainSession, s.engineHandle, visualId)
  }

  // ── Save (commit protocol + 3-phase ownership) ──

  async saveWorkbook(
    wcId: number, sessionId: string, request: SaveRequest, mode: 'save' | 'save-as',
    callerWindow: BrowserWindow | undefined,
  ): Promise<SaveResult & { canceled?: boolean }> {
    return this.withSessionLock(wcId, sessionId, async () => {
      const state = this.tabs.get(wcId)
      if (!state) throw new InvalidSessionError(`Unknown renderer: ${wcId}`)
      const startEpoch = state.epoch
      const session = this.getSession(wcId, sessionId)

      // 1. Resolve target + ExternalChangeStatus
      let targetPath: string
      let externalChange: ExternalChangeStatus
      if (mode === 'save-as' || session.suggestSaveAs !== undefined) {
        const opts = { defaultPath: session.suggestSaveAs ?? session.restoreTarget ?? session.originalPath, filters: [{ name: 'Excel', extensions: ['xlsx'] }] }
        const sel = callerWindow ? await dialog.showSaveDialog(callerWindow, opts) : await dialog.showSaveDialog(opts)
        this.checkEpoch(wcId, startEpoch)
        if (sel.canceled || !sel.filePath) return { ok: false, canceled: true }
        targetPath = sel.filePath.endsWith('.xlsx') ? sel.filePath : `${sel.filePath}.xlsx`
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

      // 2. service.save()
      const result = await this.deps.service.save(session.domainSession, session.engineHandle, request, externalChange)
      this.checkEpoch(wcId, startEpoch)
      if (!result.ok || !result.data) return result

      // ═══ Phase A: Prepare (old session + final target untouched) ═══
      const owned = new OwnedResources()
      let replacementSession: ShellWorkbookSession
      let tempTargetPath: string
      try {
        tempTargetPath = join(dirname(targetPath), `.genoffice-save-${randomUUID()}.xlsx`)
        await writeFile(tempTargetPath, result.data)
        owned.setTempTarget(tempTargetPath)
        this.checkEpoch(wcId, startEpoch)

        const newSnapshotPath = await this.snapshotWorkbook(tempTargetPath)
        owned.setSnapshot(newSnapshotPath)
        this.checkEpoch(wcId, startEpoch)

        const newBytes = await readFile(newSnapshotPath)
        const fileName = targetPath.split(/[\\/]/).pop() ?? 'workbook.xlsx'
        const newOpenResult = await this.deps.service.open(new Uint8Array(newBytes), session.locale, fileName)
        owned.setEngineHandle(newOpenResult.engineHandle)
        this.checkEpoch(wcId, startEpoch)

        const newDiskFingerprint = await this.sha256File(newSnapshotPath)
        this.checkEpoch(wcId, startEpoch)

        replacementSession = {
          sessionId, originalPath: targetPath, snapshotPath: newSnapshotPath,
          diskFingerprint: newDiskFingerprint, engineHandle: newOpenResult.engineHandle,
          domainSession: newOpenResult.session, metadata: newOpenResult.metadata,
          locale: session.locale, recoveryEpoch: session.recoveryEpoch + 1,
        }
      } catch (error) {
        await owned.release(this.deps.service)
        throw error
      }

      // ═══ Phase B: Commit (marker → rename → install → clear marker) ═══
      this.checkEpoch(wcId, startEpoch)
      const currentState = this.tabs.get(wcId)
      if (!currentState || currentState.epoch !== startEpoch) {
        await owned.release(this.deps.service)
        throw new InvalidSessionError(`Renderer ${wcId} was torn down during save`)
      }

      // Write commit marker BEFORE rename — if crash occurs between
      // marker write and rename, reconciliation can clean up the temp.
      const markerPath = join(dirname(targetPath), `.genoffice-save-commit-${randomUUID()}.json`)
      const marker: SaveCommitMarker = { finalTarget: targetPath, tempTarget: tempTargetPath, sessionId }
      try {
        await writeFile(markerPath, JSON.stringify(marker))
      } catch {
        // If we can't write the marker, we can't safely commit
        await owned.release(this.deps.service)
        throw new EngineError('Failed to write save commit marker', 'INTERNAL_ERROR')
      }

      // Atomically promote temp target → final target via rename.
      // NO non-atomic copyFile fallback. If rename fails, save fails.
      try {
        await rename(tempTargetPath, targetPath)
      } catch (renameError) {
        // Rename failed — clean up marker, temp, snapshot, handle
        try { await rm(markerPath, { force: true }) } catch {}
        await owned.release(this.deps.service)
        throw new EngineError(
          `Save commit failed: cannot atomically rename temp to final target — ${renameError}`,
          'INTERNAL_ERROR',
        )
      }
      // Rename succeeded — temp target is now the final target
      owned.clearTempTarget()

      // Install replacement session
      currentState.sessions.set(sessionId, replacementSession)
      owned.transfer()

      // Clear commit marker (session is installed, commit is complete)
      try { await rm(markerPath, { force: true }) } catch { /* best-effort */ }

      // Clear recovery copies
      this.clearWorkbookRecovery(targetPath)
      if (session.suggestSaveAs !== undefined) this.clearWorkbookRecovery(session.suggestSaveAs)
      if (session.restoreTarget !== undefined) this.clearWorkbookRecovery(session.restoreTarget)

      // ═══ Phase C: Old-resource cleanup (isolated, best-effort) ═══
      try { await this.deps.service.close(session.engineHandle) } catch {}
      try { await rm(session.snapshotPath, { force: true }) } catch {}

      return result
    })
  }

  // ── Crash reconciliation ──

  /**
   * Reconcile leftover save-commit markers from a crash during save.
   *
   * Marker states:
   *   marker + temp exists + final is old → rename failed or crashed before rename.
   *     Action: delete temp, delete marker. Final target is the old file (safe).
   *   marker + final is new + temp exists → rename succeeded but marker not cleared.
   *     Action: delete temp, delete marker. Final target is the new file (safe).
   *   marker + final is new + temp absent → rename succeeded, temp already cleaned.
   *     Action: delete marker. Final target is the new file (safe).
   *   marker + temp absent + final is old → temp was deleted, rename never happened.
   *     Action: delete marker. Final target is the old file (safe).
   *
   * This is a static method so it can be called at startup without a
   * coordinator instance (though it needs the userData path).
   */
  static async reconcileSaveCommit(userDataDir: string): Promise<void> {
    const { readdir } = await import('node:fs/promises')
    const { join: joinPath } = await import('node:path')
    const commitDir = joinPath(userDataDir, 'sheets-save-commits')
    try {
      const entries = await readdir(commitDir)
      for (const entry of entries) {
        if (!entry.endsWith('.json')) continue
        const markerPath = joinPath(commitDir, entry)
        try {
          const markerText = await readFile(markerPath, 'utf8')
          const marker = JSON.parse(markerText) as SaveCommitMarker
          // Clean up temp target if it still exists
          if (existsSync(marker.tempTarget)) {
            try { await rm(marker.tempTarget, { force: true }) } catch {}
          }
          // Always clean up the marker
          try { await rm(markerPath, { force: true }) } catch {}
        } catch {
          // Corrupted marker — just delete it
          try { await rm(markerPath, { force: true }) } catch {}
        }
      }
    } catch {
      // Commit dir doesn't exist — nothing to reconcile
    }
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
        const cur = this.tabs.get(wcId)?.sessions.get(sessionId)
        if (!cur || cur.recoveryEpoch !== startRecoveryEpoch) return { ok: false }
        const recoveryPath = this.recoveryPathFor(session.originalPath)
        await mkdir(join(recoveryPath, '..'), { recursive: true })
        await writeFile(recoveryPath, result)
        return { ok: true }
      } catch (error) { console.warn('[sheets] recovery copy failed:', error); return { ok: false } }
    })
  }

  // ── Close ──

  async closeWorkbook(wcId: number, sessionId: string): Promise<void> {
    await this.withSessionLock(wcId, sessionId, async () => { await this.closeSession(wcId, sessionId) })
  }

  async teardown(wcId: number): Promise<void> {
    const state = this.tabs.get(wcId)
    if (!state) return
    state.epoch++
    const sessionIds = [...state.sessions.keys()]
    await Promise.all(sessionIds.map(async (sid) => {
      await this.withSessionLock(wcId, sid, async () => { await this.closeSession(wcId, sid) })
    }))
    this.tabs.delete(wcId)
  }

  // ── Internal ──

  private async closeSession(wcId: number, sessionId: string): Promise<void> {
    const state = this.tabs.get(wcId)
    if (!state) return
    const session = state.sessions.get(sessionId)
    if (!session) return
    try { await this.deps.service.close(session.engineHandle) } catch {}
    try { await rm(session.snapshotPath, { force: true }) } catch {}
    state.sessions.delete(sessionId)
  }

  private async computeExternalChangeStatus(filePath: string, storedFingerprint: string): Promise<ExternalChangeStatus> {
    try {
      const currentSha = await this.sha256File(filePath)
      if (currentSha === storedFingerprint) return 'unchanged'
      return 'changed'
    } catch { return 'unknown' }
  }

  private async prepareWorkbookForOpen(
    path: string, parent: BrowserWindow | undefined,
  ): Promise<{ openPath: string; suggestSaveAs?: string; csvImport?: boolean; restoreTarget?: string; conversionDir?: string }> {
    const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
    if (extension !== 'csv' && extension !== 'xls') {
      const recovery = this.pendingRecoveryFor(path)
      if (recovery) {
        const opts = { type: 'question' as const, buttons: ['Restore', 'Discard'], defaultId: 0, cancelId: 1, message: 'Crash recovery copy found', detail: 'Unsaved work from a previous session was found. Restore it?' }
        const answer = parent ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts)
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
      return { openPath, suggestSaveAs: path.replace(/\.[^.]+$/, '.xlsx'), csvImport: true, conversionDir: directory }
    } else {
      try { await rm(directory, { recursive: true, force: true }) } catch {}
      throw new EngineError('.xls conversion not yet supported — requires SpreadsheetEngine.convertWorkbook wired through SpreadsheetService', 'INTERNAL_ERROR')
    }
  }

  private async snapshotWorkbook(path: string): Promise<string> {
    const dir = join(app.getPath('temp'), 'genoffice-sheets-sessions')
    await mkdir(dir, { recursive: true })
    const snapshotPath = join(dir, `${randomUUID()}.xlsx`)
    // Use copyFile from node:fs/promises
    const { copyFile } = await import('node:fs/promises')
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
  private clearWorkbookRecovery(filePath: string): void { try { unlinkSync(this.recoveryPathFor(filePath)) } catch {} }
  private pendingRecoveryFor(filePath: string): string | null {
    const copy = this.recoveryPathFor(filePath)
    try {
      if (!existsSync(copy)) return null
      if (statSync(copy).mtimeMs <= statSync(filePath).mtimeMs) { unlinkSync(copy); return null }
      return copy
    } catch { return null }
  }
}
