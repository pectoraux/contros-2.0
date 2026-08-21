/**
 * createDocsDesktopBridge — maps window.desktop (DesktopApi, docs variant)
 * to DocumentService + platform capabilities.
 *
 * BOUNDARY CORRECTION (2026-08-21): the DocumentService is now session-scoped.
 * open() returns { session, result }; save() accepts the session.
 * The bridge holds the session map (wcId → DocumentSession) — this is shell
 * orchestration that lives at the bridge level, NOT in the domain service.
 *
 * Per ADR-002 Rule 3: methods perform signature conversion only, no business logic.
 * ArrayBuffer to Uint8Array conversion happens here for the save family and writeRecovery.
 *
 * NOTE: This bridge is a SKELETON — not yet wired into apps/docs/src/preload.
 * The session map (wcId → DocumentSession) is initialized when the bridge is
 * constructed; in the real wiring (Increment 2) the shell populates it as
 * tabs are opened.
 */
import type { DesktopApi } from '@genoffice/docs-shared'
import type { RuntimeContext, DocumentSession } from '@genoffice/runtime-contracts'

export function createDocsDesktopBridge(runtime: RuntimeContext): DesktopApi {
  const docs = runtime.docs
  // Session map: in the real wiring, the shell populates this as tabs open.
  // For the skeleton, we use a single "active" session slot.
  let activeSession: DocumentSession | null = null

  return {
    // ── Settings (delegate to runtime.settings) ───────────────────────
    getLanguage: () => runtime.settings.getLanguage() as never,
    onLanguageChanged: (handler) => runtime.settings.onLanguageChanged(handler as never),
    getTheme: () => runtime.settings.getTheme() as never,
    onThemeChanged: (handler) => runtime.settings.onThemeChanged(handler as never),
    onChromePressed: (handler) => runtime.windowing.onChromePressed(handler),

    // ── File lifecycle (session-scoped — bridge holds the session) ────
    openDocx: async () => {
      const r = await docs.openDialog()
      if (r) {
        activeSession = r.session
        return r.result
      }
      return null
    },
    openDocxPath: async (path: string) => {
      const r = await docs.open(path)
      if (r) {
        activeSession = r.session
        return r.result
      }
      return null
    },
    consumePendingOpenDocx: async () => {
      const r = await docs.consumePendingOpen()
      if (r) {
        activeSession = r.session
        return r.result
      }
      return null
    },
    consumeNewBlankDoc: () => docs.consumeNewBlank(),
    onOpenDocx: (handler) => docs.onOpened(handler),
    onRenamedDocx: (handler) => docs.onRenamed(handler),

    // ── Save (ARGUMENT TRANSFORMATION: ArrayBuffer → Uint8Array; session passed in) ──
    saveDocx: async (path: string, data: ArrayBuffer, auto?: boolean) => {
      // The path argument is the renderer's current path; if it matches the
      // active session, use that session. Otherwise create a transient session.
      const session: DocumentSession = activeSession && activeSession.filePath === path
        ? activeSession
        : { filePath: path, hash: '' }
      const result = await docs.save(session, new Uint8Array(data), auto)
      if (result.session) activeSession = result.session
      return result
    },
    writeRecoveryCopy: async (path: string, data: ArrayBuffer) => {
      const session: DocumentSession = activeSession && activeSession.filePath === path
        ? activeSession
        : { filePath: path, hash: '' }
      return docs.writeRecovery(session, new Uint8Array(data))
    },
    saveDocxAs: async (defaultName: string, data: ArrayBuffer) => {
      const session: DocumentSession = activeSession ?? { filePath: '', hash: '' }
      const result = await docs.saveAs(session, defaultName, new Uint8Array(data))
      if (result.session) activeSession = result.session
      return result
    },
    saveDocxNew: async (defaultName: string, data: ArrayBuffer) => {
      const result = await docs.saveNew(activeSession, defaultName, new Uint8Array(data))
      if (result.session) activeSession = result.session
      return result
    },

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
    aiGskStatus: () => runtime.identity.accountStatus() as never,
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
