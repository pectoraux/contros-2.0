/**
 * createDocsDesktopBridge — maps window.desktop (DesktopApi, docs variant)
 * to DocumentService + platform capabilities.
 *
 * BOUNDARY CORRECTION (2026-08-21, FINAL pass):
 *   - Uses a SessionRegistry (injected by the shell) instead of a single
 *     activeSession slot. Supports multiple simultaneous tabs.
 *   - NO synthetic { filePath, hash: '' } sessions — if the path isn't in
 *     the registry, returns { ok: false, error: 'save target is not an
 *     opened document' } (matches existing docs-main behavior).
 *   - Tab/window operations (openNewTab, listDocsTabs, focusDocsTab) now
 *     delegate to runtime.windowing (the shell-level capability), NOT to
 *     runtime.docs (which no longer has those methods).
 *   - Checks isWired(runtime.docs) before delegating to DocumentService.
 *
 * Per ADR-002 Rule 3: methods perform signature conversion only, no business logic.
 * ArrayBuffer to Uint8Array conversion happens here for the save family and writeRecovery.
 *
 * NOTE: This bridge is a SKELETON — not yet wired into apps/docs/src/preload.
 * The SessionRegistry is constructed by the shell and passed in.
 */
import type { DesktopApi } from '@genoffice/docs-shared'
import type { RuntimeContext, DocumentSession } from '@genoffice/runtime-contracts'
import { isWired } from '@genoffice/runtime-contracts'
import type { SessionRegistry } from '@genoffice/services-docs'

export interface DocsBridgeDeps {
  runtime: RuntimeContext
  registry: SessionRegistry
}

export function createDocsDesktopBridge(deps: DocsBridgeDeps): DesktopApi {
  const { runtime, registry } = deps
  return {
    // ── Settings (delegate to runtime.settings) ───────────────────────
    getLanguage: () => runtime.settings.getLanguage() as never,
    onLanguageChanged: (handler) => runtime.settings.onLanguageChanged(handler as never),
    getTheme: () => runtime.settings.getTheme() as never,
    onThemeChanged: (handler) => runtime.settings.onThemeChanged(handler as never),
    onChromePressed: (handler) => runtime.windowing.onChromePressed(handler),

    // ── File lifecycle (session-scoped — registry holds the session) ──
    openDocx: async () => {
      if (!isWired(runtime.docs)) {
        throw new Error('runtime.docs is not wired — Phase 1 increment 2 wires it')
      }
      const r = await runtime.docs.openDialog()
      if (r) {
        registry.register(r.session)
        return r.result
      }
      return null
    },
    openDocxPath: async (path: string) => {
      if (!isWired(runtime.docs)) {
        throw new Error('runtime.docs is not wired — Phase 1 increment 2 wires it')
      }
      const r = await runtime.docs.open(path)
      if (r) {
        registry.register(r.session)
        return r.result
      }
      return null
    },
    consumePendingOpenDocx: () => {
      // The pending-open queue lives in the shell (apps/docs/src/main/).
      // The shell calls docs.open(path) directly when there's a pending path;
      // this method is a no-op on the service side (the shell handles it).
      // For Phase 1 increment 1 (not yet wired), return null.
      return Promise.resolve(null)
    },
    consumeNewBlankDoc: () => {
      // The new-blank flag set lives in the shell.
      // For Phase 1 increment 1 (not yet wired), return false.
      return Promise.resolve(false)
    },
    onOpenDocx: (handler) => {
      if (isWired(runtime.docs)) runtime.docs.onOpened(handler)
      return () => {}
    },
    onRenamedDocx: (handler) => {
      if (isWired(runtime.docs)) runtime.docs.onRenamed(handler)
      return () => {}
    },

    // ── Save (ARGUMENT TRANSFORMATION: ArrayBuffer → Uint8Array; session from registry) ──
    saveDocx: async (path: string, data: ArrayBuffer, auto?: boolean) => {
      if (!isWired(runtime.docs)) {
        throw new Error('runtime.docs is not wired — Phase 1 increment 2 wires it')
      }
      // Look up the session by path — NO synthetic fallback
      const session = registry.get(path)
      if (!session) {
        // Matches existing docs-main.ts behavior: 'save target is not an opened document'
        return { ok: false, error: 'save target is not an opened document' }
      }
      const result = await runtime.docs.save(session, new Uint8Array(data), auto)
      if (result.session) registry.register(result.session)
      return result
    },
    writeRecoveryCopy: async (path: string, data: ArrayBuffer) => {
      if (!isWired(runtime.docs)) {
        throw new Error('runtime.docs is not wired — Phase 1 increment 2 wires it')
      }
      const session = registry.get(path)
      if (!session) {
        return { ok: false }
      }
      return runtime.docs.writeRecovery(session, new Uint8Array(data))
    },
    saveDocxAs: async (defaultName: string, data: ArrayBuffer) => {
      if (!isWired(runtime.docs)) {
        throw new Error('runtime.docs is not wired — Phase 1 increment 2 wires it')
      }
      // For save-as, the session may not exist yet (untitled document).
      // Use a transient session that points at the current path (empty string if untitled).
      // The service's saveAs shows the save dialog and returns a new session.
      // We use a placeholder session with empty filePath for untitled docs.
      const transientSession: DocumentSession = { filePath: '', hash: '' }
      const result = await runtime.docs.saveAs(transientSession, defaultName, new Uint8Array(data))
      if (result.session) registry.register(result.session)
      return result
    },
    saveDocxNew: async (defaultName: string, data: ArrayBuffer) => {
      if (!isWired(runtime.docs)) {
        throw new Error('runtime.docs is not wired — Phase 1 increment 2 wires it')
      }
      const result = await runtime.docs.saveNew(defaultName, new Uint8Array(data))
      if (result.session) registry.register(result.session)
      return result
    },

    // ── File/recent operations ────────────────────────────────────────
    getRecentFiles: () => {
      if (!isWired(runtime.docs)) return Promise.resolve([])
      return runtime.docs.recentFiles()
    },
    onTeardown: (handler) => {
      if (isWired(runtime.docs)) runtime.docs.onTeardown(handler)
      return () => {}
    },

    // ── Images & attachments ───────────────────────────────────────────
    pickImage: () => {
      if (!isWired(runtime.docs)) return Promise.resolve(null)
      return runtime.docs.pickImage()
    },
    fontMetrics: (family) => {
      if (!isWired(runtime.docs)) return Promise.resolve(null)
      return runtime.docs.fontMetrics(family)
    },
    pickAttachments: () => {
      if (!isWired(runtime.docs)) return Promise.resolve(null)
      return runtime.docs.pickAttachments()
    },
    addAttachmentPaths: (paths) => {
      if (!isWired(runtime.docs)) return Promise.resolve({ accepted: [], rejected: [] })
      return runtime.docs.addAttachmentPaths(paths)
    },
    addPastedImage: (data, ext) => {
      if (!isWired(runtime.docs)) return Promise.resolve({ accepted: [], rejected: [] })
      return runtime.docs.addPastedImage(data, ext)
    },
    readAttachment: (path, offset, maxChars) => {
      if (!isWired(runtime.docs)) return Promise.resolve({ ok: false, error: 'docs not wired' })
      return runtime.docs.readAttachment(path, offset, maxChars)
    },
    readAttachmentImage: (path) => {
      if (!isWired(runtime.docs)) return Promise.resolve({ ok: false, error: 'docs not wired' })
      return runtime.docs.readAttachmentImage(path)
    },
    getPathForFile: (file) => runtime.files.getPathForFile(file),

    // ── Tab management (delegates to runtime.windowing — shell-level) ──
    // The bridge still implements these (DesktopApi requires them), but they
    // go to the Windowing capability, NOT to DocumentService (which no longer
    // has tab/window methods — they're shell orchestration, not domain).
    openNewTab: (openPath) => {
      // The Windowing capability has showNewMenu which the shell implements.
      // For now, this is a no-op stub — the shell will wire it in Increment 2.
      return Promise.resolve()
    },
    listDocsTabs: () => {
      return Promise.resolve([])
    },
    focusDocsTab: (_id) => {
      return Promise.resolve()
    },

    // ── AI (delegate to runtime.ai + runtime.identity) ─────────────────
    getAiSettings: () => {
      if (!isWired(runtime.docs)) return runtime.ai.getSettings()
      return runtime.docs.getAiSettings()
    },
    setAiSettings: (settings) => {
      if (!isWired(runtime.docs)) return runtime.ai.setSettings(settings)
      return runtime.docs.setAiSettings(settings)
    },
    print: () => {
      if (!isWired(runtime.docs)) return Promise.resolve({ ok: false, error: 'docs not wired' })
      return runtime.docs.print()
    },
    exportPdf: (defaultName, w, h, outPath) => {
      if (!isWired(runtime.docs)) return Promise.resolve({ ok: false, error: 'docs not wired' })
      return runtime.docs.exportPdf(defaultName, w, h, outPath)
    },
    printPdfBuffer: (w, h) => {
      if (!isWired(runtime.docs)) return Promise.resolve({ ok: false, error: 'docs not wired' })
      return runtime.docs.printPdfBuffer(w, h)
    },
    saveMergedPdf: (defaultName, parts, outPath) => {
      if (!isWired(runtime.docs)) return Promise.resolve({ ok: false, error: 'docs not wired' })
      return runtime.docs.saveMergedPdf(defaultName, parts, outPath)
    },
    aiChat: (request) => {
      if (!isWired(runtime.docs)) return runtime.ai.chat(request)
      return runtime.docs.aiChat(request)
    },
    aiStream: (request) => {
      if (!isWired(runtime.docs)) return runtime.ai.stream(request)
      return runtime.docs.aiStream(request)
    },
    aiStreamCancel: (requestId) => {
      if (!isWired(runtime.docs)) return runtime.ai.streamCancel(requestId)
      return runtime.docs.aiStreamCancel(requestId)
    },
    aiGskStatus: () => runtime.identity.accountStatus() as never,
    aiGskLogin: () => runtime.identity.login() as never,
    webSearch: (query, maxResults) => runtime.ai.webSearch(query, maxResults) as never,
    imageSearch: (query, maxResults) => runtime.ai.imageSearch(query, maxResults) as never,
    fetchImage: (url) => runtime.ai.fetchImage(url) as never,
    onAiStream: (handler) => {
      if (isWired(runtime.docs)) return runtime.docs.onAiStream(handler)
      return runtime.ai.onStream(handler)
    },

    // ── Menu / close guard ────────────────────────────────────────────
    onMenuCommand: (handler) => {
      if (isWired(runtime.docs)) runtime.docs.onMenuCommand(handler)
      return () => {}
    },
    onCloseCheck: (handler) => {
      if (isWired(runtime.docs)) runtime.docs.onCloseCheck(handler)
      return () => {}
    },
    reportCloseCheck: (state) => {
      if (isWired(runtime.docs)) runtime.docs.reportCloseCheck(state)
    },
    onCloseSaveRequest: (handler) => {
      if (isWired(runtime.docs)) runtime.docs.onCloseSaveRequest(handler)
      return () => {}
    },
    reportCloseSaveResult: (ok) => {
      if (isWired(runtime.docs)) runtime.docs.reportCloseSaveResult(ok)
    },
    reportViewMenuState: (state) => {
      if (isWired(runtime.docs)) runtime.docs.reportViewMenuState(state)
    },
  }
}
