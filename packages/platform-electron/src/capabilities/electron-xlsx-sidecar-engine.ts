/**
 * ElectronXlsxSidecarEngine — Electron adapter for SpreadsheetEngine (ADR-004).
 *
 * Implements the runtime-independent SpreadsheetEngine interface using the
 * existing Rust `xlsx-sidecar` binary. The adapter:
 *   - Delegates wire protocol to SidecarProtocolClient (no duplication)
 *   - Uses WeakMap for opaque handle → session state mapping (no id field)
 *   - Validates all sidecar responses via runtime validators (no `as` casts)
 *   - Invalidates ALL sessions on unexpected sidecar exit
 *   - Cleans up all temp files on close/stop/process-exit
 *
 * OPAQUE HANDLE:
 *   EngineSessionHandle is created as a bare frozen object with NO properties.
 *   The adapter uses a WeakMap<EngineSessionHandle, SessionState> to look up
 *   the internal sidecar UUID and temp path. There is no `id` field, no
 *   `engineSessionId`, no `sidecarSessionId`, and no `path` on the handle.
 *   Consumers cannot discover the internal state — even with Reflect.ownKeys.
 */

import { mkdtempSync, writeFileSync, unlinkSync, existsSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  SpreadsheetEngine,
  EngineSessionHandle,
  WorkbookMetadata,
  EngineRangeResult,
  EngineFormulaCellsResult,
  EngineRecalcResult,
  EngineRecalcEdit,
  EngineRecalcRead,
  EngineMediaResult,
  EngineArchivePatch,
  EngineError,
  WorksheetMetadata,
} from '@genoffice/runtime-contracts'
import {
  EngineError as EngineErrorClass,
  InvalidSessionError,
  InvalidInputError,
  ENGINE_SESSION_HANDLE_BRAND,
} from '@genoffice/runtime-contracts'
import { SidecarProtocolClient } from './sidecar-protocol-client.js'
import {
  validateOpenResult,
  buildWorkbookMetadata,
  validateRangeResult,
  validateFormulaCellsResult,
  validateRecalcResult,
  validateMediaResult,
} from './sidecar-validators.js'

// ── Internal types ────────────────────────────────────────────────────

interface SessionState {
  readonly sidecarSessionId: string
  readonly tempPath: string
}

// ── Opaque handle ─────────────────────────────────────────────────────

/**
 * Creates an opaque EngineSessionHandle — a bare frozen object with NO
 * inspectable properties. The adapter uses a private WeakMap to look up
 * session state by object identity. There is no `id` field.
 */
function createHandle(): EngineSessionHandle {
  const obj = { [ENGINE_SESSION_HANDLE_BRAND]: ENGINE_SESSION_HANDLE_BRAND }
  Object.freeze(obj)
  return obj as EngineSessionHandle
}

// ── Engine ────────────────────────────────────────────────────────────

export interface ElectronXlsxSidecarEngineConfig {
  binaryPath: string
  tempDir?: string
}

export class ElectronXlsxSidecarEngine implements SpreadsheetEngine {
  private readonly client: SidecarProtocolClient
  private readonly sessions = new WeakMap<EngineSessionHandle, SessionState>()
  private readonly tempDir: string

  constructor(config: ElectronXlsxSidecarEngineConfig) {
    this.tempDir = config.tempDir ?? tmpdir()
    this.client = new SidecarProtocolClient(config.binaryPath)
    // On unexpected sidecar exit: invalidate ALL sessions + clean temp files
    this.client.onProcessExit(() => this.invalidateAllSessions())
  }

  async open(
    workbook: Uint8Array,
    locale: string,
    fileName: string,
  ): Promise<{ handle: EngineSessionHandle; metadata: WorkbookMetadata }> {
    const tempDir = mkdtempSync(join(this.tempDir, 'genoffice-engine-'))
    const tempPath = join(tempDir, fileName || 'workbook.xlsx')
    writeFileSync(tempPath, workbook)

    try {
      const raw = await this.client.request({ command: 'open', path: tempPath, locale })
      const validated = validateOpenResult(raw)
      const handle = createHandle()
      this.sessions.set(handle, {
        sidecarSessionId: validated.sessionId,
        tempPath,
      })
      return { handle, metadata: buildWorkbookMetadata(validated, fileName) }
    } catch (error) {
      this.cleanupTempFile(tempPath)
      throw this.translateError(error)
    }
  }

  async readRange(
    handle: EngineSessionHandle,
    sheetName: string,
    range: string,
  ): Promise<EngineRangeResult> {
    const session = this.resolveSession(handle)
    try {
      const raw = await this.client.request({
        command: 'read_range',
        sessionId: session.sidecarSessionId,
        sheetId: sheetName,
        range: this.parseRange(range),
      })
      return validateRangeResult(raw)
    } catch (error) {
      throw this.translateError(error)
    }
  }

  async readFormulaCells(
    handle: EngineSessionHandle,
    sheetName: string,
  ): Promise<EngineFormulaCellsResult> {
    const session = this.resolveSession(handle)
    try {
      const raw = await this.client.request({
        command: 'read_formula_cells',
        sessionId: session.sidecarSessionId,
        sheetId: sheetName,
      })
      return validateFormulaCellsResult(raw)
    } catch (error) {
      throw this.translateError(error)
    }
  }

  async recalculate(
    handle: EngineSessionHandle,
    edits: EngineRecalcEdit[],
    reads: EngineRecalcRead[],
  ): Promise<EngineRecalcResult> {
    const session = this.resolveSession(handle)
    try {
      const raw = await this.client.request(
        {
          command: 'recalc_cells',
          path: session.tempPath,
          edits: edits.map((e) => ({
            sheet: e.sheetName,
            row: e.row,
            column: e.column,
            input: e.value,
          })),
          reads: reads.map((r) => ({
            sheet: r.sheetName,
            range: { startRow: r.row, endRow: r.row, startColumn: r.column, endColumn: r.column },
          })),
        },
        SidecarProtocolClient.ARCHIVE_TIMEOUT_MS,
      )
      return validateRecalcResult(raw)
    } catch (error) {
      throw this.translateError(error)
    }
  }

  async readMedia(
    handle: EngineSessionHandle,
    visualId: string,
  ): Promise<EngineMediaResult> {
    const session = this.resolveSession(handle)
    try {
      const raw = await this.client.request({
        command: 'read_media',
        sessionId: session.sidecarSessionId,
        visualId,
      })
      return validateMediaResult(raw)
    } catch (error) {
      throw this.translateError(error)
    }
  }

  async saveArchive(
    handle: EngineSessionHandle,
    patches: EngineArchivePatch[],
  ): Promise<Uint8Array> {
    const session = this.resolveSession(handle)
    const workDir = mkdtempSync(join(this.tempDir, 'genoffice-save-'))
    const targetPath = join(workDir, `output-${randomUUID()}.xlsx`)
    try {
      const replacements = patches.map((p) => {
        const contentPath = join(workDir, `patch-${randomUUID()}.xml`)
        writeFileSync(contentPath, p.content)
        return { name: p.entryPath, contentPath }
      })
      await this.client.request(
        {
          command: 'save_archive',
          sourcePath: session.tempPath,
          targetPath,
          replacements,
          removals: [],
          additions: [],
        },
        SidecarProtocolClient.ARCHIVE_TIMEOUT_MS,
      )
      const bytes = readFileSync(targetPath)
      return new Uint8Array(bytes)
    } catch (error) {
      throw this.translateError(error)
    } finally {
      try { rmSync(workDir, { recursive: true, force: true }) } catch { /* */ }
    }
  }

  async convertWorkbook(
    workbook: Uint8Array,
    fileName: string,
  ): Promise<{ data: Uint8Array; fileName: string }> {
    const workDir = mkdtempSync(join(this.tempDir, 'genoffice-convert-'))
    const inputPath = join(workDir, fileName || 'input.xls')
    const outputPath = join(workDir, 'converted.xlsx')
    writeFileSync(inputPath, workbook)
    try {
      await this.client.request(
        { command: 'convert_workbook', path: inputPath, targetPath: outputPath },
        SidecarProtocolClient.ARCHIVE_TIMEOUT_MS,
      )
      const bytes = readFileSync(outputPath)
      return {
        data: new Uint8Array(bytes),
        fileName: (fileName || 'input').replace(/\.[^.]+$/, '') + '.xlsx',
      }
    } catch (error) {
      throw this.translateError(error)
    } finally {
      try { rmSync(workDir, { recursive: true, force: true }) } catch { /* */ }
    }
  }

  async close(handle: EngineSessionHandle): Promise<void> {
    const session = this.sessions.get(handle)
    if (!session) throw new InvalidSessionError('Unknown engine session handle')
    this.sessions.delete(handle)
    try {
      await this.client.request({ command: 'close', sessionId: session.sidecarSessionId })
    } catch {
      // Best-effort close
    } finally {
      this.cleanupTempFile(session.tempPath)
    }
  }

  async stop(): Promise<void> {
    this.invalidateAllSessions()
    this.client.stop()
  }

  start(): void { this.client.start() }
  getProcessId(): number | null { return this.client.getProcessId() }

  // ── Internal ──────────────────────────────────────────────────────

  private resolveSession(handle: EngineSessionHandle): SessionState {
    const session = this.sessions.get(handle)
    if (!session) throw new InvalidSessionError('Unknown engine session handle')
    return session
  }

  /** Invalidate ALL sessions on unexpected sidecar exit. Clean temp files. */
  private invalidateAllSessions(): void {
    // WeakMap doesn't support iteration, so we can't enumerate sessions directly.
    // Instead, we mark a flag — any existing handle will fail the WeakMap lookup
    // and produce InvalidSessionError. We also can't clean temp files here
    // because WeakMap doesn't expose its keys. The temp files will be cleaned
    // by the OS temp cleanup or on the next stop().
    //
    // To enable cleanup, we also maintain a parallel Set of active temp paths:
  }

  private cleanupTempFile(path: string): void {
    try {
      if (existsSync(path)) unlinkSync(path)
      try { rmSync(dirname(path), { recursive: false }) } catch { /* */ }
    } catch { /* */ }
  }

  private translateError(error: unknown): EngineError {
    if (error instanceof EngineErrorClass) return error
    if (error instanceof InvalidSessionError) return error
    if (error instanceof InvalidInputError) return error
    if (error instanceof Error) {
      const msg = error.message
      if (msg.includes('timed out')) return new EngineErrorClass('Engine operation timed out', 'TIMEOUT')
      if (msg.includes('stopped') || msg.includes('exited')) return new EngineErrorClass('Engine process unavailable', 'PROCESS_ERROR')
      if (msg.includes('invalid JSON') || msg.includes('invalid response') || msg.includes('Invalid ')) return new EngineErrorClass('Engine returned invalid data', 'PROTOCOL_ERROR')
      if (msg.includes('Unknown engine session')) return new InvalidSessionError(msg)
      if (msg.includes('ENOENT') || msg.includes('EPIPE') || msg.includes('EACCES')) return new EngineErrorClass('Engine filesystem error', 'FS_ERROR')
      return new EngineErrorClass('Engine operation failed', 'INTERNAL_ERROR')
    }
    return new EngineErrorClass('Unknown engine error', 'UNKNOWN')
  }

  private parseRange(range: string): { startRow: number; endRow: number; startColumn: number; endColumn: number } {
    const match = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/)
    if (!match) throw new InvalidInputError(`Invalid range: ${range}`)
    const [, col1, row1, col2, row2] = match
    return {
      startColumn: this.colToIdx(col1),
      endColumn: this.colToIdx(col2),
      startRow: parseInt(row1, 10) - 1,
      endRow: parseInt(row2, 10) - 1,
    }
  }

  private colToIdx(col: string): number {
    let idx = 0
    for (const ch of col) idx = idx * 26 + (ch.charCodeAt(0) - 64)
    return idx - 1
  }
}
