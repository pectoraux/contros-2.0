/**
 * Dispatch test for createHomeBridge — verifies the correct service/capability
 * is called (destination), the wrong one is NOT called (non-destination),
 * arguments are passed through (argument transformation), and return values
 * are passed through (return transformation).
 */
import { describe, test, expect, vi } from 'vitest'
import { createHomeBridge } from '../../src/bridges/home-bridge.js'
import { mockRuntime, mockIdentity, mockSettings, mockWindowing, mockFiles, mockStorage } from '../helpers/mocks.js'

describe('createHomeBridge dispatch', () => {
  test('getTheme dispatches to runtime.settings.getTheme (NOT identity, NOT files)', async () => {
    const settings = mockSettings()
    const identity = mockIdentity()
    const files = mockFiles()
    const runtime = mockRuntime({ settings, identity, files })
    const bridge = createHomeBridge(runtime)

    await bridge.getTheme()

    expect(settings.getTheme).toHaveBeenCalledTimes(1)
    expect(identity.accountStatus).not.toHaveBeenCalled()
    expect(files.pickOpen).not.toHaveBeenCalled()
  })

  test('getTheme returns the value from settings (return transformation)', async () => {
    const settings = mockSettings()
    settings.getTheme = vi.fn().mockResolvedValue('dark')
    const runtime = mockRuntime({ settings })
    const bridge = createHomeBridge(runtime)

    const result = await bridge.getTheme()
    expect(result).toBe('dark')
  })

  test('accountStatus dispatches to runtime.identity (NOT settings, NOT storage)', async () => {
    const identity = mockIdentity()
    const settings = mockSettings()
    const storage = mockStorage()
    const runtime = mockRuntime({ identity, settings, storage })
    const bridge = createHomeBridge(runtime)

    await bridge.accountStatus()

    expect(identity.accountStatus).toHaveBeenCalledTimes(1)
    expect(settings.getTheme).not.toHaveBeenCalled()
    expect(storage.get).not.toHaveBeenCalled()
  })

  test('setLanguage passes the lang argument through to settings (argument transformation)', async () => {
    const settings = mockSettings()
    const runtime = mockRuntime({ settings })
    const bridge = createHomeBridge(runtime)

    await bridge.setLanguage('ja' as never)

    expect(settings.setLanguage).toHaveBeenCalledWith('ja')
  })

  test('openGitHubRepo dispatches to runtime.windowing.openGitHubRepo (NOT identity)', async () => {
    const windowing = mockWindowing()
    const identity = mockIdentity()
    const runtime = mockRuntime({ windowing, identity })
    const bridge = createHomeBridge(runtime)

    await bridge.openGitHubRepo()

    expect(windowing.openGitHubRepo).toHaveBeenCalledTimes(1)
    expect(identity.openGenTeam).not.toHaveBeenCalled()
  })

  test('openCloudProject passes the URL argument through to windowing.openExternal', async () => {
    const windowing = mockWindowing()
    const runtime = mockRuntime({ windowing })
    const bridge = createHomeBridge(runtime)

    await bridge.openCloudProject('/agents?id=123')

    expect(windowing.openExternal).toHaveBeenCalledWith('/agents?id=123')
  })

  test('deleteFiles dispatches to runtime.files.trash (NOT storage)', async () => {
    const files = mockFiles()
    const storage = mockStorage()
    const runtime = mockRuntime({ files, storage })
    const bridge = createHomeBridge(runtime)

    await bridge.deleteFiles(['/path/a.docx', '/path/b.docx'])

    expect(files.trash).toHaveBeenCalledWith(['/path/a.docx', '/path/b.docx'])
    expect(storage.delete).not.toHaveBeenCalled()
  })

  test('revealPath dispatches to runtime.files.revealInFolder (NOT windowing)', async () => {
    const files = mockFiles()
    const windowing = mockWindowing()
    const runtime = mockRuntime({ files, windowing })
    const bridge = createHomeBridge(runtime)

    await bridge.revealPath('/path/to/file.docx')

    expect(files.revealInFolder).toHaveBeenCalledWith('/path/to/file.docx')
    expect(windowing.openExternal).not.toHaveBeenCalled()
  })
})
