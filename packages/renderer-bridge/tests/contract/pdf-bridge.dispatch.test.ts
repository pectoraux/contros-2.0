/** Dispatch test — PdfService is NOT_YET_WIRED, methods throw via notYet(). */
import { describe, test, expect, vi } from 'vitest'
import { createPdfApiBridge } from '../../src/bridges/pdf-bridge.js'
import { mockRuntime } from '../helpers/mocks.js'

describe('createPdfApiBridge dispatch (unwired service)', () => {
  test('consumePending throws (PdfService not wired)', async () => {
    const bridge = createPdfApiBridge(mockRuntime())
    expect(() => bridge.consumePending()).toThrow(/PdfService is not wired/)
  })

  test('getLanguage delegates to runtime.settings (cross-cutting)', async () => {
    const runtime = mockRuntime()
    runtime.settings.getLanguage = vi.fn().mockResolvedValue('en')
    const bridge = createPdfApiBridge(runtime)
    const result = await bridge.getLanguage()
    expect(result).toBe('en')
  })
})
