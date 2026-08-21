/**
 * Conversion tests for renderer-bridge.
 *
 * Tests every conversion function used by the bridges:
 *   - toLegacyLanguage: 19-lang → 11-lang (narrowing with fallback)
 *   - wrapLanguageHandler: wraps a legacy handler to receive UiLanguage
 *   - fromStorage: unknown → typed with fallback
 *   - fromStorageOrNull: unknown → typed | null
 */
import { describe, test, expect, vi } from 'vitest'
import {
  toLegacyLanguage,
  wrapLanguageHandler,
  fromStorage,
  fromStorageOrNull,
  type LegacyLanguage,
} from '../../src/conversions/docs-conversions.js'
import type { UiLanguage } from '@genoffice/platform'

describe('toLegacyLanguage', () => {
  test('returns the same value for legacy-supported languages', () => {
    const legacyLangs: LegacyLanguage[] = ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'th', 'id', 'ru', 'ar']
    for (const lang of legacyLangs) {
      expect(toLegacyLanguage(lang as UiLanguage)).toBe(lang)
    }
  })

  test('defaults to "en" for non-legacy languages', () => {
    const nonLegacyLangs: UiLanguage[] = ['pt', 'it', 'pl', 'nl', 'ms', 'he', 'hi', 'zh-TW']
    for (const lang of nonLegacyLangs) {
      expect(toLegacyLanguage(lang)).toBe('en')
    }
  })
})

describe('wrapLanguageHandler', () => {
  test('wraps a legacy handler to receive narrowed LegacyLanguage', () => {
    const received: LegacyLanguage[] = []
    const handler = (lang: LegacyLanguage) => { received.push(lang) }
    const wrapped = wrapLanguageHandler(handler)

    wrapped('en' as UiLanguage)
    wrapped('zh' as UiLanguage)
    wrapped('pt' as UiLanguage) // non-legacy → should be 'en'

    expect(received).toEqual(['en', 'zh', 'en'])
  })

  test('the wrapped handler returns void', () => {
    const handler = vi.fn()
    const wrapped = wrapLanguageHandler(handler)
    expect(wrapped('en' as UiLanguage)).toBeUndefined()
  })
})

describe('fromStorage', () => {
  test('returns the value when it is not null/undefined', () => {
    expect(fromStorage({ a: 1 }, { b: 2 })).toEqual({ a: 1 })
  })

  test('returns the fallback when the value is null', () => {
    expect(fromStorage(null, 'fallback')).toBe('fallback')
  })

  test('returns the fallback when the value is undefined', () => {
    expect(fromStorage(undefined, 'fallback')).toBe('fallback')
  })

  test('returns the value when it is 0 (falsy but not null/undefined)', () => {
    expect(fromStorage(0, -1)).toBe(0)
  })

  test('returns the value when it is an empty string', () => {
    expect(fromStorage('', 'fallback')).toBe('')
  })

  test('returns the value when it is false', () => {
    expect(fromStorage(false, true)).toBe(false)
  })

  test('returns the value when it is an empty array', () => {
    expect(fromStorage([], [1, 2])).toEqual([])
  })
})

describe('fromStorageOrNull', () => {
  test('returns the value when it is not null/undefined', () => {
    expect(fromStorageOrNull({ a: 1 })).toEqual({ a: 1 })
  })

  test('returns null when the value is null', () => {
    expect(fromStorageOrNull(null)).toBeNull()
  })

  test('returns null when the value is undefined', () => {
    expect(fromStorageOrNull(undefined)).toBeNull()
  })

  test('returns the value when it is 0', () => {
    expect(fromStorageOrNull(0)).toBe(0)
  })
})
