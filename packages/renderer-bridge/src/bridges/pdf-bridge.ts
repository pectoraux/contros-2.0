/**
 * createPdfApiBridge — maps window.pdfApi (PdfApi) to PdfService.
 *
 * The PdfService is NOT_YET_WIRED. Service-specific methods throw via
 * `notYet()`. Cross-cutting methods delegate to runtime capabilities.
 *
 * NO `as never` / `as any` casts.
 */
import type { PdfApi } from '@genoffice/pdf-shared'
import type { RuntimeContext } from '@genoffice/runtime-contracts'
import { toLegacyLanguage, wrapLanguageHandler } from '../conversions/docs-conversions.js'
import { notYet } from './not-yet.js'

export function createPdfApiBridge(runtime: RuntimeContext): PdfApi {
  return {
    consumePending: notYet.bind(null, 'PdfService'),
    readFile: notYet.bind(null, 'PdfService'),
    save: notYet.bind(null, 'PdfService'),
    validateTextEdits: notYet.bind(null, 'PdfService'),
    listEditFonts: notYet.bind(null, 'PdfService'),
    listPageImages: notYet.bind(null, 'PdfService'),
    listStaticFormFills: notYet.bind(null, 'PdfService'),
    pageImagePng: notYet.bind(null, 'PdfService'),
    pagePreviewPng: notYet.bind(null, 'PdfService'),
    extractPages: notYet.bind(null, 'PdfService'),
    insertPdf: notYet.bind(null, 'PdfService'),
    insertBlankPage: notYet.bind(null, 'PdfService'),
    splitPdf: notYet.bind(null, 'PdfService'),
    mergePdf: notYet.bind(null, 'PdfService'),
    mergePages: notYet.bind(null, 'PdfService'),
    replacePages: notYet.bind(null, 'PdfService'),
    setPageSize: notYet.bind(null, 'PdfService'),
    splitPages: notYet.bind(null, 'PdfService'),
    cropPages: notYet.bind(null, 'PdfService'),
    exportImages: notYet.bind(null, 'PdfService'),
    imageSearch: (query, maxResults) => runtime.ai.imageSearch(query, maxResults),
    fetchImage: (url) => runtime.ai.fetchImage(url),
    generateImage: notYet.bind(null, 'PdfService'),
    listSavedSignatures: notYet.bind(null, 'PdfService'),
    addSavedSignature: notYet.bind(null, 'PdfService'),
    removeSavedSignature: notYet.bind(null, 'PdfService'),
    getUsername: notYet.bind(null, 'PdfService'),
    setDirty: notYet.bind(null, 'PdfService'),
    onCloseSaveRequest: notYet.bind(null, 'PdfService'),
    sendCloseSaveResult: notYet.bind(null, 'PdfService'),
    onSaveAsRequest: notYet.bind(null, 'PdfService'),
    sendSaveAsResult: notYet.bind(null, 'PdfService'),
    onSaveAsFlow: notYet.bind(null, 'PdfService'),
    onPrintRequest: notYet.bind(null, 'PdfService'),
    getLanguage: () => runtime.settings.getLanguage().then(toLegacyLanguage),
    onLanguageChanged: (handler) => runtime.settings.onLanguageChanged(wrapLanguageHandler(handler)),
    getTheme: () => runtime.settings.getTheme(),
    onThemeChanged: (handler) => runtime.settings.onThemeChanged(handler),
    onChromePressed: (handler) => runtime.windowing.onChromePressed(handler),
    getAiSettings: () => runtime.ai.getSettings(),
    aiStream: (request) => runtime.ai.stream(request),
    aiStreamCancel: (requestId) => runtime.ai.streamCancel(requestId),
    onAiStream: (handler) => runtime.ai.onStream(handler),
  }
}
