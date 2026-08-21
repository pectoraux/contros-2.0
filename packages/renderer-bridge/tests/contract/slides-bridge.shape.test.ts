/** Shape test for createSlidesApiBridge. */
import { describe, test, expect } from 'vitest'
import { createSlidesApiBridge } from '../../src/bridges/slides-bridge.js'
import { mockRuntime } from '../helpers/mocks.js'

// Cross-cutting methods (delegate to capabilities, NOT to PresentationService).
const CROSS_CUTTING_METHODS = [
  'getLanguage',
  'onLanguageChanged',
  'getTheme',
  'onThemeChanged',
  'onChromePressed',
  'setShowFullScreen',
  'getAiSettings',
  'setAiSettings',
  'aiStream',
  'aiStreamCancel',
  'aiGskStatus',
  'aiGskLogin',
  'webSearch',
  'imageSearch',
  'onAiStream',
  'openExternal',
] as const

// A representative sample of slides-specific methods (the full list is ~120).
const SAMPLE_SLIDES_METHODS = [
  'openPptx',
  'openPptxPath',
  'consumePendingOpen',
  'newBlank',
  'editText',
  'editTransform',
  'editFill',
  'editStroke',
  'addElement',
  'deleteElement',
  'addSlide',
  'deleteSlide',
  'save',
  'saveAs',
  'undo',
  'redo',
  'masterEnter',
  'masterClose',
  'presenterStart',
  'presenterEnd',
] as const

describe('createSlidesApiBridge shape', () => {
  test('implements cross-cutting methods', () => {
    const bridge = createSlidesApiBridge(mockRuntime())
    for (const method of CROSS_CUTTING_METHODS) {
      expect(typeof (bridge as never)[method]).toBe('function')
    }
  })

  test('delegates slides-specific methods to PresentationService via spread', () => {
    const runtime = mockRuntime()
    const slides = runtime.slides as Record<string, () => unknown>
    // Verify a sample of slides-specific methods exist on the bridge
    const bridge = createSlidesApiBridge(runtime) as Record<string, () => unknown>
    for (const method of SAMPLE_SLIDES_METHODS) {
      expect(typeof bridge[method]).toBe('function')
    }
  })
})
