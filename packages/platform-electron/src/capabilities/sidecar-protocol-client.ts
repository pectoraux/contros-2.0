/**
 * SidecarProtocolClient — the proven JSON-over-stdio wire protocol for the
 * Rust xlsx-sidecar binary, extracted from apps/sheets/src/main/xlsx-sidecar-client.ts.
 *
 * This component OWNS:
 *   - child_process lifecycle (spawn, kill)
 *   - JSON-over-stdio framing
 *   - request ID correlation
 *   - timeouts
 *   - stderr accumulation
 *   - process exit/error handling
 *   - pending request rejection
 *
 * The engine (ElectronXlsxSidecarEngine) OWNS:
 *   - SpreadsheetEngine semantics
 *   - handle mapping (opaque handle ↔ session state)
 *   - temp-file strategy
 *   - sidecar command translation
 *   - runtime-independent result construction
 *   - response validation
 *
 * This separation eliminates duplication of the wire protocol.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface, type Interface } from 'node:readline'
import { randomUUID } from 'node:crypto'

const PROTOCOL_VERSION = 1
const REQUEST_TIMEOUT_MS = 30_000
const ARCHIVE_TIMEOUT_MS = 180_000
const MAX_STDERR_LENGTH = 8_192

interface PendingRequest {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  readonly timeout: ReturnType<typeof setTimeout>
}

interface SidecarResponse {
  readonly version: number
  readonly requestId: string
  readonly ok: boolean
  readonly result?: unknown
  readonly error?: {
    readonly code: string
    readonly message: string
  }
}

/** Callback invoked when the sidecar process exits unexpectedly. */
export type OnProcessExitCallback = () => void

export class SidecarProtocolClient {
  private process: ChildProcessWithoutNullStreams | null = null
  private lines: Interface | null = null
  private readonly pending = new Map<string, PendingRequest>()
  private stderr = ''
  private onExitCallback: OnProcessExitCallback | null = null

  constructor(private readonly binaryPath: string) {}

  /** Register a callback for unexpected process exit. */
  onProcessExit(callback: OnProcessExitCallback): void {
    this.onExitCallback = callback
  }

  /** Send a request and await the response. Returns `unknown` — the caller validates. */
  request(
    command: Readonly<Record<string, unknown>>,
    timeoutMs: number = REQUEST_TIMEOUT_MS,
  ): Promise<unknown> {
    const child = this.ensureStarted()
    const requestId = randomUUID()
    const payload = JSON.stringify({
      version: PROTOCOL_VERSION,
      requestId,
      ...command,
    })
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error('XLSX sidecar request timed out.'))
      }, timeoutMs)
      this.pending.set(requestId, { resolve, reject, timeout })
      child.stdin.write(`${payload}\n`, (error) => {
        if (!error) return
        const pending = this.pending.get(requestId)
        if (!pending) return
        clearTimeout(pending.timeout)
        this.pending.delete(requestId)
        pending.reject(error)
      })
    })
  }

  /** Archive timeout constant (exposed for the engine). */
  static readonly ARCHIVE_TIMEOUT_MS = ARCHIVE_TIMEOUT_MS

  /** Spawn the sidecar ahead of the first request. */
  start(): void {
    this.ensureStarted()
  }

  getProcessId(): number | null {
    return this.process?.pid ?? null
  }

  stop(): void {
    this.lines?.close()
    this.lines = null
    this.process?.kill()
    this.process = null
    this.rejectPending(new Error('XLSX sidecar stopped.'))
  }

  // ── Internal ──────────────────────────────────────────────────────

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.process && !this.process.killed) return this.process
    const child = spawn(this.binaryPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.process = child
    this.stderr = ''
    this.lines = createInterface({ input: child.stdout })
    this.lines.on('line', (line) => this.handleLine(line))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-MAX_STDERR_LENGTH)
    })
    child.once('error', (error) => {
      this.process = null
      this.rejectPending(error)
    })
    child.once('exit', (code, signal) => {
      this.process = null
      this.lines?.close()
      this.lines = null
      const detail = this.stderr.trim()
      const reason = detail
        ? `XLSX sidecar exited: ${detail}`
        : `XLSX sidecar exited with code ${String(code)} and signal ${String(signal)}.`
      this.rejectPending(new Error(reason))
      // Notify the engine that the process died — all sessions are now invalid
      this.onExitCallback?.()
    })
    return child
  }

  private handleLine(line: string): void {
    let response: SidecarResponse
    try {
      response = JSON.parse(line) as SidecarResponse
    } catch {
      this.rejectPending(new Error('XLSX sidecar returned invalid JSON.'))
      return
    }
    if (
      response.version !== PROTOCOL_VERSION ||
      typeof response.requestId !== 'string' ||
      typeof response.ok !== 'boolean'
    ) {
      this.rejectPending(new Error('XLSX sidecar returned an invalid response.'))
      return
    }
    const pending = this.pending.get(response.requestId)
    if (!pending) return
    clearTimeout(pending.timeout)
    this.pending.delete(response.requestId)
    if (response.ok) {
      pending.resolve(response.result)
      return
    }
    pending.reject(new Error(response.error?.message ?? 'XLSX sidecar request failed.'))
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
  }
}
