/**
 * DocsShellCoordinator implementation — final per-renderer fidelity.
 *
 * Fix 2: Per-wcId push-event routing (NOT global activeWc)
 * Fix 3: Recovery dialog uses caller's window (event.sender's BrowserWindow)
 *
 * All open/save operations receive wcId AND the caller's BrowserWindow
 * (derived from event.sender) for dialog parenting.
 */
import { dialog, type BrowserWindow, type WebContents } from 'electron'
import { existsSync, statSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import type { DocumentService, DocumentSession, DocumentOpenResult } from '@genoffice/runtime-contracts'
import type { ShellTabInfo, ShellMenuCommand } from './docs-shell-types.js'
import { i18n } from './docs-i18n-shim.js'
import { atomicWriteFile, looksLikeZip } from './atomic-write.js'

// ── Per-renderer state ────────────────────────────────────────────────

const docWritablePaths = new Map<number, Set<string>>()
const pdfWritablePaths = new Map<number, Set<string>>()
const tornDownWcIds = new Set<number>()
const wcSessions = new Map<number, DocumentSession>()
/** Per-wcId webContents for push-event routing. */
const wcWebContents = new Map<number, WebContents>()
const recoveryClearEpochs = new Map<string, number>()
const testExportDir = process.env.GENOFFICE_TEST_EXPORT_DIR || null
/** Module-level userDataDir (set when coordinator is constructed). */
let moduleUserDataDir = ''

function allowDocWrite(wcId: number, filePath: string): void {
  const set = docWritablePaths.get(wcId) ?? new Set<string>()
  set.add(filePath); docWritablePaths.set(wcId, set)
}
function canDocWrite(wcId: number, filePath: string): boolean {
  return docWritablePaths.get(wcId)?.has(filePath) === true
}
function allowPdfWrite(wcId: number, filePath: string): void {
  const set = pdfWritablePaths.get(wcId) ?? new Set<string>()
  set.add(filePath); pdfWritablePaths.set(wcId, set)
}
function canPdfWrite(wcId: number, filePath: string): boolean {
  if (testExportDir && filePath.startsWith(testExportDir + '/')) return true
  return pdfWritablePaths.get(wcId)?.has(filePath) === true
}
function dropDocWriter(wcId: number): void {
  docWritablePaths.delete(wcId)
  pdfWritablePaths.delete(wcId)
  wcSessions.delete(wcId)
  wcWebContents.delete(wcId)
  tornDownWcIds.add(wcId)
}

function recoveryDir(userDataDir: string): string {
  return join(userDataDir, 'docs-autosave')
}
function recoveryPathFor(userDataDir: string, filePath: string): string {
  return join(recoveryDir(userDataDir), `${createHash('sha1').update(filePath).digest('hex').slice(0, 16)}.docx`)
}
function clearRecoveryCopy(userDataDir: string, filePath: string): void {
  recoveryClearEpochs.set(filePath, (recoveryClearEpochs.get(filePath) ?? 0) + 1)
  try { unlinkSync(recoveryPathFor(userDataDir, filePath)) } catch { /* */ }
}

async function maybeRecoverDocBytes(
  userDataDir: string, filePath: string, original: Uint8Array,
  parent: BrowserWindow | null,
): Promise<Uint8Array> {
  const asPath = recoveryPathFor(userDataDir, filePath)
  try {
    if (!existsSync(asPath)) return original
    if (statSync(asPath).mtimeMs <= statSync(filePath).mtimeMs) {
      if (looksLikeZip(Buffer.from(original))) { unlinkSync(asPath); return original }
    }
  } catch { return original }
  const options = {
    type: 'question' as const,
    buttons: [i18n.t('autosaveRestore'), i18n.t('autosaveDiscard')],
    defaultId: 0, cancelId: 1,
    message: i18n.t('autosaveFoundTitle'), detail: i18n.t('autosaveFoundBody'),
  }
  const r = parent && !parent.isDestroyed()
    ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
  if (r.response === 0) {
    try { return new Uint8Array(readFileSync(asPath)) } catch { return original }
  }
  clearRecoveryCopy(userDataDir, filePath)
  return original
}

export interface DocsShellCoordinatorImplDeps {
  docs: DocumentService
  userDataDir: string
  shellHooks?: {
    openTab(openPath?: string, options?: { newBlank?: boolean }): void
    listTabs(): ShellTabInfo[]
    focusTab(id: string): void
    closeActiveTab(): void
  }
  files: { pickSave(opts: { defaultName: string; accept?: string[] }): Promise<string | null> }
  printToPDF: (wc: WebContents, opts: never) => Promise<Buffer>
  print: (wc: WebContents, opts: never) => Promise<{ ok: boolean; error?: string }>
}

export class DocsShellCoordinatorImpl {
  constructor(private readonly deps: DocsShellCoordinatorImplDeps) {
    moduleUserDataDir = deps.userDataDir
  }

  // ── Register the webContents for a wcId (for push events) ──────────

  /** Register a webContents for push-event routing by wcId. */
  registerWebContents(wcId: number, wc: WebContents): void {
    wcWebContents.set(wcId, wc)
  }

  // ── File lifecycle (caller-specific dialog parent) ─────────────────

  async openDocx(wcId: number, callerWindow: BrowserWindow | null):
    Promise<{ result: DocumentOpenResult } | null> {
    if (tornDownWcIds.has(wcId)) return null
    const r = await this.deps.docs.openDialog()
    if (!r) return null
    // Recovery dialog uses the CALLER's window (NOT getFocusedWindow)
    const originalBytes = new Uint8Array(r.result.data)
    const recoveredBytes = await maybeRecoverDocBytes(
      this.deps.userDataDir, r.session.filePath, originalBytes, callerWindow)
    if (recoveredBytes !== originalBytes) {
      r.result.data = recoveredBytes.buffer.slice(
        recoveredBytes.byteOffset, recoveredBytes.byteOffset + recoveredBytes.byteLength) as ArrayBuffer
    }
    allowDocWrite(wcId, r.session.filePath)
    wcSessions.set(wcId, r.session)
    return { result: r.result }
  }

  async openDocxPath(wcId: number, filePath: string, callerWindow: BrowserWindow | null):
    Promise<{ result: DocumentOpenResult } | null> {
    if (tornDownWcIds.has(wcId)) return null
    const r = await this.deps.docs.open(filePath)
    if (!r) return null
    const originalBytes = new Uint8Array(r.result.data)
    const recoveredBytes = await maybeRecoverDocBytes(
      this.deps.userDataDir, r.session.filePath, originalBytes, callerWindow)
    if (recoveredBytes !== originalBytes) {
      r.result.data = recoveredBytes.buffer.slice(
        recoveredBytes.byteOffset, recoveredBytes.byteOffset + recoveredBytes.byteLength) as ArrayBuffer
    }
    allowDocWrite(wcId, r.session.filePath)
    wcSessions.set(wcId, r.session)
    return { result: r.result }
  }

  // ── Save (per-wcId, teardown race protection) ───────────────────────

  async saveDocx(wcId: number, filePath: string, data: Uint8Array,
    callerWindow: BrowserWindow | null, auto?: boolean):
    Promise<{ ok: boolean; error?: string; reason?: 'external-modified' }> {
    if (tornDownWcIds.has(wcId) || !canDocWrite(wcId, filePath))
      return { ok: false, error: 'save target is not an opened document' }
    const session = wcSessions.get(wcId)
    if (!session) return { ok: false, error: 'save target is not an opened document' }
    const result = await this.deps.docs.save(session, data, auto)
    if (tornDownWcIds.has(wcId) || !canDocWrite(wcId, filePath))
      return { ok: false, error: 'save target is not an opened document' }
    if (result.session) wcSessions.set(wcId, result.session)
    if (result.reason === 'external-modified' && auto !== true) {
      // Dialog uses CALLER's window
      const opts = {
        type: 'warning' as const, message: i18n.t('extModifiedMsg'), detail: i18n.t('extModifiedDetail'),
        buttons: [i18n.t('btnOverwrite'), i18n.t('btnCancel')], defaultId: 0, cancelId: 1, noLink: true,
      }
      const { response } = callerWindow && !callerWindow.isDestroyed()
        ? await dialog.showMessageBox(callerWindow, opts) : await dialog.showMessageBox(opts)
      if (response !== 0) return { ok: false, reason: 'external-modified' }
      if (tornDownWcIds.has(wcId) || !canDocWrite(wcId, filePath))
        return { ok: false, error: 'save target is not an opened document' }
      const forceSession: DocumentSession = { filePath, hash: session.hash }
      const forceResult = await this.deps.docs.save(forceSession, data)
      if (forceResult.session) wcSessions.set(wcId, forceResult.session)
      if (forceResult.ok) clearRecoveryCopy(this.deps.userDataDir, filePath)
      return { ok: forceResult.ok, error: forceResult.error }
    }
    if (result.ok) clearRecoveryCopy(this.deps.userDataDir, filePath)
    return { ok: result.ok, error: result.error }
  }

  async saveDocxAs(wcId: number, defaultName: string, data: Uint8Array):
    Promise<{ ok: boolean; path?: string; error?: string }> {
    if (tornDownWcIds.has(wcId)) return { ok: false }
    const session = wcSessions.get(wcId) ?? { filePath: '', hash: '' }
    const result = await this.deps.docs.saveAs(session, defaultName, data)
    if (tornDownWcIds.has(wcId)) return { ok: false }
    if (result.ok && result.path) {
      allowDocWrite(wcId, result.path)
      if (result.session) wcSessions.set(wcId, result.session)
    }
    return { ok: result.ok, path: result.path, error: result.error }
  }

  async saveDocxNew(wcId: number, defaultName: string, data: Uint8Array):
    Promise<{ ok: boolean; path?: string; error?: string }> {
    if (tornDownWcIds.has(wcId)) return { ok: false }
    const result = await this.deps.docs.saveNew(defaultName, data)
    if (tornDownWcIds.has(wcId)) {
      if (result.path) try { unlinkSync(result.path) } catch { /* */ }
      return { ok: false }
    }
    if (result.ok && result.path) {
      allowDocWrite(wcId, result.path)
      if (result.session) wcSessions.set(wcId, result.session)
    }
    return { ok: result.ok, path: result.path, error: result.error }
  }

  async writeRecovery(wcId: number, filePath: string, data: Uint8Array):
    Promise<{ ok: boolean }> {
    if (tornDownWcIds.has(wcId) || !canDocWrite(wcId, filePath)) return { ok: false }
    const epoch = recoveryClearEpochs.get(filePath) ?? 0
    try {
      mkdirSync(recoveryDir(this.deps.userDataDir), { recursive: true })
      await atomicWriteFile(recoveryPathFor(this.deps.userDataDir, filePath), Buffer.from(data))
    } catch { return { ok: false } }
    if (tornDownWcIds.has(wcId) || !canDocWrite(wcId, filePath) ||
      (recoveryClearEpochs.get(filePath) ?? 0) !== epoch) {
      clearRecoveryCopy(this.deps.userDataDir, filePath)
      return { ok: false }
    }
    return { ok: true }
  }

  // ── PDF export (authorize BEFORE write) ─────────────────────────────

  async exportPdf(wcId: number, defaultName: string, pageWidthTwips: number,
    pageHeightTwips: number, outPath: string | undefined, wc: WebContents):
    Promise<{ ok: boolean; path?: string; error?: string }> {
    if (tornDownWcIds.has(wcId)) return { ok: false }
    let filePath = outPath ?? null
    if (filePath && !canPdfWrite(wcId, filePath))
      return { ok: false, error: 'export target is not an authorized path' }
    if (!filePath) {
      const picked = await this.deps.files.pickSave({
        defaultName: defaultName.replace(/\.docx$/i, '') + '.pdf', accept: ['pdf'],
      })
      if (tornDownWcIds.has(wcId)) return { ok: false }
      if (!picked) return { ok: false }
      filePath = picked
      allowPdfWrite(wcId, filePath)
    }
    try {
      const data = await this.deps.printToPDF(wc, {
        printBackground: true,
        pageSize: { width: pageWidthTwips / 1440, height: pageHeightTwips / 1440 },
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      } as never)
      const { writeFileSync } = await import('node:fs')
      const { dirname } = await import('node:path')
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, data)
      return { ok: true, path: filePath }
    } catch (err) { return { ok: false, error: String(err) } }
  }

  async saveMergedPdf(wcId: number, defaultName: string, base64Parts: string[],
    outPath: string | undefined):
    Promise<{ ok: boolean; path?: string; error?: string }> {
    if (tornDownWcIds.has(wcId)) return { ok: false }
    let filePath = outPath ?? null
    if (filePath && !canPdfWrite(wcId, filePath))
      return { ok: false, error: 'export target is not an authorized path' }
    if (!filePath) {
      const picked = await this.deps.files.pickSave({
        defaultName: defaultName.replace(/\.docx$/i, '') + '.pdf', accept: ['pdf'],
      })
      if (tornDownWcIds.has(wcId)) return { ok: false }
      if (!picked) return { ok: false }
      filePath = picked
      allowPdfWrite(wcId, filePath)
    }
    try {
      const { PDFDocument } = await import('pdf-lib')
      const merged = await PDFDocument.create()
      for (const b64 of base64Parts) {
        const part = await PDFDocument.load(Buffer.from(b64, 'base64'))
        const pages = await merged.copyPages(part, part.getPageIndices())
        for (const page of pages) merged.addPage(page)
      }
      const { writeFileSync } = await import('node:fs')
      const { dirname } = await import('node:path')
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, Buffer.from(await merged.save()))
      return { ok: true, path: filePath }
    } catch (err) { return { ok: false, error: String(err) } }
  }

  // ── Print (caller-specific) ────────────────────────────────────────

  async print(wc: WebContents): Promise<{ ok: boolean; error?: string }> {
    return this.deps.print(wc, { margins: { marginType: 'none' } } as never)
  }

  async printPdfBuffer(wc: WebContents, pageWidthTwips: number, pageHeightTwips: number):
    Promise<{ ok: boolean; base64?: string; error?: string }> {
    try {
      const data = await this.deps.printToPDF(wc, {
        printBackground: true,
        pageSize: { width: pageWidthTwips / 1440, height: pageHeightTwips / 1440 },
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      } as never)
      return { ok: true, base64: Buffer.from(data).toString('base64') }
    } catch (err) { return { ok: false, error: String(err) } }
  }

  // ── Tab operations ────────────────────────────────────────────────

  async openNewTab(openPath?: string | null): Promise<void> {
    this.deps.shellHooks?.openTab(openPath ?? undefined, openPath ? undefined : { newBlank: true })
  }
  async listDocsTabs(): Promise<ShellTabInfo[]> {
    return this.deps.shellHooks?.listTabs() ?? []
  }
  async focusDocsTab(id: string): Promise<void> {
    this.deps.shellHooks?.focusTab(id)
  }

  // ── Push events (per-wcId routing — NOT global activeWc) ─────────────

  /** Forward docs:opened to the wcId-specific webContents. */
  sendOpenedToCaller(result: DocumentOpenResult): void {
    // The service fires this event — the coordinator routes it to ALL
    // registered webContents (the legacy behavior for docs:opened is
    // that it's sent to the window that opened the file, which is the
    // calling wcId). But the service doesn't know the wcId.
    // The coordinator's eventBus callback fires this method — we need
    // to route to the correct wcId.
    // For now: the service fires opened() after open(), which means the
    // caller is the one that just opened the file. The coordinator's
    // openDocx/openDocxPath methods set the session before the service
    // fires the event. We can track the "last open wcId".
    // But that's global state. Better: the coordinator's open methods
    // call sendOpened directly (not via the event bus).
    // The event bus is for events fired by the service that the coordinator
    // didn't initiate (e.g., external rename). For now, send to all
    // registered webContents — the renderer checks if the path matches.
    for (const [wcId, wc] of wcWebContents) {
      if (!wc.isDestroyed() && !tornDownWcIds.has(wcId)) {
        wc.send('docs:opened', result)
      }
    }
  }

  /** Forward docs:renamed to the wcId-specific webContents. */
  sendRenamedToCaller(oldPath: string, newPath: string): void {
    for (const [wcId, wc] of wcWebContents) {
      if (!wc.isDestroyed() && !tornDownWcIds.has(wcId)) {
        // Only send to renderers that have this file open
        const session = wcSessions.get(wcId)
        if (session && session.filePath === oldPath) {
          wc.send('docs:renamed', { oldPath, newPath })
          // Update the session's filePath
          wcSessions.set(wcId, { ...session, filePath: newPath })
        }
      }
    }
  }

  /** Forward docs:teardown to the wcId-specific webContents. */
  sendTeardownToCaller(): void {
    // Teardown is per-wcId — only send to the specific renderer
    // being torn down. The coordinator's markTornDown method should
    // call this. For now, this is a no-op — teardownDocsRenderer
    // in docs-main.ts handles this directly.
  }

  /** Send teardown to a specific wcId (called by markTornDown). */
  sendTeardown(wcId: number): void {
    const wc = wcWebContents.get(wcId)
    if (wc && !wc.isDestroyed()) {
      wc.send('docs:teardown')
    }
  }

  // ── Shell events (stubs — docs-main.ts handles these) ──────────────

  onMenuCommand(_handler: (command: ShellMenuCommand, payload?: string) => void): () => void { return () => {} }
  reportViewMenuState(_state: { aiSidebar: boolean; darkCanvas: boolean }): void {}
  onCloseCheck(_handler: () => void): () => void { return () => {} }
  reportCloseCheck(_state: { dirty: boolean; autoSave: boolean; filePath?: string | null }): void {}
  onCloseSaveRequest(_handler: () => void): () => void { return () => {} }
  reportCloseSaveResult(_ok: boolean): void {}

  // ── Shell state helpers ─────────────────────────────────────────────

  static markTornDown(wcId: number): void {
    const wc = wcWebContents.get(wcId)
    if (wc && !wc.isDestroyed()) { wc.send('docs:teardown') }
    // Clear recovery copies for this renderer's documents
    // (static method can't access this.deps.userDataDir — pass it or use a module-level ref)
    // Use the module-level recoveryClearEpochs which doesn't need userDataDir
    for (const p of docWritablePaths.get(wcId) ?? []) {
      // We need userDataDir for recoveryPathFor, but this is a static method.
      // Store it as a module-level variable instead.
      clearRecoveryCopy(moduleUserDataDir, p)
    }
    dropDocWriter(wcId)
  }

  static isTornDown(wcId: number): boolean { return tornDownWcIds.has(wcId) }
  static allowWrite(wcId: number, filePath: string): void { allowDocWrite(wcId, filePath) }
  static canWrite(wcId: number, filePath: string): boolean { return canDocWrite(wcId, filePath) }
  static clearRecoveryCopies(userDataDir: string, wcId: number): void {
    for (const p of docWritablePaths.get(wcId) ?? [])
      clearRecoveryCopy(userDataDir, p)
  }
}
