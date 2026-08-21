/**
 * Explicit conversion functions between legacy renderer-facing types
 * (from @genoffice/docs-shared) and runtime-independent types
 * (from @genoffice/runtime-contracts).
 *
 * ZERO unchecked type assertions. Every function either:
 *   - uses TypeScript structural typing (direct assignment), or
 *   - uses a runtime type guard that produces a genuinely typed value
 *
 * No `as T`, `as LegacyType`, `as never`, or `as any` anywhere.
 */

import type { UiLanguage } from '@genoffice/platform'

// ── Language conversion ────────────────────────────────────────────────

const LEGACY_LANGS: ReadonlySet<LegacyLanguage> = new Set([
  'zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'th', 'id', 'ru', 'ar',
])

export type LegacyLanguage =
  | 'zh' | 'en' | 'ja' | 'ko' | 'fr' | 'de' | 'es' | 'th' | 'id' | 'ru' | 'ar'

const LEGACY_LANG_VALUES: readonly LegacyLanguage[] = [
  'zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'th', 'id', 'ru', 'ar',
]

/**
 * Narrow a UiLanguage (19 members) to the legacy language (11 members).
 * Languages outside the legacy set default to 'en'.
 *
 * Uses exhaustive comparison — no cast. Each value is checked against
 * the literal union members directly.
 */
export function toLegacyLanguage(lang: UiLanguage): LegacyLanguage {
  for (const valid of LEGACY_LANG_VALUES) {
    if (lang === valid) return valid
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

// ── Runtime type guards ────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((item) => typeof item === 'string')
}

function hasField<T extends string>(
  obj: Record<string, unknown>,
  field: T,
): obj is Record<string, unknown> & { [K in T]: unknown } {
  return field in obj
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && !Number.isNaN(v)
}

function isString(v: unknown): v is string {
  return typeof v === 'string'
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean'
}

// ── Validated storage conversions ──────────────────────────────────────
//
// Storage.readObject returns `unknown | null`. These functions validate
// the structural shape at runtime and return the typed value, or a
// fallback. No assertions — the type guard produces the typed value.

/** Validate an unknown as a string array, with fallback. */
export function fromStorageStringArray(raw: unknown, fallback: string[]): string[] {
  return isStringArray(raw) ? raw : fallback
}

// ── Specific structural validators (replace generic fromStorageObject) ──

/** Fields for ProjectSummary (from project-store/types.ts). */
interface ProjectSummaryFields {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  fileCount: number
  lastActiveAt: string
  isDefault: boolean
}

/** Runtime validator: is this a ProjectSummary-shaped object? */
function isProjectSummary(v: unknown): v is ProjectSummaryFields {
  if (!isPlainObject(v)) return false
  return (
    hasField(v, 'id') && isString(v.id) &&
    hasField(v, 'name') && isString(v.name) &&
    hasField(v, 'createdAt') && isString(v.createdAt) &&
    hasField(v, 'updatedAt') && isString(v.updatedAt) &&
    hasField(v, 'fileCount') && isNumber(v.fileCount) &&
    hasField(v, 'lastActiveAt') && isString(v.lastActiveAt) &&
    hasField(v, 'isDefault') && isBoolean(v.isDefault)
  )
}

/** Validate an unknown as a ProjectSummary, with fallback. */
export function fromStorageProjectSummary(
  raw: unknown,
  fallback: ProjectSummaryFields,
): ProjectSummaryFields {
  return isProjectSummary(raw) ? raw : fallback
}

// ── Structural validators for specific bridge types ────────────────────

/** Fields shared by RecentEntry (from home-api.ts). */
interface RecentEntryFields {
  path: string
  name: string
  ext: string
  mtimeMs: number
  sizeBytes: number
  starred: boolean
}

/** Runtime validator: is this a RecentEntry-shaped object? */
function isRecentEntryArray(v: unknown): v is RecentEntryFields[] {
  if (!Array.isArray(v)) return false
  return v.every((item) =>
    isPlainObject(item) &&
    hasField(item, 'path') && isString(item.path) &&
    hasField(item, 'name') && isString(item.name) &&
    hasField(item, 'ext') && isString(item.ext) &&
    hasField(item, 'mtimeMs') && isNumber(item.mtimeMs) &&
    hasField(item, 'sizeBytes') && isNumber(item.sizeBytes) &&
    hasField(item, 'starred') && isBoolean(item.starred),
  )
}

/** Validate an unknown as a RecentEntry array, with fallback. */
export function fromStorageRecentEntries(raw: unknown, fallback: RecentEntryFields[]): RecentEntryFields[] {
  return isRecentEntryArray(raw) ? raw : fallback
}

/** Fields for a RecentPage (from home-api.ts). */
interface RecentPageFields {
  entries: RecentEntryFields[]
  total: number
  totalAll: number
}

/** Runtime validator: is this a RecentPage-shaped object? */
function isRecentPage(v: unknown): v is RecentPageFields {
  if (!isPlainObject(v)) return false
  return (
    hasField(v, 'entries') && isRecentEntryArray(v.entries) &&
    hasField(v, 'total') && isNumber(v.total) &&
    hasField(v, 'totalAll') && isNumber(v.totalAll)
  )
}

/** Validate an unknown as a RecentPage, with fallback. */
export function fromStorageRecentPage(raw: unknown, fallback: RecentPageFields): RecentPageFields {
  return isRecentPage(raw) ? raw : fallback
}

/** Fields for StarPromptShow (from home-api.ts). */
interface StarPromptShowFields {
  show: boolean
  docOpens: number
}

/** Runtime validator: is this a StarPromptShow-shaped object? */
function isStarPromptShow(v: unknown): v is StarPromptShowFields {
  if (!isPlainObject(v)) return false
  return (
    hasField(v, 'show') && isBoolean(v.show) &&
    hasField(v, 'docOpens') && isNumber(v.docOpens)
  )
}

/** Validate an unknown as a StarPromptShow, with fallback. */
export function fromStorageStarPrompt(raw: unknown, fallback: StarPromptShowFields): StarPromptShowFields {
  return isStarPromptShow(raw) ? raw : fallback
}

/** Fields for CloudProjectEntry (from home-api.ts). */
interface CloudProjectEntryFields {
  projectId: string
  title: string
  kind: 'docs' | 'sheets' | 'slides' | 'other'
  ctimeMs: number
  projectUrl: string
}

/** Runtime validator: is this a CloudProjectEntry-shaped object? */
function isCloudProjectEntry(v: unknown): v is CloudProjectEntryFields {
  if (!isPlainObject(v)) return false
  if (!hasField(v, 'projectId') || !isString(v.projectId)) return false
  if (!hasField(v, 'title') || !isString(v.title)) return false
  if (!hasField(v, 'kind') || !isString(v.kind)) return false
  if (v.kind !== 'docs' && v.kind !== 'sheets' && v.kind !== 'slides' && v.kind !== 'other') return false
  if (!hasField(v, 'ctimeMs') || !isNumber(v.ctimeMs)) return false
  if (!hasField(v, 'projectUrl') || !isString(v.projectUrl)) return false
  return true
}

/** Runtime validator: is this a CloudProjectEntry array? */
function isCloudProjectEntryArray(v: unknown): v is CloudProjectEntryFields[] {
  return Array.isArray(v) && v.every(isCloudProjectEntry)
}

/** Fields for CloudProjectsSnapshot (from home-api.ts). */
interface CloudProjectsSnapshotFields {
  available: boolean
  projects: CloudProjectEntryFields[]
  syncedAt: number
}

/** Runtime validator: is this a CloudProjectsSnapshot-shaped object? */
function isCloudProjectsSnapshot(v: unknown): v is CloudProjectsSnapshotFields {
  if (!isPlainObject(v)) return false
  return (
    hasField(v, 'available') && isBoolean(v.available) &&
    hasField(v, 'projects') && isCloudProjectEntryArray(v.projects) &&
    hasField(v, 'syncedAt') && isNumber(v.syncedAt)
  )
}

/**
 * Validate an unknown as a CloudProjectsSnapshot or null.
 * Fully validates the CloudProjectEntry[] structure at runtime.
 */
export function fromStorageCloudProjects(
  raw: unknown,
): CloudProjectsSnapshotFields | null {
  return isCloudProjectsSnapshot(raw) ? raw : null
}

// ── Re-export field types for bridge use ───────────────────────────────

export type {
  RecentEntryFields,
  RecentPageFields,
  StarPromptShowFields,
  CloudProjectsSnapshotFields,
  CloudProjectEntryFields,
  ProjectSummaryFields,
}
