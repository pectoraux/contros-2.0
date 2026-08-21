/**
 * PresentationService — domain runtime service for the slides (`.pptx`) editor.
 *
 * Composes @genoffice/pptx-engine + @genoffice/pptx-render + session/undo
 * state with platform capabilities. The bridge (createSlidesApiBridge) maps
 * the existing window.slidesApi API to these methods.
 *
 * IMPORTANT (ADR-001 Correction A): implementations receive their dependencies
 * via constructor injection. They MUST NOT call getRuntime() internally.
 *
 * NOTE: For Milestone 1, the service type is derived from the actual SlidesApi
 * interface via Omit (excluding cross-cutting methods that delegate to platform
 * capabilities). This keeps the bridge 1:1 with the repo interface. In Phase 1,
 * the service interface may be refined to higher-level capabilities.
 */
import type { SlidesApi } from '@genoffice/slides-shared'

/** Cross-cutting method names that delegate to platform capabilities, not to PresentationService. */
export type SlidesCrossCuttingMethods =
  | 'getLanguage'
  | 'onLanguageChanged'
  | 'getTheme'
  | 'onThemeChanged'
  | 'onChromePressed'
  | 'setShowFullScreen'
  | 'getAiSettings'
  | 'setAiSettings'
  | 'aiStream'
  | 'aiStreamCancel'
  | 'aiGskStatus'
  | 'aiGskLogin'
  | 'webSearch'
  | 'imageSearch'
  | 'onAiStream'
  | 'openExternal'

/**
 * The slides-specific subset of SlidesApi. Every method here delegates to
 * the PresentationService. The remaining SlidesApi methods delegate to
 * runtime.settings / runtime.windowing / runtime.ai / runtime.identity.
 */
export type PresentationService = Omit<SlidesApi, SlidesCrossCuttingMethods>
