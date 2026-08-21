/**
 * DocsShellCoordinator implementation.
 *
 * Lives in apps/docs/src/main/ (the application shell).
 * Implements the DocsShellCoordinator interface from renderer-bridge.
 *
 * Owns:
 *   - Session registry (Map<filePath, DocumentSession>)
 *   - Path-grant tracking (docWritablePaths per wcId)
 *   - Disk state tracking (per wcId + filePath)
 *   - Pending-open queue
 *   - New-blank flags
 *   - Tab operations (delegate to shell hooks or BrowserWindow)
 *   - Close-guard coordination
 *   - Recovery copy dialog
 *
 * Delegates domain operations to DocumentService.
 */
import { dialog, type BrowserWindow } from 'electron'
import { existsSync, statSync, readFileSync, unlinkSync } from 'node:fs'
import { join, basename } from 'node:path'
import { Buffer } from 'node:buffer'
import type { DocumentService, DocumentSession } from '@genoffice/runtime-contracts'
import type { ShellTabInfo, ShellMenuCommand } from './docs-shell-types.js'

/** Per-wcId path-grant tracking. */
const docWritablePaths = new Map<number, Set<string>>()
/** Per-wcId disk state (filePath → { mtimeMs, size, hash }). */
const docDiskStates = new Map<number, Map<string, { mtimeMs: number; size: number; hash: string }>>()
/** Per-wcId torn-down flag. */
const tornDownWcIds = new Set<number>()
/** Pending-open path (Finder/Explorer drop at launch). */
let pendingOpenPath: string | null = null
/** Per-wcId new-blank flag. */
const pendingNewBlankIds = new Set<number>()

function allowDocWrite(wcId: number, filePath: string): void {
  const set = docWritablePaths.get(wcId) ?? new Set<string>()
  set.add(filePath)
  docWritablePaths.set(wcId, set)
}

function canDocWrite(wcId: number, filePath: string): boolean {
  return docWritablePaths.get(wcId)?.has(filePath) === true
}

function dropDocWriter(wcId: number): void {
  docWritablePaths.delete(wcId)
  docDiskStates.delete(wcId)
}

async function rememberDiskState(wcId: number, filePath: string, bytes: Uint8Array): Promise<void> {
  const st = statSync(filePath)
  const hash = await sha256Hex(bytes)
  const states = docDiskStates.get(wcId) ?? new Map()
  states.set(filePath, { mtimeMs: st.mtimeMs, size: st.size, hash })
  docDiskStates.set(wcId, states)
}

async function diskChangedExternally(wcId: number, filePath: string): Promise<boolean> {
  const states = docDiskStates.get(wcId)
  const recorded = states?.get(filePath)
  if (!recorded) return false
  try {
    const st = statSync(filePath)
    if (st.mtimeMs === recorded.mtimeMs && st.size === recorded.size) return false
    const bytes = readFileSync(filePath)
    const hash = await sha256Hex(Buffer.from(bytes))
    return hash !== recorded.hash
  } catch {
    return false
  }
}

function recoveryPathFor(userDataDir: string, filePath: string): string {
  const { createHash } = require('node:crypto')
  const sha1 = createHash('sha1').update(filePath).digest('hex')
  return join(userDataDir, 'docs-autosave', `${sha1}.docx`)
}

function clearRecoveryCopy(userDataDir: string, filePath: string): void {
  const p = recoveryPathFor(userDataDir, filePath)
  if (existsSync(p)) {
    try { unlinkSync(p) } catch { /* already gone */ }
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const { createHash } = require('node:crypto')
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex')
}

export interface DocsShellCoordinatorImplDeps {
  docs: DocumentService
  userDataDir: string
  /** Returns the focused window (for dialog parent), or null. */
  getFocusedWindow: () => BrowserWindow | null
  /** Shell hooks for tab management (standalone mode uses BrowserWindow directly). */
  shellHooks?: {
    openTab(openPath?: string, options?: { newBlank?: boolean }): void
    listTabs(): ShellTabInfo[]
    focusTab(id: string): void
    closeActiveTab(): void
  }
}

export class DocsShellCoordinatorImpl {
  private readonly sessions = new Map<string, DocumentSession>()

  constructor(private readonly deps: DocsShellCoordinatorImplDeps) {}

  // ── File lifecycle ──────────────────────────────────────────────────

  async openDocx(): Promise<{ session: DocumentSession; result: import('@genoffice/runtime-contracts').DocumentOpenResult } | null> {
    const result = await this.deps.docs.openDialog()
    if (!result) return null
    this.sessions.set(result.session.filePath, result.session)
    return result
  }

  async openDocxPath(path: string): Promise<{ session: DocumentSession; result: import('@genoffice/runtime-contracts').DocumentOpenResult } | null> {
    const result = await this.deps.docs.open(path)
    if (!result) return null
    this.sessions.set(result.session.filePath, result.session)
    return result
  }

  async consumePendingOpen(): Promise<{ session: DocumentSession; result: import('@genoffice/runtime-contracts').DocumentOpenResult } | null> {
    const filePath = pendingOpenPath
    pendingOpenPath = null
    if (!filePath) return null
    return this.openDocxPath(filePath)
  }

  async consumeNewBlank(): Promise<boolean> {
    // The pendingNewBlankIds set is per-wcId; the coordinator can't know
    // which wcId is calling. The IPC handler checks this before calling
    // the coordinator. For now, return false — the IPC handler handles this.
    return false
  }

  // ── Save coordination ────────────────────────────────────────────────

  async saveDocx(
    path: string,
    data: Uint8Array,
    auto?: boolean,
  ): Promise<{ ok: boolean; error?: string; reason?: 'external-modified' }> {
    const session = this.sessions.get(path)
    if (!session) {
      return { ok: false, error: 'save target is not an opened document' }
    }
    const result = await this.deps.docs.save(session, data, auto)
    if (result.session) this.sessions.set(result.session.filePath, result.session)
    if (result.reason === 'external-modified' && auto !== true) {
      // Show the Overwrite/Cancel dialog (shell behavior)
      const parent = this.deps.getFocusedWindow()
      const options = {
        type: 'warning' as const,
        message: 'The file has been modified by another program.',
        buttons: ['Overwrite', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      }
      const { response } = parent && !parent.isDestroyed()
        ? await dialog.showMessageBox(parent, options)
        : await dialog.showMessageBox(options)
      if (response !== 0) return { ok: false, reason: 'external-modified' }
      // Force save by passing a session without diskState (skips external-modified check)
      const forceSession: DocumentSession = { filePath: path, hash: session.hash }
      const forceResult = await this.deps.docs.save(forceSession, data)
      if (forceResult.session) this.sessions.set(forceResult.session.filePath, forceResult.session)
      return { ok: forceResult.ok, error: forceResult.error }
    }
    // Clear recovery copy (shell behavior)
    clearRecoveryCopy(this.deps.userDataDir, path)
    return { ok: result.ok, error: result.error }
  }

  async saveDocxAs(
    defaultName: string,
    data: Uint8Array,
  ): Promise<{ ok: boolean; path?: string; error?: string }> {
    const session = this.sessions.size > 0
      ? Array.from(this.sessions.values())[0] // Use any existing session (for untitled docs, filePath is empty)
      : null
    // For save-as, we can pass a transient session (empty filePath for untitled docs)
    const transientSession: DocumentSession = session ?? { filePath: '', hash: '' }
    const result = await this.deps.docs.saveAs(transientSession, defaultName, data)
    if (result.ok && result.session) {
      this.sessions.set(result.session.filePath, result.session)
    }
    return { ok: result.ok, path: result.path, error: result.error }
  }

  async saveDocxNew(
    defaultName: string,
    data: Uint8Array,
  ): Promise<{ ok: boolean; path?: string; error?: string }> {
    const result = await this.deps.docs.saveNew(defaultName, data)
    if (result.ok && result.session) {
      this.sessions.set(result.session.filePath, result.session)
    }
    return { ok: result.ok, path: result.path, error: result.error }
  }

  async writeRecovery(path: string, data: Uint8Array): Promise<{ ok: boolean }> {
    const session = this.sessions.get(path)
    if (!session) return { ok: false }
    return this.deps.docs.writeRecovery(session, data)
  }

  // ── Tab operations ──────────────────────────────────────────────────

  async openNewTab(openPath?: string | null): Promise<void> {
    this.deps.shellHooks?.openTab(openPath ?? undefined, openPath ? undefined : { newBlank: true })
  }

  async listDocsTabs(): Promise<ShellTabInfo[]> {
    return this.deps.shellHooks?.listTabs() ?? []
  }

  async focusDocsTab(id: string): Promise<void> {
    this.deps.shellHooks?.focusTab(id)
  }

  // ── Session registry ────────────────────────────────────────────────

  getSession(filePath: string): DocumentSession | null {
    return this.sessions.get(filePath) ?? null
  }

  registerSession(session: DocumentSession): void {
    this.sessions.set(session.filePath, session)
  }

  // ── Shell events ────────────────────────────────────────────────────

  onMenuCommand(_handler: (command: ShellMenuCommand, payload?: string) => void): () => void {
    // Menu command routing is handled by docs-main.ts (sendCommand)
    return () => {}
  }

  reportViewMenuState(_state: { aiSidebar: boolean; darkCanvas: boolean }): void {
    // View menu state is handled by docs-main.ts
  }

  // ── Close guard ──────────────────────────────────────────────────────

  onCloseCheck(_handler: () => void): () => void {
    // Close-check is handled by docs-main.ts (ipcMain.on('docs:close-check-result'))
    return () => {}
  }

  reportCloseCheck(_state: { dirty: boolean; autoSave: boolean; filePath?: string | null }): void {
    // Close-check result is handled by docs-main.ts
  }

  onCloseSaveRequest(_handler: () => void): () => void {
    // Close-save-request is handled by docs-main.ts
    return () => {}
  }

  reportCloseSaveResult(_ok: boolean): void {
    // Close-save-result is handled by docs-main.ts
  }

  // ── Shell state helpers (called by docs-main.ts, not by the bridge) ──

  /** Set the pending-open path (Finder/Explorer drop). */
  static setPendingOpenPath(path: string | null): void {
    pendingOpenPath = path
  }

  /** Mark a wcId as new-blank. */
  static markNewBlank(wcId: number): void {
    pendingNewBlankIds.add(wcId)
  }

  /** Consume the new-blank flag for a wcId. */
  static consumeNewBlankForWc(wcId: number): boolean {
    if (pendingNewBlankIds.has(wcId)) {
      pendingNewBlankIds.delete(wcId)
      return true
    }
    return false
  }

  /** Allow a wcId to write to a path. */
  static allowWrite(wcId: number, filePath: string): void {
    allowDocWrite(wcId, filePath)
  }

  /** Check if a wcId can write to a path. */
  static canWrite(wcId: number, filePath: string): boolean {
    return canDocWrite(wcId, filePath)
  }

  /** Check if a wcId is torn down. */
  static isTornDown(wcId: number): boolean {
    return tornDownWcIds.has(wcId)
  }

  /** Mark a wcId as torn down. */
  static markTornDown(wcId: number): void {
    tornDownWcIds.add(wcId)
    dropDocWriter(wcId)
  }
}
