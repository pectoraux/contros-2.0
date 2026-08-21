/**
 * Runtime-independent docs domain types.
 *
 * BOUNDARY CORRECTION (2026-08-21, contract direction):
 *   These types are defined HERE in @genoffice/runtime-contracts, NOT imported
 *   from @genoffice/docs-shared (which is a path alias to apps/docs/src/shared/ipc.ts).
 *   The runtime-independent layer must not depend on the app's shared contracts.
 *
 *   The types are structurally identical to the legacy types in
 *   apps/docs/src/shared/ipc.ts — the bridge performs type conversion
 *   between the legacy DesktopApi types and these runtime-independent types.
 *
 *   The legacy apps/docs/src/shared/ipc.ts types remain frozen and authoritative
 *   for the renderer-facing API. These types are authoritative for the
 *   runtime/domain-facing API.
 */

/** Result of opening a document — returned from DocumentService.open(). */
export interface DocumentOpenResult {
  path: string
  name: string
  /** raw docx bytes */
  data: ArrayBuffer
  /** sha256 of the original file; original archived under this hash */
  hash: string
}

/** Result of picking an image for insertion. */
export interface DocumentPickImageResult {
  /** raw image bytes, base64 encoded */
  base64: string
  mime: 'image/png' | 'image/jpeg' | 'image/gif'
  name: string
}

/** Metadata for a chat attachment file. */
export interface DocumentAttachmentMeta {
  /** absolute local path; the file never leaves the machine */
  path: string
  name: string
  /** lowercased extension without the dot */
  ext: string
  sizeBytes: number
}

/** Result of adding attachments (multi-select). */
export interface DocumentAttachmentAddResult {
  accepted: DocumentAttachmentMeta[]
  /** per-file rejection messages (too large / unsupported type / unreadable) */
  rejected: string[]
}

/** Result of reading an attachment's text content. */
export interface DocumentAttachmentReadResult {
  ok: boolean
  error?: string
  name?: string
  /** total characters of the extracted text */
  totalChars?: number
  /** requested slice */
  text?: string
  offset?: number
}

/** Result of reading an image attachment as base64 for multimodal input. */
export interface DocumentAttachmentImageResult {
  ok: boolean
  /** raw base64 (no data: URL prefix) */
  base64?: string
  mime?: string
  error?: string
}

/** An open docs tab, for View → Switch Tab. */
export interface DocumentTabInfo {
  id: string
  title: string
  focused: boolean
}

/**
 * Commands dispatched from the native application menu to the renderer.
 * Runtime-independent version of the MenuCommand type from apps/docs/src/shared/ipc.ts.
 */
export type DocumentMenuCommand =
  | 'new'
  | 'open'
  | 'open-path'
  | 'save'
  | 'save-as'
  | 'undo'
  | 'redo'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-100'
  | 'zoom-page-width'
  | 'zoom-whole-page'
  | 'toggle-ai'
  | 'toggle-dark'
  | 'insert-table'
  | 'insert-image'
  | 'insert-page-break'
  | 'insert-link'
  | 'insert-equation'
  | 'insert-comment'
  | 'font-dialog'
  | 'paragraph-dialog'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'align-left'
  | 'align-center'
  | 'align-right'
  | 'align-justify'
  | 'page-setup'
  | 'find'
  | 'print'
  | 'export-pdf'
  | 'word-count'
  | 'ai-proofread'
