/**
 * Service-level tests for DocumentServiceImpl.
 *
 * Verifies the core open/save/saveAs/saveNew/recovery/external-modified/recents
 * lifecycle through mocked capabilities. Confirms the service:
 *   - Delegates to the correct capability (destination + non-destination)
 *   - Performs argument transformation (ArrayBuffer → Uint8Array is in the bridge;
 *     the service receives Uint8Array directly)
 *   - Returns correct session objects
 *   - Updates the registry via return values
 *
 * NO fs access in these tests — all capabilities are mocked.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { DocumentServiceImpl, type DocumentServiceDeps, type DocsEventBus } from '../src/document-service.js'
import type { DocumentSession } from '@genoffice/runtime-contracts'

// ── Mock capability factories ──────────────────────────────────────────

function mockStorage() {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    readObject: vi.fn().mockResolvedValue(null),
    writeObject: vi.fn().mockResolvedValue(undefined),
    deleteObject: vi.fn().mockResolvedValue(undefined),
    listObjects: vi.fn().mockResolvedValue([]),
    readBlob: vi.fn().mockResolvedValue(null),
    writeBlob: vi.fn().mockResolvedValue(undefined),
    deleteBlob: vi.fn().mockResolvedValue(undefined),
  }
}

function mockFiles() {
  return {
    pickOpen: vi.fn().mockResolvedValue(null),
    pickSave: vi.fn().mockResolvedValue(null),
    pickDirectory: vi.fn().mockResolvedValue(null),
    read: vi.fn().mockResolvedValue({ bytes: new Uint8Array(), stat: { mtimeMs: 0, sizeBytes: 0 } }),
    write: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue(null),
    rename: vi.fn().mockResolvedValue(''),
    trash: vi.fn().mockResolvedValue(undefined),
    revealInFolder: vi.fn().mockResolvedValue(undefined),
    openPath: vi.fn().mockResolvedValue(undefined),
    getPathForFile: vi.fn().mockReturnValue(''),
    uniquePath: vi.fn().mockResolvedValue('/dir/foo.docx'),
  }
}

function mockAI() {
  return {
    getSettings: vi.fn().mockResolvedValue({ provider: 'genspark' }),
    setSettings: vi.fn().mockResolvedValue(undefined),
    stream: vi.fn().mockResolvedValue(undefined),
    streamCancel: vi.fn().mockResolvedValue(undefined),
    onStream: vi.fn().mockReturnValue(() => {}),
    chat: vi.fn().mockResolvedValue({}),
    webSearch: vi.fn().mockResolvedValue({ results: [], method: '' }),
    imageSearch: vi.fn().mockResolvedValue({ images: [], method: '' }),
    fetchImage: vi.fn().mockResolvedValue(null),
    generateImage: vi.fn().mockResolvedValue({}),
    analyzeMedia: vi.fn().mockResolvedValue({}),
  }
}

function mockPrinting() {
  return {
    print: vi.fn().mockResolvedValue({ ok: true }),
    exportPdf: vi.fn().mockResolvedValue({ ok: true, path: '/out.pdf' }),
    printToBytes: vi.fn().mockResolvedValue({ ok: true, base64: '' }),
    saveMergedPdf: vi.fn().mockResolvedValue({ ok: true, path: '/out.pdf' }),
  }
}

function mockSettings() {
  return {
    getTheme: vi.fn().mockResolvedValue('system'),
    setTheme: vi.fn().mockResolvedValue(undefined),
    onThemeChanged: vi.fn().mockReturnValue(() => {}),
    getLanguage: vi.fn().mockResolvedValue('en'),
    setLanguage: vi.fn().mockResolvedValue(undefined),
    onLanguageChanged: vi.fn().mockReturnValue(() => {}),
    getUpdateChannel: vi.fn().mockResolvedValue('stable'),
    setUpdateChannel: vi.fn().mockResolvedValue(undefined),
    onboardingSeen: vi.fn().mockResolvedValue(false),
    setOnboardingSeen: vi.fn().mockResolvedValue(undefined),
    getDefaultSaveDir: vi.fn().mockResolvedValue('/home/user/Documents/GenOffice'),
    pickDefaultSaveDir: vi.fn().mockResolvedValue(null),
    getAppVersion: vi.fn().mockResolvedValue('0.1.0'),
  }
}

function mockFontRegistry() {
  return { fontMetrics: vi.fn().mockResolvedValue(null) }
}

function mockEventBus(): DocsEventBus {
  return {
    opened: vi.fn(),
    renamed: vi.fn(),
    teardown: vi.fn(),
    menuCommand: vi.fn(),
    closeCheck: vi.fn(),
    closeSaveRequest: vi.fn(),
  }
}

function makeService(overrides: Partial<DocumentServiceDeps> = {}) {
  const deps: DocumentServiceDeps = {
    storage: mockStorage(),
    files: mockFiles(),
    ai: mockAI(),
    printing: mockPrinting(),
    settings: mockSettings(),
    fontRegistry: mockFontRegistry(),
    ...overrides,
  }
  const eventBus = mockEventBus()
  const service = new DocumentServiceImpl(deps, eventBus)
  return { service, deps, eventBus }
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('DocumentServiceImpl', () => {
  describe('open', () => {
    test('returns { session, result } with the file path, name, hash, and data', async () => {
      const { service, deps } = makeService()
      const fileBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]) // PK zip header
      deps.files.read = vi.fn().mockResolvedValue({
        bytes: fileBytes,
        stat: { mtimeMs: 1234567890, sizeBytes: 4 },
      })

      const result = await service.open('/path/to/test.docx')

      expect(result).not.toBeNull()
      expect(result!.session.filePath).toBe('/path/to/test.docx')
      expect(result!.session.hash).toMatch(/^[a-f0-9]{64}$/) // sha256 hex
      expect(result!.session.diskState).toEqual({
        mtimeMs: 1234567890,
        size: 4,
        hash: result!.session.hash,
      })
      expect(result!.result.path).toBe('/path/to/test.docx')
      expect(result!.result.name).toBe('test.docx')
      expect(result!.result.hash).toBe(result!.session.hash)
      expect(result!.result.data).toBeInstanceOf(ArrayBuffer)
    })

    test('archives the original via Storage.writeBlob', async () => {
      const { service, deps } = makeService()
      const fileBytes = new Uint8Array([1, 2, 3])
      deps.files.read = vi.fn().mockResolvedValue({
        bytes: fileBytes,
        stat: { mtimeMs: 0, sizeBytes: 3 },
      })

      await service.open('/p.docx')

      expect(deps.storage.writeBlob).toHaveBeenCalledTimes(1)
      const [key, bytes] = deps.storage.writeBlob.mock.calls[0]
      expect(key).toMatch(/^originals:[a-f0-9]{64}$/)
      expect(bytes).toBe(fileBytes)
    })

    test('pushes the file to recents via Storage.writeObject', async () => {
      const { service, deps } = makeService()
      deps.files.read = vi.fn().mockResolvedValue({
        bytes: new Uint8Array(),
        stat: { mtimeMs: 0, sizeBytes: 0 },
      })

      await service.open('/p.docx')

      expect(deps.storage.writeObject).toHaveBeenCalledWith('docs', 'recents', ['/p.docx'])
    })

    test('fires the opened event via EventBus', async () => {
      const { service, deps, eventBus } = makeService()
      deps.files.read = vi.fn().mockResolvedValue({
        bytes: new Uint8Array(),
        stat: { mtimeMs: 0, sizeBytes: 0 },
      })

      await service.open('/p.docx')

      expect(eventBus.opened).toHaveBeenCalledTimes(1)
      const result = (eventBus.opened as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(result.path).toBe('/p.docx')
    })

    test('returns null when Files.read throws', async () => {
      const { service, deps } = makeService()
      deps.files.read = vi.fn().mockRejectedValue(new Error('not found'))

      const result = await service.open('/missing.docx')

      expect(result).toBeNull()
    })
  })

  describe('save', () => {
    test('writes bytes via Files.write and returns the updated session', async () => {
      const { service, deps } = makeService()
      const session: DocumentSession = {
        filePath: '/p.docx',
        hash: 'oldhash',
        diskState: { mtimeMs: 100, size: 5, hash: 'oldhash' },
      }
      // stat returns matching mtime+size → no external-modified check triggered
      deps.files.stat = vi.fn().mockResolvedValue({ mtimeMs: 100, sizeBytes: 5 })

      const result = await service.save(session, new Uint8Array([1, 2, 3]))

      expect(deps.files.write).toHaveBeenCalledWith('/p.docx', expect.any(Uint8Array))
      expect(result.ok).toBe(true)
      expect(result.session?.diskState?.mtimeMs).toBe(100)
    })

    test('clears the recovery copy via Storage.deleteBlob', async () => {
      const { service, deps } = makeService()
      const session: DocumentSession = { filePath: '/p.docx', hash: 'h' }

      await service.save(session, new Uint8Array())

      expect(deps.storage.deleteBlob).toHaveBeenCalledWith(
        expect.stringMatching(/^recovery:[a-f0-9]{40}$/), // sha1 hex
      )
    })

    test('returns reason=external-modified when disk state changed', async () => {
      const { service, deps } = makeService()
      const session: DocumentSession = {
        filePath: '/p.docx',
        hash: 'oldhash',
        diskState: { mtimeMs: 100, size: 5, hash: 'oldhash' },
      }
      // stat returns different mtime/size → triggers hash check
      deps.files.stat = vi.fn().mockResolvedValue({ mtimeMs: 200, sizeBytes: 10 })
      // read returns different bytes → different hash → external modified
      deps.files.read = vi.fn().mockResolvedValue({
        bytes: new Uint8Array([99]),
        stat: { mtimeMs: 200, sizeBytes: 10 },
      })

      const result = await service.save(session, new Uint8Array([1, 2, 3]))

      expect(result.ok).toBe(false)
      expect(result.reason).toBe('external-modified')
    })

    test('auto=true returns reason=external-modified without prompting (matches existing behavior)', async () => {
      const { service, deps } = makeService()
      const session: DocumentSession = {
        filePath: '/p.docx',
        hash: 'oldhash',
        diskState: { mtimeMs: 100, size: 5, hash: 'oldhash' },
      }
      deps.files.stat = vi.fn().mockResolvedValue({ mtimeMs: 200, sizeBytes: 10 })
      deps.files.read = vi.fn().mockResolvedValue({
        bytes: new Uint8Array([99]),
        stat: { mtimeMs: 200, sizeBytes: 10 },
      })

      const result = await service.save(session, new Uint8Array(), true)

      expect(result.ok).toBe(false)
      expect(result.reason).toBe('external-modified')
    })
  })

  describe('saveNew', () => {
    test('uses Settings.getDefaultSaveDir + Files.uniquePath + Files.write', async () => {
      const { service, deps } = makeService()
      deps.settings.getDefaultSaveDir = vi.fn().mockResolvedValue('/home/user/Documents/GenOffice')
      deps.files.uniquePath = vi.fn().mockResolvedValue('/home/user/Documents/GenOffice/New Doc.docx')
      deps.files.stat = vi.fn().mockResolvedValue({ mtimeMs: 0, sizeBytes: 5 })

      const result = await service.saveNew('New Doc.docx', new Uint8Array([1, 2, 3, 4, 5]))

      expect(deps.settings.getDefaultSaveDir).toHaveBeenCalled()
      expect(deps.files.uniquePath).toHaveBeenCalledWith('/home/user/Documents/GenOffice', 'New Doc.docx')
      expect(deps.files.write).toHaveBeenCalledWith('/home/user/Documents/GenOffice/New Doc.docx', expect.any(Uint8Array))
      expect(result.ok).toBe(true)
      expect(result.path).toBe('/home/user/Documents/GenOffice/New Doc.docx')
      expect(result.session?.filePath).toBe('/home/user/Documents/GenOffice/New Doc.docx')
    })

    test('returns ok=false when Files.write fails', async () => {
      const { service, deps } = makeService()
      deps.settings.getDefaultSaveDir = vi.fn().mockResolvedValue('/dir')
      deps.files.uniquePath = vi.fn().mockResolvedValue('/dir/foo.docx')
      deps.files.write = vi.fn().mockRejectedValue(new Error('disk full'))

      const result = await service.saveNew('foo.docx', new Uint8Array())

      expect(result.ok).toBe(false)
      expect(result.error).toContain('disk full')
    })
  })

  describe('writeRecovery', () => {
    test('writes via Storage.writeBlob with recovery: prefix', async () => {
      const { service, deps } = makeService()
      const session: DocumentSession = { filePath: '/p.docx', hash: 'h' }

      await service.writeRecovery(session, new Uint8Array([1, 2]))

      expect(deps.storage.writeBlob).toHaveBeenCalledWith(
        expect.stringMatching(/^recovery:[a-f0-9]{40}$/),
        expect.any(Uint8Array),
      )
    })

    test('returns ok=false when Storage.writeBlob fails', async () => {
      const { service, deps } = makeService()
      deps.storage.writeBlob = vi.fn().mockRejectedValue(new Error('quota'))
      const session: DocumentSession = { filePath: '/p.docx', hash: 'h' }

      const result = await service.writeRecovery(session, new Uint8Array())

      expect(result.ok).toBe(false)
    })
  })

  describe('recentFiles', () => {
    test('returns paths that still exist (filtered via Files.stat)', async () => {
      const { service, deps } = makeService()
      deps.storage.readObject = vi.fn().mockResolvedValue(['/a.docx', '/b.docx', '/c.docx'])
      deps.files.stat = vi.fn().mockImplementation((path: string) => {
        // /b.docx is missing
        return Promise.resolve(path === '/b.docx' ? null : { mtimeMs: 0, sizeBytes: 0 })
      })

      const result = await service.recentFiles()

      expect(result).toEqual(['/a.docx', '/c.docx'])
    })

    test('returns [] when no recents stored', async () => {
      const { service, deps } = makeService()
      deps.storage.readObject = vi.fn().mockResolvedValue(null)

      const result = await service.recentFiles()

      expect(result).toEqual([])
    })
  })
})
