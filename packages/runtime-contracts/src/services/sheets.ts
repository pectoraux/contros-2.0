/**
 * SpreadsheetService — domain runtime service for the sheets (`.xlsx`) editor.
 *
 * Composes the in-house xlsx gateway + Rust/WASM engine + Univer glue with
 * platform capabilities. The bridge (createSheetsDesktopApiBridge) maps the
 * existing window.desktopApi API to these methods.
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
  GenSparkAccountStatus,
} from '@genoffice/ai-provider'
import type {
  WorkbookFile,
  WorkbookRangeRequest,
  WorkbookRangeResult,
  WorkbookFormulaCellsRequest,
  WorkbookFormulaCellsResult,
  WorkbookRecalcRequest,
  WorkbookRecalcResult,
  WorkbookMediaRequest,
  WorkbookMediaResult,
  WorkbookPivotRequest,
  WorkbookPivotDefinition,
  LocalImageRequest,
  LocalImageResult,
  ScreenSourcesResult,
  ScreenCaptureRequest,
  ScreenCaptureResult,
  WorkbookSaveRequest,
  WorkbookSaveResult,
  WorkbookExportPdfRequest,
  WorkbookExportPdfResult,
  MenuAction,
  WebSearchResult,
  ImageSearchResponse,
  GenerateImageResult,
  AttachmentAddResult,
  AttachmentReadResult,
  AttachmentImageResult,
} from '@genoffice/sheets-shared'

export interface SpreadsheetService {
  // ── Workbook lifecycle ──────────────────────────────────────────────
  /** Show the open-file dialog and open the chosen workbook; null when canceled. */
  selectWorkbook(): Promise<WorkbookFile | null>
  /** Read a range of cells from a sheet. */
  readWorkbookRange(request: WorkbookRangeRequest): Promise<WorkbookRangeResult>
  /** Read all formula cells of a sheet. */
  readWorkbookFormulas(request: WorkbookFormulaCellsRequest): Promise<WorkbookFormulaCellsResult>
  /** Recalculate formulas (IronCalc-backed). */
  recalcWorkbook(request: WorkbookRecalcRequest): Promise<WorkbookRecalcResult>
  /** Read an embedded image's bytes. */
  readWorkbookMedia(request: WorkbookMediaRequest): Promise<WorkbookMediaResult>
  /** Read a pivot cache/table definition. */
  readPivotDefinition(request: WorkbookPivotRequest): Promise<WorkbookPivotDefinition>
  /** Read a local image by path (for sheet screenshots etc.). */
  readLocalImage(request: LocalImageRequest): Promise<LocalImageResult>

  // ── Screen capture (sheets screenshot picker) ──────────────────────
  /** Enumerate capturable windows/screens. */
  captureScreenSources(): Promise<ScreenSourcesResult>
  /** Capture one source at full resolution; null when the source vanished. */
  captureScreenSource(request: ScreenCaptureRequest): Promise<ScreenCaptureResult | null>

  // ── Save (byte-preserving via streaming sidecar) ────────────────────
  /** Save workbook edits (streaming, byte-preserving). */
  saveWorkbookEdits(request: WorkbookSaveRequest): Promise<WorkbookSaveResult>
  /** Crash-recovery copy of the pending edits. */
  writeWorkbookRecovery(request: WorkbookSaveRequest): Promise<{ ok: boolean }>
  /** Rename a still-untitled workbook after AI-generated content. */
  autoRenameWorkbook(
    sessionId: string,
    baseName: string,
  ): Promise<{ renamed: boolean; name?: string }>
  /** Export to PDF (hidden BrowserWindow → printToPDF). */
  exportPdf(request: WorkbookExportPdfRequest): Promise<WorkbookExportPdfResult>
  /** Close a sidecar session. */
  closeWorkbook(sessionId: string): Promise<void>

  // ── Shell events ────────────────────────────────────────────────────
  /** Application-menu File commands (Open/Save/Save As/Export PDF/Undo/Redo). */
  onMenuAction(callback: (action: MenuAction) => void): () => void
  /** The open workbook was renamed on disk. */
  onWorkbookRenamed(callback: (newName: string) => void): () => void
  /** Mirror pending-edit count to the main process (drives the close guard). */
  notifyPendingEdits(count: number): void
  /** Main asks the renderer to save before closing. */
  onCloseSaveRequest(callback: () => void): () => void
  /** Renderer reports the close-save outcome. */
  reportCloseSaveResult(ok: boolean): void
  /** Returns true once when this tab was opened via "New Spreadsheet". */
  consumeNewBlankWorkbook(): Promise<boolean>
  /** Is a shell-queued workbook path still waiting to be opened? */
  hasQueuedWorkbook(): Promise<boolean>

  // ── AI ──────────────────────────────────────────────────────────────
  getAiSettings(): Promise<AiSettings>
  setAiSettings(settings: AiSettings): Promise<void>
  aiChat(request: AiChatRequest): Promise<AiChatResponse>
  aiStream(request: AiStreamRequest): Promise<void>
  aiStreamCancel(requestId: string): Promise<void>
  /** Genspark account status (gsk login state). */
  aiGskStatus(withEmail?: boolean): Promise<GenSparkAccountStatus>
  /** Open the browser to sign in to Genspark. */
  aiGskLogin(): Promise<void>
  /** Web search (main-process Serper/DuckDuckGo). */
  webSearch(query: string, maxResults?: number): Promise<WebSearchResult>
  /** Image search. */
  imageSearch(query: string, maxResults?: number): Promise<ImageSearchResponse>
  /** AI image generation via the Genspark account. */
  generateImage(op: { prompt: string; aspectRatio?: string }): Promise<GenerateImageResult>
  /** Download an image URL (SSRF-guarded); null on failure. */
  fetchImage(url: string): Promise<{ base64: string; mime: string } | null>
  /** Subscribe to AI stream chunks. */
  onAiStream(handler: (chunk: AiStreamChunk) => void): () => void

  // ── Chat attachments ─────────────────────────────────────────────────
  pickAttachments(): Promise<AttachmentAddResult | null>
  addAttachmentPaths(paths: string[]): Promise<AttachmentAddResult>
  addPastedImage(data: ArrayBuffer, ext: string): Promise<AttachmentAddResult>
  readAttachment(path: string, offset: number, maxChars: number): Promise<AttachmentReadResult>
  readAttachmentImage(path: string): Promise<AttachmentImageResult>

  // ── Filesystem passthrough ──────────────────────────────────────────
  /** Absolute path of a File dropped on the window (Electron webUtils). */
  getPathForFile(file: File): string

  // ── External links ──────────────────────────────────────────────────
  /** Open an external URL in the default browser (validated). */
  openExternal(url: string): Promise<void>
}
