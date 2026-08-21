/**
 * Shell types for the docs editor.
 *
 * These types are shell/UI concerns (tabs, menus, close-guard coordination).
 * They live in renderer-bridge (the application boundary), NOT in
 * runtime-contracts (the runtime-independent layer).
 *
 * NOTE (Increment 2H): the DocsShellCoordinator interface that previously
 * lived here has been REMOVED. The bridge no longer delegates to a
 * coordinator object — it delegates to IPC (transport.invoke/on). The
 * coordinator implementation lives in apps/docs/src/main/docs-coordinator-impl.ts
 * and is called directly by the IPC handlers (docs-migrated-handlers.ts).
 *
 * Architecture:
 *
 *   Renderer (window.desktop)
 *       ↓
 *   DesktopApi (bridge — maps methods to IPC channels)
 *       ↓
 *   IpcTransport.invoke('docs:open') / IpcTransport.on('docs:opened', ...)
 *       ↓
 *   [Electron preload: ipcRenderer] / [Web: postMessage] / [Other: ...]
 *       ↓
 *   ipcMain handler (derives event.sender → wcId, callerWindow)
 *       ↓
 *   DocsShellCoordinatorImpl(wcId, callerWindow, ...)
 *
 * The bridge has NO caller identity and NO coordinator reference. It is
 * a pure IPC adapter.
 */

/** An open docs tab, for View → Switch Tab. */
export interface ShellTabInfo {
  id: string
  title: string
  focused: boolean
}

/**
 * Commands dispatched from the native application menu to the renderer.
 * Shell concern — the native menu is shell, the command is shell.
 */
export type ShellMenuCommand =
  | 'new'
  | 'open'
  | 'open-path'
  | 'save'
  | 'save-as'
  | 'undo'
  | 'redo'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-100'
  | 'zoom-page-width'
  | 'zoom-whole-page'
  | 'toggle-ai'
  | 'toggle-dark'
  | 'insert-table'
  | 'insert-image'
  | 'insert-page-break'
  | 'insert-link'
  | 'insert-equation'
  | 'insert-comment'
  | 'font-dialog'
  | 'paragraph-dialog'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'align-left'
  | 'align-center'
  | 'align-right'
  | 'align-justify'
  | 'page-setup'
  | 'find'
  | 'print'
  | 'export-pdf'
  | 'word-count'
  | 'ai-proofread'
