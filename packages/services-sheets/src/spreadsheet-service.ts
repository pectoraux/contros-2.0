/**
 * SpreadsheetServiceImpl — the Sheets domain service.
 *
 * Composes SpreadsheetEngine (runtime-independent) + platform capabilities.
 * Owns domain semantics: workbook open/read/recalc/save, sheet-id translation,
 * external-change policy, recovery path derivation.
 *
 * ZERO node:* / Electron imports (verified by architecture test).
 * ZERO shell-hook deps (no wcId, no BrowserWindow, no dialogs).
 * Session-scoped: open returns { session, engineHandle, metadata };
 * subsequent operations receive session + engineHandle.
 *
 * IMPORTANT (ADR-001 Correction A): constructor injection. No getRuntime().
 */

import type {
  SpreadsheetEngine,
  EngineSessionHandle,
  ExternalChangeStatus,
  WorkbookMetadata,
  EngineRangeResult,
  EngineFormulaCellsResult,
  EngineRecalcEdit,
  EngineRecalcRead,
  EngineRecalcResult,
  EngineMediaResult,
  EngineArchivePatch,
  WorksheetMetadata,
} from '@genoffice/runtime-contracts'
import type {
  SpreadsheetService,
  WorkbookSession,
  WorkbookOpenResult,
  SaveRequest,
  SaveResult,
} from '@genoffice/runtime-contracts'
import type { WorkbookOpenResult as FullOpenResult } from '@genoffice/runtime-contracts'

// ── Event bus ──────────────────────────────────────────────────────────

export interface SheetsEventBus {
  opened: (result: WorkbookOpenResult) => void
  renamed: (paths: { oldPath: string; newPath: string }) => void
  teardown: () => void
}

// ── Dependencies ──────────────────────────────────────────────────────

export interface SpreadsheetServiceDeps {
  /** The spreadsheet execution engine (injected — runtime chooses impl). */
  engine: SpreadsheetEngine
}

// ── Implementation ────────────────────────────────────────────────────

export class SpreadsheetServiceImpl implements SpreadsheetService {
  private readonly eventListeners = {
    opened: new Set<(r: WorkbookOpenResult) => void>(),
    renamed: new Set<(p: { oldPath: string; newPath: string }) => void>(),
    teardown: new Set<() => void>(),
  }

  constructor(
    private readonly deps: SpreadsheetServiceDeps,
    private readonly eventBus: SheetsEventBus,
  ) {}

  // ── Workbook lifecycle ──────────────────────────────────────────────

  async open(
    workbook: Uint8Array,
    locale: string,
    fileName: string,
  ): Promise<WorkbookOpenResult | null> {
    try {
      const { handle, metadata } = await this.deps.engine.open(workbook, locale, fileName)

      // Build the domain session — no engine handle, no snapshot path
      const sheetNames = new Map<string, string>()
      for (const sheet of metadata.sheets) {
        sheetNames.set(sheet.name, sheet.name)
      }

      const session: WorkbookSession = {
        workbookPath: fileName,
        workbookHash: metadata.sha256,
        sheetNames,
      }

      const result: WorkbookOpenResult = {
        session,
        engineHandle: handle,
        metadata,
      }

      this.eventBus.opened(result)
      for (const fn of this.eventListeners.opened) fn(result)

      return result
    } catch {
      return null
    }
  }

  async close(engineHandle: EngineSessionHandle): Promise<{ ok: boolean }> {
    try {
      await this.deps.engine.close(engineHandle)
      return { ok: true }
    } catch {
      return { ok: false }
    }
  }

  // ── Workbook operations ─────────────────────────────────────────────

  async readRange(
    session: WorkbookSession,
    engineHandle: EngineSessionHandle,
    sheetId: string,
    range: string,
  ): Promise<EngineRangeResult> {
    const sheetName = this.resolveSheetName(session, sheetId)
    return this.deps.engine.readRange(engineHandle, sheetName, range)
  }

  async readFormulaCells(
    session: WorkbookSession,
    engineHandle: EngineSessionHandle,
    sheetId: string,
  ): Promise<EngineFormulaCellsResult> {
    const sheetName = this.resolveSheetName(session, sheetId)
    return this.deps.engine.readFormulaCells(engineHandle, sheetName)
  }

  async recalculate(
    session: WorkbookSession,
    engineHandle: EngineSessionHandle,
    edits: EngineRecalcEdit[],
    reads: EngineRecalcRead[],
  ): Promise<EngineRecalcResult> {
    // Resolve domain sheet ids → engine sheet names
    const resolvedEdits = edits.map((e) => ({
      ...e,
      sheetName: this.resolveSheetName(session, e.sheetName),
    }))
    const resolvedReads = reads.map((r) => ({
      ...r,
      sheetName: this.resolveSheetName(session, r.sheetName),
    }))
    return this.deps.engine.recalculate(engineHandle, resolvedEdits, resolvedReads)
  }

  async readMedia(
    engineHandle: EngineSessionHandle,
    visualId: string,
  ): Promise<EngineMediaResult> {
    return this.deps.engine.readMedia(engineHandle, visualId)
  }

  // ── Save ────────────────────────────────────────────────────────────

  async save(
    session: WorkbookSession,
    engineHandle: EngineSessionHandle,
    request: SaveRequest,
    externalChange: ExternalChangeStatus,
  ): Promise<SaveResult> {
    // Apply the frozen external-change policy
    if (externalChange === 'changed' || externalChange === 'unknown') {
      return { ok: false, reason: 'external-modified' }
    }
    // externalChange === 'unchanged' → proceed with save
    try {
      const data = await this.deps.engine.saveArchive(engineHandle, request.patches)
      return { ok: true, data }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }

  async writeRecovery(
    session: WorkbookSession,
    engineHandle: EngineSessionHandle,
    request: SaveRequest,
  ): Promise<{ ok: boolean; data?: Uint8Array }> {
    try {
      const data = await this.deps.engine.saveArchive(engineHandle, request.patches)
      return { ok: true, data }
    } catch {
      return { ok: false }
    }
  }

  // ── Domain events ────────────────────────────────────────────────────

  onOpened(handler: (result: WorkbookOpenResult) => void): () => void {
    this.eventListeners.opened.add(handler)
    return () => this.eventListeners.opened.delete(handler)
  }

  onRenamed(handler: (paths: { oldPath: string; newPath: string }) => void): () => void {
    this.eventListeners.renamed.add(handler)
    return () => this.eventListeners.renamed.delete(handler)
  }

  onTeardown(handler: () => void): () => void {
    this.eventListeners.teardown.add(handler)
    return () => this.eventListeners.teardown.delete(handler)
  }

  // ── Internal: sheet-id translation ───────────────────────────────────

  /**
   * Resolve a domain sheetId to the engine's file sheet name.
   * The service owns this translation — the engine never sees domain sheet ids.
   */
  private resolveSheetName(session: WorkbookSession, sheetId: string): string {
    const sheetName = session.sheetNames.get(sheetId)
    if (!sheetName) {
      // If the sheetId isn't in the map, it may be a direct file sheet name
      // (the renderer sometimes passes file names directly)
      return sheetId
    }
    return sheetName
  }
}
