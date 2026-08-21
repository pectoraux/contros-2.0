/**
 * Explicit conversion functions between legacy renderer-facing types
 * (from @genoffice/docs-shared) and runtime-independent types
 * (from @genoffice/runtime-contracts).
 *
 * These replace `as never` / `as any` compiler-suppression casts.
 * Each conversion is explicit, named, testable, and auditable.
 *
 * Where types are structurally identical (e.g. UiTheme, OpenFileResult),
 * TypeScript's structural typing allows direct assignment without a cast —
 * no conversion function is needed.
 */

import type { UiLanguage } from '@genoffice/platform'

// ── Language conversion ────────────────────────────────────────────────
//
// The legacy DesktopApi.getLanguage() returns a 11-language union.
// The runtime UiLanguage has 19 members. The legacy type is a SUBSET.
// When the runtime returns a language the legacy doesn't support,
// default to 'en'.

const LEGACY_LANGS = new Set<string>([
  'zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'th', 'id', 'ru', 'ar',
])

/** Legacy language union type (11 members — subset of UiLanguage). */
export type LegacyLanguage =
  | 'zh' | 'en' | 'ja' | 'ko' | 'fr' | 'de' | 'es' | 'th' | 'id' | 'ru' | 'ar'

/**
 * Narrow a UiLanguage (19 members) to the legacy language (11 members).
 * Languages outside the legacy set default to 'en'.
 *
 * This is an explicit narrowing conversion — NOT a cast. The runtime
 * check ensures type safety.
 */
export function toLegacyLanguage(lang: UiLanguage): LegacyLanguage {
  if (
    lang === 'zh' || lang === 'en' || lang === 'ja' || lang === 'ko' ||
    lang === 'fr' || lang === 'de' || lang === 'es' || lang === 'th' ||
    lang === 'id' || lang === 'ru' || lang === 'ar'
  ) {
    return lang
  }
  return 'en'
}

/**
 * Wrap a legacy language handler so it receives LegacyLanguage
 * even when the runtime emits UiLanguage.
 */
export function wrapLanguageHandler(
  handler: (lang: LegacyLanguage) => void,
): (lang: UiLanguage) => void {
  return (lang: UiLanguage) => handler(toLegacyLanguage(lang))
}

// ── Unknown → typed conversions (for Storage.readObject returns) ──────
//
// Storage.readObject returns `unknown | null`. The bridge needs to
// return specific types. These conversion functions are the explicit
// boundary between untyped storage and typed contracts.
//
// A production version would validate the shape; for now we trust
// the shape because the bridge wrote the data.

/** Convert an unknown Storage value to a typed value, with a fallback. */
export function fromStorage<T>(raw: unknown, fallback: T): T {
  return (raw !== null && raw !== undefined ? raw : fallback) as T
}

/** Convert an unknown Storage value to a typed value or null. */
export function fromStorageOrNull<T>(raw: unknown): T | null {
  return raw !== null && raw !== undefined ? (raw as T) : null
}
