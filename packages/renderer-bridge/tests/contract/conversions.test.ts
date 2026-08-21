/**
 * Conversion tests for renderer-bridge.
 *
 * Tests every conversion function used by the bridges:
 *   - toLegacyLanguage: 19-lang → 11-lang (narrowing with fallback)
 *   - wrapLanguageHandler: wraps a legacy handler to receive UiLanguage
 *   - fromStorageStringArray: validated string array conversion
 *   - fromStorageObject: validated object conversion
 *   - fromStorageObjectOrNull: validated object-or-null conversion
 */
import { describe, test, expect, vi } from 'vitest'
import {
  toLegacyLanguage,
  wrapLanguageHandler,
  fromStorageStringArray,
  fromStorageObject,
  fromStorageObjectOrNull,
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
})

describe('fromStorageStringArray', () => {
  test('returns the array when it is a string array', () => {
    expect(fromStorageStringArray(['a', 'b'], [])).toEqual(['a', 'b'])
  })

  test('returns fallback when the value is null', () => {
    expect(fromStorageStringArray(null, ['default'])).toEqual(['default'])
  })

  test('returns fallback when the value is undefined', () => {
    expect(fromStorageStringArray(undefined, ['default'])).toEqual(['default'])
  })

  test('returns fallback when the value is not an array', () => {
    expect(fromStorageStringArray({ a: 1 }, ['default'])).toEqual(['default'])
    expect(fromStorageStringArray('not-array', ['default'])).toEqual(['default'])
    expect(fromStorageStringArray(42, ['default'])).toEqual(['default'])
  })

  test('returns fallback when the array contains non-strings', () => {
    expect(fromStorageStringArray(['a', 1, true], ['default'])).toEqual(['default'])
  })

  test('returns empty array when the input is an empty array', () => {
    expect(fromStorageStringArray([], ['default'])).toEqual([])
  })
})

describe('fromStorageObject', () => {
  test('returns the value when it is a plain object', () => {
    const obj = { a: 1, b: 'hello' }
    expect(fromStorageObject(obj, { a: 0, b: '' })).toBe(obj)
  })

  test('returns fallback when the value is null', () => {
    expect(fromStorageObject(null, { a: 0 })).toEqual({ a: 0 })
  })

  test('returns fallback when the value is undefined', () => {
    expect(fromStorageObject(undefined, { a: 0 })).toEqual({ a: 0 })
  })

  test('returns fallback when the value is not an object', () => {
    expect(fromStorageObject('string', { a: 0 })).toEqual({ a: 0 })
    expect(fromStorageObject(42, { a: 0 })).toEqual({ a: 0 })
    expect(fromStorageObject(true, { a: 0 })).toEqual({ a: 0 })
  })

  test('returns fallback when the value is an array (arrays are not plain objects)', () => {
    expect(fromStorageObject([1, 2], { a: 0 })).toEqual({ a: 0 })
  })
})

describe('fromStorageObjectOrNull', () => {
  test('returns the value when it is a plain object', () => {
    const obj = { a: 1 }
    expect(fromStorageObjectOrNull(obj)).toBe(obj)
  })

  test('returns null when the value is null', () => {
    expect(fromStorageObjectOrNull(null)).toBeNull()
  })

  test('returns null when the value is undefined', () => {
    expect(fromStorageObjectOrNull(undefined)).toBeNull()
  })

  test('returns null when the value is not an object', () => {
    expect(fromStorageObjectOrNull('string')).toBeNull()
    expect(fromStorageObjectOrNull(42)).toBeNull()
    expect(fromStorageObjectOrNull(true)).toBeNull()
    expect(fromStorageObjectOrNull([1, 2])).toBeNull()
  })
})
