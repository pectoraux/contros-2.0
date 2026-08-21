/**
 * DocumentServiceImpl — the Docs domain service.
 *
 * Implements the DocumentService interface from @genoffice/runtime-contracts.
 * Composes @genoffice/docx-engine (parseDocx, saveDocx, buildBlankDocx) +
 * @genoffice/file-parse (parseFileToText for attachments) + platform capabilities
 * (Storage, Files, AI, Printing, FontRegistry).
 *
 * Implements the byte-preserving save plan:
 *   - On open: archive the original file under userData/originals/<sha256>.docx
 *     (via Storage.writeBlob). Returns the bytes + hash to the renderer.
 *   - On save: the renderer sends the full new bytes (the renderer's editor
 *     already computed the byte-preserving save plan via @genoffice/docx-engine's
 *     saveDocx). This service writes them atomically (via Files.write), clears
 *     the recovery copy (via Storage.deleteBlob), updates the recent files list
 *     (via Storage.writeObject), and checks for external modifications
 *     (via external-change.ts).
 *
 * IMPORTANT (ADR-001 Correction A): constructor injection. This class receives
 * Storage, Files, AI, Printing, FontRegistry, ProjectStore, and an EventBus
 * via constructor. It does NOT call getRuntime() internally.
 *
 * The path-grant tracking (docWritablePaths) and the close-guard coordination
 * (close-check-result, close-save-result, view-menu-state) remain in
 * apps/docs/src/main/docs-main.ts because they are shell/window orchestration,
 * not domain behavior.
 */
import { createHash } from 'node:crypto'
import { existsSync, statSync, readdirSync, unlinkSync, mkdirSync } from 'node:fs'
import { copyFileSync, renameSync, writeFileSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { Buffer } from 'node:buffer'

import { parseDocx } from '@genoffice/docx-engine'
import { parseFileToText } from '@genoffice/file-parse'
import type {
  Storage,
  Files,
  AI,
  Printing,
  FileHandle,
  FileStat,
} from '@genoffice/platform'
import type { DocumentService } from '@genoffice/runtime-contracts'
import type {
  OpenFileResult,
  PickImageResult,
  AttachmentAddResult,
  AttachmentReadResult,
  AttachmentImageResult,
  DocsTabInfo,
  MenuCommand,
} from '@genoffice/docs-shared'
import type { FaceVerticalMetrics } from '@genoffice/font-metrics'
import type { AiSettings, AiChatRequest, AiChatResponse, AiStreamRequest, AiStreamChunk } from '@genoffice/ai-provider'

import { isExternallyModified, type DiskFileState } from './external-change.js'
import { atomicWriteFile } from './atomic-write.js'

// ── Constants (mirror apps/docs/src/main/docs-main.ts) ───────────────────
const TWIPS_PER_INCH = 1440
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
const ORIGINALS_MAX_BYTES = 500 * 1024 * 1024

// ── EventBus: how the service tells its consumers (the docs main / preload)
//    about push events (onOpened, onRenamed, onTeardown, etc.). The main
//    process subscribes and forwards to webContents.send(). ────────────────
export interface DocsEventBus {
  opened: (result: OpenFileResult) => void
  renamed: (paths: { oldPath: string; newPath: string }) => void
  teardown: () => void
  menuCommand: (command: MenuCommand, payload?: string) => void
  closeCheck: () => void
  closeSaveRequest: () => void
}

// ── Per-tab state tracked by the service ────────────────────────────────
interface DocSession {
  /** The file path the renderer is editing. */
  filePath: string
  /** sha256 of the original file (the archive key). */
  hash: string
  /** Disk state at last read/write (for external-modified detection). */
  diskState?: DiskFileState
}

// ── Dependencies ────────────────────────────────────────────────────────
export interface DocumentServiceDeps {
  storage: Storage
  files: Files
  ai: AI
  printing: Printing
  /** FontRegistry — passed in (constructed by platform-electron). */
  fontRegistry: { fontMetrics(family: string): Promise<FaceVerticalMetrics | null> }
  /** Path to userData dir (for originals archive + recovery dir). */
  userDataDir: string
  /** Default save dir (Documents/GenOffice). */
  defaultSaveDir: string
  /** Path-grant tracker — checks whether a renderer may write to a path. */
  canWrite: (wcId: number, filePath: string) => boolean
  allowWrite: (wcId: number, filePath: string) => void
  /** WebContents ID resolver (for the active tab). */
  getActiveWcId: () => number | null
  /** Tab management hooks (shell orchestration). */
  openTab?: (openPath?: string, opts?: { newBlank?: boolean }) => void
  listTabs?: () => DocsTabInfo[]
  focusTab?: (id: string) => void
  /** Optional: dialog for save-as (when files.pickSave is not sufficient). */
  saveDialog?: (defaultName: string) => Promise<string | null>
}

export class DocumentServiceImpl implements DocumentService {
  private readonly sessions = new Map<number, DocSession>()
  private readonly eventListeners = {
    opened: new Set<(r: OpenFileResult) => void>(),
    renamed: new Set<(p: { oldPath: string; newPath: string }) => void>(),
    teardown: new Set<() => void>(),
    menuCommand: new Set<(c: MenuCommand, p?: string) => void>(),
    closeCheck: new Set<() => void>(),
    closeSaveRequest: new Set<() => void>(),
  }
  private originalsPruneRunning = false

  constructor(
    private readonly deps: DocumentServiceDeps,
    private readonly eventBus: DocsEventBus,
  ) {
    // Wire eventBus → listeners
    // (The main process subscribes to the bus and forwards to webContents.send.)
  }

  // ── File lifecycle ───────────────────────────────────────────────────

  async openDialog(): Promise<OpenFileResult | null> {
    const handles = await this.deps.files.pickOpen({
      accept: ['docx'],
      multiple: false,
    })
    if (!handles || handles.length === 0) return null
    const path = handles[0] as string
    const wcId = this.deps.getActiveWcId()
    if (wcId === null) return null
    return this.open(path)
  }

  async open(path: string): Promise<OpenFileResult | null> {
    const wcId = this.deps.getActiveWcId()
    if (wcId === null) return null

    const { bytes, stat } = await this.deps.files.read(path)
    const hash = createHash('sha256').update(Buffer.from(bytes)).digest('hex')

    // Archive the original (for byte-preserving save plan)
    await this.archiveOriginal(path, Buffer.from(bytes), hash)

    // Track the session
    this.sessions.set(wcId, {
      filePath: path,
      hash,
      diskState: { mtimeMs: stat.mtimeMs, size: stat.sizeBytes, hash },
    })
    this.deps.allowWrite(wcId, path)

    // Push to recent files
    await this.pushRecent(path)

    const result: OpenFileResult = {
      path,
      name: basename(path),
      data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      hash,
    }

    // Notify listeners (the main process forwards to webContents)
    this.eventBus.opened(result)
    for (const fn of this.eventListeners.opened) fn(result)

    return result
  }

  async consumePendingOpen(): Promise<OpenFileResult | null> {
    // The pendingOpenPath queue lives in apps/docs/src/main/docs-main.ts
    // (shell/window orchestration). The main process calls this.open(path)
    // when there's a pending path. This method exists for API completeness
    // but is a no-op when called directly.
    return null
  }

  async consumeNewBlank(): Promise<boolean> {
    // The pendingNewBlankIds set lives in apps/docs/src/main/docs-main.ts.
    // Same as consumePendingOpen — main process orchestrates.
    return false
  }

  // ── Save (byte-preserving) ───────────────────────────────────────────

  async save(
    path: string,
    data: Uint8Array,
    auto?: boolean,
  ): Promise<{ ok: boolean; error?: string; reason?: 'external-modified' }> {
    const wcId = this.deps.getActiveWcId()
    if (wcId === null) return { ok: false, error: 'no active session' }
    if (!this.deps.canWrite(wcId, path)) {
      return { ok: false, error: 'save target is not an opened document' }
    }

    // External-modified check
    const session = this.sessions.get(wcId)
    if (session && (await this.checkExternalModified(path, session.diskState))) {
      if (auto === true) return { ok: false, reason: 'external-modified' }
      // The main process shows the Overwrite/Cancel dialog (shell orchestration).
      // For now, fail with reason — the main process intercepts this return.
      return { ok: false, reason: 'external-modified' }
    }

    try {
      await this.deps.files.write(path, data)
      // Update disk state
      const stat = await this.deps.files.stat(path)
      const hash = createHash('sha256').update(Buffer.from(data)).digest('hex')
      if (session) {
        session.diskState = { mtimeMs: stat.mtimeMs, size: stat.sizeBytes, hash }
      }
      // Clear recovery copy
      await this.clearRecoveryCopy(path)
      // Update recent files
      await this.pushRecent(path)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }

  async saveAs(
    defaultName: string,
    data: Uint8Array,
  ): Promise<{ ok: boolean; path?: string; error?: string }> {
    const wcId = this.deps.getActiveWcId()
    if (wcId === null) return { ok: false, error: 'no active session' }

    const path = await this.deps.files.pickSave({
      defaultName,
      accept: ['docx'],
    })
    if (!path) return { ok: false }

    try {
      await this.deps.files.write(path as string, data)
      this.deps.allowWrite(wcId, path as string)
      // Update session
      const stat = await this.deps.files.stat(path as string)
      const hash = createHash('sha256').update(Buffer.from(data)).digest('hex')
      this.sessions.set(wcId, {
        filePath: path as string,
        hash,
        diskState: { mtimeMs: stat.mtimeMs, size: stat.sizeBytes, hash },
      })
      await this.pushRecent(path as string)
      return { ok: true, path: path as string }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }

  async saveNew(
    defaultName: string,
    data: Uint8Array,
  ): Promise<{ ok: boolean; path?: string; error?: string }> {
    const wcId = this.deps.getActiveWcId()
    if (wcId === null) return { ok: false, error: 'no active session' }

    const filePath = this.uniquePathIn(this.deps.defaultSaveDir, defaultName)
    try {
      await this.deps.files.write(filePath, data)
      this.deps.allowWrite(wcId, filePath)
      const stat = await this.deps.files.stat(filePath)
      const hash = createHash('sha256').update(Buffer.from(data)).digest('hex')
      this.sessions.set(wcId, {
        filePath,
        hash,
        diskState: { mtimeMs: stat.mtimeMs, size: stat.sizeBytes, hash },
      })
      await this.pushRecent(filePath)
      return { ok: true, path: filePath }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }

  async writeRecovery(path: string, data: Uint8Array): Promise<{ ok: boolean }> {
    const wcId = this.deps.getActiveWcId()
    if (wcId === null) return { ok: false }
    if (!this.deps.canWrite(wcId, path)) return { ok: false }

    try {
      const recoveryDir = join(this.deps.userDataDir, 'docs-autosave')
      mkdirSync(recoveryDir, { recursive: true })
      const recoveryPath = join(recoveryDir, `${sha1Hex(path)}.docx`)
      await this.deps.files.write(recoveryPath, data)
      return { ok: true }
    } catch {
      return { ok: false }
    }
  }

  async recentFiles(): Promise<string[]> {
    const all = (await this.deps.storage.readObject('docs', 'recents')) as string[] | null
    if (!Array.isArray(all)) return []
    return all.filter((p) => typeof p === 'string' && existsSync(p))
  }

  // ── Images & attachments ─────────────────────────────────────────────

  async pickImage(): Promise<PickImageResult | null> {
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
      base64: Buffer.from(bytes).toString('base64'),
      mime,
      name: basename(filePath),
    }
  }

  async pickAttachments(): Promise<AttachmentAddResult | null> {
    const handles = await this.deps.files.pickOpen({
      accept: [...ATTACHMENT_EXTS],
      multiple: true,
    })
    if (!handles || handles.length === 0) return null
    return this.collectAttachments(handles as string[])
  }

  async addAttachmentPaths(paths: string[]): Promise<AttachmentAddResult> {
    return this.collectAttachments(paths)
  }

  async addPastedImage(data: ArrayBuffer, ext: string): Promise<AttachmentAddResult> {
    // Save the pasted image to a temp file, then collect as attachment
    const tempDir = join(this.deps.userDataDir, 'temp', 'genoffice-pasted')
    mkdirSync(tempDir, { recursive: true })
    const filePath = join(tempDir, `${Date.now()}.${ext}`)
    writeFileSync(filePath, Buffer.from(data))
    return this.collectAttachments([filePath])
  }

  async readAttachment(
    path: string,
    offset: number,
    maxChars: number,
  ): Promise<AttachmentReadResult> {
    const name = basename(path)
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

  async readAttachmentImage(path: string): Promise<AttachmentImageResult> {
    const name = basename(path)
    const ext = name.split('.').pop()?.toLowerCase() ?? ''
    const mime = ATTACHMENT_IMAGE_MIME[ext]
    if (!mime) return { ok: false, error: `${name}: not an image` }
    try {
      const { bytes } = await this.deps.files.read(path)
      if (bytes.byteLength > ATTACHMENT_IMAGE_MAX_BYTES) {
        return { ok: false, error: `${name}: image too large` }
      }
      return { ok: true, base64: Buffer.from(bytes).toString('base64'), mime }
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
      filePath = await this.deps.files.pickSave({
        defaultName: defaultName.replace(/\.docx$/i, '') + '.pdf',
        accept: ['pdf'],
      }) as string | null
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
      filePath = await this.deps.files.pickSave({
        defaultName: defaultName.replace(/\.docx$/i, '') + '.pdf',
        accept: ['pdf'],
      }) as string | null
      if (!filePath) return { ok: false }
    }
    return this.deps.printing.saveMergedPdf(defaultName, base64Parts, filePath)
  }

  // ── Tab management (delegates to shell hooks) ────────────────────────

  async openNewTab(openPath?: string | null): Promise<void> {
    this.deps.openTab?.(openPath ?? undefined, openPath ? undefined : { newBlank: true })
  }

  async listDocsTabs(): Promise<DocsTabInfo[]> {
    return this.deps.listTabs?.() ?? []
  }

  async focusDocsTab(id: string): Promise<void> {
    this.deps.focusTab?.(id)
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

  // ── Events (push from service to renderer) ────────────────────────────

  onOpened(handler: (result: OpenFileResult) => void): () => void {
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

  onMenuCommand(handler: (command: MenuCommand, payload?: string) => void): () => void {
    this.eventListeners.menuCommand.add(handler)
    return () => this.eventListeners.menuCommand.delete(handler)
  }

  onCloseCheck(handler: () => void): () => void {
    this.eventListeners.closeCheck.add(handler)
    return () => this.eventListeners.closeCheck.delete(handler)
  }

  reportCloseCheck(state: { dirty: boolean; autoSave: boolean; filePath?: string | null }): void {
    // Forwarded to the main process close-guard flow (shell orchestration).
    // The main process subscribes to this via the EventBus.
  }

  onCloseSaveRequest(handler: () => void): () => void {
    this.eventListeners.closeSaveRequest.add(handler)
    return () => this.eventListeners.closeSaveRequest.delete(handler)
  }

  reportCloseSaveResult(ok: boolean): void {
    // Forwarded to the main process close-guard flow.
  }

  reportViewMenuState(state: { aiSidebar: boolean; darkCanvas: boolean }): void {
    // Forwarded to the main process menu builder (shell orchestration).
  }

  // ── Internal helpers ────────────────────────────────────────────────

  private async archiveOriginal(filePath: string, bytes: Buffer, hash: string): Promise<void> {
    const dir = join(this.deps.userDataDir, 'originals')
    mkdirSync(dir, { recursive: true })
    const target = join(dir, `${hash}.docx`)
    if (!existsSync(target)) {
      try {
        copyFileSync(filePath, target)
      } catch {
        // If copy fails (e.g. file moved), write the bytes directly.
        writeFileSync(target, bytes)
      }
    }
    void this.pruneOriginals(dir)
  }

  private async pruneOriginals(dir: string): Promise<void> {
    if (this.originalsPruneRunning) return
    this.originalsPruneRunning = true
    try {
      const files: Array<{ path: string; size: number; mtimeMs: number }> = []
      for (const name of readdirSync(dir)) {
        try {
          const stat = statSync(join(dir, name))
          if (stat.isFile()) {
            files.push({ path: join(dir, name), size: stat.size, mtimeMs: stat.mtimeMs })
          }
        } catch {
          /* removed concurrently */
        }
      }
      let total = files.reduce((sum, f) => sum + f.size, 0)
      files.sort((a, b) => a.mtimeMs - b.mtimeMs)
      for (const f of files) {
        if (total <= ORIGINALS_MAX_BYTES) break
        try {
          unlinkSync(f.path)
          total -= f.size
        } catch {
          /* already gone */
        }
      }
    } catch {
      /* directory unreadable: retry on the next archive */
    } finally {
      this.originalsPruneRunning = false
    }
  }

  private async checkExternalModified(path: string, recorded?: DiskFileState): Promise<boolean> {
    if (!recorded) return false
    try {
      const stat = await this.deps.files.stat(path)
      return isExternallyModified(
        recorded,
        { mtimeMs: stat.mtimeMs, size: stat.sizeBytes },
        async () => {
          const { bytes } = await this.deps.files.read(path)
          return createHash('sha256').update(Buffer.from(bytes)).digest('hex')
        },
      )
    } catch {
      return false
    }
  }

  private async clearRecoveryCopy(filePath: string): Promise<void> {
    const recoveryPath = join(this.deps.userDataDir, 'docs-autosave', `${sha1Hex(filePath)}.docx`)
    if (existsSync(recoveryPath)) {
      try {
        unlinkSync(recoveryPath)
      } catch {
        /* already gone */
      }
    }
  }

  private async pushRecent(filePath: string): Promise<void> {
    const all = (await this.deps.storage.readObject('docs', 'recents')) as string[] | null
    const list = Array.isArray(all) ? all.filter((p) => typeof p === 'string') : []
    const filtered = list.filter((p) => p !== filePath)
    filtered.unshift(filePath)
    await this.deps.storage.writeObject('docs', 'recents', filtered.slice(0, 50))
  }

  private uniquePathIn(dir: string, fileName: string): string {
    mkdirSync(dir, { recursive: true })
    const base = fileName.replace(/\.docx$/i, '')
    let candidate = join(dir, `${base}.docx`)
    let n = 1
    while (existsSync(candidate)) {
      candidate = join(dir, `${base} ${n}.docx`)
      n++
    }
    return candidate
  }

  private async collectAttachments(paths: string[]): Promise<AttachmentAddResult> {
    const accepted: AttachmentAddResult['accepted'] = []
    const rejected: string[] = []
    for (const p of paths) {
      try {
        const name = basename(p)
        const ext = name.split('.').pop()?.toLowerCase() ?? ''
        if (!ATTACHMENT_EXTS.has(ext)) {
          rejected.push(`${name}: unsupported type`)
          continue
        }
        const stat = statSync(p)
        accepted.push({ path: p, name, ext, sizeBytes: stat.size })
      } catch {
        rejected.push(`${basename(p)}: unreadable`)
      }
    }
    return { accepted, rejected }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function sha1Hex(s: string): string {
  return createHash('sha1').update(s).digest('hex')
}
