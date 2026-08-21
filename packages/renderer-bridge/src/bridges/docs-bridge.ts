/**
 * createDocsDesktopBridge — maps window.desktop (DesktopApi, docs variant)
 * to typed IPC calls via an injected DocsIpcTransport.
 *
 * PRELOAD ARCHITECTURE (Increment 2H):
 *   The bridge is a PRELOAD-SIDE adapter. It does NOT call the runtime or
 *   the coordinator directly. It maps each DesktopApi method to the
 *   corresponding IPC channel, using the authoritative channel names and
 *   payload shapes from apps/docs/src/preload/index.ts (the frozen preload).
 *
 * TYPED IPC (Increment 2I):
 *   The transport is typed via DocsIpcTransport (TypedIpcTransport with the
 *   DocsIpcContract channel maps). Every invoke/send/on call is type-checked:
 *     - The channel name must be a known channel
 *     - The argument tuple must match the channel's Args
 *     - The return/payload type is inferred
 *   ZERO `as never` / `as any` / `as unknown as` casts — the types flow
 *   correctly from the typed channel map.
 *
 *     window.desktop.openDocx()
 *         ↓
 *     bridge.openDocx()
 *         ↓
 *     transport.invoke('docs:open')  // typed: Return = OpenFileResult | null
 *         ↓
 *     [Electron: ipcRenderer.invoke('docs:open')]
 *         ↓
 *     ipcMain.handle('docs:open', (event) => ...)
 *         ↓
 *     DocsShellCoordinatorImpl(event.sender.id, callerWindow, ...)
 *
 * ZERO Electron imports. The DocsIpcTransport is injected by the preload
 * (backed by ipcRenderer) or by a future web runtime (backed by
 * postMessage/fetch).
 */
import type { DesktopApi } from '@genoffice/docs-shared'
import type { DocsIpcTransport } from '../ipc-transport.js'

export interface DocsBridgeDeps {
  /** The typed IPC transport (injected by the preload — backed by ipcRenderer). */
  transport: DocsIpcTransport
  /**
   * getPathForFile is a preload-only utility (Electron webUtils.getPathForFile).
   * File objects can't cross IPC, so this must be provided by the preload
   * directly. In a future web runtime, this would be a no-op or placeholder
   * (browsers don't expose absolute file paths).
   */
  getPathForFile: (file: File) => string
}

/**
 * Create the DesktopApi bridge backed by typed IPC.
 *
 * Each method maps to the exact IPC channel name from the frozen preload
 * (apps/docs/src/preload/index.ts). The transport type-checks the channel
 * name, argument tuple, and return type — no casts needed.
 */
export function createDocsDesktopBridge(deps: DocsBridgeDeps): DesktopApi {
  const { transport, getPathForFile } = deps

  return {
    // ── Settings (app:* channels) ────────────────────────────────────
    getLanguage: () => transport.invoke('app:get-language'),
    onLanguageChanged: (handler) =>
      transport.on('app:language-changed', (lang) => handler(lang)),
    getTheme: () => transport.invoke('app:get-theme'),
    onThemeChanged: (handler) =>
      transport.on('app:theme-changed', (theme) => handler(theme)),
    onChromePressed: (handler) =>
      transport.on('app:chrome-pressed', () => handler()),

    // ── File lifecycle (docs:* channels) ──────────────────────────────
    openDocx: () => transport.invoke('docs:open'),
    openDocxPath: (path) => transport.invoke('docs:open-path', path),
    consumePendingOpenDocx: () => transport.invoke('docs:consume-pending-open'),
    consumeNewBlankDoc: () => transport.invoke('docs:consume-new-blank'),

    // ── Push events (docs:opened / docs:renamed / docs:teardown) ─────
    // The main process sends these to the specific wcId via wc.send().
    // The bridge wraps the IPC listener — the renderer handler receives
    // only the payload (not the IpcRendererEvent). The typed transport
    // ensures the payload type matches the DesktopApi handler signature.
    onOpenDocx: (handler) =>
      transport.on('docs:opened', (result) => handler(result)),
    onRenamedDocx: (handler) =>
      transport.on('docs:renamed', (paths) => handler(paths)),
    onTeardown: (handler) => transport.on('docs:teardown', () => handler()),

    // ── Save (docs:* channels) ───────────────────────────────────────
    saveDocx: (path, data, auto) =>
      transport.invoke('docs:save', path, data, auto === true),
    writeRecoveryCopy: (path, data) =>
      transport.invoke('docs:write-recovery', path, data),
    saveDocxAs: (defaultName, data) =>
      transport.invoke('docs:save-as', defaultName, data),
    saveDocxNew: (defaultName, data) =>
      transport.invoke('docs:save-new', defaultName, data),

    // ── Domain operations (docs:* and files:* channels) ───────────────
    getRecentFiles: () => transport.invoke('docs:recent'),
    pickImage: () => transport.invoke('docs:pick-image'),
    fontMetrics: (family) => transport.invoke('docs:font-metrics', family),
    pickAttachments: () => transport.invoke('files:pick'),
    addAttachmentPaths: (paths) => transport.invoke('files:add', paths),
    addPastedImage: (data, ext) =>
      transport.invoke('files:add-pasted-image', data, ext),
    readAttachment: (path, offset, maxChars) =>
      transport.invoke('files:read', path, offset, maxChars),
    readAttachmentImage: (path) => transport.invoke('files:read-image', path),
    // getPathForFile is a preload-only utility (webUtils) — File objects
    // can't cross IPC. The preload provides this function directly.
    getPathForFile,

    // ── Print & export (docs:* channels) ──────────────────────────────
    print: () => transport.invoke('docs:print'),
    exportPdf: (defaultName, w, h, outPath) =>
      transport.invoke('docs:export-pdf', defaultName, w, h, outPath),
    printPdfBuffer: (w, h) =>
      transport.invoke('docs:print-pdf-buffer', w, h),
    saveMergedPdf: (defaultName, parts, outPath) =>
      transport.invoke('docs:save-merged-pdf', defaultName, parts, outPath),

    // ── AI (ai:* channels) ───────────────────────────────────────────
    getAiSettings: () => transport.invoke('ai:get-settings'),
    setAiSettings: (settings) => transport.invoke('ai:set-settings', settings),
    aiChat: (request) => transport.invoke('ai:chat', request),
    aiStream: (request) => transport.invoke('ai:stream', request),
    aiStreamCancel: (requestId) => transport.invoke('ai:stream-cancel', requestId),
    aiGskStatus: (withEmail) => transport.invoke('ai:gsk-status', withEmail),
    aiGskLogin: () => transport.invoke('ai:gsk-login'),
    webSearch: (query, maxResults) =>
      transport.invoke('ai:web-search', query, maxResults),
    imageSearch: (query, maxResults) =>
      transport.invoke('ai:image-search', query, maxResults),
    fetchImage: (url) => transport.invoke('ai:fetch-image', url),
    onAiStream: (handler) =>
      transport.on('ai:stream-chunk', (chunk) => handler(chunk)),

    // ── Tab management (win:* channels) ──────────────────────────────
    openNewTab: (openPath) => transport.invoke('win:new', openPath ?? null),
    listDocsTabs: () => transport.invoke('win:list'),
    focusDocsTab: (id) => transport.invoke('win:focus', id),

    // ── Menu / close guard (menu:*, docs:* channels) ─────────────────
    onMenuCommand: (handler) =>
      transport.on('menu:command', (command, payload) => handler(command, payload)),
    onCloseCheck: (handler) =>
      transport.on('docs:close-check', () => handler()),
    reportViewMenuState: (state) =>
      transport.send('docs:view-menu-state', {
        aiSidebar: state?.aiSidebar === true,
        darkCanvas: state?.darkCanvas === true,
      }),
    reportCloseCheck: (state) =>
      transport.send('docs:close-check-result', {
        dirty: state?.dirty === true,
        autoSave: state?.autoSave === true,
        filePath: typeof state?.filePath === 'string' ? state.filePath : null,
      }),
    onCloseSaveRequest: (handler) =>
      transport.on('docs:close-save-request', () => handler()),
    reportCloseSaveResult: (ok) =>
      transport.send('docs:close-save-result', ok === true),
  }
}
