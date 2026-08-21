/**
 * @genoffice/platform — shared platform types.
 *
 * These types are platform-neutral (no Electron, no browser). They are the
 * "currency" types that the capability interfaces in this package consume.
 *
 * Types that already live in existing workspace packages or app shared files
 * are NOT redefined here — they are imported via the temporary
 * `@genoffice/*-shared` path aliases (see tsconfig.base.json). This avoids
 * duplication during the migration; in Phase 6 the aliases are removed and
 * the types are either relocated here or kept in their canonical packages.
 */

// ── File system types ──────────────────────────────────────────────────

/**
 * Platform-neutral file handle.
 *
 * Electron: an absolute path string (e.g. "/path/to/file.docx").
 * Web: a FileSystemFileHandle (File System Access API).
 *
 * The handle is opaque to domain services; they pass it to Files capability
 * methods which know how to resolve it.
 */
export type FileHandle = string | { readonly kind: 'file' }

/**
 * Platform-neutral directory handle.
 *
 * Electron: an absolute path string.
 * Web: a FileSystemDirectoryHandle.
 */
export type DirectoryHandle = string | { readonly kind: 'directory' }

/** File stat info (mtime + size). */
export interface FileStat {
  /** Last-modified time, ms since epoch */
  mtimeMs: number
  /** File size in bytes */
  sizeBytes: number
}

// ── Generic operation results ──────────────────────────────────────────

/** Generic save result. */
export interface SaveResult {
  ok: boolean
  /** New path when the save went to a new file (save-as / save-new) */
  path?: string
  /** Error message when ok=false */
  error?: string
  /** Save failure reason (e.g. 'external-modified' for docs) */
  reason?: string
}

// ── Printing types ─────────────────────────────────────────────────────

export interface PrintOptions {
  /** Printer name (null = system default) */
  printer?: string | null
  /** Silence the print dialog */
  silent?: boolean
  /** Print in color (false = grayscale) */
  color?: boolean
  /** Duplex mode */
  duplex?: 'single' | 'short-edge' | 'long-edge'
}

export interface ExportPdfOptions {
  /** Default file name for the save dialog */
  defaultName: string
  /** Page width in twips (1 inch = 1440 twips) */
  pageWidthTwips?: number
  /** Page height in twips */
  pageHeightTwips?: number
  /** Pre-chosen output path (only honored when it came from a prior save dialog) */
  outPath?: string
}

export interface PrintToBytesOptions {
  pageWidthTwips: number
  pageHeightTwips: number
}

// ── Clipboard types ────────────────────────────────────────────────────

export interface ClipboardContent {
  /** Plain text content (null when the clipboard has no text) */
  text?: string | null
  /** HTML content (null when the clipboard has no HTML) */
  html?: string | null
}

// ── Notification types ─────────────────────────────────────────────────

export interface NotificationOptions {
  /** Body text (below the title) */
  body?: string
  /** Icon URL */
  icon?: string
  /** Tag (replaces existing notifications with the same tag) */
  tag?: string
}

// ── Tab types (re-exported from shell-tabs-shared for convenience) ─────
// The canonical TabSummary/TabKind types live in apps/shell/src/shared/tabs-api.ts.
// During migration they are aliased via @genoffice/shell-tabs-shared; in Phase 6
// they are either relocated to this package or kept in a shared types module.

export type { TabSummary, TabKind } from '@genoffice/shell-tabs-shared'

// ── Theme / language / update-channel types ────────────────────────────
// Canonical types live in apps/shell/src/shared/home-api.ts and update-api.ts.

export type { UiTheme, UiLanguage } from '@genoffice/shell-home-shared'
export type { UpdateChannel } from '@genoffice/shell-update-shared'

// ── Account types ──────────────────────────────────────────────────────

export type { AccountStatus, AccountLoginEvent } from '@genoffice/shell-home-shared'

// ── AI types (canonical types live in @genoffice/ai-provider) ───────────

export type {
  AiSettings,
  AiStreamRequest,
  AiStreamChunk,
  AiChatRequest,
  AiChatResponse,
  GenSparkAccountStatus,
} from '@genoffice/ai-provider'
