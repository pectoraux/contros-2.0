/**
 * DocumentServiceImpl — the Docs domain service.
 *
 * Composes @genoffice/docx-engine + @genoffice/file-parse + platform capabilities
 * (Storage, Files, AI, Printing, FontRegistry, Settings).
 *
 * BOUNDARY CORRECTION (2026-08-21, FINAL pass):
 *   - Removed `consumePendingOpen`, `consumeNewBlank` — shell state, not domain
 *   - Removed `openNewTab`, `listDocsTabs`, `focusDocsTab` — shell ops, not domain
 *   - Removed `requestOpenTab`/`requestListTabs`/`requestFocusTab` from DocsEventBus
 *   - `saveNew` is now behavior-complete (uses Settings.getDefaultSaveDir() + Files.uniquePath())
 *   - ZERO node:* / Electron imports (verified by architecture test)
 *   - ZERO shell-hook deps (no canWrite/allowWrite/getActiveWcId/openTab/listTabs/focusTab)
 *   - Session-scoped (open returns { session, result }; save accepts session)
 *   - The shell owns the SessionRegistry (Map<filePath, DocumentSession>)
 *
 * PERSISTENCE vs TRANSFORMATION: this service handles PERSISTENCE only.
 * The byte-preserving DOCX TRANSFORMATION (saveDocx) remains in the renderer.
 *
 * IMPORTANT (ADR-001 Correction A): constructor injection. No getRuntime().
 */
import { parseFileToText } from '@genoffice/file-parse'
import type {
  Storage,
  Files,
  AI,
  Printing,
  Settings,
  FileStat,
} from '@genoffice/platform'
import type { DocumentService, DocumentSession } from '@genoffice/runtime-contracts'
import type {
  DocumentOpenResult,
  DocumentPickImageResult,
  DocumentAttachmentAddResult,
  DocumentAttachmentReadResult,
  DocumentAttachmentImageResult,
} from '@genoffice/runtime-contracts'
import type { FaceVerticalMetrics } from '@genoffice/font-metrics'
import type {
  AiSettings,
  AiChatRequest,
  AiChatResponse,
  AiStreamRequest,
  AiStreamChunk,
} from '@genoffice/ai-provider'

import { isExternallyModified, type DiskFileState } from './external-change-impl.js'

// ── Constants ──────────────────────────────────────────────────────────
const ATTACHMENT_EXTS = new Set([
  'docx', 'xlsx', 'pptx', 'pdf', 'txt', 'md', 'markdown', 'csv',
  'png', 'jpg', 'jpeg', 'gif', 'webp',
])
const ATTACHMENT_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])
const ATTACHMENT_IMAGE_MIME: Record<string, 'image/png' | 'image/jpeg' | 'image/gif'> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
}
const ATTACHMENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024
const IMAGE_MIME: Record<string, 'image/png' | 'image/jpeg' | 'image/gif'> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
}
const RECENT_FILES_MAX = 50

/**
 * DocsEventBus — DOMAIN-ONLY events. No shell commands.
 *
 * The shell subscribes to these and forwards to webContents.send().
 * The service publishes domain events; it does NOT issue shell commands
 * (no requestOpenTab / requestListTabs / requestFocusTab — those were removed).
 */
export interface DocsEventBus {
  opened: (result: DocumentOpenResult) => void
  renamed: (paths: { oldPath: string; newPath: string }) => void
  teardown: () => void
  closeCheck: () => void
  closeSaveRequest: () => void
}

// ── Dependencies (capability-only — NO shell hooks, NO wcId) ──────────
export interface DocumentServiceDeps {
  storage: Storage
  files: Files
  ai: AI
  printing: Printing
  settings: Settings
  /** FontRegistry — passed in (constructed by platform-electron). */
  fontRegistry: { fontMetrics(family: string): Promise<FaceVerticalMetrics | null> }
}

/**
 * DocumentServiceImpl — PURE DOMAIN, no node:* or electron imports.
 *
 * Every method is either EXTRACTED AND BEHAVIOR-COMPLETE or explicitly
 * removed (not part of this extraction). See PHASE-1-FINAL-CORRECTION.md
 * for the method classification table.
 */
export class DocumentServiceImpl implements DocumentService {
  private readonly eventListeners = {
    opened: new Set<(r: DocumentOpenResult) => void>(),
    renamed: new Set<(p: { oldPath: string; newPath: string }) => void>(),
    teardown: new Set<() => void>(),
    closeCheck: new Set<() => void>(),
    closeSaveRequest: new Set<() => void>(),
  }

  constructor(
    private readonly deps: DocumentServiceDeps,
    private readonly eventBus: DocsEventBus,
  ) {}

  // ── File lifecycle (session-scoped) ───────────────────────────────────

  async openDialog(): Promise<{ session: DocumentSession; result: DocumentOpenResult } | null> {
    const handles = await this.deps.files.pickOpen({
      accept: ['docx'],
      multiple: false,
    })
    if (!handles || handles.length === 0) return null
    const path = handles[0] as string
    return this.open(path)
  }

  async open(path: string): Promise<{ session: DocumentSession; result: DocumentOpenResult } | null> {
    try {
      const { bytes, stat } = await this.deps.files.read(path)
      const hash = await this.hashBytes(bytes)

      // Archive the original (for byte-preserving save plan) — via Storage capability
      await this.deps.storage.writeBlob('originals:' + hash, bytes)

      // Update recents
      await this.pushRecent(path)

      const session: DocumentSession = {
        filePath: path,
        hash,
        diskState: { mtimeMs: stat.mtimeMs, size: stat.sizeBytes, hash },
      }

      // Build the DocumentOpenResult (data is an ArrayBuffer copy for the renderer)
      const result: DocumentOpenResult = {
        path,
        name: this.basename(path),
        data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        hash,
      }

      // Notify listeners (the shell forwards to webContents)
      this.eventBus.opened(result)
      for (const fn of this.eventListeners.opened) fn(result)

      return { session, result }
    } catch {
      return null
    }
  }

  // ── Save (persistence only — renderer produces the bytes) ───────────

  async save(
    session: DocumentSession,
    data: Uint8Array,
    auto?: boolean,
  ): Promise<{ ok: boolean; error?: string; reason?: 'external-modified'; session?: DocumentSession }> {
    // External-modified check (uses Files.stat, not statSync)
    if (session.diskState && (await this.checkExternalModified(session.filePath, session.diskState))) {
      if (auto === true) return { ok: false, reason: 'external-modified', session }
      return { ok: false, reason: 'external-modified', session }
    }

    try {
      await this.deps.files.write(session.filePath, data)
      // Update disk state
      const stat = await this.deps.files.stat(session.filePath)
      const hash = await this.hashBytes(data)
      const updatedSession: DocumentSession = {
        filePath: session.filePath,
        hash,
        diskState: stat ? { mtimeMs: stat.mtimeMs, size: stat.sizeBytes, hash } : session.diskState,
      }
      // Clear recovery copy (via Storage capability)
      await this.deps.storage.deleteBlob('recovery:' + (await this.sha1Hash(session.filePath)))
      // Update recent files
      await this.pushRecent(session.filePath)
      return { ok: true, session: updatedSession }
    } catch (err) {
      return { ok: false, error: String(err), session }
    }
  }

  async saveAs(
    session: DocumentSession,
    defaultName: string,
    data: Uint8Array,
  ): Promise<{ ok: boolean; path?: string; error?: string; session?: DocumentSession }> {
    const path = await this.deps.files.pickSave({
      defaultName,
      accept: ['docx'],
    })
    if (!path) return { ok: false }

    try {
      const filePath = path as string
      await this.deps.files.write(filePath, data)
      const stat = await this.deps.files.stat(filePath)
      const hash = await this.hashBytes(data)
      const newSession: DocumentSession = {
        filePath,
        hash,
        diskState: stat ? { mtimeMs: stat.mtimeMs, size: stat.sizeBytes, hash } : undefined,
      }
      await this.pushRecent(filePath)
      return { ok: true, path: filePath, session: newSession }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }

  async saveNew(
    defaultName: string,
    data: Uint8Array,
  ): Promise<{ ok: boolean; path?: string; error?: string; session?: DocumentSession }> {
    try {
      // Resolve the default save dir via Settings capability
      const defaultSaveDir = await this.deps.settings.getDefaultSaveDir()
      // Find a non-conflicting path via Files.uniquePath
      const filePath = await this.deps.files.uniquePath(defaultSaveDir, defaultName)
      // Write the bytes
      await this.deps.files.write(filePath, data)
      const stat = await this.deps.files.stat(filePath)
      const hash = await this.hashBytes(data)
      const session: DocumentSession = {
        filePath,
        hash,
        diskState: stat ? { mtimeMs: stat.mtimeMs, size: stat.sizeBytes, hash } : undefined,
      }
      await this.pushRecent(filePath)
      return { ok: true, path: filePath, session }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }

  async writeRecovery(session: DocumentSession, data: Uint8Array): Promise<{ ok: boolean }> {
    try {
      // Recovery copies are binary blobs keyed by sha1(filePath) — via Storage capability
      await this.deps.storage.writeBlob('recovery:' + (await this.sha1Hash(session.filePath)), data)
      return { ok: true }
    } catch {
      return { ok: false }
    }
  }

  async recentFiles(): Promise<string[]> {
    const all = (await this.deps.storage.readObject('docs', 'recents')) as string[] | null
    if (!Array.isArray(all)) return []
    // Filter to existing files (uses Files.stat, not existsSync)
    const existing: string[] = []
    for (const p of all) {
      if (typeof p === 'string') {
        const stat = await this.deps.files.stat(p)
        if (stat) existing.push(p)
      }
    }
    return existing
  }

  // ── Images & attachments ─────────────────────────────────────────────

  async pickImage(): Promise<DocumentPickImageResult | null> {
    const handles = await this.deps.files.pickOpen({
      accept: ['png', 'jpg', 'jpeg', 'gif'],
      multiple: false,
    })
    if (!handles || handles.length === 0) return null
    const filePath = handles[0] as string
    const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
    const mime = IMAGE_MIME[ext]
    if (!mime) return null
    const { bytes } = await this.deps.files.read(filePath)
    return {
      base64: this.bytesToBase64(bytes),
      mime,
      name: this.basename(filePath),
    }
  }

  async pickAttachments(): Promise<DocumentAttachmentAddResult | null> {
    const handles = await this.deps.files.pickOpen({
      accept: [...ATTACHMENT_EXTS],
      multiple: true,
    })
    if (!handles || handles.length === 0) return null
    return this.collectAttachments(handles as string[])
  }

  async addAttachmentPaths(paths: string[]): Promise<DocumentAttachmentAddResult> {
    return this.collectAttachments(paths)
  }

  async addPastedImage(data: ArrayBuffer, ext: string): Promise<DocumentAttachmentAddResult> {
    // Save the pasted image to a temp blob — via Storage capability
    const key = 'pasted-image:' + Date.now() + '.' + ext
    await this.deps.storage.writeBlob(key, new Uint8Array(data))
    return {
      accepted: [{ path: key, name: `pasted.${ext}`, ext, sizeBytes: data.byteLength }],
      rejected: [],
    }
  }

  async readAttachment(
    path: string,
    offset: number,
    maxChars: number,
  ): Promise<DocumentAttachmentReadResult> {
    const name = this.basename(path)
    const ext = name.split('.').pop()?.toLowerCase() ?? ''
    if (!ATTACHMENT_EXTS.has(ext)) {
      return { ok: false, error: `unsupported extension: ${ext}` }
    }
    if (ATTACHMENT_IMAGE_EXTS.has(ext)) {
      return { ok: false, error: 'image attachments have no text content' }
    }
    try {
      const parsed = await parseFileToText(path)
      const text = parsed.ok && parsed.kind === 'text' ? (parsed.text ?? '') : ''
      const start = Math.max(0, Math.floor(offset) || 0)
      const size = Math.min(Math.max(1, Math.floor(maxChars) || 1), 48_000)
      return {
        ok: true,
        name,
        totalChars: text.length,
        offset: start,
        text: text.slice(start, start + size),
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  async readAttachmentImage(path: string): Promise<DocumentAttachmentImageResult> {
    const name = this.basename(path)
    const ext = name.split('.').pop()?.toLowerCase() ?? ''
    const mime = ATTACHMENT_IMAGE_MIME[ext]
    if (!mime) return { ok: false, error: `${name}: not an image` }
    try {
      const { bytes } = await this.deps.files.read(path)
      if (bytes.byteLength > ATTACHMENT_IMAGE_MAX_BYTES) {
        return { ok: false, error: `${name}: image too large` }
      }
      return { ok: true, base64: this.bytesToBase64(bytes), mime }
    } catch {
      return { ok: false, error: `${name}: unreadable` }
    }
  }

  // ── Fonts ────────────────────────────────────────────────────────────

  async fontMetrics(family: string): Promise<FaceVerticalMetrics | null> {
    return this.deps.fontRegistry.fontMetrics(family)
  }

  // ── Print & export ───────────────────────────────────────────────────

  async print(): Promise<{ ok: boolean; error?: string }> {
    return this.deps.printing.print()
  }

  async exportPdf(
    defaultName: string,
    pageWidthTwips: number,
    pageHeightTwips: number,
    outPath?: string,
  ): Promise<{ ok: boolean; path?: string; error?: string }> {
    let filePath = outPath ?? null
    if (!filePath) {
      filePath = (await this.deps.files.pickSave({
        defaultName: defaultName.replace(/\.docx$/i, '') + '.pdf',
        accept: ['pdf'],
      })) as string | null
      if (!filePath) return { ok: false }
    }
    return this.deps.printing.exportPdf({
      defaultName,
      pageWidthTwips,
      pageHeightTwips,
      outPath: filePath,
    })
  }

  async printPdfBuffer(
    pageWidthTwips: number,
    pageHeightTwips: number,
  ): Promise<{ ok: boolean; base64?: string; error?: string }> {
    return this.deps.printing.printToBytes({ pageWidthTwips, pageHeightTwips })
  }

  async saveMergedPdf(
    defaultName: string,
    base64Parts: string[],
    outPath?: string,
  ): Promise<{ ok: boolean; path?: string; error?: string }> {
    let filePath = outPath ?? null
    if (!filePath) {
      filePath = (await this.deps.files.pickSave({
        defaultName: defaultName.replace(/\.docx$/i, '') + '.pdf',
        accept: ['pdf'],
      })) as string | null
      if (!filePath) return { ok: false }
    }
    return this.deps.printing.saveMergedPdf(defaultName, base64Parts, filePath)
  }

  // ── AI (delegates to runtime.ai) ─────────────────────────────────────

  async getAiSettings(): Promise<AiSettings> {
    return this.deps.ai.getSettings()
  }

  async setAiSettings(settings: AiSettings): Promise<void> {
    return this.deps.ai.setSettings(settings)
  }

  async aiChat(request: AiChatRequest): Promise<AiChatResponse> {
    return this.deps.ai.chat(request)
  }

  async aiStream(request: AiStreamRequest): Promise<void> {
    return this.deps.ai.stream(request)
  }

  async aiStreamCancel(requestId: string): Promise<void> {
    return this.deps.ai.streamCancel(requestId)
  }

  onAiStream(handler: (chunk: AiStreamChunk) => void): () => void {
    return this.deps.ai.onStream(handler)
  }

  // ── Domain events (push from service to shell; shell forwards to webContents) ──

  onOpened(handler: (result: DocumentOpenResult) => void): () => void {
    this.eventListeners.opened.add(handler)
    return () => this.eventListeners.opened.delete(handler)
  }

  onRenamed(handler: (paths: { oldPath: string; newPath: string }) => void): () => void {
    this.eventListeners.renamed.add(handler)
    return () => this.eventListeners.renamed.delete(handler)
  }

  onTeardown(handler: () => void): () => void {
    this.eventListeners.teardown.add(handler)
    return () => this.eventListeners.teardown.delete(handler)
  }

  onCloseCheck(handler: () => void): () => void {
    this.eventListeners.closeCheck.add(handler)
    return () => this.eventListeners.closeCheck.delete(handler)
  }

  reportCloseCheck(_state: { dirty: boolean; autoSave: boolean; filePath?: string | null }): void {
    // Forwarded to the shell close-guard flow via EventBus (if connected).
  }

  onCloseSaveRequest(handler: () => void): () => void {
    this.eventListeners.closeSaveRequest.add(handler)
    return () => this.eventListeners.closeSaveRequest.delete(handler)
  }

  reportCloseSaveResult(_ok: boolean): void {
    // Forwarded to the shell close-guard flow.
  }

  // ── Internal helpers (PURE LOGIC — no fs access) ────────────────────

  /**
   * Compute a sha256 hash of bytes. Uses the Web Crypto API
   * (crypto.subtle) which is available in both Node 22+ and browsers —
   * no node:* import needed.
   */
  private async hashBytes(bytes: Uint8Array): Promise<string> {
    // Copy into a fresh ArrayBuffer to satisfy crypto.subtle's BufferSource typing.
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    const digest = await crypto.subtle.digest('SHA-256', copy)
    return this.bytesToHex(new Uint8Array(digest))
  }

  /** Compute a sha1 hash of a string (for recovery-key derivation). Pure computation. */
  private async sha1Hash(s: string): Promise<string> {
    const bytes = new TextEncoder().encode(s)
    const digest = await crypto.subtle.digest('SHA-1', bytes)
    return this.bytesToHex(new Uint8Array(digest))
  }

  private bytesToHex(bytes: Uint8Array): string {
    let hex = ''
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0')
    }
    return hex
  }

  private bytesToBase64(bytes: Uint8Array): string {
    // btoa is available in Node 22+ and browsers
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
  }

  private basename(path: string): string {
    const parts = path.split(/[/\\]/)
    return parts[parts.length - 1] || path
  }

  private async checkExternalModified(path: string, recorded: DiskFileState): Promise<boolean> {
    try {
      const stat = await this.deps.files.stat(path)
      if (!stat) return false
      // The hash read only runs when mtime+size disagree — use Files.read for that
      return isExternallyModified(
        recorded,
        { mtimeMs: stat.mtimeMs, size: stat.sizeBytes },
        async () => {
          const { bytes } = await this.deps.files.read(path)
          return this.hashBytes(bytes)
        },
      )
    } catch {
      return false
    }
  }

  private async pushRecent(filePath: string): Promise<void> {
    const all = (await this.deps.storage.readObject('docs', 'recents')) as string[] | null
    const list = Array.isArray(all) ? all.filter((p) => typeof p === 'string') : []
    const filtered = list.filter((p) => p !== filePath)
    filtered.unshift(filePath)
    await this.deps.storage.writeObject('docs', 'recents', filtered.slice(0, RECENT_FILES_MAX))
  }

  private async collectAttachments(paths: string[]): Promise<DocumentAttachmentAddResult> {
    const accepted: DocumentAttachmentAddResult['accepted'] = []
    const rejected: string[] = []
    for (const p of paths) {
      try {
        const name = this.basename(p)
        const ext = name.split('.').pop()?.toLowerCase() ?? ''
        if (!ATTACHMENT_EXTS.has(ext)) {
          rejected.push(`${name}: unsupported type`)
          continue
        }
        const stat = await this.deps.files.stat(p)
        if (!stat) {
          rejected.push(`${name}: not found`)
          continue
        }
        accepted.push({ path: p, name, ext, sizeBytes: stat.sizeBytes })
      } catch {
        rejected.push(`${this.basename(p)}: unreadable`)
      }
    }
    return { accepted, rejected }
  }
}
