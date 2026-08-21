/** Shape test for createMarkdownApiBridge. */
import { describe, test, expect } from 'vitest'
import { createMarkdownApiBridge } from '../../src/bridges/markdown-bridge.js'
import { mockRuntime } from '../helpers/mocks.js'

const EXPECTED_MARKDOWN_API_METHODS = [
  'consumePending',
  'readFile',
  'save',
  'setDirty',
  'onSaveRequest',
  'sendSaveRequestAck',
  'onCloseSaveRequest',
  'sendCloseSaveResult',
  'onFileRenamed',
  'pickImage',
  'saveImage',
  'readImage',
  'onExportRequest',
  'onPrintRequest',
  'exportDocx',
  'exportPdf',
  'getLanguage',
  'onLanguageChanged',
  'getTheme',
  'onThemeChanged',
  'onChromePressed',
  'getAiSettings',
  'aiStream',
  'aiStreamCancel',
  'onAiStream',
  'webSearch',
] as const

describe('createMarkdownApiBridge shape', () => {
  test('implements every MarkdownApi method', () => {
    const bridge = createMarkdownApiBridge(mockRuntime())
    const bridgeMethods = Object.keys(bridge).sort()
    const expected = [...EXPECTED_MARKDOWN_API_METHODS].sort()
    expect(bridgeMethods).toEqual(expected)
  })
})
