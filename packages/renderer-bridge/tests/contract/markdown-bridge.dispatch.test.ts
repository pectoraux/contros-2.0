/** Dispatch test for createMarkdownApiBridge — all service methods throw via notYet(). */
import { describe, test, expect, vi } from 'vitest'
import { createMarkdownApiBridge } from '../../src/bridges/markdown-bridge.js'
import { mockRuntime } from '../helpers/mocks.js'

describe('createMarkdownApiBridge dispatch (unwired service)', () => {
  test('consumePending throws (MarkdownService not wired)', async () => {
    const bridge = createMarkdownApiBridge(mockRuntime())
    expect(() => bridge.consumePending()).toThrow(/MarkdownService is not wired/)
  })

  test('readFile throws (MarkdownService not wired)', async () => {
    const bridge = createMarkdownApiBridge(mockRuntime())
    expect(() => bridge.readFile('/path')).toThrow(/MarkdownService is not wired/)
  })

  test('save throws (MarkdownService not wired)', async () => {
    const bridge = createMarkdownApiBridge(mockRuntime())
    expect(() => bridge.save({ text: '', mode: 'save' })).toThrow(/MarkdownService is not wired/)
  })

  test('getLanguage delegates to runtime.settings (cross-cutting, NOT notYet)', async () => {
    const runtime = mockRuntime()
    runtime.settings.getLanguage = vi.fn().mockResolvedValue('en')
    const bridge = createMarkdownApiBridge(runtime)
    const result = await bridge.getLanguage()
    expect(result).toBe('en')
    expect(runtime.settings.getLanguage).toHaveBeenCalledTimes(1)
  })
})
