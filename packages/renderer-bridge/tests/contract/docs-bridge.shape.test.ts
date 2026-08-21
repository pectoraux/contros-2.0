/** Shape test for createDocsDesktopBridge. */
import { describe, test, expect } from 'vitest'
import { createDocsDesktopBridge } from '../../src/bridges/docs-bridge.js'
import { mockRuntime } from '../helpers/mocks.js'

// Canonical DesktopApi method names from apps/docs/src/shared/ipc.ts:140-279.
const EXPECTED_DOCS_DESKTOP_API_METHODS = [
  'getLanguage',
  'onLanguageChanged',
  'getTheme',
  'onThemeChanged',
  'onChromePressed',
  'openDocx',
  'openDocxPath',
  'consumePendingOpenDocx',
  'consumeNewBlankDoc',
  'onOpenDocx',
  'onRenamedDocx',
  'saveDocx',
  'writeRecoveryCopy',
  'saveDocxAs',
  'saveDocxNew',
  'getRecentFiles',
  'onTeardown',
  'pickImage',
  'fontMetrics',
  'getAiSettings',
  'setAiSettings',
  'print',
  'exportPdf',
  'printPdfBuffer',
  'saveMergedPdf',
  'aiChat',
  'aiStream',
  'aiStreamCancel',
  'aiGskStatus',
  'aiGskLogin',
  'webSearch',
  'imageSearch',
  'fetchImage',
  'pickAttachments',
  'addAttachmentPaths',
  'addPastedImage',
  'readAttachment',
  'readAttachmentImage',
  'getPathForFile',
  'openNewTab',
  'listDocsTabs',
  'focusDocsTab',
  'onAiStream',
  'onMenuCommand',
  'onCloseCheck',
  'reportCloseCheck',
  'onCloseSaveRequest',
  'reportCloseSaveResult',
  'reportViewMenuState',
] as const

describe('createDocsDesktopBridge shape', () => {
  test('implements every DesktopApi method', () => {
    const bridge = createDocsDesktopBridge(mockRuntime())
    const bridgeMethods = Object.keys(bridge).sort()
    const expected = [...EXPECTED_DOCS_DESKTOP_API_METHODS].sort()
    expect(bridgeMethods).toEqual(expected)
  })

  test('no extra methods beyond DesktopApi', () => {
    const bridge = createDocsDesktopBridge(mockRuntime())
    const expected = new Set(EXPECTED_DOCS_DESKTOP_API_METHODS)
    for (const key of Object.keys(bridge)) {
      expect(expected.has(key as never)).toBe(true)
    }
  })
})
