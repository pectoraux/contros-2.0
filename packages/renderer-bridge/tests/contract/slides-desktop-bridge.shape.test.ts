/** Shape test for createSlidesDesktopBridge (the small DesktopFilesApi). */
import { describe, test, expect } from 'vitest'
import { createSlidesDesktopBridge } from '../../src/bridges/slides-desktop-bridge.js'
import { mockRuntime } from '../helpers/mocks.js'

const EXPECTED_DESKTOP_FILES_API_METHODS = [
  'pickAttachments',
  'addAttachmentPaths',
  'addPastedImage',
  'readAttachment',
  'readAttachmentImage',
  'getPathForFile',
] as const

describe('createSlidesDesktopBridge shape', () => {
  test('implements every DesktopFilesApi method', () => {
    const bridge = createSlidesDesktopBridge(mockRuntime())
    const bridgeMethods = Object.keys(bridge).sort()
    const expected = [...EXPECTED_DESKTOP_FILES_API_METHODS].sort()
    expect(bridgeMethods).toEqual(expected)
  })
})
