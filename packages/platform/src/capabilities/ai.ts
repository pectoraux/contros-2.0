/**
 * AI capability — model routing, streaming, web/image search, image generation/analysis.
 *
 * Electron: net.fetch in main process + gsk CLI for cloud tools.
 * Web: HTTP/SSE to backend proxy that holds the Genspark key + does SSRF guards.
 */
import type {
  AiSettings,
  AiStreamRequest,
  AiStreamChunk,
  AiChatRequest,
  AiChatResponse,
} from '../types.js'

/** Web search result (Serper/DuckDuckGo). */
export interface WebSearchResult {
  results: Array<{ title: string; url: string; snippet: string }>
  answer?: string
  /** Method used ('serper' | 'duckduckgo' | 'error') */
  method: string
  /** Failure reason when method === 'error' */
  error?: string
}

/** Image search result. */
export interface ImageSearchResult {
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

/** AI image generation request. */
export interface GenerateImageOp {
  prompt: string
  model?: string
  referenceImageUrls?: string[]
  aspectRatio?: string
  imageSize?: string
}

/** AI image generation result. */
export interface GenerateImageResult {
  url?: string
  error?: string
}

/** AI media analysis request. */
export interface AnalyzeMediaParams {
  mediaUrls: string[]
  requirements: string
}

/** AI media analysis result. */
export interface MediaAnalysis {
  text?: string
  error?: string
}

export interface AI {
  /** Read AI provider settings (provider, model, key, etc.). */
  getSettings(): Promise<AiSettings>
  /** Persist AI provider settings. */
  setSettings(settings: AiSettings): Promise<void>
  /** Start a streaming AI call; deltas arrive via onStream with the same requestId. */
  stream(request: AiStreamRequest): Promise<void>
  /** Cancel an in-flight stream. */
  streamCancel(requestId: string): Promise<void>
  /** Subscribe to stream chunks. */
  onStream(handler: (chunk: AiStreamChunk) => void): () => void
  /** One-shot AI chat (no tools). */
  chat(request: AiChatRequest): Promise<AiChatResponse>
  /** Web search (Serper + DuckDuckGo fallback). */
  webSearch(query: string, maxResults?: number): Promise<WebSearchResult>
  /** Image search. */
  imageSearch(query: string, maxResults?: number): Promise<ImageSearchResult>
  /** Download an image URL (SSRF-guarded); null on failure. */
  fetchImage(url: string): Promise<{ base64: string; mime: string } | null>
  /** AI image generation (Genspark gsk). */
  generateImage(op: GenerateImageOp): Promise<GenerateImageResult>
  /** AI media analysis (Genspark gsk). */
  analyzeMedia(params: AnalyzeMediaParams): Promise<MediaAnalysis>
}
