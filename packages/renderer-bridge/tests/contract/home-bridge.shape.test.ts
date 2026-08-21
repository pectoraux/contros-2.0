/**
 * Shape test for createHomeBridge — verifies every HomeApi method is implemented.
 *
 * The EXPECTED array is the canonical method list from
 * apps/shell/src/shared/home-api.ts:60-146 (HomeApi interface).
 */
import { describe, test, expect } from 'vitest'
import { createHomeBridge } from '../../src/bridges/home-bridge.js'
import { mockRuntime } from '../helpers/mocks.js'

// Canonical HomeApi method names from apps/shell/src/shared/home-api.ts:60-146.
const EXPECTED_HOME_API_METHODS = [
  'recents',
  'starred',
  'statPaths',
  'toggleStar',
  'openPath',
  'browse',
  'newDoc',
  'newSheet',
  'newSlide',
  'newMarkdown',
  'removeRecent',
  'revealPath',
  'renameFile',
  'duplicateFile',
  'deleteFiles',
  'openTrash',
  'getLanguage',
  'setLanguage',
  'getUpdateChannel',
  'setUpdateChannel',
  'accountStatus',
  'accountLogin',
  'onAccountLogin',
  'openLoginUrl',
  'accountLogout',
  'getAppVersion',
  'onboardingSeen',
  'setOnboardingSeen',
  'getTheme',
  'setTheme',
  'getDefaultSaveDir',
  'pickDefaultSaveDir',
  'onThemeChanged',
  'openGenTeam',
  'openCreditUsage',
  'openGitHubRepo',
  'githubStars',
  'starPromptShouldShow',
  'starPromptAction',
  'cloudProjectsCached',
  'cloudProjectsSync',
  'openCloudProject',
] as const

describe('createHomeBridge shape', () => {
  test('implements every HomeApi method', () => {
    const bridge = createHomeBridge(mockRuntime())
    const bridgeMethods = Object.keys(bridge).sort()
    const expected = [...EXPECTED_HOME_API_METHODS].sort()
    expect(bridgeMethods).toEqual(expected)
  })

  test('no extra methods beyond HomeApi', () => {
    const bridge = createHomeBridge(mockRuntime())
    const bridgeMethods = new Set(Object.keys(bridge))
    for (const expected of EXPECTED_HOME_API_METHODS) {
      expect(bridgeMethods.has(expected)).toBe(true)
    }
  })
})
