/**
 * createSheetsDesktopApiBridge — maps window.desktopApi (DesktopApi, sheets variant)
 * to SpreadsheetService + platform capabilities.
 */
import type { DesktopApi } from '@genoffice/sheets-shared'
import type { RuntimeContext } from '@genoffice/runtime-contracts'
import { requireWired } from './require-wired.js'

export function createSheetsDesktopApiBridge(runtime: RuntimeContext): DesktopApi {
  const sheets = requireWired(runtime.sheets, "sheetsService")
  return {
    // ── Settings (delegate to runtime.settings) ───────────────────────
    getLanguage: () => runtime.settings.getLanguage() as never,
    onLanguageChanged: (handler) => runtime.settings.onLanguageChanged(handler as never),
    getTheme: () => runtime.settings.getTheme() as never,
    onThemeChanged: (handler) => runtime.settings.onThemeChanged(handler as never),
    onChromePressed: (handler) => runtime.windowing.onChromePressed(handler),

    // ── Workbook lifecycle ────────────────────────────────────────────
    selectWorkbook: () => sheets.selectWorkbook(),
    readWorkbookRange: (request) => sheets.readWorkbookRange(request),
    readWorkbookFormulas: (request) => sheets.readWorkbookFormulas(request),
    recalcWorkbook: (request) => sheets.recalcWorkbook(request),
    readWorkbookMedia: (request) => sheets.readWorkbookMedia(request),
    readPivotDefinition: (request) => sheets.readPivotDefinition(request),
    readLocalImage: (request) => sheets.readLocalImage(request),
    captureScreenSources: () => sheets.captureScreenSources(),
    captureScreenSource: (request) => sheets.captureScreenSource(request),
    saveWorkbookEdits: (request) => sheets.saveWorkbookEdits(request),
    writeWorkbookRecovery: (request) => sheets.writeWorkbookRecovery(request),
    autoRenameWorkbook: (sessionId, baseName) => sheets.autoRenameWorkbook(sessionId, baseName),
    exportPdf: (request) => sheets.exportPdf(request),
    closeWorkbook: (sessionId) => sheets.closeWorkbook(sessionId),
    openExternal: (url) => sheets.openExternal(url),
    onMenuAction: (callback) => sheets.onMenuAction(callback),
    onWorkbookRenamed: (callback) => sheets.onWorkbookRenamed(callback),
    notifyPendingEdits: (count) => sheets.notifyPendingEdits(count),
    onCloseSaveRequest: (callback) => sheets.onCloseSaveRequest(callback),
    reportCloseSaveResult: (ok) => sheets.reportCloseSaveResult(ok),
    consumeNewBlankWorkbook: () => sheets.consumeNewBlankWorkbook(),
    hasQueuedWorkbook: () => sheets.hasQueuedWorkbook(),

    // ── AI ──────────────────────────────────────────────────────────────
    getAiSettings: () => sheets.getAiSettings(),
    setAiSettings: (settings) => sheets.setAiSettings(settings),
    aiChat: (request) => sheets.aiChat(request),
    aiStream: (request) => sheets.aiStream(request),
    aiStreamCancel: (requestId) => sheets.aiStreamCancel(requestId),
    aiGskStatus: (withEmail) => sheets.aiGskStatus(withEmail),
    aiGskLogin: () => sheets.aiGskLogin(),
    webSearch: (query, maxResults) => sheets.webSearch(query, maxResults),
    imageSearch: (query, maxResults) => sheets.imageSearch(query, maxResults),
    generateImage: (op) => sheets.generateImage(op),
    fetchImage: (url) => sheets.fetchImage(url),
    onAiStream: (handler) => sheets.onAiStream(handler),

    // ── Attachments ───────────────────────────────────────────────────
    pickAttachments: () => sheets.pickAttachments(),
    addAttachmentPaths: (paths) => sheets.addAttachmentPaths(paths),
    addPastedImage: (data, ext) => sheets.addPastedImage(data, ext),
    readAttachment: (path, offset, maxChars) => sheets.readAttachment(path, offset, maxChars),
    readAttachmentImage: (path) => sheets.readAttachmentImage(path),
    getPathForFile: (file) => sheets.getPathForFile(file),
  }
}
