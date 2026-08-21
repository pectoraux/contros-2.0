/**
 * createDocsDesktopBridge — maps window.desktop (DesktopApi, docs variant)
 * to DocumentService + platform capabilities.
 *
 * Per ADR-002 Rule 3: methods perform signature conversion only, no business logic.
 * ArrayBuffer → Uint8Array conversion happens here for save_ and writeRecovery_ methods.
 */
import type { DesktopApi } from '@genoffice/docs-shared'
import type { RuntimeContext } from '@genoffice/runtime-contracts'

export function createDocsDesktopBridge(runtime: RuntimeContext): DesktopApi {
  const docs = runtime.docs
  return {
    // ── Settings (delegate to runtime.settings) ───────────────────────
    getLanguage: () => runtime.settings.getLanguage() as never,
    onLanguageChanged: (handler) => runtime.settings.onLanguageChanged(handler as never),
    getTheme: () => runtime.settings.getTheme() as never,
    onThemeChanged: (handler) => runtime.settings.onThemeChanged(handler as never),
    onChromePressed: (handler) => runtime.windowing.onChromePressed(handler),

    // ── File lifecycle (delegate to DocumentService) ──────────────────
    openDocx: () => docs.openDialog(),
    openDocxPath: (path) => docs.open(path),
    consumePendingOpenDocx: () => docs.consumePendingOpen(),
    consumeNewBlankDoc: () => docs.consumeNewBlank(),
    onOpenDocx: (handler) => docs.onOpened(handler),
    onRenamedDocx: (handler) => docs.onRenamed(handler),

    // ── Save (ARGUMENT TRANSFORMATION: ArrayBuffer → Uint8Array) ───────
    saveDocx: (path, data, auto) => docs.save(path, new Uint8Array(data), auto),
    writeRecoveryCopy: (path, data) => docs.writeRecovery(path, new Uint8Array(data)),
    saveDocxAs: (defaultName, data) => docs.saveAs(defaultName, new Uint8Array(data)),
    saveDocxNew: (defaultName, data) => docs.saveNew(defaultName, new Uint8Array(data)),

    // ── File/recent operations ────────────────────────────────────────
    getRecentFiles: () => docs.recentFiles(),
    onTeardown: (handler) => docs.onTeardown(handler),

    // ── Images & attachments ───────────────────────────────────────────
    pickImage: () => docs.pickImage(),
    fontMetrics: (family) => docs.fontMetrics(family),
    pickAttachments: () => docs.pickAttachments(),
    addAttachmentPaths: (paths) => docs.addAttachmentPaths(paths),
    addPastedImage: (data, ext) => docs.addPastedImage(data, ext),
    readAttachment: (path, offset, maxChars) => docs.readAttachment(path, offset, maxChars),
    readAttachmentImage: (path) => docs.readAttachmentImage(path),
    getPathForFile: (file) => runtime.files.getPathForFile(file),

    // ── Tab management ────────────────────────────────────────────────
    openNewTab: (openPath) => docs.openNewTab(openPath),
    listDocsTabs: () => docs.listDocsTabs(),
    focusDocsTab: (id) => docs.focusDocsTab(id),

    // ── AI (delegate to runtime.ai + runtime.identity) ─────────────────
    getAiSettings: () => docs.getAiSettings(),
    setAiSettings: (settings) => docs.setAiSettings(settings),
    print: () => docs.print(),
    exportPdf: (defaultName, w, h, outPath) => docs.exportPdf(defaultName, w, h, outPath),
    printPdfBuffer: (w, h) => docs.printPdfBuffer(w, h),
    saveMergedPdf: (defaultName, parts, outPath) => docs.saveMergedPdf(defaultName, parts, outPath),
    aiChat: (request) => docs.aiChat(request),
    aiStream: (request) => docs.aiStream(request),
    aiStreamCancel: (requestId) => docs.aiStreamCancel(requestId),
    aiGskStatus: (withEmail) => runtime.identity.accountStatus() as never,
    aiGskLogin: () => runtime.identity.login() as never,
    webSearch: (query, maxResults) => runtime.ai.webSearch(query, maxResults) as never,
    imageSearch: (query, maxResults) => runtime.ai.imageSearch(query, maxResults) as never,
    fetchImage: (url) => runtime.ai.fetchImage(url) as never,
    onAiStream: (handler) => docs.onAiStream(handler),

    // ── Menu / close guard ────────────────────────────────────────────
    onMenuCommand: (handler) => docs.onMenuCommand(handler),
    onCloseCheck: (handler) => docs.onCloseCheck(handler),
    reportCloseCheck: (state) => docs.reportCloseCheck(state),
    onCloseSaveRequest: (handler) => docs.onCloseSaveRequest(handler),
    reportCloseSaveResult: (ok) => docs.reportCloseSaveResult(ok),
    reportViewMenuState: (state) => docs.reportViewMenuState(state),
  }
}
