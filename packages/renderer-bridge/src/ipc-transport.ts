/**
 * IpcTransport — runtime-independent IPC interface for preload/preload-like
 * adapters.
 *
 * The renderer-bridge package MUST NOT import Electron. Instead, the
 * preload (or future web runtime) provides an IpcTransport implementation
 * backed by `ipcRenderer` (Electron), `postMessage` (web worker), or
 * `fetch` (remote).
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
 * The bridge has NO caller identity. The caller is derived at the IPC
 * handler boundary from IpcMainInvokeEvent.sender — NOT in the bridge,
 * NOT from global state, NOT from focused-window inference.
 */
export interface IpcTransport {
  /**
   * Invoke a main-process IPC handler and await its response.
   * Maps to `ipcRenderer.invoke(channel, ...args)` in Electron.
   */
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>
  /**
   * Send a fire-and-forget IPC message (no response awaited).
   * Maps to `ipcRenderer.send(channel, ...args)` in Electron.
   */
  send(channel: string, ...args: unknown[]): void
  /**
   * Subscribe to a push-event channel. Returns an unsubscribe function.
   * Maps to `ipcRenderer.on(channel, listener)` +
   * `ipcRenderer.removeListener(channel, listener)` in Electron.
   *
   * The listener receives the event payload arguments (NOT the IpcRendererEvent —
   * the IpcTransport implementation strips it).
   */
  on(channel: string, listener: (...args: unknown[]) => void): () => void
}
