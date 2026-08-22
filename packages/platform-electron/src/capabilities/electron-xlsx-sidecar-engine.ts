/**
 * ElectronXlsxSidecarEngine — Electron adapter for SpreadsheetEngine (ADR-004).
 *
 * Implements the runtime-independent SpreadsheetEngine interface using the
 * existing Rust `xlsx-sidecar` binary. The sidecar communicates via
 * JSON-over-stdio; this adapter owns the child process lifecycle, request
 * correlation, timeouts, and temp-file management.
 *
 * RUNTIME BOUNDARY:
 *   This file is Electron-specific (Layer 4a). It MAY import:
 *     electron, node:child_process, node:fs, node:path, node:os, node:crypto
 *   It MUST NOT export those concepts upward. The SpreadsheetEngine
 *   interface (in runtime-contracts) is the only public contract.
 *
 * OPAQUE HANDLE MAPPING:
 *   The adapter maintains an internal Map<EngineSessionHandle, SessionState>
 *   where SessionState contains the sidecar's UUID, the temp file path,
 *   and other adapter-private state. The handle is opaque — consumers
 *   cannot inspect it to discover the UUID or path.
 *
 * TEMP FILE STRATEGY:
 *   The runtime-independent contract passes Uint8Array, not file paths.
 *   The adapter writes the bytes to a temp file, passes the path to the
 *   sidecar, and cleans up the temp file on close/stop. The temp path
 *   never escapes the adapter boundary.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface, type Interface } from 'node:readline'
import { mkdtempSync, writeFileSync, unlinkSync, existsSync, rmSync } from 'node:fs'
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
  WorksheetMetadata,
  EngineCellRecord,
  EngineCellArea,
  EngineRowMetadata,
  EngineColumnMetadata,
  EngineFormulaCell,
  EngineRecalcCell,
  EngineError,
} from '@genoffice/runtime-contracts'
import {
  EngineError as EngineErrorClass,
  InvalidSessionError,
  InvalidInputError,
} from '@genoffice/runtime-contracts'

// ── Constants (from the proven existing implementation) ────────────────

const PROTOCOL_VERSION = 1
const REQUEST_TIMEOUT_MS = 30_000
const ARCHIVE_TIMEOUT_MS = 180_000
const MAX_STDERR_LENGTH = 8_192

// ── Internal types ─────────────────────────────────────────────────────

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

/**
 * Internal adapter state for each engine session. Private to the adapter —
 * never exposed through EngineSessionHandle or any public API.
 */
interface SessionState {
  /** The sidecar's internal session UUID. Private to the adapter. */
  readonly sidecarSessionId: string
  /** Path to the temp file the sidecar reads from. Private. */
  readonly tempPath: string
}

// ── Opaque handle implementation ───────────────────────────────────────

/**
 * Creates an opaque EngineSessionHandle that wraps an internal id.
 * The handle is a branded object — consumers cannot inspect the `id`
 * field because the type is declared with `declare const` in runtime-contracts.
 * The actual runtime value is `{ [BRAND]: true, id: string }` but the
 * TypeScript type only exposes the brand symbol.
 */
const HANDLE_BRAND = Symbol('EngineSessionHandle')

function createHandle(internalId: string): EngineSessionHandle {
  return { [ENGINE_SESSION_HANDLE_BRAND]: ENGINE_SESSION_HANDLE_BRAND, id: internalId } as unknown as EngineSessionHandle
}

// Import the brand symbol from runtime-contracts
import { ENGINE_SESSION_HANDLE_BRAND } from '@genoffice/runtime-contracts'

function getInternalId(handle: EngineSessionHandle): string {
  return (handle as unknown as { id: string }).id
}

// ── ElectronXlsxSidecarEngine ─────────────────────────────────────────

export interface ElectronXlsxSidecarEngineConfig {
  /** Path to the compiled Rust xlsx-sidecar binary. */
  binaryPath: string
  /** Directory for temp files (default: os.tmpdir()). */
  tempDir?: string
}

export class ElectronXlsxSidecarEngine implements SpreadsheetEngine {
  private process: ChildProcessWithoutNullStreams | null = null
  private lines: Interface | null = null
  private readonly pending = new Map<string, PendingRequest>()
  private stderr = ''

  /** Maps opaque handle internal id → SessionState (sidecar UUID + temp path). */
  private readonly sessions = new Map<string, SessionState>()

  /** Directory for temp workbook files. */
  private readonly tempDir: string

  /** Counter for generating unique internal handle ids. */
  private handleCounter = 0

  constructor(private readonly config: ElectronXlsxSidecarEngineConfig) {
    this.tempDir = config.tempDir ?? tmpdir()
  }

  // ── SpreadsheetEngine implementation ────────────────────────────────

  async open(
    workbook: Uint8Array,
    locale: string,
    fileName: string,
  ): Promise<{ handle: EngineSessionHandle; metadata: WorkbookMetadata }> {
    // Write bytes to a temp file — the sidecar needs a path
    const tempDir = mkdtempSync(join(this.tempDir, 'genoffice-engine-'))
    const tempPath = join(tempDir, fileName || 'workbook.xlsx')
    writeFileSync(tempPath, workbook)

    try {
      // Call sidecar open
      const result = await this.request({
        command: 'open',
        path: tempPath,
        locale,
      }) as SidecarOpenResult

      // Create the opaque handle
      const internalId = `h${this.handleCounter++}`
      this.sessions.set(internalId, {
        sidecarSessionId: result.sessionId,
        tempPath,
      })

      // Build metadata (no path field — that's shell-owned)
      const metadata = this.buildMetadata(result, fileName)

      return {
        handle: createHandle(internalId),
        metadata,
      }
    } catch (error) {
      // Clean up temp file on failure
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
      const result = await this.request({
        command: 'read_range',
        sessionId: session.sidecarSessionId,
        sheetId: sheetName,
        range: this.parseRange(range),
      }) as Record<string, unknown>
      return this.buildRangeResult(result)
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
      const result = await this.request({
        command: 'read_formula_cells',
        sessionId: session.sidecarSessionId,
        sheetId: sheetName,
      }) as { cells: unknown[] }
      return {
        cells: (result.cells ?? []).map((c) => this.buildFormulaCell(c as Record<string, unknown>)),
      }
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
      const result = await this.request(
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
        ARCHIVE_TIMEOUT_MS,
      ) as { cells: unknown[] }
      return {
        cells: (result.cells ?? []).map((c) => this.buildRecalcCell(c as Record<string, unknown>)),
      }
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
      const result = await this.request({
        command: 'read_media',
        sessionId: session.sidecarSessionId,
        visualId,
      }) as { mediaType?: string; base64?: string }
      if (!result.mediaType || !result.base64) {
        throw new InvalidInputError('Media not found in workbook')
      }
      return { mediaType: result.mediaType, base64: result.base64 }
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
      // Write patch contents to temp files for the sidecar's save_archive command
      const replacements = patches.map((p) => {
        const contentPath = join(workDir, `patch-${randomUUID()}.xml`)
        writeFileSync(contentPath, p.content)
        return { name: p.entryPath, contentPath }
      })

      await this.request(
        {
          command: 'save_archive',
          sourcePath: session.tempPath,
          targetPath,
          replacements,
          removals: [],
          additions: [],
        },
        ARCHIVE_TIMEOUT_MS,
      )

      // Read the output file as bytes
      const { readFileSync } = await import('node:fs')
      const bytes = readFileSync(targetPath)
      return new Uint8Array(bytes)
    } catch (error) {
      throw this.translateError(error)
    } finally {
      // Clean up work dir
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
      await this.request(
        {
          command: 'convert_workbook',
          path: inputPath,
          targetPath: outputPath,
        },
        ARCHIVE_TIMEOUT_MS,
      )

      const { readFileSync } = await import('node:fs')
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
    const internalId = getInternalId(handle)
    const session = this.sessions.get(internalId)
    if (!session) {
      throw new InvalidSessionError('Unknown engine session handle')
    }
    try {
      await this.request({
        command: 'close',
        sessionId: session.sidecarSessionId,
      })
    } catch {
      // Best-effort close — the sidecar may have already cleaned up
    } finally {
      this.sessions.delete(internalId)
      this.cleanupTempFile(session.tempPath)
    }
  }

  async stop(): Promise<void> {
    // Close all sessions
    const internalIds = [...this.sessions.keys()]
    for (const id of internalIds) {
      const session = this.sessions.get(id)
      if (session) {
        this.cleanupTempFile(session.tempPath)
      }
      this.sessions.delete(id)
    }
    // Kill the sidecar process
    this.lines?.close()
    this.lines = null
    this.process?.kill()
    this.process = null
    this.rejectPending(new Error('XLSX sidecar stopped.'))
  }

  // ── Public utility (for pre-warming) ────────────────────────────────

  /** Spawn the sidecar ahead of the first request to hide cold-start latency. */
  start(): void {
    this.ensureStarted()
  }

  getProcessId(): number | null {
    return this.process?.pid ?? null
  }

  // ── Internal: session resolution ────────────────────────────────────

  private resolveSession(handle: EngineSessionHandle): SessionState {
    const internalId = getInternalId(handle)
    const session = this.sessions.get(internalId)
    if (!session) {
      throw new InvalidSessionError('Unknown engine session handle')
    }
    return session
  }

  // ── Internal: sidecar process management (adapted from XlsxSidecarClient) ──

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.process && !this.process.killed) return this.process
    const child = spawn(this.config.binaryPath, [], {
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
    })
    return child
  }

  private request(
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

  // ── Internal: temp file cleanup ──────────────────────────────────────

  private cleanupTempFile(path: string): void {
    try {
      if (existsSync(path)) unlinkSync(path)
      // Also try to clean up the parent directory if it's empty
      const dir = dirname(path)
      try { rmSync(dir, { recursive: false }) } catch { /* not empty or doesn't exist */ }
    } catch {
      // Best-effort cleanup
    }
  }

  // ── Internal: error translation ──────────────────────────────────────

  private translateError(error: unknown): EngineError {
    if (error instanceof EngineErrorClass) return error
    if (error instanceof Error) {
      const msg = error.message
      // Map known sidecar/process errors to domain-safe errors
      if (msg.includes('timed out')) {
        return new EngineErrorClass('Engine operation timed out', 'TIMEOUT')
      }
      if (msg.includes('stopped') || msg.includes('exited')) {
        return new EngineErrorClass('Engine process unavailable', 'PROCESS_ERROR')
      }
      if (msg.includes('invalid JSON') || msg.includes('invalid response')) {
        return new EngineErrorClass('Engine returned invalid data', 'PROTOCOL_ERROR')
      }
      if (msg.includes('Unknown engine session handle')) {
        return new InvalidSessionError(msg)
      }
      if (msg.includes('ENOENT') || msg.includes('EPIPE') || msg.includes('EACCES')) {
        return new EngineErrorClass('Engine filesystem error', 'FS_ERROR')
      }
      // Default: wrap as a generic engine error (no implementation details leak)
      return new EngineErrorClass('Engine operation failed', 'INTERNAL_ERROR')
    }
    return new EngineErrorClass('Unknown engine error', 'UNKNOWN')
  }

  // ── Internal: response building ─────────────────────────────────────

  private parseRange(range: string): { startRow: number; endRow: number; startColumn: number; endColumn: number } {
    // Parse 'A1:Z100' → { startRow: 0, endRow: 99, startColumn: 0, endColumn: 25 }
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

  private buildMetadata(result: SidecarOpenResult, fileName: string): WorkbookMetadata {
    return {
      name: fileName,
      sha256: result.sha256 ?? '',
      entryCount: result.entryCount ?? 0,
      sheets: (result.sheets ?? []).map((s, i) => this.buildWorksheetMetadata(s, i)),
      activeTab: result.activeTab ?? 0,
      definedNames: (result.definedNames ?? []).map((d) => ({
        name: d.name,
        value: d.value,
      })),
      themeColors: result.themeColors ?? [],
      themeFonts: {
        major: result.themeFonts?.major ?? '',
        minor: result.themeFonts?.minor ?? '',
      },
    }
  }

  private buildWorksheetMetadata(s: SidecarSheetMetadata, index: number): WorksheetMetadata {
    return {
      name: s.name,
      index,
      hidden: s.hidden ?? false,
      rtl: s.rtl ?? false,
      gridlineColor: s.gridlineColor,
      showGridlines: s.showGridlines ?? true,
      rowCount: s.rowCount ?? 0,
      columnCount: s.columnCount ?? 0,
      defaultRowHeight: s.defaultRowHeight ?? 15,
      defaultColumnWidth: s.defaultColumnWidth ?? 8.43,
      tabColor: s.tabColor,
    }
  }

  private buildRangeResult(result: Record<string, unknown>): EngineRangeResult {
    const cells = (result.cells as unknown[] ?? []).map((c) => this.buildCellRecord(c as Record<string, unknown>))
    const rows = (result.rows as unknown[] ?? []).map((r) => this.buildRowMetadata(r as Record<string, unknown>))
    const columns = (result.columns as unknown[] ?? []).map((c) => this.buildColumnMetadata(c as Record<string, unknown>))
    const merges = (result.merges as unknown[] ?? []).map((m) => this.buildCellArea(m as Record<string, unknown>))
    return {
      cells,
      rows,
      merges,
      columns,
      hyperlinks: (result.hyperlinks as Array<{ cell: string; target: string }>) ?? [],
      conditionalFormatting: (result.conditionalFormatting as unknown[]) ?? [],
      dataValidation: (result.dataValidation as unknown[]) ?? [],
      autoFilter: result.autoFilter as { startRow: number; startColumn: number; endRow: number; endColumn: number } | undefined,
      rowBreaks: (result.rowBreaks as number[]) ?? [],
      columnBreaks: (result.columnBreaks as number[]) ?? [],
      sheetProtection: (result.sheetProtection as boolean) ?? false,
    }
  }

  private buildCellRecord(c: Record<string, unknown>): EngineCellRecord {
    return {
      row: c.row as number,
      column: c.column as number,
      value: (c.value as string) ?? '',
      number: c.number as number | undefined,
      isFormula: (c.isFormula as boolean) ?? false,
      styleIndex: (c.styleIndex as number) ?? 0,
      hyperlink: c.hyperlink as string | undefined,
    }
  }

  private buildRowMetadata(r: Record<string, unknown>): EngineRowMetadata {
    return {
      row: r.row as number,
      height: r.height as number | undefined,
      customHeight: r.customHeight as boolean | undefined,
      hidden: (r.hidden as boolean) ?? false,
      outlineLevel: r.outlineLevel as number | undefined,
      collapsed: r.collapsed as boolean | undefined,
      styleIndex: r.styleIndex as number | undefined,
    }
  }

  private buildColumnMetadata(c: Record<string, unknown>): EngineColumnMetadata {
    return {
      column: c.column as number,
      width: c.width as number | undefined,
      customWidth: c.customWidth as boolean | undefined,
      hidden: (c.hidden as boolean) ?? false,
      outlineLevel: c.outlineLevel as number | undefined,
      collapsed: c.collapsed as boolean | undefined,
      styleIndex: c.styleIndex as number | undefined,
    }
  }

  private buildCellArea(m: Record<string, unknown>): EngineCellArea {
    return {
      firstRow: m.firstRow as number,
      firstColumn: m.firstColumn as number,
      lastRow: m.lastRow as number,
      lastColumn: m.lastColumn as number,
    }
  }

  private buildFormulaCell(c: Record<string, unknown>): EngineFormulaCell {
    return {
      row: c.row as number,
      column: c.column as number,
      formula: (c.formula as string) ?? '',
      cachedValue: c.cachedValue as string | undefined,
    }
  }

  private buildRecalcCell(c: Record<string, unknown>): EngineRecalcCell {
    return {
      sheetName: (c.sheet as string) ?? '',
      row: c.row as number,
      column: c.column as number,
      formatted: (c.formatted as string) ?? '',
      number: c.number as number | undefined,
      isFormula: (c.isFormula as boolean) ?? false,
    }
  }
}

// ── Sidecar response types (internal, not exported) ───────────────────

interface SidecarOpenResult {
  sessionId: string
  sha256?: string
  entryCount?: number
  sheets?: SidecarSheetMetadata[]
  activeTab?: number
  definedNames?: Array<{ name: string; value: string }>
  themeColors?: string[]
  themeFonts?: { major: string; minor: string }
}

interface SidecarSheetMetadata {
  name: string
  hidden?: boolean
  rtl?: boolean
  gridlineColor?: string
  showGridlines?: boolean
  rowCount?: number
  columnCount?: number
  defaultRowHeight?: number
  defaultColumnWidth?: number
  tabColor?: string
}
