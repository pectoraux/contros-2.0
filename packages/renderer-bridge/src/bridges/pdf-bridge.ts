/**
 * createPdfApiBridge — maps window.pdfApi (PdfApi) to PdfService.
 *
 * PdfApi is entirely pdf-specific (no cross-cutting methods that delegate to
 * capabilities — the settings/AI methods are part of PdfService per the
 * runtime-contracts design). So the bridge is a pure 1:1 delegation.
 */
import type { PdfApi } from '@genoffice/pdf-shared'
import type { RuntimeContext } from '@genoffice/runtime-contracts'
import { requireWired } from './require-wired.js'

export function createPdfApiBridge(runtime: RuntimeContext): PdfApi {
  const pdf = requireWired(runtime.pdf, "pdfService")
  return {
    consumePending: () => pdf.consumePending(),
    readFile: (path) => pdf.readFile(path),
    save: (request) => pdf.save(request),
    validateTextEdits: (request) => pdf.validateTextEdits(request),
    listEditFonts: () => pdf.listEditFonts(),
    listPageImages: (path) => pdf.listPageImages(path),
    listStaticFormFills: (path) => pdf.listStaticFormFills(path),
    pageImagePng: (request) => pdf.pageImagePng(request),
    pagePreviewPng: (request) => pdf.pagePreviewPng(request),
    extractPages: (request) => pdf.extractPages(request),
    insertPdf: (request) => pdf.insertPdf(request),
    insertBlankPage: (request) => pdf.insertBlankPage(request),
    splitPdf: (request) => pdf.splitPdf(request),
    mergePdf: (request) => pdf.mergePdf(request),
    mergePages: (request) => pdf.mergePages(request),
    replacePages: (request) => pdf.replacePages(request),
    setPageSize: (request) => pdf.setPageSize(request),
    splitPages: (request) => pdf.splitPages(request),
    cropPages: (request) => pdf.cropPages(request),
    exportImages: (request) => pdf.exportImages(request),
    imageSearch: (query, maxResults) => pdf.imageSearch(query, maxResults),
    fetchImage: (url) => pdf.fetchImage(url),
    generateImage: (op) => pdf.generateImage(op),
    listSavedSignatures: () => pdf.listSavedSignatures(),
    addSavedSignature: (data) => pdf.addSavedSignature(data),
    removeSavedSignature: (id) => pdf.removeSavedSignature(id),
    getUsername: () => pdf.getUsername(),
    setDirty: (dirty) => pdf.setDirty(dirty),
    onCloseSaveRequest: (handler) => pdf.onCloseSaveRequest(handler),
    sendCloseSaveResult: (ok) => pdf.sendCloseSaveResult(ok),
    onSaveAsRequest: (handler) => pdf.onSaveAsRequest(handler),
    sendSaveAsResult: (ok) => pdf.sendSaveAsResult(ok),
    onSaveAsFlow: (handler) => pdf.onSaveAsFlow(handler),
    onPrintRequest: (handler) => pdf.onPrintRequest(handler),
    getLanguage: () => pdf.getLanguage(),
    onLanguageChanged: (handler) => pdf.onLanguageChanged(handler),
    getTheme: () => pdf.getTheme(),
    onThemeChanged: (handler) => pdf.onThemeChanged(handler),
    onChromePressed: (handler) => pdf.onChromePressed(handler),
    getAiSettings: () => pdf.getAiSettings(),
    aiStream: (request) => pdf.aiStream(request),
    aiStreamCancel: (requestId) => pdf.aiStreamCancel(requestId),
    onAiStream: (handler) => pdf.onAiStream(handler),
  }
}
