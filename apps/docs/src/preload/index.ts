/**
 * Docs preload — migrated to the typed compatibility bridge (Increment 3).
 *
 * Architecture:
 *
 *   Renderer (window.desktop)
 *       ↓
 *   createDocsDesktopBridge({ transport, getPathForFile })
 *       ↓
 *   DocsIpcTransport (typed — DocsIpcContract channel map)
 *       ↓
 *   [Electron: ipcRenderer.invoke / ipcRenderer.send / ipcRenderer.on]
 *       ↓
 *   ipcMain handler (derives event.sender → wcId, callerWindow)
 *       ↓
 *   DocsShellCoordinatorImpl(wcId, callerWindow, ...)
 *
 * The handwritten DesktopApi implementation has been REMOVED. The bridge
 * is now the single production implementation of window.desktop.
 *
 * The Electron IPC transport strips the IpcRendererEvent before delivering
 * the typed payload to the bridge listener — matching the frozen preload's
 * per-listener `(_event, ...payload) => handler(...payload)` pattern, but
 * centralized in the transport.
 *
 * projectApi is UNCHANGED — it still uses ipcRenderer directly (not yet
 * migrated to a bridge).
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IpcRendererEvent } from 'electron'
// Import from the docs-specific entry point (NOT the barrel) to avoid pulling
// in the slides bridge, which imports @genoffice/slides-shared. The slides
// shared contract has a `declare global { Window.desktop: DesktopFilesApi }`
// that would conflict with the docs `Window.desktop: DesktopApi` declaration
// in env.d.ts. The docs-entry.ts exports ONLY the docs bridge + typed
// transport + IPC contract — no slides/sheets/pdf/markdown bridges.
import { createDocsDesktopBridge } from '@genoffice/renderer-bridge/docs'
import type { DocsIpcTransport } from '@genoffice/renderer-bridge/docs'
import type { ProjectApi } from '@genoffice/project-store'

// ── Electron IPC transport ─────────────────────────────────────────────
//
// The concrete DocsIpcTransport backed by Electron's ipcRenderer.
// This is the ONLY place that imports Electron in the preload. The bridge
// (renderer-bridge package) has ZERO Electron imports — it receives the
// transport as a dependency.
//
// The `on` method wraps the listener to strip the IpcRendererEvent:
//   ipcRenderer.on(channel, (_event, ...payload) => listener(...payload))
// This matches the frozen preload's per-listener pattern, centralized.

const transport: DocsIpcTransport = {
  invoke(channel, ...args) {
    return ipcRenderer.invoke(channel, ...args)
  },
  send(channel, ...args) {
    ipcRenderer.send(channel, ...args)
  },
  on(channel, listener) {
    // Wrap the listener to strip the IpcRendererEvent. The typed transport
    // guarantees `listener` receives only the payload args (matching the
    // DocsIpcEventChannels map).
    //
    // The payload is forwarded via Function.apply — TypeScript can't verify
    // that `unknown[]` (from ipcRenderer's rest args) satisfies the typed
    // listener's specific tuple (e.g. `[result: OpenFileResult]`). This is
    // the ONE place where the IPC boundary crosses from Electron's untyped
    // ipcRenderer to the typed DocsIpcTransport. The cast is safe because:
    //   1. The channel name is typed (must be a known DocsIpcEventChannels key)
    //   2. The main process sends the payload via wc.send(channel, ...payload)
    //      matching the DocsIpcEventChannels map
    //   3. The bridge's on() method receives the typed listener and forwards
    //      it here — the types are already verified at the bridge level
    const wrapped = (_event: IpcRendererEvent, ...payload: unknown[]) => {
      ;(listener as (...args: unknown[]) => void)(...payload)
    }
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  },
}

// ── DesktopApi (window.desktop) ─────────────────────────────────────────
//
// The bridge is the single production implementation. The old handwritten
// `const api: DesktopApi = { ... }` has been removed.

const api = createDocsDesktopBridge({
  transport,
  getPathForFile: (file) => webUtils.getPathForFile(file),
})

// ── ProjectApi (window.projectApi) — UNCHANGED ─────────────────────────
//
// projectApi is not migrated in this increment. It still uses ipcRenderer
// directly.

const projectApi: ProjectApi = {
  resolveChat: (args) => ipcRenderer.invoke('project:resolveChat', args),
  appendChat: (args) => ipcRenderer.invoke('project:appendChat', args),
  loadChat: (args) => ipcRenderer.invoke('project:loadChat', args),
  rebindChat: (args) => ipcRenderer.invoke('project:rebindChat', args),
  // P1 extensions
  listProjects: () => ipcRenderer.invoke('project:list'),
  createProject: (args) => ipcRenderer.invoke('project:create', args),
  renameProject: (args) => ipcRenderer.invoke('project:rename', args),
  deleteProject: (args) => ipcRenderer.invoke('project:delete', args),
  moveFile: (args) => ipcRenderer.invoke('project:moveFile', args),
  getTimeline: (args) => ipcRenderer.invoke('project:timeline', args),
}

contextBridge.exposeInMainWorld('desktop', api)
contextBridge.exposeInMainWorld('projectApi', projectApi)
