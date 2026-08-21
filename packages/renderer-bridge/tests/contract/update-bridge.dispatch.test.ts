/** Dispatch test for createUpdateBridge. */
import { describe, test, expect, vi } from 'vitest'
import { createUpdateBridge } from '../../src/bridges/update-bridge.js'
import { mockRuntime } from '../helpers/mocks.js'

describe('createUpdateBridge dispatch', () => {
  test('download dispatches to runtime.updater.download (NOT install, NOT later)', () => {
    const mockUpdater = {
      getState: vi.fn().mockResolvedValue(null),
      download: vi.fn(),
      install: vi.fn(),
      later: vi.fn(),
      openDownload: vi.fn(),
      onState: vi.fn().mockReturnValue(() => {}),
    }
    const runtime = mockRuntime({ updater: mockUpdater } as never)
    const bridge = createUpdateBridge(runtime)

    bridge.download()

    expect(mockUpdater.download).toHaveBeenCalledTimes(1)
    expect(mockUpdater.install).not.toHaveBeenCalled()
    expect(mockUpdater.later).not.toHaveBeenCalled()
  })

  test('onState subscribes via updater.onState (NOT getState)', () => {
    const mockUpdater = {
      getState: vi.fn().mockResolvedValue(null),
      download: vi.fn(),
      install: vi.fn(),
      later: vi.fn(),
      openDownload: vi.fn(),
      onState: vi.fn().mockReturnValue(() => {}),
    }
    const runtime = mockRuntime({ updater: mockUpdater } as never)
    const bridge = createUpdateBridge(runtime)

    const handler = () => {}
    const unsub = bridge.onState(handler)

    expect(mockUpdater.onState).toHaveBeenCalledWith(handler)
    expect(mockUpdater.getState).not.toHaveBeenCalled()
    expect(typeof unsub).toBe('function')
  })
})
