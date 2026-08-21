/**
 * DocsIpcContract — the typed IPC channel map for the Docs application.
 *
 * This is the authoritative typed encoding of the IPC contract between the
 * Docs renderer (via the preload bridge) and the Docs main process.
 *
 * The channel names and payload shapes are sourced from the frozen preload
 * (apps/docs/src/preload/index.ts) and the frozen shared contract
 * (apps/docs/src/shared/ipc.ts). This file does NOT modify either — it
 * only types them for compile-time safety in the renderer-bridge package.
 *
 * Architecture:
 *
 *   Renderer (window.desktop)
 *       ↓
 *   DesktopApi (bridge — typed methods)
 *       ↓
 *   TypedIpcTransport.invoke('docs:open') — type-checked channel + args + return
 *       ↓
 *   [Electron: ipcRenderer.invoke('docs:open')]
 *       ↓
 *   ipcMain handler
 *
 * Each channel maps to:
 *   - Args: the argument tuple (what the renderer passes to invoke/send)
 *   - Return: the return type (for invoke) or the event payload (for on)
 *
 * The transport methods are generic over the channel name, so TypeScript
 * infers the exact args tuple and return type — NO casts needed.
 */

// ── Type helpers ────────────────────────────────────────────────────────

/**
 * A request channel: invoke(channel, ...args) → Promise<Return>.
 * `Args` is the argument tuple; `Return` is the resolved value.
 */
export interface IpcRequestChannel {
  Args: unknown[]
  Return: unknown
}

/**
 * A send channel: send(channel, ...args) → void. Fire-and-forget.
 * `Args` is the argument tuple.
 */
export interface IpcSendChannel {
  Args: unknown[]
}

/**
 * A push-event channel: on(channel, listener) — the listener receives
 * the event payload. `Payload` is the payload tuple (what the main
 * process sends via wc.send(channel, ...payload)).
 */
export interface IpcEventChannel {
  Payload: unknown[]
}

// ── Docs IPC channel map ────────────────────────────────────────────────
//
// Each channel is typed to match the frozen preload's
// ipcRenderer.invoke/send/on call. The bridge uses these to compile-check
// every IPC call — NO `as never` / `as any` / `as unknown as` casts.

import type {
  OpenFileResult,
  PickImageResult,
  UiTheme,
  MenuCommand,
  DocsTabInfo,
  AttachmentAddResult,
  AttachmentReadResult,
  AttachmentImageResult,
} from '@genoffice/docs-shared'
import type {
  AiSettings,
  AiChatRequest,
  AiChatResponse,
  AiStreamRequest,
  AiStreamChunk,
  GenSparkAccountStatus,
} from '@genoffice/ai-provider'
import type { FaceVerticalMetrics } from '@genoffice/font-metrics'

// Re-export the language type for convenience (the DesktopApi uses a literal
// union that's duplicated in the shared contract).
type UiLanguage = 'zh' | 'en' | 'ja' | 'ko' | 'fr' | 'de' | 'es' | 'th' | 'id' | 'ru' | 'ar'

/** Save result shape (from DesktopApi.saveDocx). */
interface SaveResult {
  ok: boolean
  error?: string
  reason?: 'external-modified'
}
/** Save-as / save-new result shape (from DesktopApi.saveDocxAs/saveDocxNew). */
interface SaveAsResult {
  ok: boolean
  path?: string
  error?: string
}
/** Print result shape (from DesktopApi.print). */
interface PrintResult {
  ok: boolean
  error?: string
}
/** Export-PDF result shape (from DesktopApi.exportPdf). */
interface ExportPdfResult {
  ok: boolean
  path?: string
  error?: string
}
/** Print-to-buffer result shape (from DesktopApi.printPdfBuffer). */
interface PrintPdfBufferResult {
  ok: boolean
  base64?: string
  error?: string
}
/** Web-search result shape (from DesktopApi.webSearch). */
interface WebSearchResult {
  results: Array<{ title: string; url: string; snippet: string }>
  answer?: string
  method: string
  error?: string
}
/** Image-search result shape (from DesktopApi.imageSearch). */
interface ImageSearchResult {
  images: Array<{
    title: string
    imageUrl: string
    sourceUrl: string
    source: string
    width?: number
    height?: number
  }>
  method: string
  error?: string
}
/** Fetch-image result shape (from DesktopApi.fetchImage). */
interface FetchImageResult {
  base64: string
  mime: string
}

/**
 * The Docs IPC request channels (invoke → Promise<Return>).
 *
 * Each key is a channel name; the value encodes the argument tuple and
 * the return type, matching the frozen preload exactly.
 *
 * NOTE: this is a `type` alias (not an `interface`) so it satisfies the
 * `Record<string, ...>` constraint on TypedIpcTransport. Interfaces in
 * TypeScript don't have implicit index signatures, so they can't be used
 * as generic constraints for Record<string, ...>.
 */
export type DocsIpcRequestChannels = {
  // ── Settings ──
  'app:get-language': { Args: []; Return: UiLanguage }
  'app:get-theme': { Args: []; Return: UiTheme }
  // ── File lifecycle ──
  'docs:open': { Args: []; Return: OpenFileResult | null }
  'docs:open-path': { Args: [path: string]; Return: OpenFileResult | null }
  'docs:consume-pending-open': { Args: []; Return: OpenFileResult | null }
  'docs:consume-new-blank': { Args: []; Return: boolean }
  // ── Save ──
  'docs:save': {
    Args: [path: string, data: ArrayBuffer, auto: boolean]
    Return: SaveResult
  }
  'docs:write-recovery': {
    Args: [path: string, data: ArrayBuffer]
    Return: { ok: boolean }
  }
  'docs:save-as': {
    Args: [defaultName: string, data: ArrayBuffer]
    Return: SaveAsResult
  }
  'docs:save-new': {
    Args: [defaultName: string, data: ArrayBuffer]
    Return: SaveAsResult
  }
  // ── Domain operations ──
  'docs:recent': { Args: []; Return: string[] }
  'docs:pick-image': { Args: []; Return: PickImageResult | null }
  'docs:font-metrics': { Args: [family: string]; Return: FaceVerticalMetrics | null }
  'docs:print': { Args: []; Return: PrintResult }
  'docs:export-pdf': {
    Args: [defaultName: string, pageWidthTwips: number, pageHeightTwips: number, outPath: string | undefined]
    Return: ExportPdfResult
  }
  'docs:print-pdf-buffer': {
    Args: [pageWidthTwips: number, pageHeightTwips: number]
    Return: PrintPdfBufferResult
  }
  'docs:save-merged-pdf': {
    Args: [defaultName: string, base64Parts: string[], outPath: string | undefined]
    Return: ExportPdfResult
  }
  // ── Files ──
  'files:pick': { Args: []; Return: AttachmentAddResult | null }
  'files:add': { Args: [paths: string[]]; Return: AttachmentAddResult }
  'files:add-pasted-image': {
    Args: [data: ArrayBuffer, ext: string]
    Return: AttachmentAddResult
  }
  'files:read': {
    Args: [path: string, offset: number, maxChars: number]
    Return: AttachmentReadResult
  }
  'files:read-image': { Args: [path: string]; Return: AttachmentImageResult }
  // ── AI ──
  'ai:get-settings': { Args: []; Return: AiSettings }
  'ai:set-settings': { Args: [settings: AiSettings]; Return: void }
  'ai:chat': { Args: [request: AiChatRequest]; Return: AiChatResponse }
  'ai:stream': { Args: [request: AiStreamRequest]; Return: void }
  'ai:stream-cancel': { Args: [requestId: string]; Return: void }
  'ai:gsk-status': { Args: [withEmail: boolean | undefined]; Return: GenSparkAccountStatus }
  'ai:gsk-login': { Args: []; Return: void }
  'ai:web-search': {
    Args: [query: string, maxResults: number | undefined]
    Return: WebSearchResult
  }
  'ai:image-search': {
    Args: [query: string, maxResults: number | undefined]
    Return: ImageSearchResult
  }
  'ai:fetch-image': { Args: [url: string]; Return: FetchImageResult | null }
  // ── Tab management ──
  'win:new': { Args: [openPath: string | null]; Return: void }
  'win:list': { Args: []; Return: DocsTabInfo[] }
  'win:focus': { Args: [id: string]; Return: void }
}

/**
 * The Docs IPC send channels (send → void). Fire-and-forget.
 */
export type DocsIpcSendChannels = {
  'docs:view-menu-state': { Args: [{ aiSidebar: boolean; darkCanvas: boolean }] }
  'docs:close-check-result': {
    Args: [{ dirty: boolean; autoSave: boolean; filePath: string | null }]
  }
  'docs:close-save-result': { Args: [ok: boolean] }
}

/**
 * The Docs IPC push-event channels (on → listener receives Payload).
 *
 * The payload tuple matches what the main process sends via wc.send(channel, ...payload).
 */
export type DocsIpcEventChannels = {
  'app:language-changed': { Payload: [lang: UiLanguage] }
  'app:theme-changed': { Payload: [theme: UiTheme] }
  'app:chrome-pressed': { Payload: [] }
  'docs:opened': { Payload: [result: OpenFileResult] }
  'docs:renamed': { Payload: [paths: { oldPath: string; newPath: string }] }
  'docs:teardown': { Payload: [] }
  'ai:stream-chunk': { Payload: [chunk: AiStreamChunk] }
  'menu:command': { Payload: [command: MenuCommand, payload: string | undefined] }
  'docs:close-check': { Payload: [] }
  'docs:close-save-request': { Payload: [] }
}
