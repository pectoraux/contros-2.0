/** Dispatch test — PresentationService is NOT_YET_WIRED, methods throw via notYet(). */
import { describe, test, expect, vi } from 'vitest'
import { createSlidesApiBridge } from '../../src/bridges/slides-bridge.js'
import { mockRuntime } from '../helpers/mocks.js'

describe('createSlidesApiBridge dispatch (unwired service)', () => {
  test('openPptx throws (PresentationService not wired)', async () => {
    const bridge = createSlidesApiBridge(mockRuntime())
    expect(() => bridge.openPptx(1280)).toThrow(/PresentationService is not wired/)
  })

  test('getLanguage delegates to runtime.settings (cross-cutting)', async () => {
    const runtime = mockRuntime()
    runtime.settings.getLanguage = vi.fn().mockResolvedValue('en')
    const bridge = createSlidesApiBridge(runtime)
    const result = await bridge.getLanguage()
    expect(result).toBe('en')
  })
})
