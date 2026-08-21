/** Dispatch test — SpreadsheetService is NOT_YET_WIRED, methods throw via notYet(). */
import { describe, test, expect, vi } from 'vitest'
import { createSheetsDesktopApiBridge } from '../../src/bridges/sheets-bridge.js'
import { mockRuntime } from '../helpers/mocks.js'

describe('createSheetsDesktopApiBridge dispatch (unwired service)', () => {
  test('selectWorkbook throws (SpreadsheetService not wired)', async () => {
    const bridge = createSheetsDesktopApiBridge(mockRuntime())
    expect(() => bridge.selectWorkbook()).toThrow(/SpreadsheetService is not wired/)
  })

  test('getLanguage delegates to runtime.settings (cross-cutting)', async () => {
    const runtime = mockRuntime()
    runtime.settings.getLanguage = vi.fn().mockResolvedValue('en')
    const bridge = createSheetsDesktopApiBridge(runtime)
    const result = await bridge.getLanguage()
    expect(result).toBe('en')
  })
})
