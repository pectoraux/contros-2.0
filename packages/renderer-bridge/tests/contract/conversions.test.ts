/**
 * Conversion tests for renderer-bridge.
 *
 * Tests every conversion function used by the bridges:
 *   - toLegacyLanguage: 19-lang to 11-lang (narrowing with fallback)
 *   - wrapLanguageHandler: wraps a legacy handler to receive UiLanguage
 *   - fromStorageStringArray: validated string array conversion
 *   - fromStorageProjectSummary: validated ProjectSummary conversion
 *   - fromStorageRecentEntries: validated RecentEntry[] conversion
 *   - fromStorageRecentPage: validated RecentPage conversion
 *   - fromStorageStarPrompt: validated StarPromptShow conversion
 *   - fromStorageCloudProjects: validated CloudProjectsSnapshot conversion
 */
import { describe, test, expect, vi } from 'vitest'
import {
  toLegacyLanguage,
  wrapLanguageHandler,
  fromStorageStringArray,
  fromStorageProjectSummary,
  fromStorageRecentEntries,
  fromStorageRecentPage,
  fromStorageStarPrompt,
  fromStorageCloudProjects,
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
    wrapped('pt' as UiLanguage)

    expect(received).toEqual(['en', 'zh', 'en'])
  })
})

describe('fromStorageStringArray', () => {
  test('returns the array when valid', () => {
    expect(fromStorageStringArray(['a', 'b'], [])).toEqual(['a', 'b'])
  })

  test('returns fallback when null', () => {
    expect(fromStorageStringArray(null, ['default'])).toEqual(['default'])
  })

  test('returns fallback when not an array', () => {
    expect(fromStorageStringArray({ a: 1 }, ['default'])).toEqual(['default'])
    expect(fromStorageStringArray('string', ['default'])).toEqual(['default'])
  })

  test('returns fallback when array contains non-strings', () => {
    expect(fromStorageStringArray(['a', 1], ['default'])).toEqual(['default'])
  })

  test('returns empty array for empty input', () => {
    expect(fromStorageStringArray([], ['default'])).toEqual([])
  })
})

// ── Regression tests: preserve previous bridge behavior ────────────────

describe('fromStorageRecentEntries (regression: statPaths behavior)', () => {
  test('returns entries when valid RecentEntry array', () => {
    const validEntries = [
      { path: '/a.docx', name: 'a.docx', ext: 'docx', mtimeMs: 123, sizeBytes: 456, starred: false },
    ]
    expect(fromStorageRecentEntries(validEntries, [])).toBe(validEntries)
  })

  test('returns fallback [] when null', () => {
    expect(fromStorageRecentEntries(null, [])).toEqual([])
  })

  test('returns fallback [] when not an array', () => {
    expect(fromStorageRecentEntries({ foo: 'bar' }, [])).toEqual([])
  })

  test('returns fallback [] when entries missing fields', () => {
    const invalidEntries = [{ path: '/a.docx' }]
    expect(fromStorageRecentEntries(invalidEntries, [])).toEqual([])
  })
})

describe('fromStorageRecentPage (regression: recents/starred behavior)', () => {
  test('returns page when valid', () => {
    const validPage = {
      entries: [
        { path: '/a.docx', name: 'a.docx', ext: 'docx', mtimeMs: 123, sizeBytes: 456, starred: false },
      ],
      total: 1,
      totalAll: 1,
    }
    expect(fromStorageRecentPage(validPage, { entries: [], total: 0, totalAll: 0 })).toBe(validPage)
  })

  test('returns fallback when null', () => {
    expect(fromStorageRecentPage(null, { entries: [], total: 0, totalAll: 0 })).toEqual({
      entries: [],
      total: 0,
      totalAll: 0,
    })
  })

  test('returns fallback when missing total field', () => {
    expect(
      fromStorageRecentPage({ entries: [], totalAll: 0 }, { entries: [], total: 0, totalAll: 0 }),
    ).toEqual({ entries: [], total: 0, totalAll: 0 })
  })
})

describe('fromStorageStarPrompt (regression: starPromptShouldShow behavior)', () => {
  test('returns value when valid', () => {
    const valid = { show: true, docOpens: 5 }
    expect(fromStorageStarPrompt(valid, { show: false, docOpens: 0 })).toBe(valid)
  })

  test('returns fallback when null', () => {
    expect(fromStorageStarPrompt(null, { show: false, docOpens: 0 })).toEqual({
      show: false,
      docOpens: 0,
    })
  })

  test('returns fallback when missing show field', () => {
    expect(fromStorageStarPrompt({ docOpens: 3 }, { show: false, docOpens: 0 })).toEqual({
      show: false,
      docOpens: 0,
    })
  })
})

describe('fromStorageCloudProjects (regression: cloudProjectsCached/Sync behavior)', () => {
  test('returns snapshot when valid', () => {
    const valid = {
      available: true,
      projects: [
        { projectId: 'p1', title: 'Test', kind: 'docs', ctimeMs: 123, projectUrl: '/agents?id=p1' },
      ],
      syncedAt: 12345,
    }
    expect(fromStorageCloudProjects(valid)).toBe(valid)
  })

  test('returns null when null', () => {
    expect(fromStorageCloudProjects(null)).toBeNull()
  })

  test('returns null when not an object', () => {
    expect(fromStorageCloudProjects('string')).toBeNull()
    expect(fromStorageCloudProjects(42)).toBeNull()
    expect(fromStorageCloudProjects([1, 2])).toBeNull()
  })

  test('returns null when missing fields', () => {
    expect(fromStorageCloudProjects({ available: true })).toBeNull()
    expect(fromStorageCloudProjects({ available: true, projects: [] })).toBeNull()
  })

  test('returns null when projects contains invalid entries', () => {
    expect(
      fromStorageCloudProjects({
        available: true,
        projects: [{ projectId: 'p1' }],
        syncedAt: 123,
      }),
    ).toBeNull()
  })
})

describe('fromStorageProjectSummary', () => {
  test('returns value when valid', () => {
    const valid = {
      id: 'proj-1',
      name: 'Test',
      createdAt: '2024-01-01',
      updatedAt: '2024-01-02',
      fileCount: 5,
      lastActiveAt: '2024-01-02',
      isDefault: false,
    }
    expect(
      fromStorageProjectSummary(valid, {
        id: '',
        name: '',
        createdAt: '',
        updatedAt: '',
        fileCount: 0,
        lastActiveAt: '',
        isDefault: false,
      }),
    ).toBe(valid)
  })

  test('returns fallback when null', () => {
    expect(
      fromStorageProjectSummary(null, {
        id: '',
        name: '',
        createdAt: '',
        updatedAt: '',
        fileCount: 0,
        lastActiveAt: '',
        isDefault: false,
      }),
    ).toEqual({
      id: '',
      name: '',
      createdAt: '',
      updatedAt: '',
      fileCount: 0,
      lastActiveAt: '',
      isDefault: false,
    })
  })

  test('returns fallback when missing fields', () => {
    expect(
      fromStorageProjectSummary({ id: 'p1' }, {
        id: '',
        name: '',
        createdAt: '',
        updatedAt: '',
        fileCount: 0,
        lastActiveAt: '',
        isDefault: false,
      }),
    ).toEqual({
      id: '',
      name: '',
      createdAt: '',
      updatedAt: '',
      fileCount: 0,
      lastActiveAt: '',
      isDefault: false,
    })
  })
})
