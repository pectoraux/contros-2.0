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
 * ERROR MODEL (Increment 3A correction):
 *   The service preserves typed engine/domain failures. It does NOT silently
 *   convert every engine exception into `null` or `{ ok: false }`:
 *     - open()          → throws EngineError | InvalidSessionError | InvalidInputError
 *     - close()         → throws EngineError | InvalidSessionError
 *     - writeRecovery() → throws EngineError | InvalidSessionError
 *   Only `save()` returns a soft-failure result, because external-change
 *   policy refusal ({ ok: false, reason: 'external-modified' }) is a
 *   legitimate business outcome. Engine failures during save still throw.
 *
 * DOMAIN-EVENT PURITY (Increment 3A correction):
 *   The service does NOT own renderer/event routing. It exposes NO
 *   `onOpened`, `onRenamed`, `onTeardown`, `SheetsEventBus`, or
 *   `{ oldPath, newPath }` payloads. The shell coordinator owns:
 *     - `docs/workbook opened` notification
 *     - `renamed` notification
 *     - `teardown` notification
 *     - renderer notification dispatch
 *
 * IMPORTANT (ADR-001 Correction A): constructor injection. No getRuntime().
 */

import type {
  SpreadsheetEngine,
  EngineSessionHandle,
  ExternalChangeStatus,
  EngineRangeResult,
  EngineFormulaCellsResult,
  EngineRecalcEdit,
  EngineRecalcRead,
  EngineRecalcResult,
  EngineMediaResult,
  EngineArchivePatch,
} from '@genoffice/runtime-contracts'
import type {
  SpreadsheetService,
  WorkbookSession,
  WorkbookOpenResult,
  SaveRequest,
  SaveResult,
} from '@genoffice/runtime-contracts'

// ── Dependencies ──────────────────────────────────────────────────────

export interface SpreadsheetServiceDeps {
  /** The spreadsheet execution engine (injected — runtime chooses impl). */
  engine: SpreadsheetEngine
}

// ── Implementation ────────────────────────────────────────────────────

export class SpreadsheetServiceImpl implements SpreadsheetService {
  constructor(private readonly deps: SpreadsheetServiceDeps) {}

  // ── Workbook lifecycle ──────────────────────────────────────────────

  async open(
    workbook: Uint8Array,
    locale: string,
    fileName: string,
  ): Promise<WorkbookOpenResult> {
    // Delegate to the engine. Typed engine failures (InvalidInputError,
    // InvalidSessionError, EngineError) propagate to the caller.
    const { handle, metadata } = await this.deps.engine.open(workbook, locale, fileName)

    // Build the domain session — no engine handle, no snapshot path,
    // no absolute filesystem path. workbookName is a basename only.
    const sheetNames = new Map<string, string>()
    for (const sheet of metadata.sheets) {
      sheetNames.set(sheet.name, sheet.name)
    }

    const session: WorkbookSession = {
      workbookName: fileName,
      workbookHash: metadata.sha256,
      sheetNames,
    }

    return {
      session,
      engineHandle: handle,
      metadata,
    }
  }

  async close(engineHandle: EngineSessionHandle): Promise<void> {
    // Delegate to the engine. Typed engine failures (InvalidSessionError,
    // EngineError) propagate to the caller — do NOT swallow them as
    // { ok: false }. The caller must distinguish invalid-session from
    // protocol failure from engine failure.
    await this.deps.engine.close(engineHandle)
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
    session: WorkbookSession,
    engineHandle: EngineSessionHandle,
    visualId: string,
  ): Promise<EngineMediaResult> {
    // visualId is scoped to the workbook session. The `session` parameter
    // is accepted for API consistency with readRange/readFormulaCells/
    // recalculate (domain/session model). The handle scopes the request
    // server-side; the session is reserved for future domain validation.
    void session
    return this.deps.engine.readMedia(engineHandle, visualId)
  }

  // ── Save ────────────────────────────────────────────────────────────

  async save(
    session: WorkbookSession,
    engineHandle: EngineSessionHandle,
    request: SaveRequest,
    externalChange: ExternalChangeStatus,
  ): Promise<SaveResult> {
    // Apply the frozen external-change policy. This is the ONLY legitimate
    // soft-failure outcome — refused in-place save is a business decision,
    // NOT an error. The shell prompts the user to Save-As.
    if (externalChange === 'changed' || externalChange === 'unknown') {
      return { ok: false, reason: 'external-modified' }
    }
    // externalChange === 'unchanged' → proceed with save.
    // Typed engine failures (InvalidSessionError, InvalidInputError,
    // EngineError) propagate to the caller — do NOT swallow them as
    // { ok: false, error: string }.
    void session
    const data = await this.deps.engine.saveArchive(engineHandle, request.patches)
    return { ok: true, data }
  }

  async writeRecovery(
    session: WorkbookSession,
    engineHandle: EngineSessionHandle,
    request: SaveRequest,
  ): Promise<Uint8Array> {
    // Delegate to the engine. Typed engine failures propagate to the
    // caller — do NOT swallow them as { ok: false }. The caller must
    // distinguish invalid-session from protocol failure from engine
    // failure (e.g. to decide whether to retry vs. surface an error).
    void session
    return this.deps.engine.saveArchive(engineHandle, request.patches)
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
