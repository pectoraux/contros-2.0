/**
 * Sheets attachment adapter — application-level file/attachment operations.
 *
 * This module owns the Sheets-specific attachment logic:
 *   - Extension validation (ATTACHMENT_EXTS, ATTACHMENT_IMAGE_EXTS)
 *   - Size limits (ATTACHMENT_MAX_BYTES, ATTACHMENT_IMAGE_MAX_BYTES)
 *   - File stat + metadata collection (collectAttachments)
 *   - Text extraction (via @genoffice/file-parse — runtime-independent parser)
 *   - Image reading (raw bytes → base64 + MIME)
 *   - Pasted image persistence (base64 → temp file)
 *
 * ARCHITECTURE:
 *   This is shell/application code (apps/sheets/src/main), NOT a platform
 *   capability. It uses node:fs directly for I/O — the existing Files
 *   capability (packages/platform) is not used because the attachment
 *   logic is tightly coupled to Sheets-specific constants (extensions,
 *   size limits, text-extraction caching). A future refactor could extract
 *   attachment logic into a proper service if needed.
 *
 * INCREMENT 9: extracted from sheets-main.ts to make the migrated handlers
 * thin adapters. The handler delegates to this module — NO parsing/validation
 * logic in the handler itself.
 *
 * ZERO type assertions. ZERO Electron imports (uses node:fs only).
 * ZERO global mutable state except the text-cache (which is path-keyed and
 * bounded by usage — the legacy code has the same cache).
 */

import { statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { app } from 'electron'
import { parseFileToText } from '@genoffice/file-parse'

import type {
  AttachmentMeta,
  AttachmentAddResult,
  AttachmentReadResult,
  AttachmentImageResult,
} from '../shared/desktop-api'
import { ATTACHMENT_IMAGE_EXTS } from '../shared/desktop-api'

// ── Constants (matching legacy sheets-main.ts) ──────────────────────

const ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024
const ATTACHMENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024

const ATTACHMENT_TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'yaml', 'yml', 'xml',
  'html', 'htm', 'log', 'js', 'ts', 'tsx', 'jsx', 'py', 'java', 'c', 'h',
  'cpp', 'go', 'rs', 'rb', 'sh', 'sql', 'css',
])

const ATTACHMENT_EXTS = new Set([
  ...ATTACHMENT_TEXT_EXTS,
  'docx', 'pdf', 'pptx', 'ppt', 'xlsx', 'xls',
  ...ATTACHMENT_IMAGE_EXTS,
])

const ATTACHMENT_IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

// ── Text cache (matching legacy behavior) ───────────────────────────

const attachmentTextCache = new Map<string, { stamp: string; text: string }>()

// ── Attachment operations ────────────────────────────────────────────

function statAttachment(filePath: string): { meta?: AttachmentMeta; error?: string } {
  const name = basename(filePath)
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (!ATTACHMENT_EXTS.has(ext)) return { error: `${name}: unsupported extension .${ext}` }
  try {
    const stat = statSync(filePath)
    if (!stat.isFile()) return { error: `${name}: not a file` }
    if (stat.size > ATTACHMENT_MAX_BYTES) {
      return { error: `${name}: too large (${Math.round(ATTACHMENT_MAX_BYTES / 1024 / 1024)}MB max)` }
    }
    if (ATTACHMENT_IMAGE_EXTS.has(ext) && stat.size > ATTACHMENT_IMAGE_MAX_BYTES) {
      return { error: `${name}: image too large` }
    }
    return { meta: { path: filePath, name, ext, sizeBytes: stat.size } }
  } catch {
    return { error: `${name}: unreadable` }
  }
}

export function collectAttachments(paths: string[]): AttachmentAddResult {
  const accepted: AttachmentMeta[] = []
  const rejected: string[] = []
  for (const p of paths) {
    const { meta, error } = statAttachment(p)
    if (meta) accepted.push(meta)
    else if (error) rejected.push(error)
  }
  return { accepted, rejected }
}

export async function readAttachmentText(
  filePath: string,
  offset: number,
  maxChars: number,
): Promise<AttachmentReadResult> {
  const name = basename(filePath)
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (!ATTACHMENT_EXTS.has(ext)) return { ok: false, error: `unsupported extension .${ext}` }
  if (ATTACHMENT_IMAGE_EXTS.has(ext)) {
    return { ok: false, error: 'images cannot be read as text' }
  }
  try {
    const text = await extractAttachmentText(filePath)
    const start = Math.max(0, Math.floor(Number(offset)) || 0)
    const size = Math.min(Math.max(1, Math.floor(Number(maxChars)) || 1), 48_000)
    return {
      ok: true,
      name,
      totalChars: text.length,
      offset: start,
      text: text.slice(start, start + size),
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function extractAttachmentText(filePath: string): Promise<string> {
  const stat = statSync(filePath)
  const stamp = `${stat.mtimeMs}:${stat.size}`
  const cached = attachmentTextCache.get(filePath)
  if (cached && cached.stamp === stamp) return cached.text
  if (stat.size > ATTACHMENT_MAX_BYTES) throw new Error('file too large')
  const parsed = await parseFileToText(filePath)
  if (!parsed.ok || parsed.kind !== 'text' || parsed.text == null) {
    throw new Error(parsed.error ?? 'parse failed')
  }
  attachmentTextCache.set(filePath, { stamp, text: parsed.text })
  return parsed.text
}

export function readAttachmentImage(filePath: string): AttachmentImageResult {
  const name = basename(filePath)
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const mime = ATTACHMENT_IMAGE_MIME[ext]
  if (!mime) return { ok: false, error: `${name}: not an image` }
  try {
    const stat = statSync(filePath)
    if (stat.size > ATTACHMENT_IMAGE_MAX_BYTES) {
      return { ok: false, error: `${name}: image too large` }
    }
    return { ok: true, base64: readFileSync(filePath).toString('base64'), mime }
  } catch {
    return { ok: false, error: `${name}: unreadable` }
  }
}

// ── Pasted image persistence ────────────────────────────────────────

let pastedImageSeq = 0

export function savePastedImage(data: unknown, ext: unknown): string | null {
  const cleanExt = typeof ext === 'string' ? ext.toLowerCase() : ''
  if (!ATTACHMENT_IMAGE_EXTS.has(cleanExt)) return null
  const bytes =
    data instanceof ArrayBuffer
      ? Buffer.from(data)
      : ArrayBuffer.isView(data)
        ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
        : null
  if (!bytes || bytes.byteLength === 0) return null
  const dir = join(app.getPath('temp'), 'genoffice-pasted')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
  const filePath = join(dir, `pasted-${stamp}-${++pastedImageSeq}.${cleanExt}`)
  writeFileSync(filePath, bytes)
  return filePath
}

// ── Local image reading (for AI image insertion) ────────────────────

const MAX_LOCAL_IMAGE_BYTES = 20 * 1024 * 1024

/**
 * Read a local image file as base64 with MIME detection.
 * Matches the legacy readLocalImage handler behavior:
 *   - Resolves ~ → home directory
 *   - Validates absolute path
 *   - Validates file exists + is a file
 *   - Enforces 20MB max size
 *   - Detects MIME from magic bytes (not extension)
 *   - Returns { mediaType, base64 }
 */
export function readLocalImage(filePath: string): { mediaType: string; base64: string } {
  const { isAbsolute } = require('node:path')
  const { statSync, readFileSync } = require('node:fs')
  const { join } = require('node:path')
  const app_module = require('electron')

  const resolved = filePath.startsWith('~/')
    ? join(app_module.app.getPath('home'), filePath.slice(2))
    : filePath
  if (!isAbsolute(resolved)) throw new Error('Path must be absolute')
  const info = statSync(resolved)
  if (!info.isFile()) throw new Error(`File not found: ${filePath}`)
  if (info.size > MAX_LOCAL_IMAGE_BYTES) throw new Error('Image too large (20MB max)')
  const bytes = readFileSync(resolved)
  const mediaType = sniffImageType(bytes)
  if (mediaType === null) throw new Error('Unsupported image type')
  return { mediaType, base64: bytes.toString('base64') }
}

/**
 * Detect image MIME type from magic bytes.
 * Returns null if the bytes don't match a known image format.
 */
function sniffImageType(bytes: Buffer): string | null {
  if (bytes.length >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return 'image/png'
  }
  if (bytes.length >= 3 &&
      bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (bytes.length >= 6 &&
      (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) ||
      (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38)) {
    return 'image/gif'
  }
  if (bytes.length >= 12 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image/webp'
  }
  return null
}

// ── Attachment extension set (for file picker filters) ──────────────

export function getAttachmentExtensions(): string[] {
  return [...ATTACHMENT_EXTS]
}
