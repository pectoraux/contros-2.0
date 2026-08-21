/**
 * Migrated Docs IPC handlers — per-renderer fidelity.
 *
 * Increment 2D fixes:
 *   - docs:opened routes to the originating wcId ONLY (no broadcast)
 *   - caller-window resolution NEVER falls back to getFocusedWindow()
 *
 * All handlers pass wcId + callerWindow (from event.sender) to the
 * coordinator. Push events route per-wcId. Recovery / external-modified
 * dialogs use the caller's window — resolved via BrowserWindow.fromWebContents
 * (standalone) or the shell-window resolver (shell-tab / WebContentsView).
 */
import { ipcMain, type IpcMainInvokeEvent, BrowserWindow, type WebContents } from 'electron'
import { Buffer } from 'node:buffer'
import type { DocumentService } from '@genoffice/runtime-contracts'
import type { DocsShellCoordinatorImpl } from './docs-coordinator-impl.js'
import type { ElectronFontRegistry } from '@genoffice/platform-electron'
import type { RuntimeContext } from '@genoffice/runtime-contracts'

export interface MigratedHandlersDeps {
  runtime: RuntimeContext
  docsService: DocumentService
  coordinator: DocsShellCoordinatorImpl
  fontRegistry: ElectronFontRegistry
}

// ── Caller-window resolver ────────────────────────────────────────────────
//
// For standalone BrowserWindow usage, BrowserWindow.fromWebContents(wc)
// returns the BrowserWindow that owns the wc. That's the correct dialog
// parent for recovery / external-modified / save-as dialogs.
//
// For shell-tab / WebContentsView usage, fromWebContents may return null
// (the wc is inside a WebContentsView, not a BrowserWindow directly). In
// that case the shell registers a resolver that maps the wc to its owning
// shell BrowserWindow via the actual shell/tab ownership mechanism
// (tabManager → BrowserWindow).
//
// FALLBACK POLICY (explicit):
//   If both fromWebContents AND the shell-window resolver return null
//   (e.g., the wc was destroyed, the shell disconnected, or the wc is in
//   an unmanaged detached view), the dialog is shown WITHOUT a parent —
//   `dialog.showMessageBox(options)` (no parent arg) renders a modeless
//   dialog on the OS default window. This is the safe fallback because:
//     1. The dialog still appears (the user can see and interact with it).
//     2. We never attribute the dialog to the wrong window (window B
//        getting A's recovery dialog just because B is focused).
//     3. A modeless dialog is recoverable — the user can refocus the
//        correct window and re-trigger the operation.
//
//   We NEVER use BrowserWindow.getFocusedWindow() as a fallback. The
//   focused window is unrelated to the IPC caller — using it would
//   attribute A's dialog to B when B is focused, which is the exact
//   defect Increment 2C introduced and Increment 2D corrects.

let callerWindowResolver: ((wc: WebContents) => BrowserWindow | null) | null = null

/**
 * Register a resolver that maps a webContents to its owning shell BrowserWindow.
 *
 * The shell calls this when it creates the shell window (or when the
 * tab→window mapping changes). The resolver is used by `windowFromSender`
 * when `BrowserWindow.fromWebContents(event.sender)` returns null (which
 * happens when the sender is inside a WebContentsView, not a BrowserWindow).
 *
 * Pass `null` to clear the resolver (e.g., when the shell window is closed).
 */
export function setCallerWindowResolver(
  fn: ((wc: WebContents) => BrowserWindow | null) | null,
): void {
  callerWindowResolver = fn
}

/**
 * Derive the BrowserWindow from an IPC event sender.
 *
 * Resolution order:
 *   1. BrowserWindow.fromWebContents(event.sender) — correct for standalone
 *      BrowserWindow usage (the wc is the BrowserWindow's own webContents).
 *   2. callerWindowResolver?.(event.sender) — correct for shell-tab /
 *      WebContentsView usage (the shell resolves the owning BrowserWindow
 *      via its tab→window ownership mechanism).
 *   3. null — the dialog will be shown modeless (no parent). See the
 *      FALLBACK POLICY above.
 *
 * NEVER uses BrowserWindow.getFocusedWindow() — the focused window is
 * unrelated to the IPC caller and would attribute dialogs to the wrong
 * window in multi-renderer scenarios.
 */
export function windowFromSender(event: IpcMainInvokeEvent): BrowserWindow | null {
  return (
    BrowserWindow.fromWebContents(event.sender) ??
    callerWindowResolver?.(event.sender) ??
    null
  )
}

export function registerMigratedDocsIpc(deps: MigratedHandlersDeps): void {
  const { runtime, docsService, coordinator, fontRegistry } = deps

  // ── docs:open ──────────────────────────────────────────────────────
  ipcMain.removeHandler('docs:open')
  ipcMain.handle('docs:open', async (event: IpcMainInvokeEvent) => {
    coordinator.registerWebContents(event.sender.id, event.sender)
    const r = await coordinator.openDocx(event.sender.id, windowFromSender(event))
    return r?.result ?? null
  })

  // ── docs:open-path ──────────────────────────────────────────────────
  ipcMain.removeHandler('docs:open-path')
  ipcMain.handle('docs:open-path', async (event: IpcMainInvokeEvent, filePath: string) => {
    coordinator.registerWebContents(event.sender.id, event.sender)
    const r = await coordinator.openDocxPath(event.sender.id, filePath, windowFromSender(event))
    return r?.result ?? null
  })

  // ── docs:save ──────────────────────────────────────────────────────
  ipcMain.removeHandler('docs:save')
  ipcMain.handle('docs:save',
    async (event: IpcMainInvokeEvent, filePath: string, data: ArrayBuffer, auto?: boolean) =>
      coordinator.saveDocx(event.sender.id, filePath, new Uint8Array(data),
        windowFromSender(event), auto === true))

  // ── docs:save-as ────────────────────────────────────────────────────
  // Increment 2E: pass callerWindow so the save dialog is parented to the
  // caller's window (NOT getFocusedWindow()).
  ipcMain.removeHandler('docs:save-as')
  ipcMain.handle('docs:save-as',
    async (event: IpcMainInvokeEvent, defaultName: string, data: ArrayBuffer) =>
      coordinator.saveDocxAs(event.sender.id, defaultName, new Uint8Array(data),
        windowFromSender(event)))

  // ── docs:save-new ───────────────────────────────────────────────────
  ipcMain.removeHandler('docs:save-new')
  ipcMain.handle('docs:save-new',
    async (event: IpcMainInvokeEvent, defaultName: string, data: ArrayBuffer) =>
      coordinator.saveDocxNew(event.sender.id, defaultName, new Uint8Array(data)))

  // ── docs:write-recovery ─────────────────────────────────────────────
  ipcMain.removeHandler('docs:write-recovery')
  ipcMain.handle('docs:write-recovery',
    async (event: IpcMainInvokeEvent, filePath: string, data: ArrayBuffer) =>
      coordinator.writeRecovery(event.sender.id, filePath, new Uint8Array(data)))

  // ── docs:recent ─────────────────────────────────────────────────────
  ipcMain.removeHandler('docs:recent')
  ipcMain.handle('docs:recent', () => docsService.recentFiles())

  // ── docs:pick-image ─────────────────────────────────────────────────
  // Increment 2E: route through the coordinator so the open dialog is
  // parented to the caller's window (NOT getFocusedWindow()). Previously
  // this bypassed the coordinator and called docsService.pickImage() with
  // no parent — the dialog was parented to the global active window.
  ipcMain.removeHandler('docs:pick-image')
  ipcMain.handle('docs:pick-image', async (event: IpcMainInvokeEvent) =>
    coordinator.pickImage(event.sender.id, windowFromSender(event)))

  // ── docs:font-metrics ───────────────────────────────────────────────
  ipcMain.removeHandler('docs:font-metrics')
  ipcMain.handle('docs:font-metrics', (_event: IpcMainInvokeEvent, family: string) =>
    typeof family === 'string' ? fontRegistry.fontMetrics(family) : Promise.resolve(null))

  // ── docs:print ─────────────────────────────────────────────────────
  ipcMain.removeHandler('docs:print')
  ipcMain.handle('docs:print', (event: IpcMainInvokeEvent) =>
    coordinator.print(event.sender))

  // ── docs:export-pdf ─────────────────────────────────────────────────
  // Increment 2E: pass callerWindow so the save dialog is parented to the
  // caller's window (NOT getFocusedWindow()).
  ipcMain.removeHandler('docs:export-pdf')
  ipcMain.handle('docs:export-pdf',
    async (event: IpcMainInvokeEvent, defaultName: string, pageWidthTwips: number,
      pageHeightTwips: number, outPath?: string) =>
      coordinator.exportPdf(event.sender.id, defaultName, pageWidthTwips,
        pageHeightTwips, outPath, event.sender, windowFromSender(event)))

  // ── docs:print-pdf-buffer ───────────────────────────────────────────
  ipcMain.removeHandler('docs:print-pdf-buffer')
  ipcMain.handle('docs:print-pdf-buffer',
    async (event: IpcMainInvokeEvent, pageWidthTwips: number, pageHeightTwips: number) =>
      coordinator.printPdfBuffer(event.sender, pageWidthTwips, pageHeightTwips))

  // ── docs:save-merged-pdf ───────────────────────────────────────────
  // Increment 2E: pass callerWindow so the save dialog is parented to the
  // caller's window (NOT getFocusedWindow()).
  ipcMain.removeHandler('docs:save-merged-pdf')
  ipcMain.handle('docs:save-merged-pdf',
    async (event: IpcMainInvokeEvent, defaultName: string, base64Parts: string[],
      outPath?: string) =>
      coordinator.saveMergedPdf(event.sender.id, defaultName, base64Parts, outPath,
        windowFromSender(event)))
}
