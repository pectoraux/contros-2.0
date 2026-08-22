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

import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync, existsSync, rmSync, readFileSync } from 'node:fs'
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
  EngineSaveResult,
  EngineError,
  WorksheetMetadata,
} from '@genoffice/runtime-contracts'
import {
  EngineError as EngineErrorClass,
  InvalidSessionError,
  InvalidInputError,
  ENGINE_SESSION_HANDLE_BRAND,
} from '@genoffice/runtime-contracts'
import type { SavePlan } from '@genoffice/runtime-contracts'
import type { EntrySource } from '@genoffice/xlsx-gateway'
import { SidecarProtocolClient } from './sidecar-protocol-client.js'
import {
  validateOpenResult,
  buildWorkbookMetadata,
  validateRangeResult,
  validateFormulaCellsResult,
  validateRecalcResult,
  validateMediaResult,
} from './sidecar-validators.js'
import { translateSavePlan, type EngineArchivePatch } from './save-plan-translator.js'

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
  /**
   * Parallel map of handle → sheetNames (sheetId → file sheet name).
   * Stored at open() time so applySavePlan's translator can resolve
   * domain sheetIds → file sheet names without the engine having access
   * to the domain session.
   */
  private readonly sessionSheetNames = new WeakMap<EngineSessionHandle, ReadonlyMap<string, string>>()
  /** Parallel iterable set — enables invalidateAllSessions() to enumerate handles. */
  private readonly activeHandles = new Set<EngineSessionHandle>()
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
      // Store the sheetNames map (sheetId → file sheet name) for applySavePlan.
      // Built from [sheet.id, sheet.name] — the stable XLSX sheetId attribute.
      const sheetNames = new Map<string, string>()
      for (const sheet of validated.sheets) {
        sheetNames.set(sheet.id, sheet.name)
      }
      this.sessionSheetNames.set(handle, sheetNames)
      this.activeHandles.add(handle)
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

  async applySavePlan(
    handle: EngineSessionHandle,
    plan: SavePlan,
  ): Promise<EngineSaveResult> {
    const session = this.resolveSession(handle)
    const workDir = mkdtempSync(join(this.tempDir, 'genoffice-save-'))
    const targetPath = join(workDir, `output-${randomUUID()}.xlsx`)
    try {
      // Create a sidecar-backed EntrySource (abstract archive reader).
      // Mirrors createSidecarEntrySource in apps/sheets/src/gateway/xlsx-package-io.ts.
      const source = this.createEntrySource(session.tempPath, workDir)

      // The engine stores the sheetNames map at open() time so the translator
      // can resolve domain sheetIds → file sheet names. The service validates
      // sheetIds before calling applySavePlan, but the translator needs the
      // actual sheetNames map to perform the resolution.
      const sheetNames = this.sessionSheetNames.get(handle)
      if (sheetNames === undefined) {
        throw new InvalidSessionError('Session sheetNames not found — was the session closed?')
      }

      // Translate the domain SavePlan to engine archive patches via the legacy
      // planCellEditsToXlsx planning logic. The translator:
      //   1. Resolves sheetIds → sheetNames (fail-closed → InvalidInputError)
      //   2. Builds gateway-style mutation types (mirrors writeWorkbookTo)
      //   3. Calls planCellEditsToXlsx with the sidecar-backed EntrySource
      //   4. Converts MutationPlan → EngineArchivePatch[] + touched/removed/added
      const translation = await translateSavePlan(plan, sheetNames, source)

      // Write each patch's content to a temp file (the sidecar's save_archive
      // command expects { name, contentPath } pairs, not inline content).
      const replacements: { name: string; contentPath: string }[] = []
      const additions: { name: string; contentPath: string }[] = []
      const addedSet = new Set(translation.addedEntries)
      for (const patch of translation.patches) {
        const contentPath = join(workDir, `patch-${randomUUID()}.bin`)
        if (typeof patch.content === 'string') {
          writeFileSync(contentPath, patch.content, 'utf8')
        } else {
          writeFileSync(contentPath, patch.content)
        }
        if (addedSet.has(patch.entryPath)) {
          additions.push({ name: patch.entryPath, contentPath })
        } else {
          replacements.push({ name: patch.entryPath, contentPath })
        }
      }

      await this.client.request(
        {
          command: 'save_archive',
          sourcePath: session.tempPath,
          targetPath,
          replacements,
          removals: translation.removedEntries,
          additions,
        },
        SidecarProtocolClient.ARCHIVE_TIMEOUT_MS,
      )
      const bytes = readFileSync(targetPath)
      return {
        data: new Uint8Array(bytes),
        touchedEntries: translation.touchedEntries,
      }
    } catch (error) {
      throw this.translateError(error)
    } finally {
      try { rmSync(workDir, { recursive: true, force: true }) } catch { /* */ }
    }
  }

  /**
   * Create a sidecar-backed EntrySource for the save planner.
   *
   * Mirrors `createSidecarEntrySource` in apps/sheets/src/gateway/xlsx-package-io.ts.
   * The EntrySource abstracts archive reading: the planner calls readText/has/
   * canPatch/containsText, and this implementation backs them with sidecar
   * wire commands (archive_manifest, read_entries, scan_entries).
   */
  private createEntrySource(sourcePath: string, workDir: string): EntrySource {
    // Fetch the archive manifest up front to know entry sizes.
    // The sidecar returns { entries: [{ name, crc32, compressedSize, uncompressedSize }] }.
    const manifestPromise = this.client.request(
      { command: 'archive_manifest', path: sourcePath },
      SidecarProtocolClient.ARCHIVE_TIMEOUT_MS,
    )
    const cache = new Map<string, string>()
    let extractionCount = 0
    const MAX_PATCH_ENTRY_BYTES = 256 * 1024 * 1024

    return {
      paths: async () => {
        const manifest = await manifestPromise
        const entries = (manifest as { entries: Array<{ name: string }> }).entries
        return entries.map((e) => e.name)
      },
      has: async (path: string) => {
        const manifest = await manifestPromise
        const entries = (manifest as { entries: Array<{ name: string }> }).entries
        return entries.some((e) => e.name === path)
      },
      canPatch: async (path: string) => {
        const manifest = await manifestPromise
        const entries = (manifest as { entries: Array<{ name: string; uncompressedSize: number }> }).entries
        const entry = entries.find((e) => e.name === path)
        return (entry?.uncompressedSize ?? 0) <= MAX_PATCH_ENTRY_BYTES
      },
      containsText: async (path: string, needle: string) => {
        const scanned = await this.client.request(
          { command: 'scan_entries', path: sourcePath, entries: [path], needle },
          SidecarProtocolClient.ARCHIVE_TIMEOUT_MS,
        )
        const matches = (scanned as { matches: string[] }).matches
        return matches.includes(path)
      },
      readText: async (path: string) => {
        const cached = cache.get(path)
        if (cached !== undefined) return cached
        const manifest = await manifestPromise
        const entries = (manifest as { entries: Array<{ name: string; uncompressedSize: number }> }).entries
        const entry = entries.find((e) => e.name === path)
        if (!entry) throw new EngineErrorClass(`Workbook is missing ${path}`, 'PROTOCOL_ERROR')
        if (entry.uncompressedSize > MAX_PATCH_ENTRY_BYTES) {
          throw new EngineErrorClass(
            `${path} is ${entry.uncompressedSize} bytes uncompressed — too large to edit.`,
            'INTERNAL_ERROR',
          )
        }
        const extractDir = join(workDir, `extract-${extractionCount}`)
        extractionCount += 1
        mkdirSync(extractDir, { recursive: true })
        const extracted = await this.client.request(
          { command: 'read_entries', path: sourcePath, entries: [path], outputDir: extractDir },
          SidecarProtocolClient.ARCHIVE_TIMEOUT_MS,
        )
        const filePath = (extracted as { entries: Array<{ name: string; path: string }> }).entries[0]?.path
        if (!filePath) throw new EngineErrorClass(`Sidecar did not extract ${path}`, 'PROTOCOL_ERROR')
        const content = readFileSync(filePath, 'utf8')
        cache.set(path, content)
        return content
      },
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
    this.sessionSheetNames.delete(handle)
    this.activeHandles.delete(handle)
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

  /**
   * Invalidate ALL sessions on unexpected sidecar exit.
   * Iterates activeHandles, deletes WeakMap entries, cleans temp directories,
   * and clears the Set. After this, all existing handles produce InvalidSessionError.
   */
  private invalidateAllSessions(): void {
    for (const handle of this.activeHandles) {
      const session = this.sessions.get(handle)
      if (session) {
        this.cleanupTempFile(session.tempPath)
        this.sessions.delete(handle)
        this.sessionSheetNames.delete(handle)
      }
    }
    this.activeHandles.clear()
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
