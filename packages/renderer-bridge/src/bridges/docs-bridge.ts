/**
 * createDocsDesktopBridge — maps window.desktop (DesktopApi, docs variant)
 * to the DocsShellCoordinator + DocumentService + platform capabilities.
 *
 * Uses explicit conversion functions (toLegacyLanguage, wrapLanguageHandler)
 * instead of `as never` / `as any` casts.
 *
 * The bridge is a GENUINELY THIN adapter:
 *   - Convert legacy types → runtime types (explicit functions)
 *   - Delegate to coordinator / service / capabilities
 *   - Convert runtime types → legacy types (explicit functions)
 *
 * Where types are structurally identical (e.g. UiTheme, OpenFileResult),
 * TypeScript's structural typing allows direct assignment without a cast.
 */
import type { DesktopApi } from '@genoffice/docs-shared'
import type { RuntimeContext } from '@genoffice/runtime-contracts'
import type { DocsShellCoordinator } from '../shell/docs-coordinator.js'
import { requireWired } from './require-wired.js'
import { toLegacyLanguage, wrapLanguageHandler } from '../conversions/docs-conversions.js'

export interface DocsBridgeDeps {
  runtime: RuntimeContext
  coordinator: DocsShellCoordinator
}

export function createDocsDesktopBridge(deps: DocsBridgeDeps): DesktopApi {
  const { runtime, coordinator } = deps

  return {
    // ── Settings ──────────────────────────────────────────────────────
    // UiTheme is structurally identical — no conversion needed.
    getLanguage: () => runtime.settings.getLanguage().then(toLegacyLanguage),
    onLanguageChanged: (handler) => runtime.settings.onLanguageChanged(wrapLanguageHandler(handler)),
    getTheme: () => runtime.settings.getTheme(),
    onThemeChanged: (handler) => runtime.settings.onThemeChanged(handler),
    onChromePressed: (handler) => runtime.windowing.onChromePressed(handler),

    // ── File lifecycle (delegate to coordinator) ─────────────────────
    openDocx: async () => {
      const r = await coordinator.openDocx()
      return r?.result ?? null
    },
    openDocxPath: async (path: string) => {
      const r = await coordinator.openDocxPath(path)
      return r?.result ?? null
    },
    consumePendingOpenDocx: async () => {
      const r = await coordinator.consumePendingOpen()
      return r?.result ?? null
    },
    consumeNewBlankDoc: () => coordinator.consumeNewBlank(),
    onOpenDocx: (handler) => {
      const docs = requireWired(runtime.docs, 'DocumentService')
      return docs.onOpened(handler)
    },
    onRenamedDocx: (handler) => {
      const docs = requireWired(runtime.docs, 'DocumentService')
      return docs.onRenamed(handler)
    },
    onTeardown: (handler) => {
      const docs = requireWired(runtime.docs, 'DocumentService')
      return docs.onTeardown(handler)
    },

    // ── Save (ArrayBuffer → Uint8Array conversion; coordinator handles the rest) ──
    saveDocx: (path, data, auto) =>
      coordinator.saveDocx(path, new Uint8Array(data), auto),
    writeRecoveryCopy: (path, data) =>
      coordinator.writeRecovery(path, new Uint8Array(data)),
    saveDocxAs: (defaultName, data) =>
      coordinator.saveDocxAs(defaultName, new Uint8Array(data)),
    saveDocxNew: (defaultName, data) =>
      coordinator.saveDocxNew(defaultName, new Uint8Array(data)),

    // ── Domain operations ──────────────────────────────────────────────
    // Increment 2F: pickImage/pickAttachments route through the coordinator
    // (which owns the caller-specific file-picker dialog) instead of calling
    // the service directly. The service's readImage/collectAttachments take
    // already-resolved paths — the bridge can't call them directly because
    // it has no caller window context. The coordinator does.
    getRecentFiles: () => requireWired(runtime.docs, 'DocumentService').recentFiles(),
    pickImage: () => coordinator.pickImage(),
    pickAttachments: () => coordinator.pickAttachments(),
    fontMetrics: (family) => requireWired(runtime.docs, 'DocumentService').fontMetrics(family),
    addAttachmentPaths: (paths) => requireWired(runtime.docs, 'DocumentService').addAttachmentPaths(paths),
    addPastedImage: (data, ext) => requireWired(runtime.docs, 'DocumentService').addPastedImage(data, ext),
    readAttachment: (path, offset, maxChars) =>
      requireWired(runtime.docs, 'DocumentService').readAttachment(path, offset, maxChars),
    readAttachmentImage: (path) =>
      requireWired(runtime.docs, 'DocumentService').readAttachmentImage(path),
    getPathForFile: (file) => runtime.files.getPathForFile(file),

    // ── Tab management (delegate to coordinator) ─────────────────────
    openNewTab: (openPath) => coordinator.openNewTab(openPath),
    listDocsTabs: () => coordinator.listDocsTabs(),
    focusDocsTab: (id) => coordinator.focusDocsTab(id),

    // ── AI (delegate to runtime.ai + runtime.identity) ───────────────
    getAiSettings: () => runtime.ai.getSettings(),
    setAiSettings: (settings) => runtime.ai.setSettings(settings),
    print: () => runtime.printing.print(),
    exportPdf: (defaultName, w, h, outPath) =>
      runtime.printing.exportPdf({ defaultName, pageWidthTwips: w, pageHeightTwips: h, outPath }),
    printPdfBuffer: (w, h) =>
      runtime.printing.printToBytes({ pageWidthTwips: w, pageHeightTwips: h }),
    saveMergedPdf: (defaultName, parts, outPath) =>
      runtime.printing.saveMergedPdf(defaultName, parts, outPath),
    aiChat: (request) => runtime.ai.chat(request),
    aiStream: (request) => runtime.ai.stream(request),
    aiStreamCancel: (requestId) => runtime.ai.streamCancel(requestId),
    aiGskStatus: () => runtime.identity.accountStatus(),
    aiGskLogin: () => runtime.identity.login().then(() => undefined),
    webSearch: (query, maxResults) => runtime.ai.webSearch(query, maxResults),
    imageSearch: (query, maxResults) => runtime.ai.imageSearch(query, maxResults),
    fetchImage: (url) => runtime.ai.fetchImage(url),
    onAiStream: (handler) => runtime.ai.onStream(handler),

    // ── Menu / close guard (delegate to coordinator — shell owns these) ──
    onMenuCommand: (handler) => coordinator.onMenuCommand(handler),
    onCloseCheck: (handler) => coordinator.onCloseCheck(handler),
    reportCloseCheck: (state) => coordinator.reportCloseCheck(state),
    onCloseSaveRequest: (handler) => coordinator.onCloseSaveRequest(handler),
    reportCloseSaveResult: (ok) => coordinator.reportCloseSaveResult(ok),
    reportViewMenuState: (state) => coordinator.reportViewMenuState(state),
  }
}
