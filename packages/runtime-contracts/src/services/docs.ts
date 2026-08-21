/**
 * DocumentService — domain runtime service for the docs (`.docx`) editor.
 *
 * Composes @genoffice/docx-engine with platform capabilities (Storage, Files,
 * AI, Printing) to deliver docs product capabilities. The bridge
 * (createDocsDesktopBridge) maps the existing window.desktop API to these
 * methods, performing ArrayBuffer → Uint8Array conversion where needed.
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
  DocsTabInfo,
  MenuCommand,
} from '@genoffice/docs-shared'

export interface DocumentService {
  // ── File lifecycle ───────────────────────────────────────────────────
  /** Show the open-file dialog and open the chosen file; null when canceled. */
  openDialog(): Promise<OpenFileResult | null>
  /** Open a file by absolute path (Finder/Explorer drop or queued at launch). */
  open(path: string): Promise<OpenFileResult | null>
  /** Consume a file queued at tab creation; null when none pending. */
  consumePendingOpen(): Promise<OpenFileResult | null>
  /** Returns true once when this tab was opened via "New Document". */
  consumeNewBlank(): Promise<boolean>

  // ── Save (byte-preserving) ───────────────────────────────────────────
  /**
   * Save the document bytes. auto=true marks an autosave (an externally
   * modified file then fails with reason 'external-modified' instead of
   * prompting).
   */
  save(
    path: string,
    data: Uint8Array,
    auto?: boolean,
  ): Promise<{ ok: boolean; error?: string; reason?: 'external-modified' }>
  /** Save-as: show the save dialog and write to the chosen path. */
  saveAs(
    defaultName: string,
    data: Uint8Array,
  ): Promise<{ ok: boolean; path?: string; error?: string }>
  /** First save of a new document: silently write into the default folder. */
  saveNew(
    defaultName: string,
    data: Uint8Array,
  ): Promise<{ ok: boolean; path?: string; error?: string }>
  /** Crash-recovery copy of a dirty document, stored under userData. */
  writeRecovery(path: string, data: Uint8Array): Promise<{ ok: boolean }>
  /** Recent files list (paths). */
  recentFiles(): Promise<string[]>

  // ── Images & attachments ─────────────────────────────────────────────
  /** Show the image picker (png/jpg/jpeg/gif); null when canceled. */
  pickImage(): Promise<PickImageResult | null>
  /** Multi-select file dialog for chat attachments. */
  pickAttachments(): Promise<AttachmentAddResult | null>
  /** Validate dropped paths and return attachment metadata. */
  addAttachmentPaths(paths: string[]): Promise<AttachmentAddResult>
  /** Persist a pasted clipboard image to a temp file and add as attachment. */
  addPastedImage(data: ArrayBuffer, ext: string): Promise<AttachmentAddResult>
  /** Read one slice of an attachment's extracted text. */
  readAttachment(
    path: string,
    offset: number,
    maxChars: number,
  ): Promise<AttachmentReadResult>
  /** Read an image attachment as base64 for multimodal input (≤5MB). */
  readAttachmentImage(path: string): Promise<AttachmentImageResult>

  // ── Fonts ────────────────────────────────────────────────────────────
  /** Vertical metrics of an installed family (exact name match); null when missing. */
  fontMetrics(family: string): Promise<FaceVerticalMetrics | null>

  // ── Print & export ───────────────────────────────────────────────────
  /** System print dialog for the current window. */
  print(): Promise<{ ok: boolean; error?: string }>
  /** Render the document to PDF and ask where to save. */
  exportPdf(
    defaultName: string,
    pageWidthTwips: number,
    pageHeightTwips: number,
    outPath?: string,
  ): Promise<{ ok: boolean; path?: string; error?: string }>
  /** Mixed paper-size export: produce one PDF bytes blob at the given size. */
  printPdfBuffer(
    pageWidthTwips: number,
    pageHeightTwips: number,
  ): Promise<{ ok: boolean; base64?: string; error?: string }>
  /** Merge grouped PDF fragments in order and write to disk. */
  saveMergedPdf(
    defaultName: string,
    base64Parts: string[],
    outPath?: string,
  ): Promise<{ ok: boolean; path?: string; error?: string }>

  // ── Tab management (docs-specific) ──────────────────────────────────
  /** View → New Tab: open another docs tab, optionally loading the same document. */
  openNewTab(openPath?: string | null): Promise<void>
  /** All open docs tabs, for View → Switch Tab. */
  listDocsTabs(): Promise<DocsTabInfo[]>
  /** Focus a docs tab by id. */
  focusDocsTab(id: string): Promise<void>

  // ── AI (docs-specific — provider settings are in runtime.ai) ────────
  /** Read AI provider settings (cached locally for the docs editor). */
  getAiSettings(): Promise<AiSettings>
  /** Persist AI provider settings. */
  setAiSettings(settings: AiSettings): Promise<void>
  /** One-shot AI chat (no tools). */
  aiChat(request: AiChatRequest): Promise<AiChatResponse>
  /** Start a streaming AI call; deltas arrive via onAiStream. */
  aiStream(request: AiStreamRequest): Promise<void>
  /** Cancel an in-flight stream. */
  aiStreamCancel(requestId: string): Promise<void>
  /** Subscribe to AI stream chunks. */
  onAiStream(handler: (chunk: AiStreamChunk) => void): () => void

  // ── Events (push from service to renderer) ──────────────────────────
  /** A document was opened while the app is running. */
  onOpened(handler: (result: OpenFileResult) => void): () => void
  /** File was renamed externally (shell Home list rename). */
  onRenamed(handler: (paths: { oldPath: string; newPath: string }) => void): () => void
  /** Tab closed but webContents kept alive (shell freeze workaround). */
  onTeardown(handler: () => void): () => void
  /** Native menu command dispatched to the renderer. */
  onMenuCommand(handler: (command: MenuCommand, payload?: string) => void): () => void

  // ── Close guard ──────────────────────────────────────────────────────
  /** Main process queries pre-close state (dirty flag + autosave switch). */
  onCloseCheck(handler: () => void): () => void
  /** Renderer replies with its close-check state. */
  reportCloseCheck(state: { dirty: boolean; autoSave: boolean; filePath?: string | null }): void
  /** Close guard chose "Save": main asks the renderer to run the full save flow. */
  onCloseSaveRequest(handler: () => void): () => void
  /** Renderer reports the close-save outcome. */
  reportCloseSaveResult(ok: boolean): void
  /** Keep the native View menu's checkbox items in sync with renderer state. */
  reportViewMenuState(state: { aiSidebar: boolean; darkCanvas: boolean }): void
}
