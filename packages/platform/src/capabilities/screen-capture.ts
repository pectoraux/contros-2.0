/**
 * ScreenCapture — platform capability for screen/source capture (ADR-005).
 *
 * This is a cross-runtime capability (not Sheets-specific). It exposes:
 *   - enumerateSources() — list available capture sources (displays + windows)
 *   - captureSource(sourceId) — full-resolution capture of a specific source
 *   - requestCapture() — user-mediated capture flow (browser: getDisplayMedia)
 *   - getPermissionStatus() — OS-level screen recording permission
 *
 * Deterministic contract:
 *   Electron → returns actual source list (desktopCapturer.getSources)
 *   Browser  → returns empty array (browsers cannot enumerate system windows)
 *
 * ZERO Electron/desktopCapturer/screen/BrowserWindow/WebContents/node:*
 * imports. The interface is data-only.
 */

// ── Source types ─────────────────────────────────────────────────────

/**
 * A capture source (display or application window).
 */
export interface ScreenSource {
  /** Stable source identifier (Electron media source ID). */
  readonly id: string
  /** Display name (e.g., "Entire Screen", "Terminal — bash"). */
  readonly name: string
  /** Whether this source is a display or a window. */
  readonly kind: 'screen' | 'window'
  /**
   * Thumbnail preview as a data URL. Empty string when the OS returned
   * no preview (e.g., permission denied on macOS returns black frames).
   */
  readonly thumbnail: string
}

// ── Capture result ──────────────────────────────────────────────────

/**
 * Result of capturing a screen source.
 */
export interface ScreenCaptureResult {
  /** MIME type of the captured image (always 'image/png'). */
  readonly mediaType: 'image/png'
  /** Base64-encoded image data. */
  readonly base64: string
  /** Image width in pixels. */
  readonly width: number
  /** Image height in pixels. */
  readonly height: number
}

// ── Sources result ──────────────────────────────────────────────────

/**
 * Result of enumerating capture sources.
 *
 * status:
 *   - 'ok' — sources were enumerated successfully
 *   - 'denied' — OS permission denied (macOS Screen Recording not granted)
 */
export interface ScreenSourcesResult {
  readonly status: 'ok' | 'denied'
  readonly sources: readonly ScreenSource[]
}

// ── Permission status ───────────────────────────────────────────────

export type ScreenCapturePermission = 'granted' | 'denied' | 'prompt' | 'unknown'

// ── Capability interface ────────────────────────────────────────────

/**
 * Screen capture platform capability (ADR-005).
 *
 * The 10th platform capability, added by formal architecture amendment.
 * Defines screen/source enumeration and capture operations.
 *
 * RUNTIME CONTRACT:
 *   - Electron: uses desktopCapturer + screen.getAllDisplays()
 *   - Browser: enumerateSources() returns [], requestCapture() uses
 *     navigator.mediaDevices.getDisplayMedia()
 *
 * The capability is optional — a runtime that doesn't support screen
 * capture can provide a no-op or throwing implementation.
 */
export interface ScreenCapture {
  /**
   * Enumerate available capture sources (displays and windows).
   *
   * Electron → returns actual source list (desktopCapturer.getSources).
   * Browser → returns empty array (browsers cannot enumerate system windows).
   *
   * macOS: returns { status: 'denied', sources: [] } if the Screen Recording
   * permission has not been granted.
   */
  enumerateSources(): Promise<ScreenSourcesResult>

  /**
   * Capture a full-resolution screenshot of a specific source by ID.
   *
   * The sourceId comes from enumerateSources(). Only available in runtimes
   * that support programmatic source enumeration (Electron).
   *
   * Returns null if the source was not found or its thumbnail is empty
   * (e.g., the source disappeared between enumeration and capture).
   */
  captureSource(sourceId: string): Promise<ScreenCaptureResult | null>

  /**
   * Request a capture with user-mediated source selection.
   *
   * Electron → implementation-selected capture (enumerateSources + captureSource).
   * Browser → navigator.mediaDevices.getDisplayMedia() (user picks at capture time).
   *
   * Returns null if the user cancels.
   */
  requestCapture(): Promise<ScreenCaptureResult | null>

  /**
   * Check the OS-level permission status for screen recording.
   *
   * macOS: systemPreferences.getMediaAccessStatus('screen').
   * Other platforms: 'granted' (no permission system).
   */
  getPermissionStatus(): Promise<ScreenCapturePermission>
}
