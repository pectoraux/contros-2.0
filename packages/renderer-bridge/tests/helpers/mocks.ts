/**
 * Mock factories for the renderer-bridge contract tests.
 *
 * Each mock returns a `vi.fn()`-backed object that satisfies the corresponding
 * service or capability interface. The dispatch tests assert against these mocks
 * to verify the bridge delegates to the correct destination.
 */
import { vi } from 'vitest'
import type { RuntimeContext } from '@genoffice/runtime-contracts'

/**
 * Wrap every method of an interface T in a stable vi.fn() mock.
 * Returns an object with the same shape, where each method is a spy that
 * is referentially stable (same fn returned for repeated access).
 */
function mockAllMethods<T extends Record<string, unknown>>(methodNames: readonly string[]): T {
  const cache: Record<string, ReturnType<typeof vi.fn>> = {}
  const mock: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const name of methodNames) {
    const fn = vi.fn().mockResolvedValue(undefined)
    cache[name] = fn
    mock[name] = fn
  }
  return mock as unknown as T
}

// ── Capability mocks ───────────────────────────────────────────────────

export const STORAGE_METHODS = [
  'get', 'set', 'delete',
  'readObject', 'writeObject', 'deleteObject', 'listObjects',
  'readBlob', 'writeBlob', 'deleteBlob',
] as const

export const FILES_METHODS = [
  'pickOpen', 'pickSave', 'pickDirectory',
  'read', 'write', 'stat', 'rename',
  'trash', 'revealInFolder', 'openPath', 'getPathForFile',
] as const

export const IDENTITY_METHODS = [
  'accountStatus', 'login', 'logout',
  'onLoginEvent', 'openLoginUrl', 'openCreditUsage', 'openGenTeam',
] as const

export const AI_METHODS = [
  'getSettings', 'setSettings', 'stream', 'streamCancel', 'onStream',
  'chat', 'webSearch', 'imageSearch', 'fetchImage', 'generateImage', 'analyzeMedia',
] as const

export const PRINTING_METHODS = [
  'print', 'exportPdf', 'printToBytes', 'saveMergedPdf',
] as const

export const CLIPBOARD_METHODS = [
  'read', 'write', 'readImage', 'writeImage',
] as const

export const NOTIFICATIONS_METHODS = [
  'show', 'requestPermission',
] as const

export const WINDOWING_METHODS = [
  'listTabs', 'activateTab', 'closeTab', 'reorderTab',
  'showTabMenu', 'showNewMenu', 'notifyChromePressed',
  'onTabsChanged', 'onChromePressed',
  'setProgressBar', 'onThemeChanged',
  'openExternal', 'openGitHubRepo',
] as const

export const SETTINGS_METHODS = [
  'getTheme', 'setTheme', 'onThemeChanged',
  'getLanguage', 'setLanguage', 'onLanguageChanged',
  'getUpdateChannel', 'setUpdateChannel',
  'onboardingSeen', 'setOnboardingSeen',
  'getDefaultSaveDir', 'pickDefaultSaveDir',
  'getAppVersion',
] as const

// ── Service method lists (for stable mock caches) ─────────────────────

export const DOCS_SERVICE_METHODS = [
  'openDialog', 'open', 'consumePendingOpen', 'consumeNewBlank',
  'save', 'saveAs', 'saveNew', 'writeRecovery', 'recentFiles',
  'pickImage', 'addAttachmentPaths', 'pickAttachments',
  'addPastedImage', 'readAttachment', 'readAttachmentImage',
  'fontMetrics', 'print', 'exportPdf', 'printPdfBuffer', 'saveMergedPdf',
  'openNewTab', 'listDocsTabs', 'focusDocsTab',
  'getAiSettings', 'setAiSettings', 'aiChat', 'aiStream', 'aiStreamCancel', 'onAiStream',
  'onOpened', 'onRenamed', 'onTeardown', 'onMenuCommand',
  'onCloseCheck', 'reportCloseCheck', 'onCloseSaveRequest', 'reportCloseSaveResult', 'reportViewMenuState',
] as const

export const SHEETS_SERVICE_METHODS = [
  'selectWorkbook', 'readWorkbookRange', 'readWorkbookFormulas',
  'recalcWorkbook', 'readWorkbookMedia', 'readPivotDefinition', 'readLocalImage',
  'captureScreenSources', 'captureScreenSource',
  'saveWorkbookEdits', 'writeWorkbookRecovery', 'autoRenameWorkbook',
  'exportPdf', 'closeWorkbook', 'openExternal',
  'onMenuAction', 'onWorkbookRenamed', 'notifyPendingEdits',
  'onCloseSaveRequest', 'reportCloseSaveResult',
  'consumeNewBlankWorkbook', 'hasQueuedWorkbook',
  'getAiSettings', 'setAiSettings', 'aiChat', 'aiStream', 'aiStreamCancel',
  'aiGskStatus', 'aiGskLogin', 'webSearch', 'imageSearch',
  'generateImage', 'fetchImage', 'onAiStream',
  'pickAttachments', 'addAttachmentPaths', 'addPastedImage',
  'readAttachment', 'readAttachmentImage', 'getPathForFile',
] as const

export const PROJECT_METHODS = [
  'resolveChat', 'appendChat', 'loadChat', 'rebindChat',
  'listProjects', 'createProject', 'renameProject', 'deleteProject',
  'moveFile', 'getTimeline', 'listFiles',
] as const

// ── Mock builders ──────────────────────────────────────────────────────

export function mockStorage() {
  return mockAllMethods(STORAGE_METHODS)
}
export function mockFiles() {
  return mockAllMethods(FILES_METHODS)
}
export function mockIdentity() {
  return mockAllMethods(IDENTITY_METHODS)
}
export function mockAI() {
  return mockAllMethods(AI_METHODS)
}
export function mockPrinting() {
  return mockAllMethods(PRINTING_METHODS)
}
export function mockClipboard() {
  return mockAllMethods(CLIPBOARD_METHODS)
}
export function mockNotifications() {
  return mockAllMethods(NOTIFICATIONS_METHODS)
}
export function mockWindowing() {
  return mockAllMethods(WINDOWING_METHODS)
}
export function mockSettings() {
  return mockAllMethods(SETTINGS_METHODS)
}

// ── Service mocks (domain services) ────────────────────────────────────

export function mockDocumentService() {
  return mockAllMethods(DOCS_SERVICE_METHODS)
}
export function mockSpreadsheetService() {
  return mockAllMethods(SHEETS_SERVICE_METHODS)
}

// Slides-specific methods (PresentationService = Omit<SlidesApi, CrossCuttingMethods>).
// Comprehensive list of slides-specific method names from apps/slides/src/shared/ipc.ts:1020-1466.
export const SLIDES_SERVICE_METHODS = [
  'openPptx', 'openPptxPath', 'privateFontFaces', 'privateFontData',
  'consumePendingOpen', 'newBlank', 'htmlToPptx', 'cloudGenStatus', 'cloudGeneratePage',
  'editText', 'setElementFont', 'setElementParagraphFormat', 'findReplace',
  'setSlideLayout', 'setSlideSize', 'getSlideSize',
  'editTransform', 'editConnectorEndpoints', 'batchEditTransform', 'getRenderSlides',
  'editPictureSrcRect', 'editPictureOpacity', 'editImageFill', 'setTextAnchor',
  'clipboardExternal', 'groupElements', 'ungroupElement',
  'addElement', 'deleteElement', 'addSlide', 'addBlankSlide',
  'copySlide', 'pasteSlide', 'repasteSlide', 'hasSlideClipboard',
  'deleteSlide', 'reorderElement', 'editTableCell', 'tableStructure', 'tableMerge',
  'setTableColWidth', 'setTableRowHeight', 'setTableCellAnchor',
  'editFill', 'editStroke', 'flipElements', 'editBackground',
  'insertImage', 'copyElements', 'pasteElements', 'duplicateElements',
  'addTable', 'addInk', 'addChart', 'addSmartArt', 'addImageBytes',
  'replacePictureBytes', 'insertMedia', 'addMediaBytes', 'getMediaData', 'insertModel3d',
  'setLink', 'getLink', 'getSlideLinks', 'getRunLinks',
  'applyHeaderFooter', 'getHeaderFooter', 'applyTheme',
  'setTransition', 'getTransition', 'setAdvanceTimes',
  'getAnimations', 'getShapeKeys', 'setAnimations', 'setSlideHidden',
  'getSections', 'setSections', 'addSection', 'renameSection', 'removeSection', 'moveSection', 'moveSlide',
  'getNotes', 'setNotes', 'getComments', 'addComment', 'deleteComment',
  'nativeClipboard', 'beginHistoryBatch', 'endHistoryBatch', 'aiSnapshotRestore',
  'undo', 'redo', 'editTableStyle', 'editChart',
  'getChartColorSchemes', 'getChartData',
  'pickExportDir', 'exportImages', 'pickExportPdfPath', 'exportPdf', 'printSlides',
  'save', 'saveAs', 'onCloseSaveRequest', 'onHistoryChanged', 'reportCloseSaveResult',
  'setAutoSavePref', 'isDirty', 'getRecentFiles', 'onMenuCommand', 'onOpened', 'onRenamed',
  'getAiSettings', 'setAiSettings', 'saveStyleSidecar',
  'saveStyleTemplate', 'listStyleTemplates', 'loadStyleTemplate',
  'addSlideWithLayout', 'getLayouts',
  'masterEnter', 'masterOpen', 'masterClose',
  'masterEditText', 'masterEditTransform', 'masterEditFill', 'masterEditStroke', 'masterDeleteElement',
  'presenterStart', 'presenterSync', 'presenterInk', 'presenterSwap', 'presenterEnd',
  'audienceReady', 'audienceNav', 'onShowSync', 'onShowInk', 'onAudienceNav',
] as const

export function mockPresentationService() {
  return mockAllMethods(SLIDES_SERVICE_METHODS)
}
export function mockProjectStore() {
  return mockAllMethods(PROJECT_METHODS)
}

// ── RuntimeContext mock ────────────────────────────────────────────────

export function mockRuntime(overrides: Partial<RuntimeContext> = {}): RuntimeContext {
  return {
    platform: 'electron',
    version: '0.0.0-test',
    storage: mockStorage(),
    files: mockFiles(),
    identity: mockIdentity(),
    ai: mockAI(),
    printing: mockPrinting(),
    clipboard: mockClipboard(),
    notifications: mockNotifications(),
    windowing: mockWindowing(),
    settings: mockSettings(),
    docs: mockDocumentService(),
    sheets: mockSpreadsheetService(),
    slides: mockPresentationService(),
    pdf: mockAllMethods([
      'consumePending', 'readFile', 'save', 'validateTextEdits', 'listEditFonts',
      'listPageImages', 'listStaticFormFills', 'pageImagePng', 'pagePreviewPng',
      'extractPages', 'insertPdf', 'insertBlankPage', 'splitPdf', 'mergePdf',
      'mergePages', 'replacePages', 'setPageSize', 'splitPages', 'cropPages',
      'exportImages', 'imageSearch', 'fetchImage', 'generateImage',
      'listSavedSignatures', 'addSavedSignature', 'removeSavedSignature',
      'getUsername', 'setDirty', 'onCloseSaveRequest', 'sendCloseSaveResult',
      'onSaveAsRequest', 'sendSaveAsResult', 'onSaveAsFlow', 'onPrintRequest',
      'getLanguage', 'onLanguageChanged', 'getTheme', 'onThemeChanged', 'onChromePressed',
      'getAiSettings', 'aiStream', 'aiStreamCancel', 'onAiStream',
    ]),
    markdown: mockAllMethods([
      'consumePending', 'readFile', 'save', 'setDirty',
      'onSaveRequest', 'sendSaveRequestAck', 'onCloseSaveRequest', 'sendCloseSaveResult',
      'onFileRenamed', 'pickImage', 'saveImage', 'readImage',
      'onExportRequest', 'onPrintRequest', 'exportDocx', 'exportPdf',
      'getLanguage', 'onLanguageChanged', 'getTheme', 'onThemeChanged', 'onChromePressed',
      'getAiSettings', 'aiStream', 'aiStreamCancel', 'onAiStream', 'webSearch',
    ]),
    project: mockProjectStore(),
    ...overrides,
  } as unknown as RuntimeContext
}
