/**
 * createSheetsDesktopApiBridge — maps window.desktopApi (DesktopApi, sheets variant)
 * to SpreadsheetService + platform capabilities.
 *
 * The SpreadsheetService is NOT_YET_WIRED. Service-specific methods throw
 * via `notYet()`. Cross-cutting methods delegate to runtime capabilities.
 *
 * NO `as never` / `as any` casts.
 */
import type { DesktopApi } from '@genoffice/sheets-shared'
import type { RuntimeContext } from '@genoffice/runtime-contracts'
import { toLegacyLanguage, wrapLanguageHandler } from '../conversions/docs-conversions.js'
import { notYet } from './not-yet.js'

export function createSheetsDesktopApiBridge(runtime: RuntimeContext): DesktopApi {
  return {
    getLanguage: () => runtime.settings.getLanguage().then(toLegacyLanguage),
    onLanguageChanged: (handler) => runtime.settings.onLanguageChanged(wrapLanguageHandler(handler)),
    getTheme: () => runtime.settings.getTheme(),
    onThemeChanged: (handler) => runtime.settings.onThemeChanged(handler),
    onChromePressed: (handler) => runtime.windowing.onChromePressed(handler),

    selectWorkbook: notYet.bind(null, 'SpreadsheetService'),
    readWorkbookRange: notYet.bind(null, 'SpreadsheetService'),
    readWorkbookFormulas: notYet.bind(null, 'SpreadsheetService'),
    recalcWorkbook: notYet.bind(null, 'SpreadsheetService'),
    readWorkbookMedia: notYet.bind(null, 'SpreadsheetService'),
    readPivotDefinition: notYet.bind(null, 'SpreadsheetService'),
    readLocalImage: notYet.bind(null, 'SpreadsheetService'),
    captureScreenSources: notYet.bind(null, 'SpreadsheetService'),
    captureScreenSource: notYet.bind(null, 'SpreadsheetService'),
    saveWorkbookEdits: notYet.bind(null, 'SpreadsheetService'),
    writeWorkbookRecovery: notYet.bind(null, 'SpreadsheetService'),
    autoRenameWorkbook: notYet.bind(null, 'SpreadsheetService'),
    exportPdf: notYet.bind(null, 'SpreadsheetService'),
    closeWorkbook: notYet.bind(null, 'SpreadsheetService'),
    openExternal: (url) => runtime.windowing.openExternal(url),
    onMenuAction: notYet.bind(null, 'SpreadsheetService'),
    onWorkbookRenamed: notYet.bind(null, 'SpreadsheetService'),
    notifyPendingEdits: notYet.bind(null, 'SpreadsheetService'),
    onCloseSaveRequest: notYet.bind(null, 'SpreadsheetService'),
    reportCloseSaveResult: notYet.bind(null, 'SpreadsheetService'),
    consumeNewBlankWorkbook: notYet.bind(null, 'SpreadsheetService'),
    hasQueuedWorkbook: notYet.bind(null, 'SpreadsheetService'),
    getAiSettings: () => runtime.ai.getSettings(),
    setAiSettings: (settings) => runtime.ai.setSettings(settings),
    aiChat: (request) => runtime.ai.chat(request),
    aiStream: (request) => runtime.ai.stream(request),
    aiStreamCancel: (requestId) => runtime.ai.streamCancel(requestId),
    aiGskStatus: () => runtime.identity.accountStatus(),
    aiGskLogin: () => runtime.identity.login().then(() => undefined),
    webSearch: (query, maxResults) => runtime.ai.webSearch(query, maxResults),
    imageSearch: (query, maxResults) => runtime.ai.imageSearch(query, maxResults),
    generateImage: notYet.bind(null, 'SpreadsheetService'),
    fetchImage: (url) => runtime.ai.fetchImage(url),
    onAiStream: (handler) => runtime.ai.onStream(handler),
    pickAttachments: notYet.bind(null, 'SpreadsheetService'),
    addAttachmentPaths: notYet.bind(null, 'SpreadsheetService'),
    addPastedImage: notYet.bind(null, 'SpreadsheetService'),
    readAttachment: notYet.bind(null, 'SpreadsheetService'),
    readAttachmentImage: notYet.bind(null, 'SpreadsheetService'),
    getPathForFile: (file) => runtime.files.getPathForFile(file),
  }
}
