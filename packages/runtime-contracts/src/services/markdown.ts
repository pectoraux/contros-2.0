/**
 * MarkdownService — domain runtime service for the markdown (`.md`) editor.
 *
 * Composes TipTap + @genoffice/docx-engine (for DOCX export) with platform
 * capabilities. The bridge (createMarkdownApiBridge) maps the existing
 * window.markdownApi API to these methods.
 *
 * IMPORTANT (ADR-001 Correction A): implementations receive their dependencies
 * via constructor injection. They MUST NOT call getRuntime() internally.
 */
import type { Lang } from '@genoffice/i18n'
import type {
  AiSettings,
  AiStreamRequest,
  AiStreamChunk,
} from '@genoffice/ai-provider'
import type {
  SaveMarkdownRequest,
  SaveMarkdownResult,
  SaveMode,
  ExportDocxRequest,
  ExportPdfRequest,
  ExportResult,
  ExportFormat,
  ImageData,
  WebSearchResult,
  UiTheme,
} from '@genoffice/markdown-shared'

export interface MarkdownService {
  // ── File lifecycle ──────────────────────────────────────────────────
  /** Take the md path pending for this view; null = new untitled document. */
  consumePending(): Promise<string | null>
  /** Read the file as UTF-8 text. Only granted paths are allowed. */
  readFile(path: string): Promise<string>
  /** Write the document text (atomic: tmp + rename). */
  save(request: SaveMarkdownRequest): Promise<SaveMarkdownResult>
  /** Mirror unsaved-changes state to the main process. */
  setDirty(dirty: boolean): void

  // ── Shell menu events ───────────────────────────────────────────────
  /** Shell menu Save / Save As → renderer serializes and calls save(). */
  onSaveRequest(handler: (mode: SaveMode) => void): () => void
  /** Resolve a menu-save waiter when doSave exits without invoking save(). */
  sendSaveRequestAck(ok: boolean): void
  /** Main picked "Save" in the close prompt → renderer saves. */
  onCloseSaveRequest(handler: () => void): () => void
  sendCloseSaveResult(ok: boolean): void
  /** File was renamed on disk → renderer syncs its display path. */
  onFileRenamed(handler: (newPath: string) => void): () => void

  // ── Images ───────────────────────────────────────────────────────────
  /** Pick an image file and copy into `assets/`; returns relative path or null. */
  pickImage(): Promise<string | null>
  /** Persist pasted/dropped image bytes into `assets/`; returns relative path. */
  saveImage(data: { base64: string; ext: string }): Promise<string | null>
  /** Read an image referenced by the document for DOCX embedding. */
  readImage(src: string): Promise<ImageData | null>

  // ── Export ───────────────────────────────────────────────────────────
  /** Shell menu export → renderer serializes and calls exportDocx/exportPdf. */
  onExportRequest(handler: (format: ExportFormat) => void): () => void
  /** Shell menu Print → renderer builds print HTML and opens system print. */
  onPrintRequest(handler: () => void): () => void
  /** Export to DOCX (via @genoffice/docx-engine, runs in renderer). */
  exportDocx(request: ExportDocxRequest): Promise<ExportResult>
  /** Export to PDF (hidden BrowserWindow → printToPDF). */
  exportPdf(request: ExportPdfRequest): Promise<ExportResult>

  // ── Settings (markdown-specific — these could delegate to runtime.settings) ──
  getLanguage(): Promise<Lang>
  onLanguageChanged(handler: (lang: Lang) => void): () => void
  getTheme(): Promise<UiTheme>
  onThemeChanged(handler: (theme: UiTheme) => void): () => void
  onChromePressed(handler: () => void): () => void

  // ── AI ──────────────────────────────────────────────────────────────
  getAiSettings(): Promise<AiSettings>
  aiStream(request: AiStreamRequest): Promise<void>
  aiStreamCancel(requestId: string): Promise<void>
  onAiStream(handler: (chunk: AiStreamChunk) => void): () => void
  /** Main-process web search (Serper/DuckDuckGo). */
  webSearch(query: string, maxResults?: number): Promise<WebSearchResult>
}
