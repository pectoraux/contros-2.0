/** Shape test for createPdfApiBridge. */
import { describe, test, expect } from 'vitest'
import { createPdfApiBridge } from '../../src/bridges/pdf-bridge.js'
import { mockRuntime } from '../helpers/mocks.js'

const EXPECTED_PDF_API_METHODS = [
  'consumePending',
  'readFile',
  'save',
  'validateTextEdits',
  'listEditFonts',
  'listPageImages',
  'listStaticFormFills',
  'pageImagePng',
  'pagePreviewPng',
  'extractPages',
  'insertPdf',
  'insertBlankPage',
  'splitPdf',
  'mergePdf',
  'mergePages',
  'replacePages',
  'setPageSize',
  'splitPages',
  'cropPages',
  'exportImages',
  'imageSearch',
  'fetchImage',
  'generateImage',
  'listSavedSignatures',
  'addSavedSignature',
  'removeSavedSignature',
  'getUsername',
  'setDirty',
  'onCloseSaveRequest',
  'sendCloseSaveResult',
  'onSaveAsRequest',
  'sendSaveAsResult',
  'onSaveAsFlow',
  'onPrintRequest',
  'getLanguage',
  'onLanguageChanged',
  'getTheme',
  'onThemeChanged',
  'onChromePressed',
  'getAiSettings',
  'aiStream',
  'aiStreamCancel',
  'onAiStream',
] as const

describe('createPdfApiBridge shape', () => {
  test('implements every PdfApi method', () => {
    const bridge = createPdfApiBridge(mockRuntime())
    const bridgeMethods = Object.keys(bridge).sort()
    const expected = [...EXPECTED_PDF_API_METHODS].sort()
    expect(bridgeMethods).toEqual(expected)
  })
})
