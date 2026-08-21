/** Dispatch test for createTabsBridge. */
import { describe, test, expect, vi } from 'vitest'
import { createTabsBridge } from '../../src/bridges/tabs-bridge.js'
import { mockRuntime, mockWindowing } from '../helpers/mocks.js'

describe('createTabsBridge dispatch', () => {
  test('activate dispatches to runtime.windowing.activateTab (NOT closeTab, NOT reorderTab)', async () => {
    const windowing = mockWindowing()
    const runtime = mockRuntime({ windowing })
    const bridge = createTabsBridge(runtime)

    await bridge.activate('tab-3')

    expect(windowing.activateTab).toHaveBeenCalledWith('tab-3')
    expect(windowing.closeTab).not.toHaveBeenCalled()
    expect(windowing.reorderTab).not.toHaveBeenCalled()
  })

  test('reorder passes both arguments through (argument transformation)', async () => {
    const windowing = mockWindowing()
    const runtime = mockRuntime({ windowing })
    const bridge = createTabsBridge(runtime)

    await bridge.reorder('tab-5', 2)

    expect(windowing.reorderTab).toHaveBeenCalledWith('tab-5', 2)
  })

  test('notifyChromePressed dispatches to windowing.notifyChromePressed (fire-and-forget)', () => {
    const windowing = mockWindowing()
    const runtime = mockRuntime({ windowing })
    const bridge = createTabsBridge(runtime)

    bridge.notifyChromePressed()

    expect(windowing.notifyChromePressed).toHaveBeenCalledTimes(1)
  })

  test('onChromePressed subscribes via windowing.onChromePressed (NOT onTabsChanged)', () => {
    const windowing = mockWindowing()
    windowing.onChromePressed = vi.fn().mockReturnValue(() => {})
    windowing.onTabsChanged = vi.fn().mockReturnValue(() => {})
    const runtime = mockRuntime({ windowing })
    const bridge = createTabsBridge(runtime)

    const handler = () => {}
    const unsub = bridge.onChromePressed(handler)

    expect(windowing.onChromePressed).toHaveBeenCalledWith(handler)
    expect(windowing.onTabsChanged).not.toHaveBeenCalled()
    expect(typeof unsub).toBe('function')
  })
})
