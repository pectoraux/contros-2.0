/** Shape test for createProjectApiBridge + createProjectHomeBridge. */
import { describe, test, expect } from 'vitest'
import { createProjectApiBridge, createProjectHomeBridge } from '../../src/bridges/project-bridge.js'
import { mockRuntime } from '../helpers/mocks.js'

const EXPECTED_PROJECT_API_METHODS = [
  'resolveChat',
  'appendChat',
  'loadChat',
  'rebindChat',
  'listProjects',
  'createProject',
  'renameProject',
  'deleteProject',
  'moveFile',
  'getTimeline',
] as const

const EXPECTED_PROJECT_HOME_API_METHODS = [
  'listProjects',
  'listFiles',
  'createProject',
  'renameProject',
  'deleteProject',
  'moveFile',
  'getTimeline',
] as const

describe('createProjectApiBridge shape', () => {
  test('implements every ProjectApi method', () => {
    const bridge = createProjectApiBridge(mockRuntime())
    const bridgeMethods = Object.keys(bridge).sort()
    const expected = [...EXPECTED_PROJECT_API_METHODS].sort()
    expect(bridgeMethods).toEqual(expected)
  })
})

describe('createProjectHomeBridge shape', () => {
  test('implements every ProjectHomeApi method', () => {
    const bridge = createProjectHomeBridge(mockRuntime())
    const bridgeMethods = Object.keys(bridge).sort()
    const expected = [...EXPECTED_PROJECT_HOME_API_METHODS].sort()
    expect(bridgeMethods).toEqual(expected)
  })
})
