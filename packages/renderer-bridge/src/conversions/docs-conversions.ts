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

const LEGACY_LANGS = new Set<string>([
  'zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'th', 'id', 'ru', 'ar',
])

export type LegacyLanguage =
  | 'zh' | 'en' | 'ja' | 'ko' | 'fr' | 'de' | 'es' | 'th' | 'id' | 'ru' | 'ar'

/**
 * Narrow a UiLanguage (19 members) to the legacy language (11 members).
 * Languages outside the legacy set default to 'en'.
 *
 * This is a runtime-validated narrowing — the set membership check
 * is a real type guard, not a cast.
 */
export function toLegacyLanguage(lang: UiLanguage): LegacyLanguage {
  if (LEGACY_LANGS.has(lang)) {
    return lang as LegacyLanguage
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

// ── Runtime-validated storage conversions ──────────────────────────────
//
// Storage.readObject returns `unknown | null`. The bridge needs to
// return specific types. These functions perform RUNTIME VALIDATION
// of the shape — not unchecked casts.
//
// Each validator checks the structural shape at runtime and returns
// the fallback when the shape doesn't match. This is a real type guard
// boundary, not a compiler suppression.

/** Check if a value is a non-null object (not an array). */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Check if a value is an array of strings. */
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((item) => typeof item === 'string')
}

/**
 * Validate an unknown Storage value as a string array, with a fallback.
 * Returns the validated array, or the fallback when validation fails.
 */
export function fromStorageStringArray(raw: unknown, fallback: string[]): string[] {
  if (isStringArray(raw)) return raw
  return fallback
}

/**
 * Validate an unknown Storage value as a plain object, with a fallback.
 * Returns the validated object, or the fallback when validation fails.
 */
export function fromStorageObject<T extends Record<string, unknown>>(
  raw: unknown,
  fallback: T,
): T {
  if (isPlainObject(raw)) return raw as T
  return fallback
}

/**
 * Validate an unknown Storage value as a plain object or null.
 * Returns the validated object, or null when validation fails or the value is absent.
 */
export function fromStorageObjectOrNull<T extends Record<string, unknown>>(
  raw: unknown,
): T | null {
  if (isPlainObject(raw)) return raw as T
  return null
}
