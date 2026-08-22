/**
 * Sheets AI handlers — shell-owned AI IPC adapter.
 *
 * This module owns:
 *   - AI settings persistence (JSON file in userData)
 *   - GSK login/status (delegates to @genoffice/ai-search)
 *   - AI chat (delegates to @genoffice/ai-provider)
 *   - AI streaming with renderer-scoped tracking
 *   - Stream push routing (only to the initiating renderer's WebContents)
 *   - Web/image search (delegates to @genoffice/ai-search)
 *   - Image fetching with SSRF protection (delegates to @genoffice/electron-utils)
 *   - Image generation (delegates to @genoffice/ai-search)
 *
 * ARCHITECTURE:
 *   This is shell/application code — it uses @genoffice/ai-provider and
 *   @genoffice/ai-search directly. The existing AI platform capability
 *   (packages/platform) is a stub — its stream/chat methods throw. The
 *   full extraction of AI streaming into the platform capability is a
 *   future increment. For now, the shell owns the AI handler logic.
 *
 * RENDERER-SCOPED STREAM TRACKING:
 *   Stream state is tracked per-renderer:
 *     Map<wcId, Map<requestId, AbortController>>
 *   This ensures:
 *     - Renderer A's streams don't interfere with Renderer B's
 *     - Renderer A's cancel doesn't affect Renderer B
 *     - When a renderer is destroyed, only its streams are aborted
 *
 * ZERO global mutable state except the stream map (which is per-renderer).
 * ZERO type assertions.
 */

import { ipcMain, app, shell, type WebContents } from 'electron'
import { z } from 'zod'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { IPC_CHANNELS } from '../shared/ipc-channels'
import {
  aiSettingsInputSchema,
  aiChatRequestSchema,
  aiStreamRequestSchema,
  type AiSettingsInput,
  type AiChatRequestInput,
  type AiStreamRequestInput,
} from '../shared/desktop-api'
import type {
  AiSettings,
  AiChatRequest,
  AiChatResponse,
  AiStreamChunk,
  AiStreamRequest,
} from '@genoffice/ai-provider'

import {
  chatForProvider,
  streamForProvider,
  type AiProviderId,
  type AiProviderConfig,
  AiTimeoutError,
  AiCreditsError,
  isAiNetworkError,
  setRescueFetch,
  defaultAiSettings,
  resolveAiSettings,
} from '@genoffice/ai-provider'
import {
  webSearch,
  imageSearch,
  hasGskAuth,
  gskApiKey,
  gskLoginInfo,
  ensureGenofficeLogin,
  gskGenerateImage,
} from '@genoffice/ai-search'
import { fetchRemoteImage } from '@genoffice/electron-utils'

// ── Types ────────────────────────────────────────────────────────────

interface LegacyAiSettings {
  provider?: string
  providers?: Record<string, unknown>
}

type StreamChunkSender = (chunk: AiStreamChunk) => void

// ── Renderer-scoped stream state ─────────────────────────────────────

/**
 * Per-renderer stream tracking: Map<wcId, Map<requestId, AbortController>>.
 *
 * This is the ONLY mutable state in this module. It is renderer-scoped —
 * no global activeStream/currentRenderer/currentRequestId.
 *
 * When a renderer's WebContents is destroyed, all its streams are aborted
 * and its entry is removed.
 */
const streamState = new Map<number, Map<string, AbortController>>()

function getRendererStreams(wcId: number): Map<string, AbortController> {
  let streams = streamState.get(wcId)
  if (!streams) {
    streams = new Map()
    streamState.set(wcId, streams)
  }
  return streams
}

function abortRendererStreams(wcId: number): void {
  const streams = streamState.get(wcId)
  if (!streams) return
  for (const controller of streams.values()) {
    try { controller.abort() } catch { /* best effort */ }
  }
  streams.clear()
  streamState.delete(wcId)
}

// ── Settings persistence ────────────────────────────────────────────

function settingsPath(): string {
  return join(app.getPath('userData'), 'ai-settings.json')
}

function readSettings(): AiSettings {
  try {
    const path = settingsPath()
    if (existsSync(path)) {
      const stored = JSON.parse(readFileSync(path, 'utf-8')) as Partial<AiSettings> & LegacyAiSettings
      const settings = resolveAiSettings(stored, defaultAiSettings())
      settings.provider = 'genspark'
      return settings
    }
  } catch { /* corrupted: fall back to defaults */ }
  const settings = resolveAiSettings({}, defaultAiSettings())
  settings.provider = 'genspark'
  return settings
}

function writeSettings(settings: AiSettingsInput): void {
  const path = settingsPath()
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(settings, null, 2))
}

// ── Provider config resolution ──────────────────────────────────────

function resolveProviderConfig(
  settings: AiSettingsInput,
): { provider: AiProviderId; config: AiProviderConfig | undefined } {
  const provider = settings.provider as AiProviderId
  let config = settings.providers[provider] as AiProviderConfig | undefined
  // Genspark's key never enters the settings file; it is read from the gsk
  // login state per request
  if (provider === 'genspark' && config && !config.apiKey) {
    config = { ...config, apiKey: gskApiKey() }
  }
  return { provider, config }
}

// ── MAX_REMOTE_IMAGE_BYTES (matching legacy) ────────────────────────

const MAX_REMOTE_IMAGE_BYTES = 20 * 1024 * 1024

// ── Handler registration ────────────────────────────────────────────

let aiIpcRegistered = false

export function registerMigratedSheetsAiIpc(): void {
  if (aiIpcRegistered) return
  aiIpcRegistered = true

  // Node fetch (undici) direct connections get reset under VPN/tun setups;
  // retry over Chromium's stack
  setRescueFetch(async (url: string, init: unknown) => {
    const { net } = await import('electron')
    return net.fetch(url, init as Parameters<typeof net.fetch>[1])
  })

  // ── ai:get-settings ──
  ipcMain.removeHandler(IPC_CHANNELS.aiGetSettings)
  ipcMain.handle(IPC_CHANNELS.aiGetSettings, (): AiSettings => {
    return readSettings()
  })

  // ── ai:set-settings ──
  ipcMain.removeHandler(IPC_CHANNELS.aiSetSettings)
  ipcMain.handle(IPC_CHANNELS.aiSetSettings, (_event, input: unknown) => {
    const settings = aiSettingsInputSchema.parse(input)
    writeSettings(settings)
  })

  // ── ai:gsk-status ──
  ipcMain.removeHandler(IPC_CHANNELS.aiGskStatus)
  ipcMain.handle(
    IPC_CHANNELS.aiGskStatus,
    async (_event, withEmail?: unknown): Promise<{ loggedIn: boolean; email?: string }> => {
      if (!hasGskAuth()) return { loggedIn: false }
      if (!withEmail) return { loggedIn: true }
      const info = await gskLoginInfo()
      return info?.email ? { loggedIn: true, email: info.email } : { loggedIn: true }
    },
  )

  // ── ai:gsk-login ──
  ipcMain.removeHandler(IPC_CHANNELS.aiGskLogin)
  ipcMain.handle(IPC_CHANNELS.aiGskLogin, () => {
    ensureGenofficeLogin((url) => void shell.openExternal(url))
  })

  // ── ai:chat ──
  ipcMain.removeHandler(IPC_CHANNELS.aiChat)
  ipcMain.handle(IPC_CHANNELS.aiChat, async (_event, input: unknown): Promise<AiChatResponse> => {
    const request = aiChatRequestSchema.parse(input) as unknown as AiChatRequest
    const { provider, config } = resolveProviderConfig(request.settings)
    if (!config?.apiKey) {
      return {
        ok: false,
        error: provider === 'genspark'
          ? 'Genspark account is not logged in on this machine; ask the user to log in first'
          : `No API key configured for provider: ${provider}`,
      }
    }
    if (!config.model) return { ok: false, error: 'No model configured' }
    try {
      return await chatForProvider(provider, config, request.system, request.user)
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  // ── ai:stream ──
  // The stream handler is renderer-scoped: it tracks the AbortController
  // per (wcId, requestId) and sends chunks only to the initiating renderer.
  ipcMain.removeHandler(IPC_CHANNELS.aiStream)
  ipcMain.handle(IPC_CHANNELS.aiStream, async (event, input: unknown) => {
    const wcId = event.sender.id
    const request = aiStreamRequestSchema.parse(input) as unknown as AiStreamRequest
    const { requestId, system, messages } = request
    const tools = request.tools ?? []
    const maxTokens = request.maxTokens ?? 8192
    const { provider, config } = resolveProviderConfig(request.settings)

    const sender: WebContents = event.sender
    const send: StreamChunkSender = (chunk: AiStreamChunk) => {
      if (!sender.isDestroyed()) sender.send(IPC_CHANNELS.aiStreamChunk, chunk)
    }

    if (!config?.apiKey) {
      send({
        requestId,
        type: 'error',
        error: provider === 'genspark'
          ? 'Genspark account is not logged in on this machine; ask the user to log in first'
          : `No API key configured for provider: ${provider}`,
      })
      return
    }
    if (!config.model) {
      send({ requestId, type: 'error', error: 'No model configured' })
      return
    }

    const controller = new AbortController()
    const streams = getRendererStreams(wcId)
    streams.set(requestId, controller)

    // wire-activity keepalive: lets the renderer's silence watchdog tell
    // a slow turn from a dead one
    let lastPing = 0
    const ping = () => {
      const now = Date.now()
      if (now - lastPing < 5_000) return
      lastPing = now
      send({ requestId, type: 'ping' })
    }

    try {
      await streamForProvider(provider, config, system, messages, tools, maxTokens, {
        signal: controller.signal,
        onDelta: (text: string) => send({ requestId, type: 'delta', text }),
        onToolCall: (toolCall: Parameters<NonNullable<Parameters<typeof streamForProvider>[6]>['onToolCall']>[0]) =>
          send({ requestId, type: 'tool-call', toolCall }),
        onActivity: ping,
      })
      send({ requestId, type: 'done' })
    } catch (err) {
      if (controller.signal.aborted) {
        send({ requestId, type: 'done' })
      } else {
        const errorChunk: AiStreamChunk = {
          requestId,
          type: 'error',
          error: err instanceof Error ? err.message : String(err),
        }
        if (err instanceof AiTimeoutError) {
          ;(errorChunk as AiStreamChunk & { errorCode: string }).errorCode = 'timeout'
        } else if (err instanceof AiCreditsError) {
          ;(errorChunk as AiStreamChunk & { errorCode: string }).errorCode = 'credits'
        } else if (isAiNetworkError(err)) {
          ;(errorChunk as AiStreamChunk & { errorCode: string }).errorCode = 'network'
        }
        send(errorChunk)
      }
    } finally {
      streams.delete(requestId)
    }
  })

  // ── ai:stream-cancel ──
  ipcMain.removeHandler(IPC_CHANNELS.aiStreamCancel)
  ipcMain.handle(IPC_CHANNELS.aiStreamCancel, (event, requestId: unknown) => {
    const wcId = event.sender.id
    const streams = streamState.get(wcId)
    if (!streams) return
    const validatedRequestId = z.string().min(1).parse(requestId)
    streams.get(validatedRequestId)?.abort()
  })

  // ── ai:web-search ──
  ipcMain.removeHandler('ai:web-search')
  ipcMain.handle('ai:web-search', async (_event, query: unknown, maxResults?: unknown) => {
    try {
      return await webSearch(z.string().parse(query), typeof maxResults === 'number' ? maxResults : 6)
    } catch (err) {
      return { results: [], method: 'error', error: String(err) }
    }
  })

  // ── ai:image-search ──
  ipcMain.removeHandler('ai:image-search')
  ipcMain.handle('ai:image-search', async (_event, query: unknown, maxResults?: unknown) => {
    try {
      return await imageSearch(z.string().parse(query), typeof maxResults === 'number' ? maxResults : 8)
    } catch (err) {
      return { images: [], method: 'error', error: String(err) }
    }
  })

  // ── ai:fetch-image ──
  // SSRF-protected image fetching: @genoffice/electron-utils' fetchRemoteImage
  // refuses non-http schemes and private/link-local targets and validates
  // every redirect hop. Size-capped to match the local add_image limit.
  ipcMain.removeHandler('ai:fetch-image')
  ipcMain.handle(
    'ai:fetch-image',
    async (_event, url: unknown): Promise<{ base64: string; mime: string } | null> => {
      try {
        const resp = await fetchRemoteImage(z.string().parse(url))
        if (!resp || !resp.ok || !resp.body) return null
        const declared = Number(resp.headers.get('content-length') ?? 0)
        if (declared > MAX_REMOTE_IMAGE_BYTES) return null
        // Stream with a running cap: a missing/understated Content-Length must
        // not let a prompt-injected URL buffer unbounded bytes before a
        // post-hoc size check
        const reader = resp.body.getReader()
        const chunks: Buffer[] = []
        let received = 0
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          received += value.byteLength
          if (received > MAX_REMOTE_IMAGE_BYTES) {
            await reader.cancel()
            return null
          }
          chunks.push(Buffer.from(value))
        }
        const buf = Buffer.concat(chunks)
        const ct = resp.headers.get('content-type') ?? ''
        const mime = ct.includes('png') ? 'image/png'
          : ct.includes('gif') ? 'image/gif'
          : 'image/jpeg'
        return { base64: buf.toString('base64'), mime }
      } catch {
        return null
      }
    },
  )

  // ── sheets:ai-generate-image ──
  ipcMain.removeHandler(IPC_CHANNELS.aiGenerateImage)
  ipcMain.handle(
    IPC_CHANNELS.aiGenerateImage,
    async (_event, op: { prompt?: unknown; aspectRatio?: unknown }): Promise<{ url?: string; error?: string }> => {
      if (!hasGskAuth()) {
        return {
          error: 'Genspark account is not logged in on this machine; ask the user to log in first',
        }
      }
      const prompt = String(op?.prompt ?? '').trim()
      if (!prompt) return { error: 'prompt must not be empty' }
      try {
        const r = await gskGenerateImage({
          prompt,
          ...(op?.aspectRatio ? { aspectRatio: String(op.aspectRatio) } : {}),
        })
        return { url: r.url }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  )
}

// ── Renderer teardown ────────────────────────────────────────────────

/**
 * Called when a renderer's WebContents is destroyed.
 * Aborts ALL streams belonging to that wcId and removes the entry.
 *
 * This MUST be called from the coordinator's registerRenderer / teardown
 * path to ensure no stream chunks are sent to a destroyed WebContents.
 */
export function abortStreamsForRenderer(wcId: number): void {
  abortRendererStreams(wcId)
}
