/** Shape test for createSheetsDesktopApiBridge. */
import { describe, test, expect } from 'vitest'
import { createSheetsDesktopApiBridge } from '../../src/bridges/sheets-bridge.js'
import { mockRuntime } from '../helpers/mocks.js'

// Canonical DesktopApi (sheets variant) method names from apps/sheets/src/shared/desktop-api.ts:2109-2201.
const EXPECTED_SHEETS_DESKTOP_API_METHODS = [
  'getLanguage',
  'onLanguageChanged',
  'getTheme',
  'onThemeChanged',
  'onChromePressed',
  'selectWorkbook',
  'readWorkbookRange',
  'readWorkbookFormulas',
  'recalcWorkbook',
  'readWorkbookMedia',
  'readPivotDefinition',
  'readLocalImage',
  'captureScreenSources',
  'captureScreenSource',
  'saveWorkbookEdits',
  'writeWorkbookRecovery',
  'autoRenameWorkbook',
  'exportPdf',
  'closeWorkbook',
  'openExternal',
  'onMenuAction',
  'onWorkbookRenamed',
  'notifyPendingEdits',
  'onCloseSaveRequest',
  'reportCloseSaveResult',
  'consumeNewBlankWorkbook',
  'hasQueuedWorkbook',
  'getAiSettings',
  'setAiSettings',
  'aiChat',
  'aiStream',
  'aiStreamCancel',
  'aiGskStatus',
  'aiGskLogin',
  'webSearch',
  'imageSearch',
  'generateImage',
  'fetchImage',
  'onAiStream',
  'pickAttachments',
  'addAttachmentPaths',
  'addPastedImage',
  'readAttachment',
  'readAttachmentImage',
  'getPathForFile',
] as const

describe('createSheetsDesktopApiBridge shape', () => {
  test('implements every DesktopApi method', () => {
    const bridge = createSheetsDesktopApiBridge(mockRuntime())
    const bridgeMethods = Object.keys(bridge).sort()
    const expected = [...EXPECTED_SHEETS_DESKTOP_API_METHODS].sort()
    expect(bridgeMethods).toEqual(expected)
  })
})
