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
  const slides = requireWired(runtime.slides, 'PresentationService') as any

  // Spread all slides-specific methods (editText, editTransform, addElement, etc.).
  // The cross-cutting methods below override any same-named properties.
  return {
    ...slides,

    // ── Settings (cross-cutting) ─────────────────────────────────────
    getLanguage: () => runtime.settings.getLanguage() as never,
    onLanguageChanged: (handler: unknown) => runtime.settings.onLanguageChanged(handler as never),
    getTheme: () => runtime.settings.getTheme() as never,
    onThemeChanged: (handler: unknown) => runtime.settings.onThemeChanged(handler as never),
    onChromePressed: (handler: unknown) => runtime.windowing.onChromePressed(handler as never),
    setShowFullScreen: (on: unknown) => runtime.windowing.setProgressBar(on ? 2 : -1).then(() => undefined),

    // ── AI (cross-cutting) ─────────────────────────────────────────────
    getAiSettings: () => runtime.ai.getSettings(),
    setAiSettings: (settings: unknown) => runtime.ai.setSettings(settings as never),
    aiStream: (request: unknown) => runtime.ai.stream(request as never),
    aiStreamCancel: (requestId: unknown) => runtime.ai.streamCancel(requestId as never),
    aiGskStatus: (withEmail: unknown) => runtime.identity.accountStatus(),
    aiGskLogin: () => runtime.identity.login(),
    webSearch: (query: unknown, maxResults: unknown) => runtime.ai.webSearch(query as never, maxResults as never),
    imageSearch: (query: unknown, maxResults: unknown) => runtime.ai.imageSearch(query as never, maxResults as never),
    onAiStream: (handler: unknown) => runtime.ai.onStream(handler as never),

    // ── External links (cross-cutting) ────────────────────────────────
    openExternal: (url: string) => runtime.windowing.openExternal(url),
  } as unknown as SlidesApi
}
