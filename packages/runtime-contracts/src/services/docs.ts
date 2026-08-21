/**
 * DocumentService — domain runtime service for the docs (`.docx`) editor.
 *
 * Composes @genoffice/docx-engine with platform capabilities (Storage, Files,
 * AI, Printing) to deliver docs product capabilities. The bridge
 * (createDocsDesktopBridge) maps the existing window.desktop API to these
 * methods, performing ArrayBuffer → Uint8Array conversion where needed.
 *
 * SESSION-SCOPED (corrected 2026-08-21 per Principal Architect review):
 *   The service does NOT know about webContents IDs, path-grant tracking, or
 *   shell tab management. It returns a `DocumentSession` from `open()` and
 *   accepts it in `save()` / `saveAs()` / `writeRecovery()` etc. The shell
 *   (apps/docs/src/main/) owns the map of wcId → DocumentSession.
 *
 * IMPORTANT (ADR-001 Correction A): implementations receive their dependencies
 * via constructor injection. They MUST NOT call getRuntime() internally.
 *
 * PERSISTENCE vs TRANSFORMATION (corrected 2026-08-21):
 *   This service handles PERSISTENCE (when/where to write, external-modified
 *   check, recovery copy management). The byte-preserving DOCX TRANSFORMATION
 *   (saveDocx from @genoffice/docx-engine) remains in the renderer for now;
 *   the renderer produces the bytes and passes them to save(). A future
 *   increment may move the transformation into the service, but only when
 *   the renderer can be unfrozen and the bridge can pass structured save
 *   plans instead of raw bytes.
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
  DocsTabInfo,
  MenuCommand,
} from '@genoffice/docs-shared'

/**
 * Per-document session. Returned from open() and accepted by save() etc.
 * The shell holds the reference and tracks the wcId → session map.
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
  /** Consume a file queued at tab creation; null when none pending. (Shell orchestrates the queue.) */
  consumePendingOpen(): Promise<{ session: DocumentSession; result: OpenFileResult } | null>
  /** Returns true once when this tab was opened via "New Document". (Shell orchestrates the queue.) */
  consumeNewBlank(): Promise<boolean>

  // ── Save (persistence only — renderer produces the bytes) ──────────
  /**
   * Persist the bytes the renderer produced. Checks external-modified,
   * writes atomically via Files.write(), clears the recovery copy, updates
   * recents. The byte-preserving DOCX TRANSFORMATION (saveDocx from
   * @genoffice/docx-engine) remains in the renderer for now.
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
  /** First save of a new document: silently write into the default folder. Returns the new session. */
  saveNew(
    session: DocumentSession | null,
    defaultName: string,
    data: Uint8Array,
  ): Promise<{ ok: boolean; path?: string; error?: string; session?: DocumentSession }>
  /** Crash-recovery copy of a dirty document. */
  writeRecovery(session: DocumentSession, data: Uint8Array): Promise<{ ok: boolean }>
  /** Recent files list (paths). */
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

  // ── Tab management (delegates to EventBus; shell subscribes) ───────
  /**
   * Request the shell to open a new tab. The shell decides whether to
   * create a new BrowserWindow, a WebContentsView, or focus an existing tab.
   */
  openNewTab(openPath?: string | null): Promise<void>
  /** Request the list of open docs tabs from the shell. */
  listDocsTabs(): Promise<DocsTabInfo[]>
  /** Request the shell to focus a docs tab by id. */
  focusDocsTab(id: string): Promise<void>

  // ── AI (delegates to runtime.ai — Phase 1 increment 1: not yet wired) ──
  getAiSettings(): Promise<AiSettings>
  setAiSettings(settings: AiSettings): Promise<void>
  aiChat(request: AiChatRequest): Promise<AiChatResponse>
  aiStream(request: AiStreamRequest): Promise<void>
  aiStreamCancel(requestId: string): Promise<void>
  onAiStream(handler: (chunk: AiStreamChunk) => void): () => void

  // ── Events (push from service to shell; shell forwards to webContents) ──
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
