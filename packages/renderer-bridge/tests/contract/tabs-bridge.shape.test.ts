/** Shape test for createTabsBridge. */
import { describe, test, expect } from 'vitest'
import { createTabsBridge } from '../../src/bridges/tabs-bridge.js'
import { mockRuntime } from '../helpers/mocks.js'

const EXPECTED_TABS_API_METHODS = [
  'list',
  'activate',
  'close',
  'showMenu',
  'showNewMenu',
  'reorder',
  'onChanged',
  'notifyChromePressed',
  'onChromePressed',
] as const

describe('createTabsBridge shape', () => {
  test('implements every TabsApi method', () => {
    const bridge = createTabsBridge(mockRuntime())
    const bridgeMethods = Object.keys(bridge).sort()
    const expected = [...EXPECTED_TABS_API_METHODS].sort()
    expect(bridgeMethods).toEqual(expected)
  })
})
