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
   * NOT IMPLEMENTED in Phase 1 increment 1.
   *
   * The actual AI stream wiring (the docs-specific stream loop in
   * apps/docs/src/main/docs-main.ts registerAiIpc, lines 2496-2627) has NOT
   * been extracted yet. It has editor-specific concerns (system prompt
   * construction, tool registry, ai:stream-chunk push events) that require
   * generalization before they can move into a platform capability.
   *
   * Calling this method throws. The existing docs-main handler still owns
   * ai:stream until a later increment extracts it.
   */
  async stream(_request: AiStreamRequest): Promise<void> {
    throw new Error(
      'ElectronAI.stream not implemented in Phase 1 increment 1 — ' +
        'the existing registerAiIpc handler in apps/docs/src/main/docs-main.ts ' +
        'still owns this until the stream loop is generalized in a later increment.',
    )
  }

  async streamCancel(_requestId: string): Promise<void> {
    throw new Error(
      'ElectronAI.streamCancel not implemented in Phase 1 increment 1 — ' +
        'see ElectronAI.stream.',
    )
  }

  onStream(handler: (chunk: AiStreamChunk) => void): () => void {
    // The push subscription is wired (the existing docs-main handler emits
    // ai:stream-chunk events; the shell forwards them). For Phase 1 increment 1
    // we accept the handler but it won't be called by this capability —
    // the docs-main handler emits via webContents.send directly.
    this.streamHandlers.add(handler)
    return () => this.streamHandlers.delete(handler)
  }

  async chat(_request: AiChatRequest): Promise<AiChatResponse> {
    throw new Error(
      'ElectronAI.chat not implemented in Phase 1 increment 1 — ' +
        'the existing registerAiIpc handler in apps/docs/src/main/docs-main.ts ' +
        'still owns ai:chat.',
    )
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
    throw new Error(
      'ElectronAI.generateImage not implemented in Phase 1 increment 1 — ' +
        'the docs editor does not call generateImage; slides/pdf do, and they ' +
        'will be wired in their respective increments.',
    )
  }

  async analyzeMedia(_params: AnalyzeMediaParams): Promise<MediaAnalysis> {
    throw new Error(
      'ElectronAI.analyzeMedia not implemented in Phase 1 increment 1 — ' +
        'see ElectronAI.generateImage.',
    )
  }
}

/**
 * Helper for the Identity capability — loads the saved Genspark auth.
 * Re-exported here because both ElectronAI and ElectronIdentity need it.
 */
export { loadGenofficeAuth, startGenofficeLogin, genofficeLogout }
