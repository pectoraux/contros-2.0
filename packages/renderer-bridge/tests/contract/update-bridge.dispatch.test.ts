/** Dispatch test for createUpdateBridge. */
import { describe, test, expect, vi } from 'vitest'
import { createUpdateBridge } from '../../src/bridges/update-bridge.js'

function makeMockUpdater() {
  return {
    getState: vi.fn().mockResolvedValue(null),
    download: vi.fn(),
    install: vi.fn(),
    later: vi.fn(),
    openDownload: vi.fn(),
    onState: vi.fn().mockReturnValue(() => {}),
  }
}

describe('createUpdateBridge dispatch', () => {
  test('download dispatches to updater.download (NOT install, NOT later)', () => {
    const updater = makeMockUpdater()
    const bridge = createUpdateBridge({ updater })

    bridge.download()

    expect(updater.download).toHaveBeenCalledTimes(1)
    expect(updater.install).not.toHaveBeenCalled()
    expect(updater.later).not.toHaveBeenCalled()
  })

  test('onState subscribes via updater.onState (NOT getState)', () => {
    const updater = makeMockUpdater()
    const bridge = createUpdateBridge({ updater })

    const handler = () => {}
    const unsub = bridge.onState(handler)

    expect(updater.onState).toHaveBeenCalledWith(handler)
    expect(updater.getState).not.toHaveBeenCalled()
    expect(typeof unsub).toBe('function')
  })
})
