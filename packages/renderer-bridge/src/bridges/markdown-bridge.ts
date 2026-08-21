/**
 * createMarkdownApiBridge — maps window.markdownApi (MarkdownApi) to MarkdownService.
 *
 * Like PdfApi, MarkdownApi is entirely editor-specific (settings/AI methods are
 * part of MarkdownService per the runtime-contracts design). Pure 1:1 delegation.
 */
import type { MarkdownApi } from '@genoffice/markdown-shared'
import type { RuntimeContext } from '@genoffice/runtime-contracts'
import { requireWired } from './require-wired.js'

export function createMarkdownApiBridge(runtime: RuntimeContext): MarkdownApi {
  const md = requireWired(runtime.markdown, "markdownService")
  return {
    consumePending: () => md.consumePending(),
    readFile: (path) => md.readFile(path),
    save: (request) => md.save(request),
    setDirty: (dirty) => md.setDirty(dirty),
    onSaveRequest: (handler) => md.onSaveRequest(handler),
    sendSaveRequestAck: (ok) => md.sendSaveRequestAck(ok),
    onCloseSaveRequest: (handler) => md.onCloseSaveRequest(handler),
    sendCloseSaveResult: (ok) => md.sendCloseSaveResult(ok),
    onFileRenamed: (handler) => md.onFileRenamed(handler),
    pickImage: () => md.pickImage(),
    saveImage: (data) => md.saveImage(data),
    readImage: (src) => md.readImage(src),
    onExportRequest: (handler) => md.onExportRequest(handler),
    onPrintRequest: (handler) => md.onPrintRequest(handler),
    exportDocx: (request) => md.exportDocx(request),
    exportPdf: (request) => md.exportPdf(request),
    getLanguage: () => md.getLanguage(),
    onLanguageChanged: (handler) => md.onLanguageChanged(handler),
    getTheme: () => md.getTheme(),
    onThemeChanged: (handler) => md.onThemeChanged(handler),
    onChromePressed: (handler) => md.onChromePressed(handler),
    getAiSettings: () => md.getAiSettings(),
    aiStream: (request) => md.aiStream(request),
    aiStreamCancel: (requestId) => md.aiStreamCancel(requestId),
    onAiStream: (handler) => md.onAiStream(handler),
    webSearch: (query, maxResults) => md.webSearch(query, maxResults),
  }
}
