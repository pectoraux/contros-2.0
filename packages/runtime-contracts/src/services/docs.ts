/**
 * DocumentService — domain runtime service for the docs (`.docx`) editor.
 *
 * BOUNDARY CORRECTION (2026-08-21, FINAL pass):
 *   - Removed `consumePendingOpen`, `consumeNewBlank` — the pending-open
 *     queue and new-blank flag are shell state, not domain state. They
 *     stay in `apps/docs/src/main/docs-main.ts`.
 *   - Removed `openNewTab`, `listDocsTabs`, `focusDocsTab` — tab/window
 *     orchestration belongs in the shell, not in the domain service. The
 *     bridge delegates these to `runtime.windowing` instead.
 *   - `saveNew` is now behavior-complete (uses `Settings.getDefaultSaveDir()`
 *     + `Files.uniquePath()`).
 *
 * SESSION-SCOPED: open() returns { session, result }; save() accepts the
 * session. The shell owns the wcId → DocumentSession map (via a
 * SessionRegistry). The service does not know about wcId.
 *
 * PERSISTENCE vs TRANSFORMATION: this service handles PERSISTENCE only.
 * The byte-preserving DOCX TRANSFORMATION (saveDocx from
 * @genoffice/docx-engine) remains in the renderer for now.
 *
 * IMPORTANT (ADR-001 Correction A): implementations receive their dependencies
 * via constructor injection. They MUST NOT call getRuntime() internally.
 */
import type {
  AiSettings,
  AiChatRequest,
  AiChatResponse,
  AiStreamRequest,
  AiStreamChunk,
} from '@genoffice/ai-provider'
import type { FaceVerticalMetrics } from '@genoffice/font-metrics'
import type {
  OpenFileResult,
  PickImageResult,
  AttachmentAddResult,
  AttachmentReadResult,
  AttachmentImageResult,
  MenuCommand,
} from '@genoffice/docs-shared'

/**
 * Per-document session. Returned from open() and accepted by save() etc.
 * The shell holds the reference (in a SessionRegistry) keyed by file path.
 */
export interface DocumentSession {
  /** The file path the renderer is editing. */
  readonly filePath: string
  /** sha256 of the original file (the archive key). */
  readonly hash: string
  /** Disk state at last read/write (for external-modified detection). */
  diskState?: { mtimeMs: number; size: number; hash: string }
}

export interface DocumentService {
  // ── File lifecycle (session-scoped) ─────────────────────────────────
  /**
   * Show the open-file dialog and open the chosen file; returns a session
   * the caller (shell) holds. Null when canceled.
   */
  openDialog(): Promise<{ session: DocumentSession; result: OpenFileResult } | null>
  /**
   * Open a file by absolute path. Returns a session the caller holds.
   * Null when the file can't be read.
   */
  open(path: string): Promise<{ session: DocumentSession; result: OpenFileResult } | null>

  // ── Save (persistence only — renderer produces the bytes) ──────────
  /**
   * Persist the bytes the renderer produced. Checks external-modified,
   * writes atomically via Files.write(), clears the recovery copy, updates
   * recents. Returns the updated session (with new diskState).
   */
  save(
    session: DocumentSession,
    data: Uint8Array,
    auto?: boolean,
  ): Promise<{ ok: boolean; error?: string; reason?: 'external-modified'; session?: DocumentSession }>
  /** Save-as: show the save dialog and write to the chosen path. Returns the new session. */
  saveAs(
    session: DocumentSession,
    defaultName: string,
    data: Uint8Array,
  ): Promise<{ ok: boolean; path?: string; error?: string; session?: DocumentSession }>
  /**
   * First save of a new document: silently write into the default save
   * folder (resolved via Settings.getDefaultSaveDir() + Files.uniquePath()).
   * Returns the new session.
   */
  saveNew(
    defaultName: string,
    data: Uint8Array,
  ): Promise<{ ok: boolean; path?: string; error?: string; session?: DocumentSession }>
  /** Crash-recovery copy of a dirty document. */
  writeRecovery(session: DocumentSession, data: Uint8Array): Promise<{ ok: boolean }>
  /** Recent files list (paths that still exist). */
  recentFiles(): Promise<string[]>

  // ── Images & attachments ─────────────────────────────────────────────
  pickImage(): Promise<PickImageResult | null>
  pickAttachments(): Promise<AttachmentAddResult | null>
  addAttachmentPaths(paths: string[]): Promise<AttachmentAddResult>
  addPastedImage(data: ArrayBuffer, ext: string): Promise<AttachmentAddResult>
  readAttachment(
    path: string,
    offset: number,
    maxChars: number,
  ): Promise<AttachmentReadResult>
  readAttachmentImage(path: string): Promise<AttachmentImageResult>

  // ── Fonts ────────────────────────────────────────────────────────────
  fontMetrics(family: string): Promise<FaceVerticalMetrics | null>

  // ── Print & export ───────────────────────────────────────────────────
  print(): Promise<{ ok: boolean; error?: string }>
  exportPdf(
    defaultName: string,
    pageWidthTwips: number,
    pageHeightTwips: number,
    outPath?: string,
  ): Promise<{ ok: boolean; path?: string; error?: string }>
  printPdfBuffer(
    pageWidthTwips: number,
    pageHeightTwips: number,
  ): Promise<{ ok: boolean; base64?: string; error?: string }>
  saveMergedPdf(
    defaultName: string,
    base64Parts: string[],
    outPath?: string,
  ): Promise<{ ok: boolean; path?: string; error?: string }>

  // ── AI (delegates to runtime.ai) ───────────────────────────────────
  getAiSettings(): Promise<AiSettings>
  setAiSettings(settings: AiSettings): Promise<void>
  aiChat(request: AiChatRequest): Promise<AiChatResponse>
  aiStream(request: AiStreamRequest): Promise<void>
  aiStreamCancel(requestId: string): Promise<void>
  onAiStream(handler: (chunk: AiStreamChunk) => void): () => void

  // ── Domain events (push from service to shell; shell forwards to webContents) ──
  onOpened(handler: (result: OpenFileResult) => void): () => void
  onRenamed(handler: (paths: { oldPath: string; newPath: string }) => void): () => void
  onTeardown(handler: () => void): () => void
  onMenuCommand(handler: (command: MenuCommand, payload?: string) => void): () => void

  // ── Close guard (shell forwards; service just exposes the subscription surface) ──
  onCloseCheck(handler: () => void): () => void
  reportCloseCheck(state: { dirty: boolean; autoSave: boolean; filePath?: string | null }): void
  onCloseSaveRequest(handler: () => void): () => void
  reportCloseSaveResult(ok: boolean): void
  reportViewMenuState(state: { aiSidebar: boolean; darkCanvas: boolean }): void
}
