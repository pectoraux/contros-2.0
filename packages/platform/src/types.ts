/**
 * @genoffice/platform — shared platform types.
 *
 * BOUNDARY CORRECTION (2026-08-21, contract direction):
 *   These types are now defined DIRECTLY in this package. They were previously
 *   re-exported from @genoffice/shell-*-shared (path aliases to apps/shell/src/shared/),
 *   which created a backwards dependency: the runtime-independent layer depended
 *   on the app's shared contracts. The types are structurally identical to the
 *   legacy types in apps/shell/src/shared/ — the bridge converts between them.
 *
 * Zero Electron, zero browser, zero app imports.
 */

// ── File system types ──────────────────────────────────────────────────

export type FileHandle = string | { readonly kind: 'file' }
export type DirectoryHandle = string | { readonly kind: 'directory' }

export interface FileStat {
  mtimeMs: number
  sizeBytes: number
}

// ── Generic operation results ──────────────────────────────────────────

export interface SaveResult {
  ok: boolean
  path?: string
  error?: string
  reason?: string
}

// ── Printing types ─────────────────────────────────────────────────────

export interface PrintOptions {
  printer?: string | null
  silent?: boolean
  color?: boolean
  duplex?: 'single' | 'short-edge' | 'long-edge'
}

export interface ExportPdfOptions {
  defaultName: string
  pageWidthTwips?: number
  pageHeightTwips?: number
  outPath?: string
}

export interface PrintToBytesOptions {
  pageWidthTwips: number
  pageHeightTwips: number
}

// ── Clipboard types ────────────────────────────────────────────────────

export interface ClipboardContent {
  text?: string | null
  html?: string | null
}

// ── Notification types ─────────────────────────────────────────────────

export interface NotificationOptions {
  body?: string
  icon?: string
  tag?: string
}

// ── Tab types (previously re-exported from @genoffice/shell-tabs-shared) ──

export type TabKind = 'home' | 'docs' | 'sheets' | 'slides' | 'pdf' | 'markdown'

export interface TabSummary {
  id: string
  kind: TabKind
  title: string
  closable: boolean
  active: boolean
}

// ── Theme / language / update-channel types ────────────────────────────
// Previously re-exported from @genoffice/shell-home-shared and @genoffice/shell-update-shared

export type UiTheme = 'light' | 'dark' | 'system'

export type UiLanguage =
  | 'zh'
  | 'en'
  | 'ja'
  | 'ko'
  | 'fr'
  | 'de'
  | 'es'
  | 'th'
  | 'id'
  | 'ru'
  | 'ar'
  | 'pt'
  | 'it'
  | 'pl'
  | 'nl'
  | 'ms'
  | 'he'
  | 'hi'
  | 'zh-TW'

export type UpdateChannel = 'stable' | 'beta'

// ── Account types (previously re-exported from @genoffice/shell-home-shared) ──

export interface AccountStatus {
  loggedIn: boolean
  email?: string
  creditBalance?: number
}

export interface AccountLoginEvent {
  phase: 'launched' | 'url' | 'success' | 'error'
  url?: string
  expiresInSec?: number
  error?: string
}

// ── AI types (canonical types live in @genoffice/ai-provider — a workspace package, not an app) ──

export type {
  AiSettings,
  AiStreamRequest,
  AiStreamChunk,
  AiChatRequest,
  AiChatResponse,
  GenSparkAccountStatus,
} from '@genoffice/ai-provider'
