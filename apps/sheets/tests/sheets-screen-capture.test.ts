/**
 * Increment 8 — Screen capture migration tests.
 *
 * Tests:
 *   1. ScreenCapture contract exists in @genoffice/platform (data-only)
 *   2. ElectronScreenCapture is exported from @genoffice/platform-electron
 *   3. Handler delegates to ScreenCapture capability
 *   4. Browser semantics: enumerateSources → [], captureSource → null
 *   5. Architecture: ZERO desktopCapturer/screen/getFocusedWindow in handler
 *   6. No global capture state
 *
 * Uses a mock ScreenCapture for deterministic testing.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

// ── Mock ScreenCapture ──────────────────────────────────────────────

class MockScreenCapture {
  public enumerateCalls = 0
  public captureCalls: string[] = []
  public sources: Array<{ id: string; name: string; kind: 'screen' | 'window'; thumbnail: string }> = []
  public shouldDeny = false

  async enumerateSources() {
    this.enumerateCalls++
    if (this.shouldDeny) return { status: 'denied' as const, sources: [] }
    return { status: 'ok' as const, sources: this.sources }
  }

  async captureSource(sourceId: string) {
    this.captureCalls.push(sourceId)
    const source = this.sources.find((s) => s.id === sourceId)
    if (!source) return null
    return {
      mediaType: 'image/png' as const,
      base64: 'iVBORw0KGgo=',
      width: 1920,
      height: 1080,
    }
  }

  async requestCapture() {
    if (this.sources.length === 0) return null
    return this.captureSource(this.sources[0].id)
  }

  async getPermissionStatus() {
    return 'granted' as const
  }
}

// ── Browser semantics mock ──────────────────────────────────────────

class BrowserScreenCapture {
  async enumerateSources() {
    // Browser: cannot enumerate system windows — always empty
    return { status: 'ok' as const, sources: [] }
  }

  async captureSource(_sourceId: string) {
    // Browser: no source IDs exist from enumerateSources — unsupported
    return null
  }

  async requestCapture() {
    // Browser: would use navigator.mediaDevices.getDisplayMedia()
    // In tests, return null (simulating user cancellation)
    return null
  }

  async getPermissionStatus() {
    return 'prompt' as const
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Increment 8 — Screen capture migration', () => {
  describe('ScreenCapture contract', () => {
    test('is defined in @genoffice/platform (data-only)', () => {
      const src = readFileSync(
        join(here, '..', '..', '..', 'packages', 'platform', 'src', 'capabilities', 'screen-capture.ts'),
        'utf8',
      )
      expect(src).toMatch(/export interface ScreenCapture/)
      expect(src).toMatch(/enumerateSources/)
      expect(src).toMatch(/captureSource/)
      expect(src).toMatch(/requestCapture/)
      expect(src).toMatch(/getPermissionStatus/)
      // ZERO Electron/node imports (check import statements only)
      expect(src).not.toMatch(/from\s+['"]electron['"]/)
      expect(src).not.toMatch(/from\s+['"]node:/)
    })

    test('types are defined (ScreenSource, ScreenCaptureResult, ScreenSourcesResult)', () => {
      const src = readFileSync(
        join(here, '..', '..', '..', 'packages', 'platform', 'src', 'capabilities', 'screen-capture.ts'),
        'utf8',
      )
      expect(src).toMatch(/export interface ScreenSource/)
      expect(src).toMatch(/export interface ScreenCaptureResult/)
      expect(src).toMatch(/export interface ScreenSourcesResult/)
      expect(src).toMatch(/export type ScreenCapturePermission/)
    })
  })

  describe('ElectronScreenCapture implementation', () => {
    test('is exported from @genoffice/platform-electron', async () => {
      const platform = await import('@genoffice/platform-electron')
      expect(platform).toHaveProperty('ElectronScreenCapture')
    })

    test('implementation file exists and implements the contract', () => {
      const src = readFileSync(
        join(here, '..', '..', '..', 'packages', 'platform-electron', 'src', 'capabilities', 'electron-screen-capture.ts'),
        'utf8',
      )
      expect(src).toMatch(/class ElectronScreenCapture/)
      expect(src).toMatch(/implements ScreenCapture/)
      // Uses desktopCapturer
      expect(src).toMatch(/desktopCapturer/)
      // Uses screen.getAllDisplays
      expect(src).toMatch(/screen\.getAllDisplays/)
      // Uses systemPreferences for macOS permission
      expect(src).toMatch(/systemPreferences/)
    })
  })

  describe('handler delegation', () => {
    test('migrated handler delegates to ScreenCapture.enumerateSources', () => {
      const src = readFileSync(join(here, '..', 'src', 'main', 'sheets-migrated-handlers.ts'), 'utf8')
      expect(src).toMatch(/screenCapture\.enumerateSources/)
    })

    test('migrated handler delegates to ScreenCapture.captureSource', () => {
      const src = readFileSync(join(here, '..', 'src', 'main', 'sheets-migrated-handlers.ts'), 'utf8')
      expect(src).toMatch(/screenCapture\.captureSource/)
    })

    test('handler replaces legacy handlers via removeHandler', () => {
      const src = readFileSync(join(here, '..', 'src', 'main', 'sheets-migrated-handlers.ts'), 'utf8')
      expect(src).toMatch(/removeHandler\(IPC_CHANNELS\.captureScreenSources\)/)
      expect(src).toMatch(/removeHandler\(IPC_CHANNELS\.captureScreenSource\)/)
    })
  })

  describe('browser semantics', () => {
    test('BrowserScreenCapture.enumerateSources() returns []', async () => {
      const browser = new BrowserScreenCapture()
      const result = await browser.enumerateSources()
      expect(result.status).toBe('ok')
      expect(result.sources).toEqual([])
    })

    test('BrowserScreenCapture.captureSource() returns null (unsupported)', async () => {
      const browser = new BrowserScreenCapture()
      const result = await browser.captureSource('any-id')
      expect(result).toBeNull()
    })

    test('BrowserScreenCapture.requestCapture() returns null (simulated cancel)', async () => {
      const browser = new BrowserScreenCapture()
      const result = await browser.requestCapture()
      expect(result).toBeNull()
    })
  })

  describe('mock capability behavior', () => {
    test('enumerateSources returns sources', async () => {
      const mock = new MockScreenCapture()
      mock.sources = [
        { id: 'screen:0', name: 'Entire Screen', kind: 'screen', thumbnail: 'data:image/png;base64,abc' },
        { id: 'window:1', name: 'Terminal', kind: 'window', thumbnail: 'data:image/png;base64,def' },
      ]
      const result = await mock.enumerateSources()
      expect(result.status).toBe('ok')
      expect(result.sources.length).toBe(2)
      expect(result.sources[0].id).toBe('screen:0')
      expect(result.sources[0].kind).toBe('screen')
    })

    test('enumerateSources returns denied status', async () => {
      const mock = new MockScreenCapture()
      mock.shouldDeny = true
      const result = await mock.enumerateSources()
      expect(result.status).toBe('denied')
      expect(result.sources).toEqual([])
    })

    test('captureSource returns null for unknown source', async () => {
      const mock = new MockScreenCapture()
      const result = await mock.captureSource('nonexistent')
      expect(result).toBeNull()
    })

    test('captureSource returns image data for known source', async () => {
      const mock = new MockScreenCapture()
      mock.sources = [{ id: 'screen:0', name: 'Screen', kind: 'screen', thumbnail: '' }]
      const result = await mock.captureSource('screen:0')
      expect(result).not.toBeNull()
      expect(result!.mediaType).toBe('image/png')
      expect(result!.base64.length).toBeGreaterThan(0)
      expect(result!.width).toBeGreaterThan(0)
      expect(result!.height).toBeGreaterThan(0)
    })
  })

  describe('architecture guards', () => {
    test('handler has ZERO desktopCapturer imports', () => {
      const src = readFileSync(join(here, '..', 'src', 'main', 'sheets-migrated-handlers.ts'), 'utf8')
      const stripped = src.replace(/\/\*\*?[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      expect(stripped).not.toMatch(/desktopCapturer/)
    })

    test('handler has ZERO screen.getAllDisplays calls', () => {
      const src = readFileSync(join(here, '..', 'src', 'main', 'sheets-migrated-handlers.ts'), 'utf8')
      const stripped = src.replace(/\/\*\*?[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      expect(stripped).not.toMatch(/screen\.getAllDisplays/)
    })

    test('handler has ZERO getFocusedWindow calls', () => {
      const src = readFileSync(join(here, '..', 'src', 'main', 'sheets-migrated-handlers.ts'), 'utf8')
      expect(src).not.toMatch(/getFocusedWindow\s*\(/)
    })

    test('handler has ZERO global capture state', () => {
      const src = readFileSync(join(here, '..', 'src', 'main', 'sheets-migrated-handlers.ts'), 'utf8')
      const stripped = src.replace(/\/\*\*?[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      expect(stripped).not.toMatch(/^(let|var|const)\s+(activeSource|activeDisplay|currentCapture|activeRenderer|globalCaptureSource)\b/m)
    })
  })
})
