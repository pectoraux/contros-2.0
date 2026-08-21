/**
 * createDocsDesktopBridge — maps window.desktop (DesktopApi, docs variant)
 * to the DocsShellCoordinator + DocumentService + platform capabilities.
 *
 * BOUNDARY CORRECTION (2026-08-21, contract direction + bridge purity):
 *
 *   The bridge is now a GENUINELY THIN adapter:
 *     - Converts legacy types (from @genoffice/docs-shared) to/from runtime types
 *       (from @genoffice/runtime-contracts) — type-level conversion only
 *     - Converts ArrayBuffer → Uint8Array — signature conversion only
 *     - Delegates ALL shell state management (session lookup, error policy,
 *       tab ops, pending-open) to the DocsShellCoordinator
 *     - Delegates domain ops to DocumentService via requireWired(runtime.docs)
 *       — throws if not wired, NO fallback returns, NO isWired branches
 *     - Delegates cross-cutting ops (AI, printing, settings) to runtime capabilities
 *
 *   NO session registration, NO session lookup, NO error policy, NO stub returns.
 *
 * Per ADR-002 Rule 3: methods perform signature conversion only, no business logic.
 */
import type { DesktopApi } from '@genoffice/docs-shared'
import type { RuntimeContext } from '@genoffice/runtime-contracts'
import type { DocsShellCoordinator } from '@genoffice/runtime-contracts'
import { requireWired } from './require-wired.js'

export interface DocsBridgeDeps {
  runtime: RuntimeContext
  coordinator: DocsShellCoordinator
}

export function createDocsDesktopBridge(deps: DocsBridgeDeps): DesktopApi {
  const { runtime, coordinator } = deps

  return {
    // ── Settings (delegate to runtime.settings) ───────────────────────
    getLanguage: () => runtime.settings.getLanguage() as never,
    onLanguageChanged: (handler) => runtime.settings.onLanguageChanged(handler as never),
    getTheme: () => runtime.settings.getTheme() as never,
    onThemeChanged: (handler) => runtime.settings.onThemeChanged(handler as never),
    onChromePressed: (handler) => runtime.windowing.onChromePressed(handler),

    // ── File lifecycle (delegate to coordinator — it owns sessions + pending-open) ──
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
      return docs.onOpened(handler as never)
    },
    onRenamedDocx: (handler) => {
      const docs = requireWired(runtime.docs, 'DocumentService')
      return docs.onRenamed(handler as never)
    },
    onTeardown: (handler) => {
      const docs = requireWired(runtime.docs, 'DocumentService')
      return docs.onTeardown(handler)
    },

    // ── Save (ArrayBuffer → Uint8Array conversion ONLY; coordinator handles the rest) ──
    saveDocx: (path, data, auto) =>
      coordinator.saveDocx(path, new Uint8Array(data), auto),
    writeRecoveryCopy: (path, data) =>
      coordinator.writeRecovery(path, new Uint8Array(data)),
    saveDocxAs: (defaultName, data) =>
      coordinator.saveDocxAs(defaultName, new Uint8Array(data)),
    saveDocxNew: (defaultName, data) =>
      coordinator.saveDocxNew(defaultName, new Uint8Array(data)),

    // ── Domain operations (delegate to DocumentService via requireWired) ──
    getRecentFiles: () => requireWired(runtime.docs, 'DocumentService').recentFiles(),
    pickImage: () => requireWired(runtime.docs, 'DocumentService').pickImage() as never,
    fontMetrics: (family) => requireWired(runtime.docs, 'DocumentService').fontMetrics(family) as never,
    pickAttachments: () => requireWired(runtime.docs, 'DocumentService').pickAttachments() as never,
    addAttachmentPaths: (paths) => requireWired(runtime.docs, 'DocumentService').addAttachmentPaths(paths) as never,
    addPastedImage: (data, ext) => requireWired(runtime.docs, 'DocumentService').addPastedImage(data, ext) as never,
    readAttachment: (path, offset, maxChars) =>
      requireWired(runtime.docs, 'DocumentService').readAttachment(path, offset, maxChars) as never,
    readAttachmentImage: (path) =>
      requireWired(runtime.docs, 'DocumentService').readAttachmentImage(path) as never,
    getPathForFile: (file) => runtime.files.getPathForFile(file),

    // ── Tab management (delegate to coordinator — it owns tab ops) ────
    openNewTab: (openPath) => coordinator.openNewTab(openPath),
    listDocsTabs: () => coordinator.listDocsTabs() as never,
    focusDocsTab: (id) => coordinator.focusDocsTab(id),

    // ── AI (delegate to runtime.ai + runtime.identity) ─────────────────
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
    aiGskStatus: () => runtime.identity.accountStatus() as never,
    aiGskLogin: () => runtime.identity.login() as never,
    webSearch: (query, maxResults) => runtime.ai.webSearch(query, maxResults) as never,
    imageSearch: (query, maxResults) => runtime.ai.imageSearch(query, maxResults) as never,
    fetchImage: (url) => runtime.ai.fetchImage(url) as never,
    onAiStream: (handler) => runtime.ai.onStream(handler),

    // ── Menu / close guard (delegate to DocumentService via requireWired) ──
    onMenuCommand: (handler) => requireWired(runtime.docs, 'DocumentService').onMenuCommand(handler as never),
    onCloseCheck: (handler) => requireWired(runtime.docs, 'DocumentService').onCloseCheck(handler),
    reportCloseCheck: (state) => requireWired(runtime.docs, 'DocumentService').reportCloseCheck(state),
    onCloseSaveRequest: (handler) => requireWired(runtime.docs, 'DocumentService').onCloseSaveRequest(handler),
    reportCloseSaveResult: (ok) => requireWired(runtime.docs, 'DocumentService').reportCloseSaveResult(ok),
    reportViewMenuState: (state) => requireWired(runtime.docs, 'DocumentService').reportViewMenuState(state),
  }
}
