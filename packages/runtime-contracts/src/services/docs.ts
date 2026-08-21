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
 *
 * DIALOG PURITY (Increment 2F):
 *   This service is DOMAIN-ONLY — it must NOT know that file-picker dialogs
 *   exist. The shell (DocsShellCoordinator) is responsible for:
 *     1. Resolving the caller-specific dialog parent (BrowserWindow | null)
 *        from the IPC event.sender.
 *     2. Calling the Files capability's pickOpen/pickSave with that parent.
 *     3. Passing the SELECTED PATH(S) into the domain service.
 *
 *   The service receives already-resolved inputs:
 *     - open(path) — path already chosen by the shell's pickOpen
 *     - saveAs(session, selectedPath, data) — path already chosen by pickSave
 *     - readImage(path) / readAttachments(paths) — paths already chosen
 *
 *   No `parent`, `DialogParent`, `BrowserWindow`, or window handle of any
 *   kind appears in this interface. The service is pure domain.
 *
 * ARCHITECTURE (frozen):
 *   runtime-contracts MUST NOT depend on @genoffice/platform. The previous
 *   Increment 2E violated this by importing `DialogParent` from platform.
 *   Increment 2F removes that import entirely.
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
  // NOTE: there is NO openDialog() method. The shell (DocsShellCoordinator)
  // owns the file-picker dialog: it calls Files.pickOpen(parent, opts) to
  // resolve a path, then calls open(path) here. The service never knows
  // a dialog existed.
  open(path: string): Promise<{ session: DocumentSession; result: DocumentOpenResult } | null>

  // ── Save (persistence only — renderer produces the bytes) ──────────
  save(
    session: DocumentSession,
    data: Uint8Array,
    auto?: boolean,
  ): Promise<{ ok: boolean; error?: string; reason?: 'external-modified'; session?: DocumentSession }>
  /**
   * Save to an already-resolved path. The shell (DocsShellCoordinator)
   * runs the "Save As" file-picker dialog and passes the selected path
   * here. The service does NOT do any dialog — it just persists.
   */
  saveAs(
    session: DocumentSession,
    selectedPath: string,
    data: Uint8Array,
  ): Promise<{ ok: boolean; path?: string; error?: string; session?: DocumentSession }>
  saveNew(
    defaultName: string,
    data: Uint8Array,
  ): Promise<{ ok: boolean; path?: string; error?: string; session?: DocumentSession }>
  writeRecovery(session: DocumentSession, data: Uint8Array): Promise<{ ok: boolean }>
  recentFiles(): Promise<string[]>

  // ── Images & attachments ─────────────────────────────────────────────
  // NOTE: there are no pickImage()/pickAttachments() methods that take a
  // dialog parent. The shell runs the file-picker and passes the selected
  // path(s) here:
  //   - readImage(path) — read an already-picked image file as base64
  //   - collectAttachments(paths) — validate already-picked attachment paths
  readImage(path: string): Promise<DocumentPickImageResult | null>
  collectAttachments(paths: string[]): Promise<DocumentAttachmentAddResult>
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
  // NOTE: exportPdf/saveMergedPdf accept an already-resolved outPath OR
  // undefined (meaning "the shell will pick a path"). When outPath is
  // undefined, the shell (coordinator) MUST call Files.pickSave(parent)
  // first and pass the result. The service itself NEVER calls a dialog.
  print(): Promise<{ ok: boolean; error?: string }>
  exportPdf(
    outPath: string,
    pageWidthTwips: number,
    pageHeightTwips: number,
  ): Promise<{ ok: boolean; path?: string; error?: string }>
  printPdfBuffer(
    pageWidthTwips: number,
    pageHeightTwips: number,
  ): Promise<{ ok: boolean; base64?: string; error?: string }>
  saveMergedPdf(
    outPath: string,
    base64Parts: string[],
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
