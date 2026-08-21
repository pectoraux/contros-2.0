/**
 * createSlidesApiBridge — maps window.slidesApi (SlidesApi) to PresentationService
 * + platform capabilities.
 *
 * The slides-specific methods (~120) delegate 1:1 to PresentationService via
 * object spread. The cross-cutting methods (~16) delegate to platform capabilities
 * and are explicitly listed below.
 *
 * Per ADR-002 §2.2: explicit typed method mappings, NO Proxy.
 */
import type { SlidesApi } from '@genoffice/slides-shared'
import type { RuntimeContext, PresentationService } from '@genoffice/runtime-contracts'
import { requireWired } from './require-wired.js'

export function createSlidesApiBridge(runtime: RuntimeContext): SlidesApi {
  const slides: PresentationService = requireWired(runtime.slides, 'PresentationService')

  // Spread all slides-specific methods (editText, editTransform, addElement, etc.).
  // The cross-cutting methods below override any same-named properties.
  return {
    ...slides,

    // ── Settings (cross-cutting) ─────────────────────────────────────
    getLanguage: () => runtime.settings.getLanguage() as never,
    onLanguageChanged: (handler) => runtime.settings.onLanguageChanged(handler as never),
    getTheme: () => runtime.settings.getTheme() as never,
    onThemeChanged: (handler) => runtime.settings.onThemeChanged(handler as never),
    onChromePressed: (handler) => runtime.windowing.onChromePressed(handler),
    setShowFullScreen: (on) => runtime.windowing.setProgressBar(on ? 2 : -1).then(() => undefined),

    // ── AI (cross-cutting) ─────────────────────────────────────────────
    getAiSettings: () => runtime.ai.getSettings() as never,
    setAiSettings: (settings) => runtime.ai.setSettings(settings as never) as never,
    aiStream: (request) => runtime.ai.stream(request as never) as never,
    aiStreamCancel: (requestId) => runtime.ai.streamCancel(requestId) as never,
    aiGskStatus: (withEmail) => runtime.identity.accountStatus() as never,
    aiGskLogin: () => runtime.identity.login() as never,
    webSearch: (query, maxResults) => runtime.ai.webSearch(query, maxResults) as never,
    imageSearch: (query, maxResults) => runtime.ai.imageSearch(query, maxResults) as never,
    onAiStream: (handler) => runtime.ai.onStream(handler as never),

    // ── External links (cross-cutting) ────────────────────────────────
    openExternal: (url: string) => runtime.windowing.openExternal(url),
  } as SlidesApi
}
