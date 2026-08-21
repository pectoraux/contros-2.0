/**
 * ElectronAI — implements the AI capability using the @genoffice/ai-provider
 * + @genoffice/ai-search packages + @genoffice/electron-utils' fetchRemoteImage.
 *
 * Phase 1 increment 1: this is a STUB. The actual AI stream/chat wiring (docs-main
 * lines 2496-2627) stays in apps/docs/src/main/docs-main.ts because it has
 * editor-specific concerns (system prompt construction, tool registry,
 * ai:stream-chunk push events). The full extraction happens in a later
 * increment when the stream loop is generalized.
 *
 * For Phase 1 increment 1, the docs preload bridge calls runtime.ai.*
 * which delegates here — but the actual AI handler registration in docs-main
 * still runs and overrides these stubs via ipcMain.handle('ai:stream', ...).
 * The bridge calls ipcRenderer.invoke('ai:stream', ...) which goes to the
 * existing docs-main handler, NOT to this stub.
 *
 * This keeps behavior identical while the extraction is incremental.
 *
 * IMPORTANT (ADR-001 Correction A): constructor injection. No getRuntime().
 */
import { fetchRemoteImage } from '@genoffice/electron-utils'
import {
  webSearch,
  imageSearch,
  loadGenofficeAuth,
  startGenofficeLogin,
  genofficeLogout,
} from '@genoffice/ai-search'
import type {
  AI,
  AiSettings,
  AiStreamRequest,
  AiStreamChunk,
  AiChatRequest,
  AiChatResponse,
  WebSearchResult,
  ImageSearchResult,
  GenerateImageOp,
  GenerateImageResult,
  AnalyzeMediaParams,
  MediaAnalysis,
} from '@genoffice/platform'

export interface ElectronAIDeps {
  /** Path to userData directory (for ai-settings.json). */
  userDataDir: string
  /** Function to open a URL in the system browser (shell.openExternal). */
  openExternal: (url: string) => Promise<void>
}

export class ElectronAI implements AI {
  private streamHandlers = new Set<(chunk: AiStreamChunk) => void>()

  constructor(private readonly deps: ElectronAIDeps) {}

  async getSettings(): Promise<AiSettings> {
    try {
      const fs = await import('node:fs')
      const raw = fs.readFileSync(`${this.deps.userDataDir}/ai-settings.json`, 'utf8')
      return JSON.parse(raw) as AiSettings
    } catch {
      // Default: Genspark provider
      return { provider: 'genspark' } as AiSettings
    }
  }

  async setSettings(settings: AiSettings): Promise<void> {
    const fs = await import('node:fs')
    const fsp = await import('node:fs/promises')
    await fsp.mkdir(this.deps.userDataDir, { recursive: true })
    fs.writeFileSync(
      `${this.deps.userDataDir}/ai-settings.json`,
      JSON.stringify(settings, null, 2),
      'utf8',
    )
  }

  /**
   * Phase 1 increment 1 STUB. The actual AI stream wiring stays in
   * apps/docs/src/main/docs-main.ts (registerAiIpc). The bridge calls
   * ipcRenderer.invoke('ai:stream', ...) which goes to the existing
   * docs-main handler. This stub exists for API completeness.
   */
  async stream(_request: AiStreamRequest): Promise<void> {
    // No-op — docs-main still owns this for Phase 1 increment 1.
  }

  async streamCancel(_requestId: string): Promise<void> {
    // No-op — docs-main still owns this for Phase 1 increment 1.
  }

  onStream(handler: (chunk: AiStreamChunk) => void): () => void {
    this.streamHandlers.add(handler)
    return () => this.streamHandlers.delete(handler)
  }

  async chat(_request: AiChatRequest): Promise<AiChatResponse> {
    // Phase 1 increment 1: docs-main still owns ai:chat.
    return {} as AiChatResponse
  }

  async webSearch(query: string, maxResults?: number): Promise<WebSearchResult> {
    const result = await webSearch(query, maxResults)
    return result as WebSearchResult
  }

  async imageSearch(query: string, maxResults?: number): Promise<ImageSearchResult> {
    const result = await imageSearch(query, maxResults)
    return result as ImageSearchResult
  }

  async fetchImage(url: string): Promise<{ base64: string; mime: string } | null> {
    const resp = await fetchRemoteImage(url)
    if (!resp) return null
    const buf = Buffer.from(await resp.arrayBuffer())
    const mime = resp.headers.get('content-type') ?? 'image/png'
    return { base64: buf.toString('base64'), mime }
  }

  async generateImage(_op: GenerateImageOp): Promise<GenerateImageResult> {
    // Phase 1 increment 1 STUB — docs editor doesn't call generateImage.
    return { error: 'generateImage not yet wired in Phase 1 increment 1' }
  }

  async analyzeMedia(_params: AnalyzeMediaParams): Promise<MediaAnalysis> {
    return { error: 'analyzeMedia not yet wired in Phase 1 increment 1' }
  }
}

/**
 * Helper for the Identity capability — loads the saved Genspark auth.
 * Re-exported here because both ElectronAI and ElectronIdentity need it.
 */
export { loadGenofficeAuth, startGenofficeLogin, genofficeLogout }
