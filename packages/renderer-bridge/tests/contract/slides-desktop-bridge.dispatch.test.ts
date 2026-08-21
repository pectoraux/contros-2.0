/** Dispatch test — SpreadsheetService is NOT_YET_WIRED, methods throw via notYet(). */
import { describe, test, expect } from 'vitest'
import { createSlidesDesktopBridge } from '../../src/bridges/slides-desktop-bridge.js'
import { mockRuntime } from '../helpers/mocks.js'

describe('createSlidesDesktopBridge dispatch (unwired service)', () => {
  test('pickAttachments throws (SpreadsheetService not wired)', async () => {
    const bridge = createSlidesDesktopBridge(mockRuntime())
    expect(() => bridge.pickAttachments()).toThrow(/SpreadsheetService is not wired/)
  })
})
