/**
 * PdfService — domain runtime service for the PDF (`.pdf`) editor.
 *
 * Composes pdf.js + pdf-lib + PDFium WASM + HarfBuzz subset WASM with platform
 * capabilities. The bridge (createPdfApiBridge) maps the existing window.pdfApi
 * API to these methods.
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
  PdfApi,
  SavePdfRequest,
  SavePdfResult,
  ValidateTextEditsRequest,
  TextEditValidation,
  PageImageRef,
  StaticFormFillRecord,
  PagePreviewRequest,
  ExtractPagesRequest,
  ExtractPagesResult,
  InsertPdfRequest,
  InsertPdfResult,
  InsertBlankPageRequest,
  InsertBlankPageResult,
  SplitPdfRequest,
  SplitPdfResult,
  MergePdfRequest,
  MergePdfResult,
  MergePagesRequest,
  MergePagesResult,
  ReplacePagesRequest,
  ReplacePagesResult,
  SetPageSizeRequest,
  SetPageSizeResult,
  SplitPagesRequest,
  SplitPagesResult,
  CropPagesRequest,
  CropPagesResult,
  ExportImagesRequest,
  ExportImagesResult,
  ImageSearchResponse,
  SavedSignature,
  SignatureData,
  UiTheme,
} from '@genoffice/pdf-shared'

export interface PdfService {
  // ── File lifecycle ──────────────────────────────────────────────────
  /** Take the pdf path pending for this view; null if none. */
  consumePending(): Promise<string | null>
  /** Read pdf bytes. Only paths granted to this view are allowed. */
  readFile(path: string): Promise<ArrayBuffer>
  /** Write markups/form values/page ops back to the original file. */
  save(request: SavePdfRequest): Promise<SavePdfResult>

  // ── PDFium-backed operations ────────────────────────────────────────
  /** Dry-run match of pending text edits. */
  validateTextEdits(request: ValidateTextEditsRequest): Promise<TextEditValidation[]>
  /** EDIT_FONTS ids whose font file exists on this machine. */
  listEditFonts(): Promise<string[]>
  /** Enumerate the content-stream images of every page. */
  listPageImages(path: string): Promise<PageImageRef[]>
  /** Read GenOffice static-fill metadata stored inside the PDF. */
  listStaticFormFills(path: string): Promise<StaticFormFillRecord[]>
  /** Render one existing image object to PNG (base64) for ghost previews. */
  pageImagePng(request: {
    path: string
    pageIndex: number
    rect: [number, number, number, number]
    scale?: number
  }): Promise<string | null>
  /** Live-preview render of a page region with images removed. */
  pagePreviewPng(request: PagePreviewRequest): Promise<string | null>

  // ── Page operations ──────────────────────────────────────────────────
  extractPages(request: ExtractPagesRequest): Promise<ExtractPagesResult>
  insertPdf(request: InsertPdfRequest): Promise<InsertPdfResult>
  insertBlankPage(request: InsertBlankPageRequest): Promise<InsertBlankPageResult>
  splitPdf(request: SplitPdfRequest): Promise<SplitPdfResult>
  mergePdf(request: MergePdfRequest): Promise<MergePdfResult>
  mergePages(request: MergePagesRequest): Promise<MergePagesResult>
  replacePages(request: ReplacePagesRequest): Promise<ReplacePagesResult>
  setPageSize(request: SetPageSizeRequest): Promise<SetPageSizeResult>
  splitPages(request: SplitPagesRequest): Promise<SplitPagesResult>
  cropPages(request: CropPagesRequest): Promise<CropPagesResult>
  exportImages(request: ExportImagesRequest): Promise<ExportImagesResult>

  // ── AI image tools ──────────────────────────────────────────────────
  /** Web image search for AI tools. */
  imageSearch(query: string, maxResults?: number): Promise<ImageSearchResponse>
  /** Download an image URL (SSRF-guarded); null on failure. */
  fetchImage(url: string): Promise<{ base64: string; mime: string } | null>
  /** AI image generation via Genspark (gsk). */
  generateImage(op: { prompt: string; aspectRatio?: string }): Promise<{
    url?: string
    error?: string
  }>

  // ── Signatures ───────────────────────────────────────────────────────
  /** Saved signatures (persisted in userData), newest first. */
  listSavedSignatures(): Promise<SavedSignature[]>
  /** Persist a signature for reuse; returns the updated list. */
  addSavedSignature(data: SignatureData): Promise<SavedSignature[]>
  /** Delete one saved signature by id; returns the updated list. */
  removeSavedSignature(id: string): Promise<SavedSignature[]>

  // ── User info ────────────────────────────────────────────────────────
  /** OS account name (default author of new note comments); '' when unavailable. */
  getUsername(): Promise<string>

  // ── Close guard / save-as ───────────────────────────────────────────
  /** Mirror unsaved-changes state to the main process. */
  setDirty(dirty: boolean): void
  /** Main picked "Save" in the close prompt → renderer saves. */
  onCloseSaveRequest(handler: () => void): () => void
  sendCloseSaveResult(ok: boolean): void
  /** Shell menu Save As → renderer writes pending edits to targetPath only. */
  onSaveAsRequest(handler: (targetPath: string) => void): () => void
  sendSaveAsResult(ok: boolean): void
  /** True while the shell's Save As flow is open — renderer pauses autosave. */
  onSaveAsFlow(handler: (inFlight: boolean) => void): () => void
  /** Shell menu Print → renderer runs its print flow. */
  onPrintRequest(handler: () => void): () => void

  // ── Settings (pdf-specific — these could delegate to runtime.settings) ──
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
}

/** Convenience re-export of the full PdfApi for the bridge factory's return type. */
export type { PdfApi }
