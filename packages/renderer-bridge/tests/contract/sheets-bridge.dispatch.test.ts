/** Dispatch test for createSheetsDesktopApiBridge. */
import { describe, test, expect, vi } from 'vitest'
import { createSheetsDesktopApiBridge } from '../../src/bridges/sheets-bridge.js'
import { mockRuntime, mockSettings, mockAI, mockIdentity, mockWindowing } from '../helpers/mocks.js'

describe('createSheetsDesktopApiBridge dispatch', () => {
  test('getTheme dispatches to runtime.settings.getTheme (NOT sheets, NOT ai)', async () => {
    const settings = mockSettings()
    const runtime = mockRuntime({ settings })
    const sheets = runtime.sheets
    const bridge = createSheetsDesktopApiBridge(runtime)

    await bridge.getTheme()

    expect(settings.getTheme).toHaveBeenCalledTimes(1)
    expect(sheets.selectWorkbook).not.toHaveBeenCalled()
  })

  test('selectWorkbook dispatches to runtime.sheets.selectWorkbook (NOT saveWorkbookEdits)', async () => {
    const runtime = mockRuntime()
    const sheets = runtime.sheets
    const bridge = createSheetsDesktopApiBridge(runtime)

    await bridge.selectWorkbook()

    expect(sheets.selectWorkbook).toHaveBeenCalledTimes(1)
    expect(sheets.saveWorkbookEdits).not.toHaveBeenCalled()
  })

  test('saveWorkbookEdits passes the request through (argument transformation)', async () => {
    const runtime = mockRuntime()
    const sheets = runtime.sheets
    const bridge = createSheetsDesktopApiBridge(runtime)

    const req = { sessionId: 's1', edits: [] } as never
    await bridge.saveWorkbookEdits(req)

    expect(sheets.saveWorkbookEdits).toHaveBeenCalledWith(req)
  })

  test('onChromePressed dispatches to windowing (NOT settings)', () => {
    const windowing = mockWindowing()
    const settings = mockSettings()
    const runtime = mockRuntime({ windowing, settings })
    const bridge = createSheetsDesktopApiBridge(runtime)

    const handler = () => {}
    bridge.onChromePressed(handler)

    expect(windowing.onChromePressed).toHaveBeenCalledWith(handler)
    expect(settings.onThemeChanged).not.toHaveBeenCalled()
  })

  test('notifyPendingEdits dispatches to sheets.notifyPendingEdits (fire-and-forget)', () => {
    const runtime = mockRuntime()
    const sheets = runtime.sheets
    const bridge = createSheetsDesktopApiBridge(runtime)

    bridge.notifyPendingEdits(5)

    expect(sheets.notifyPendingEdits).toHaveBeenCalledWith(5)
  })
})
