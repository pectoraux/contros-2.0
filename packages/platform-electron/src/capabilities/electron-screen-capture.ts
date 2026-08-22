/**
 * ElectronScreenCapture — Electron adapter for ScreenCapture (ADR-005).
 *
 * Implements the ScreenCapture capability using:
 *   - desktopCapturer.getSources() for source enumeration + capture
 *   - screen.getAllDisplays() for full-resolution capture sizing
 *   - systemPreferences.getMediaAccessStatus('screen') for macOS permission
 *
 * OWNERSHIP:
 *   The adapter owns all Electron-specific APIs (desktopCapturer, screen,
 *   systemPreferences). No Electron types cross into runtime-contracts
 *   or services-sheets.
 *
 * PERMISSION SEMANTICS (matching legacy):
 *   macOS: if systemPreferences.getMediaAccessStatus('screen') is not
 *   'granted' or 'not-determined', return { status: 'denied', sources: [] }.
 *   If permission is 'not-determined', attempt the capture — macOS will
 *   prompt the user. If after the attempt the status is still not 'granted',
 *   return { status: 'denied', sources: [] }.
 *   Other platforms: no permission check (always 'granted').
 *
 * SOURCE EXCLUSION:
 *   The legacy code excludes the app's own window from the source list.
 *   The adapter accepts an optional `selfMediaSourceId` to exclude.
 */

import { desktopCapturer, screen, systemPreferences, BrowserWindow } from 'electron'
import type {
  ScreenCapture,
  ScreenSource,
  ScreenSourcesResult,
  ScreenCaptureResult,
  ScreenCapturePermission,
} from '@genoffice/platform'

export interface ElectronScreenCaptureConfig {
  /**
   * Optional: the media source ID of the app's own window, to exclude
   * from enumerateSources(). The shell coordinator sets this so the
   * renderer doesn't see its own window in the source list.
   */
  readonly selfMediaSourceId?: string
}

export class ElectronScreenCapture implements ScreenCapture {
  private readonly selfMediaSourceId: string | undefined

  constructor(config: ElectronScreenCaptureConfig = {}) {
    this.selfMediaSourceId = config.selfMediaSourceId
  }

  async enumerateSources(): Promise<ScreenSourcesResult> {
    // macOS: check Screen Recording permission before AND after enumeration.
    // desktopCapturer returns black frames (not errors) when permission
    // is denied — we detect this by checking the status after enumeration.
    if (process.platform === 'darwin') {
      const status = systemPreferences.getMediaAccessStatus('screen')
      if (status !== 'granted' && status !== 'not-determined') {
        return { status: 'denied', sources: [] }
      }
    }

    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 200 },
      fetchWindowIcons: false,
    })

    // macOS: re-check after enumeration — if permission was 'not-determined',
    // the OS may have prompted and the user may have denied.
    if (
      process.platform === 'darwin' &&
      systemPreferences.getMediaAccessStatus('screen') !== 'granted'
    ) {
      return { status: 'denied', sources: [] }
    }

    // Filter out the app's own window
    const filtered = sources.filter((s) => s.id !== this.selfMediaSourceId)

    return {
      status: 'ok',
      sources: filtered.map((source) => ({
        id: source.id,
        name: source.name,
        kind: source.id.startsWith('screen') ? 'screen' as const : 'window' as const,
        thumbnail: source.thumbnail.isEmpty() ? '' : source.thumbnail.toDataURL(),
      })),
    }
  }

  async captureSource(sourceId: string): Promise<ScreenCaptureResult | null> {
    // desktopCapturer only returns thumbnails — for full-res capture,
    // re-list sources with the thumbnail sized to the largest physical display.
    const displays = screen.getAllDisplays()
    const captureSize = {
      width: Math.min(
        4096,
        Math.max(1920, ...displays.map((d) => Math.ceil(d.size.width * d.scaleFactor))),
      ),
      height: Math.min(
        4096,
        Math.max(1080, ...displays.map((d) => Math.ceil(d.size.height * d.scaleFactor))),
      ),
    }

    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: captureSize,
      fetchWindowIcons: false,
    })

    const source = sources.find((candidate) => candidate.id === sourceId)
    if (!source || source.thumbnail.isEmpty()) return null

    let image = source.thumbnail
    let png = image.toPNG()

    // Downscale if the PNG is too large (>20MB)
    if (png.length > 20 * 1024 * 1024) {
      image = image.resize({ width: Math.round(image.getSize().width / 2) })
      png = image.toPNG()
    }

    const { width, height } = image.getSize()
    return {
      mediaType: 'image/png',
      base64: png.toString('base64'),
      width,
      height,
    }
  }

  async requestCapture(): Promise<ScreenCaptureResult | null> {
    // Electron: enumerate + capture the first screen source.
    // The caller (shell) may present a picker UI — the capability just
    // provides the data.
    const result = await this.enumerateSources()
    if (result.status !== 'ok' || result.sources.length === 0) return null

    // Pick the first screen source (displays take priority over windows)
    const screenSource = result.sources.find((s) => s.kind === 'screen') ?? result.sources[0]
    if (screenSource === undefined) return null
    return this.captureSource(screenSource.id)
  }

  async getPermissionStatus(): Promise<ScreenCapturePermission> {
    if (process.platform !== 'darwin') return 'granted'
    const status = systemPreferences.getMediaAccessStatus('screen')
    switch (status) {
      case 'granted': return 'granted'
      case 'denied': return 'denied'
      case 'not-determined': return 'prompt'
      default: return 'unknown'
    }
  }
}
