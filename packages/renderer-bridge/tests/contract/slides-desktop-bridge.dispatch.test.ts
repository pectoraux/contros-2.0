/** Dispatch test for createSlidesDesktopBridge. */
import { describe, test, expect } from 'vitest'
import { createSlidesDesktopBridge } from '../../src/bridges/slides-desktop-bridge.js'
import { mockRuntime } from '../helpers/mocks.js'

describe('createSlidesDesktopBridge dispatch', () => {
  test('pickAttachments dispatches to runtime.sheets.pickAttachments (NOT saveWorkbookEdits)', async () => {
    const runtime = mockRuntime()
    const sheets = runtime.sheets
    const bridge = createSlidesDesktopBridge(runtime)

    await bridge.pickAttachments()

    expect(sheets.pickAttachments).toHaveBeenCalledTimes(1)
    expect(sheets.saveWorkbookEdits).not.toHaveBeenCalled()
  })

  test('addPastedImage passes both arguments through (argument transformation)', async () => {
    const runtime = mockRuntime()
    const sheets = runtime.sheets
    const bridge = createSlidesDesktopBridge(runtime)

    const data = new ArrayBuffer(2)
    await bridge.addPastedImage(data, 'png')

    expect(sheets.addPastedImage).toHaveBeenCalledWith(data, 'png')
  })

  test('readAttachment passes (path, offset, maxChars) through (argument transformation)', async () => {
    const runtime = mockRuntime()
    const sheets = runtime.sheets
    const bridge = createSlidesDesktopBridge(runtime)

    await bridge.readAttachment('/path/to/attach.pdf', 0, 24000)

    expect(sheets.readAttachment).toHaveBeenCalledWith('/path/to/attach.pdf', 0, 24000)
  })
})
