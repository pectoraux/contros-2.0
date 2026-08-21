/** Shape test for createUpdateBridge. */
import { describe, test, expect } from 'vitest'
import { createUpdateBridge } from '../../src/bridges/update-bridge.js'
import type { UpdateUiState } from '@genoffice/shell-update-shared'

const EXPECTED_UPDATE_API_METHODS = [
  'getState',
  'download',
  'install',
  'later',
  'openDownload',
  'onState',
] as const

function makeMockUpdater() {
  return {
    getState: () => Promise.resolve(null),
    download: () => {},
    install: () => {},
    later: () => {},
    openDownload: () => {},
    onState: () => () => {},
  }
}

describe('createUpdateBridge shape', () => {
  test('implements every UpdateWindowApi method', () => {
    const bridge = createUpdateBridge({ updater: makeMockUpdater() })
    const bridgeMethods = Object.keys(bridge).sort()
    const expected = [...EXPECTED_UPDATE_API_METHODS].sort()
    expect(bridgeMethods).toEqual(expected)
  })

  test('getState returns UpdateUiState (return transformation)', async () => {
    const mockState: UpdateUiState = {
      phase: 'available',
      version: '1.0.0',
      currentVersion: '0.9.0',
      percent: 0,
      lang: 'en',
      strings: {
        title: 'T',
        headline: 'H',
        desc: 'D',
        download: 'DL',
        later: 'L',
        install: 'I',
        downloading: 'DLG',
        failed: 'F',
        retry: 'R',
        manualDesc: 'MD',
        openDownload: 'OD',
      },
    }
    const updater = {
      ...makeMockUpdater(),
      getState: () => Promise.resolve(mockState),
    }
    const bridge = createUpdateBridge({ updater })

    const result = await bridge.getState()
    expect(result).toBe(mockState)
  })
})
