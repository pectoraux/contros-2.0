/**
 * SheetsShellCoordinator — owns the per-renderer workbook session lifecycle.
 *
 * RESOURCE OWNERSHIP (Increment 4D/4E):
 *   OwnedResources is created BEFORE the first resource. The operation owns
 *   every resource from creation until transfer() or release().
 *
 * SAVE DISK/SESSION ATOMICITY (Increment 4E):
 *   The save flow writes to a TEMP target first, snapshots the temp, opens
 *   the replacement engine session, THEN atomically promotes temp→final.
 *   This ensures disk and session state are always coherent:
 *     - If replacement open fails: final target unchanged, old session valid
 *     - If teardown occurs: final target unchanged, old session valid
 *     - On success: final target = new bytes, new session = new bytes
 *
 * CONVERSION TEMP OWNERSHIP (Increment 4E):
 *   OwnedResources tracks conversion temp directories. They are cleaned up:
 *     - After snapshot creation (snapshot no longer depends on conversion)
 *     - On any failure (open, teardown, etc.)
 *
 * SAVE PHASE SEPARATION:
 *   Phase A — replacement preparation (temp target + snapshot + open + validate)
 *   Phase B — atomic commit (promote temp→final + install replacement + transfer)
 *   Phase C — old-resource cleanup (isolated, best-effort)
 */

import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, rm, readFile, writeFile, rename } from 'node:fs/promises'
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

      // Snapshot no longer depends on conversion temp — clean it up now
      if (prepared.conversionDir) {
        try { await rm(prepared.conversionDir, { recursive: true, force: true }) } catch {}
        // Clear from owned so it's not double-deleted on release
        // (setConversionDir already set it, but it's been cleaned)
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

  // ── Save (disk/session atomic + 3-phase ownership) ──

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

      // ═══ Phase A: Replacement preparation (disk/session atomic) ═══
      // Write to a TEMP target first. Only promote to final target AFTER
      // the replacement session is fully validated. This ensures:
      //   - If replacement open fails: final target unchanged, old session valid
      //   - If teardown occurs: final target unchanged, old session valid
      //   - On success: final target = new bytes, new session = new bytes
      const owned = new OwnedResources()
      let replacementSession: ShellWorkbookSession
      try {
        // Write to temp target (NOT the final target yet)
        const tempTargetPath = join(dirname(targetPath), `.genoffice-save-${randomUUID()}.xlsx`)
        await writeFile(tempTargetPath, result.data)
        owned.setTempTarget(tempTargetPath)
        this.checkEpoch(wcId, startEpoch)

        // Snapshot the temp target
        const newSnapshotPath = await this.snapshotWorkbook(tempTargetPath)
        owned.setSnapshot(newSnapshotPath)
        this.checkEpoch(wcId, startEpoch)

        // Open replacement engine session
        const newBytes = await readFile(newSnapshotPath)
        const fileName = targetPath.split(/[\\/]/).pop() ?? 'workbook.xlsx'
        const newOpenResult = await this.deps.service.open(new Uint8Array(newBytes), session.locale, fileName)
        owned.setEngineHandle(newOpenResult.engineHandle)
        this.checkEpoch(wcId, startEpoch)

        // Compute new fingerprint
        const newDiskFingerprint = await this.sha256File(newSnapshotPath)
        this.checkEpoch(wcId, startEpoch)

        replacementSession = {
          sessionId, originalPath: targetPath, snapshotPath: newSnapshotPath,
          diskFingerprint: newDiskFingerprint, engineHandle: newOpenResult.engineHandle,
          domainSession: newOpenResult.session, metadata: newOpenResult.metadata,
          locale: session.locale, recoveryEpoch: session.recoveryEpoch + 1,
        }
      } catch (error) {
        // Phase A failure → release new resources (temp target, snapshot, handle).
        // Final target is UNCHANGED. Old session remains valid.
        await owned.release(this.deps.service)
        throw error
      }

      // ═══ Phase B: Atomic commit ═══
      // This is the hard boundary. Promote temp→final AND install replacement
      // session atomically. After this, disk and session are coherent.
      this.checkEpoch(wcId, startEpoch)
      const currentState = this.tabs.get(wcId)
      if (!currentState || currentState.epoch !== startEpoch) {
        // Renderer torn down — release owned resources, don't promote
        await owned.release(this.deps.service)
        throw new InvalidSessionError(`Renderer ${wcId} was torn down during save`)
      }

      // Atomically promote temp target → final target
      try {
        await rename(owned.tempTarget!, targetPath)
      } catch {
        // rename may fail across devices — fall back to copy + delete
        await copyFile(owned.tempTarget!, targetPath)
        await rm(owned.tempTarget!, { force: true })
      }
      // Clear temp target from owned (it's been promoted, not leaked)
      owned.setTempTarget('') // cleared so release() won't try to delete it

      // Clear recovery copies (now that the final target is committed)
      this.clearWorkbookRecovery(targetPath)
      if (session.suggestSaveAs !== undefined) this.clearWorkbookRecovery(session.suggestSaveAs)
      if (session.restoreTarget !== undefined) this.clearWorkbookRecovery(session.restoreTarget)

      // Install replacement session
      currentState.sessions.set(sessionId, replacementSession)
      owned.transfer() // ownership transferred — Phase C cannot touch new resources

      // ═══ Phase C: Old-resource cleanup (isolated, best-effort) ═══
      try { await this.deps.service.close(session.engineHandle) } catch {}
      try { await rm(session.snapshotPath, { force: true }) } catch {}

      return result
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
      // .xls conversion — DEFERRED
      // Clean up the directory we just created
      try { await rm(directory, { recursive: true, force: true }) } catch {}
      throw new EngineError('.xls conversion not yet supported — requires SpreadsheetEngine.convertWorkbook wired through SpreadsheetService', 'INTERNAL_ERROR')
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
