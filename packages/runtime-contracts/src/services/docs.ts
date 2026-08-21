/**
 * DocumentService — domain runtime service for the docs (`.docx`) editor.
 *
 * BOUNDARY CORRECTION (2026-08-21, contract direction):
 *   This interface uses runtime-independent types defined in
 *   @genoffice/runtime-contracts/src/types/docs.ts — NOT imported from
 *   @genoffice/docs-shared (which is a path alias to apps/docs/src/shared/ipc.ts).
 *   The runtime-independent layer must not depend on the app's shared contracts.
 *
 *   Tab/window operations and pending-open/new-blank state are NOT in this
 *   interface — they belong in the DocsShellCoordinator (shell orchestration).
 *
 * SESSION-SCOPED: open() returns { session, result }; save() accepts the
 * session. The shell (via DocsShellCoordinator) owns the session registry.
 *
 * PERSISTENCE vs TRANSFORMATION: this service handles PERSISTENCE only.
 * The byte-preserving DOCX TRANSFORMATION remains in the renderer.
 *
 * IMPORTANT (ADR-001 Correction A): constructor injection. No getRuntime().
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
  DocumentOpenResult,
  DocumentPickImageResult,
  DocumentAttachmentAddResult,
  DocumentAttachmentReadResult,
  DocumentAttachmentImageResult,
} from '../types/docs.js'

/**
 * Per-document session. Returned from open() and accepted by save() etc.
 * The shell (via DocsShellCoordinator) holds the registry keyed by file path.
 */
export interface DocumentSession {
  readonly filePath: string
  readonly hash: string
  diskState?: { mtimeMs: number; size: number; hash: string }
}

export interface DocumentService {
  // ── File lifecycle (session-scoped) ─────────────────────────────────
  openDialog(): Promise<{ session: DocumentSession; result: DocumentOpenResult } | null>
  open(path: string): Promise<{ session: DocumentSession; result: DocumentOpenResult } | null>

  // ── Save (persistence only — renderer produces the bytes) ──────────
  save(
    session: DocumentSession,
    data: Uint8Array,
    auto?: boolean,
  ): Promise<{ ok: boolean; error?: string; reason?: 'external-modified'; session?: DocumentSession }>
  saveAs(
    session: DocumentSession,
    defaultName: string,
    data: Uint8Array,
  ): Promise<{ ok: boolean; path?: string; error?: string; session?: DocumentSession }>
  saveNew(
    defaultName: string,
    data: Uint8Array,
  ): Promise<{ ok: boolean; path?: string; error?: string; session?: DocumentSession }>
  writeRecovery(session: DocumentSession, data: Uint8Array): Promise<{ ok: boolean }>
  recentFiles(): Promise<string[]>

  // ── Images & attachments ─────────────────────────────────────────────
  pickImage(): Promise<DocumentPickImageResult | null>
  pickAttachments(): Promise<DocumentAttachmentAddResult | null>
  addAttachmentPaths(paths: string[]): Promise<DocumentAttachmentAddResult>
  addPastedImage(data: ArrayBuffer, ext: string): Promise<DocumentAttachmentAddResult>
  readAttachment(
    path: string,
    offset: number,
    maxChars: number,
  ): Promise<DocumentAttachmentReadResult>
  readAttachmentImage(path: string): Promise<DocumentAttachmentImageResult>

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
  onOpened(handler: (result: DocumentOpenResult) => void): () => void
  onRenamed(handler: (paths: { oldPath: string; newPath: string }) => void): () => void
  onTeardown(handler: () => void): () => void
}
