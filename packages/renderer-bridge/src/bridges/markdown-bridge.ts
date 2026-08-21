/**
 * createMarkdownApiBridge — maps window.markdownApi (MarkdownApi) to MarkdownService.
 *
 * The MarkdownService is NOT_YET_WIRED. Service-specific methods throw via
 * `notYet()`. Cross-cutting methods delegate to runtime capabilities.
 *
 * NO `as never` / `as any` casts.
 */
import type { MarkdownApi } from '@genoffice/markdown-shared'
import type { RuntimeContext } from '@genoffice/runtime-contracts'
import { toLegacyLanguage, wrapLanguageHandler } from '../conversions/docs-conversions.js'
import { notYet } from './not-yet.js'

export function createMarkdownApiBridge(runtime: RuntimeContext): MarkdownApi {
  return {
    consumePending: notYet.bind(null, 'MarkdownService'),
    readFile: notYet.bind(null, 'MarkdownService'),
    save: notYet.bind(null, 'MarkdownService'),
    setDirty: notYet.bind(null, 'MarkdownService'),
    onSaveRequest: notYet.bind(null, 'MarkdownService'),
    sendSaveRequestAck: notYet.bind(null, 'MarkdownService'),
    onCloseSaveRequest: notYet.bind(null, 'MarkdownService'),
    sendCloseSaveResult: notYet.bind(null, 'MarkdownService'),
    onFileRenamed: notYet.bind(null, 'MarkdownService'),
    pickImage: notYet.bind(null, 'MarkdownService'),
    saveImage: notYet.bind(null, 'MarkdownService'),
    readImage: notYet.bind(null, 'MarkdownService'),
    onExportRequest: notYet.bind(null, 'MarkdownService'),
    onPrintRequest: notYet.bind(null, 'MarkdownService'),
    exportDocx: notYet.bind(null, 'MarkdownService'),
    exportPdf: notYet.bind(null, 'MarkdownService'),
    getLanguage: () => runtime.settings.getLanguage().then(toLegacyLanguage),
    onLanguageChanged: (handler) => runtime.settings.onLanguageChanged(wrapLanguageHandler(handler)),
    getTheme: () => runtime.settings.getTheme(),
    onThemeChanged: (handler) => runtime.settings.onThemeChanged(handler),
    onChromePressed: (handler) => runtime.windowing.onChromePressed(handler),
    getAiSettings: () => runtime.ai.getSettings(),
    aiStream: (request) => runtime.ai.stream(request),
    aiStreamCancel: (requestId) => runtime.ai.streamCancel(requestId),
    onAiStream: (handler) => runtime.ai.onStream(handler),
    webSearch: (query, maxResults) => runtime.ai.webSearch(query, maxResults),
  }
}
