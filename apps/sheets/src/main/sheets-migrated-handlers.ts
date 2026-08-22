/**
 * Migrated Sheets IPC handlers — thin adapter that delegates to
 * SheetsShellCoordinator.
 *
 * This module contains ZERO domain logic. It only:
 *   - extracts event.sender.id → wcId
 *   - resolves sessionId from the request payload
 *   - calls the coordinator
 *   - maps the result to the frozen renderer response shape
 *
 * ARCHITECTURE GUARDS (verified by tests):
 *   - ZERO XlsxSidecarClient imports
 *   - ZERO child_process imports
 *   - ZERO direct xlsx-gateway calls
 *   - ZERO filesystem save/open implementation
 *   - ZERO getFocusedWindow
 *   - ZERO global session state
 *
 * INCREMENT 6 (save + recovery migration):
 *   workbook:save and workbook:write-recovery are now migrated here.
 *   They translate the renderer's WorkbookSaveRequest → domain SavePlan,
 *   delegate to coordinator.saveWorkbook()/writeRecovery(), and map the
 *   result back to the frozen response shape. All commit-journal / atomic
 *   promotion / teardown-safety logic lives in the coordinator — this
 *   handler does NOT touch the filesystem, commit markers, or snapshots.
 */

import { ipcMain, BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'

import { IPC_CHANNELS } from '../shared/ipc-channels'
import {
  workbookRangeRequestSchema,
  workbookRangeResultSchema,
  workbookFormulaCellsRequestSchema,
  workbookFormulaCellsResultSchema,
  workbookRecalcRequestSchema,
  workbookRecalcResultSchema,
  workbookMediaRequestSchema,
  workbookMediaResultSchema,
  workbookSaveRequestSchema,
  type WorkbookSaveRequest,
} from '../shared/desktop-api'
import type { SheetsShellCoordinator, ShellWorkbookSession } from './sheets-shell-coordinator'
import type {
  EngineRecalcEdit,
  EngineRecalcRead,
  SaveRequest,
  SavePlan,
} from '@genoffice/runtime-contracts'

// ── Session resolution ──

/** Resolve wcId from an IPC event. */
function wcIdFromEvent(event: IpcMainInvokeEvent): number {
  return event.sender.id
}

/**
 * Convert a numeric {startRow,startColumn,endRow,endColumn} range (0-indexed)
 * to Excel A1 notation (e.g. {0,0,0,1} → "A1:B1").
 *
 * INCREMENT 5B (build-fix): the migrated handler was producing
 * "0:0-0:1" which the engine's parseRange rejects. The engine contract
 * expects A1:B2 string notation. This helper mirrors the engine's
 * private colToIdx inverse without depending on the engine internals.
 */
function rangeToA1(r: { startRow: number; startColumn: number; endRow: number; endColumn: number }): string {
  return `${colIdxToLetter(r.startColumn)}${r.startRow + 1}:${colIdxToLetter(r.endColumn)}${r.endRow + 1}`
}

function colIdxToLetter(idx: number): string {
  let s = ''
  let n = idx + 1
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/**
 * Parse an A1 cell reference (e.g. "A1", "Z100", "AA1") to 0-indexed
 * (row, column). Used to convert the engine's hyperlinks `{ cell: "A1" }`
 * to the renderer's `{ row: 0, column: 0 }`.
 */
function parseCellRef(ref: string): { row: number; column: number } {
  const match = ref.match(/^([A-Z]+)(\d+)$/)
  if (!match) return { row: 0, column: 0 }
  const colStr = match[1]
  const rowStr = match[2]
  if (colStr === undefined || rowStr === undefined) return { row: 0, column: 0 }
  let col = 0
  for (const ch of colStr) col = col * 26 + (ch.charCodeAt(0) - 64)
  return { row: parseInt(rowStr, 10) - 1, column: col - 1 }
}

// ── Register migrated handlers ──

let migratedIpcRegistered = false

/**
 * Register the 5 migrated Sheets IPC handlers.
 * Must be called AFTER the coordinator is constructed and AFTER
 * the legacy registerSheetsIpc() has run (so the migrated handlers
 * replace the legacy ones).
 *
 * The coordinator MUST have its sessions registered via the legacy
 * open path (workbook:select is NOT yet migrated). The migrated
 * handlers resolve sessions from the coordinator's registry.
 */
export function registerMigratedSheetsIpc(coordinator: SheetsShellCoordinator): void {
  if (migratedIpcRegistered) return
  migratedIpcRegistered = true

  // ── workbook:read-range ──
  ipcMain.removeHandler(IPC_CHANNELS.readWorkbookRange)
  ipcMain.handle(IPC_CHANNELS.readWorkbookRange, async (event, input: unknown) => {
    const wcId = wcIdFromEvent(event)
    const request = workbookRangeRequestSchema.parse(input)
    const result = await coordinator.readRange(
      wcId, request.sessionId, request.sheetId,
      rangeToA1(request.range),
    )
    // INCREMENT 5B (build-fix): Translate EngineRangeResult → WorkbookRangeResult.
    // The engine contract uses different field names than the renderer's frozen
    // schema (conditionalFormatting vs conditionalRules, dataValidation vs
    // dataValidations). The validator now reads the sidecar's actual field
    // names (conditionalRules, dataValidations) and stores them in the engine
    // contract's fields. The translator below renames them back to the
    // renderer's expected names and adds defaults for fields the engine
    // contract doesn't carry (indexedThroughRow, indexingComplete, protectedRanges).
    // Extra engine-only fields (columns, rowBreaks, columnBreaks) are dropped.
    return workbookRangeResultSchema.parse({
      cells: result.cells.map(c => {
        // Recover the typed value: if the engine has a number, use it;
        // otherwise use the string value.
        const value = c.number !== undefined ? c.number : c.value
        const cell: Record<string, unknown> = {
          row: c.row,
          column: c.column,
          value,
        }
        if (c.isFormula) cell.formula = c.value
        if (c.styleIndex !== undefined && c.styleIndex !== 0) cell.styleIndex = c.styleIndex
        return cell
      }),
      rows: result.rows.map(r => {
        const row: Record<string, unknown> = { row: r.row, hidden: r.hidden ?? false }
        if (r.height !== undefined) row.height = r.height
        if (r.customHeight !== undefined) row.customHeight = r.customHeight
        if (r.outlineLevel !== undefined) row.outlineLevel = r.outlineLevel
        if (r.collapsed !== undefined) row.collapsed = r.collapsed
        if (r.styleIndex !== undefined) row.styleIndex = r.styleIndex
        return row
      }),
      merges: result.merges.map(m => ({
        startRow: m.firstRow, startColumn: m.firstColumn,
        endRow: m.lastRow, endColumn: m.lastColumn,
      })),
      hyperlinks: result.hyperlinks.map(h => {
        // Engine returns { cell: "A1", target: "..." } — convert to
        // { row, column, target } for the renderer.
        const parsed = parseCellRef(h.cell)
        return { row: parsed.row, column: parsed.column, target: h.target }
      }),
      conditionalRules: result.conditionalFormatting,
      autoFilter: result.autoFilter ?? null,
      dataValidations: result.dataValidation,
      sheetProtection: result.sheetProtection
        ? { protected: true, hasPassword: false }
        : null,
      protectedRanges: [],
      rowBreaks: result.rowBreaks,
      colBreaks: result.columnBreaks,
      indexedThroughRow: null,
      indexingComplete: true,
    })
  })

  // ── workbook:read-formulas ──
  ipcMain.removeHandler(IPC_CHANNELS.readWorkbookFormulas)
  ipcMain.handle(IPC_CHANNELS.readWorkbookFormulas, async (event, input: unknown) => {
    const wcId = wcIdFromEvent(event)
    const request = workbookFormulaCellsRequestSchema.parse(input)
    const result = await coordinator.readFormulaCells(
      wcId, request.sessionId, request.sheetId,
    )
    // INCREMENT 5B (build-fix): Translate EngineFormulaCellsResult →
    // WorkbookFormulaCellsResult. The engine contract doesn't carry
    // indexingComplete or truncated (the sidecar does); the migrated
    // handler defaults them to true/false (trusted-complete). The cell
    // shape is mapped: engine's { formula, cachedValue? } → renderer's
    // { value, formula }.
    return workbookFormulaCellsResultSchema.parse({
      cells: result.cells.map(c => {
        const cell: Record<string, unknown> = {
          row: c.row,
          column: c.column,
          value: c.cachedValue ?? '',
        }
        if (c.formula) cell.formula = c.formula
        return cell
      }),
      indexingComplete: true,
      truncated: false,
    })
  })

  // ── workbook:recalc ──
  ipcMain.removeHandler(IPC_CHANNELS.recalcWorkbook)
  ipcMain.handle(IPC_CHANNELS.recalcWorkbook, async (event, input: unknown) => {
    const wcId = wcIdFromEvent(event)
    const request = workbookRecalcRequestSchema.parse(input)
    const edits: EngineRecalcEdit[] = request.edits.map(e => ({
      sheetName: e.sheetId, // service resolves sheetId → sheetName internally
      row: e.row,
      column: e.column,
      value: e.input,
    }))
    const reads: EngineRecalcRead[] = request.reads.map(r => ({
      sheetName: r.sheetId, // service resolves sheetId → sheetName internally
      row: r.range.startRow,
      column: r.range.startColumn,
    }))
    const result = await coordinator.recalculate(wcId, request.sessionId, edits, reads)
    // Map EngineRecalcResult → WorkbookRecalcResult
    // The service returns cells with sheetName; map back to sheetId
    // by looking up in the session's domainSession.sheetNames map
    const session = coordinator.getSession(wcId, request.sessionId)
    const idsByName = new Map<string, string>()
    for (const [id, name] of session.domainSession.sheetNames) {
      idsByName.set(name, id)
    }
    return workbookRecalcResultSchema.parse({
      cells: result.cells.flatMap(c => {
        const sheetId = idsByName.get(c.sheetName)
        if (sheetId === undefined) return []
        return [{
          sheetId,
          row: c.row,
          column: c.column,
          formatted: c.formatted,
          ...(c.number !== undefined ? { number: c.number } : {}),
          isFormula: c.isFormula,
        }]
      }),
    })
  })

  // ── workbook:read-media ──
  ipcMain.removeHandler(IPC_CHANNELS.readWorkbookMedia)
  ipcMain.handle(IPC_CHANNELS.readWorkbookMedia, async (event, input: unknown) => {
    const wcId = wcIdFromEvent(event)
    const request = workbookMediaRequestSchema.parse(input)
    const result = await coordinator.readMedia(
      wcId, request.sessionId, request.visualId,
    )
    // Map EngineMediaResult → WorkbookMediaResult
    return workbookMediaResultSchema.parse(result)
  })

  // ── workbook:close ──
  ipcMain.removeHandler(IPC_CHANNELS.closeWorkbook)
  ipcMain.handle(IPC_CHANNELS.closeWorkbook, async (event, sessionId: unknown) => {
    const wcId = wcIdFromEvent(event)
    const validatedSessionId = z.string().uuid().parse(sessionId)
    await coordinator.closeWorkbook(wcId, validatedSessionId)
    // Legacy handler returns void
  })

  // ── workbook:save (INCREMENT 6) ──
  // Migrated from sheets-main.ts. The handler is a THIN ADAPTER:
  //   1. Validates input via workbookSaveRequestSchema (frozen IPC shape)
  //   2. Translates WorkbookSaveRequest → SaveRequest (wrapping SavePlan)
  //   3. Calls coordinator.saveWorkbook(wcId, sessionId, request, mode, callerWindow)
  //   4. Maps the SaveResult → frozen WorkbookSaveResult
  //
  // The coordinator owns the commit journal (Phase A/B/C), atomic promotion
  // (rename, no copyFile fallback), teardown safety, external-change policy,
  // and session replacement. This handler does NOT:
  //   - invoke XlsxSidecarClient
  //   - call xlsx-package-io or xlsx-gateway planning functions
  //   - manipulate snapshots or commit markers
  //   - call child_process or node:fs
  //   - perform recovery logic
  ipcMain.removeHandler(IPC_CHANNELS.saveWorkbook)
  ipcMain.handle(IPC_CHANNELS.saveWorkbook, async (event, input: unknown) => {
    const wcId = wcIdFromEvent(event)
    const request = workbookSaveRequestSchema.parse(input)
    const callerWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined

    const saveRequest = translateSaveRequest(request)
    const result = await coordinator.saveWorkbook(
      wcId, request.sessionId, saveRequest, request.mode, callerWindow,
    )

    // Map SaveResult → frozen WorkbookSaveResult
    if ('canceled' in result && result.canceled) {
      return { canceled: true }
    }
    if (!result.ok) {
      // External-change policy refusal — the service returned { ok: false,
      // reason: 'external-modified' }. The legacy handler threw tm('errDiskChanged').
      // Preserve the throw semantics so the renderer's catch path stays unchanged.
      throw new Error('errDiskChanged')
    }

    // Build the WorkbookFile from the replacement session's metadata.
    // After a successful save, the coordinator has replaced the old session
    // with a new one (same sessionId, new engine handle, new snapshot, new
    // fingerprint). We read the replacement session and build a WorkbookFile
    // the renderer can use to update its in-memory state.
    const session = coordinator.getSession(wcId, request.sessionId)
    const file = buildWorkbookFile(session)
    return {
      canceled: false as const,
      file,
      touchedEntries: result.touchedEntries ?? [],
    }
  })

  // ── workbook:write-recovery (INCREMENT 6) ──
  // Migrated from sheets-main.ts. The handler is a THIN ADAPTER:
  //   1. Validates input via workbookSaveRequestSchema
  //   2. Translates WorkbookSaveRequest → SaveRequest
  //   3. Calls coordinator.writeRecovery(wcId, sessionId, request)
  //   4. Returns { ok: boolean }
  //
  // The coordinator owns the recovery path derivation, epoch, mutation lock,
  // and stale-write rejection. This handler does NOT:
  //   - invoke XlsxSidecarClient
  //   - derive recovery paths (recoveryPathFor)
  //   - manipulate recovery files
  //   - call child_process or node:fs
  ipcMain.removeHandler(IPC_CHANNELS.writeWorkbookRecovery)
  ipcMain.handle(IPC_CHANNELS.writeWorkbookRecovery, async (event, input: unknown) => {
    const wcId = wcIdFromEvent(event)
    const request = workbookSaveRequestSchema.parse(input)
    const saveRequest = translateSaveRequest(request)
    const result = await coordinator.writeRecovery(wcId, request.sessionId, saveRequest)
    return result
  })
}

// ── SavePlan translator ──────────────────────────────────────────────

/**
 * Translate the renderer's frozen WorkbookSaveRequest → domain SaveRequest.
 *
 * The SavePlan domain types mirror the WorkbookSaveRequest types (they were
 * designed to match — see save-plan.ts). The mapping is 1:1: every field
 * is passed through with its sheetId intact (the service resolves sheetId →
 * file sheet name internally via session.sheetNames, fail-closed on unknown).
 *
 * This translator does NOT:
 *   - resolve sheetIds to sheetNames (the service does this)
 *   - call xlsx-gateway planning functions (the engine does this internally)
 *   - perform any filesystem operations
 *
 * INCREMENT 6: this replaces the legacy writeWorkbookTo() function in
 * sheets-main.ts, which did extensive sheetId → sheetName resolution before
 * calling saveWorkbookViaSidecar(). The migrated path delegates that
 * resolution to the service layer (SpreadsheetServiceImpl.validateSavePlanSheetIds).
 */
function translateSaveRequest(request: WorkbookSaveRequest): SaveRequest {
  // The Zod-validated WorkbookSaveRequest fields are structurally compatible
  // with the SavePlan domain types (they were designed to mirror each other
  // — see save-plan.ts header comment). The only difference is `readonly`
  // modifiers: the domain types use `readonly` on all fields, while Zod's
  // inferred types are mutable. We bridge this with a double cast through
  // `unknown` — safe because the Zod schema guarantees the input shape, and
  // `readonly` is a compile-time-only concern (no runtime effect).
  const plan = {
    edits: request.edits,
    structuralOps: request.structuralOps,
    formulaValues: request.formulaValues,
    sheetOps: request.sheetOps,
    sheetOrder: request.sheetOrder,
    filterStates: request.filterStates,
    hyperlinkEdits: request.hyperlinkEdits,
    cfStates: request.cfStates,
    dvStates: request.dvStates,
    pageSetupStates: request.pageSetupStates,
    noteStates: request.noteStates,
    sheetProtections: request.sheetProtections,
    protectedRangeStates: request.protectedRangeStates,
    visualAdditions: request.visualAdditions,
    tableAdditions: request.tableAdditions,
    pivotAdditions: request.pivotAdditions,
    sparklineAdditions: request.sparklineAdditions,
    chartEdits: request.chartEdits,
    visualEdits: request.visualEdits,
    pivotCacheRefreshPaths: request.pivotCacheRefreshPaths,
    pivotRefreshUpdates: request.pivotRefreshUpdates,
    definedNamesState: request.definedNamesState,
    themeState: request.themeState,
    workbookProtectionState: request.workbookProtectionState,
  } as unknown as SavePlan
  return { plan }
}

// ── WorkbookFile builder ────────────────────────────────────────────

/**
 * Build the renderer's frozen WorkbookFile from the coordinator's
 * ShellWorkbookSession.
 *
 * After a successful save, the coordinator has replaced the old session with
 * a new one (same sessionId). The replacement session carries the full
 * WorkbookMetadata from engine.open() (which captures the sidecar's open
 * response including styles, dxfStyles, visuals, sheets with columnWidths/
 * tables/comments/pivotRanges, and definedNames with formula+sheetIndex).
 *
 * This function maps the contract metadata to the renderer's WorkbookFile
 * shape, including the fields the preload validates (sessionId, name, path,
 * sha256, entryCount, sheets with columnWidths/tables/comments/pivotRanges,
 * styles, dxfStyles, visuals, definedNames, readOnly, needsSaveAs,
 * restoredFromRecovery, themeColors, themeFonts).
 *
 * INCREMENT 6: after save, needsSaveAs is always false (the file has been
 * saved to its target — no longer needs Save As). restoredFromRecovery is
 * always false (the saved file is a regular file, not a recovery copy).
 */
function buildWorkbookFile(session: ShellWorkbookSession): unknown {
  const m = session.metadata
  // Map contract WorksheetMetadata → renderer's sheet shape.
  const sheets = m.sheets.map((s) => {
    const sheet: Record<string, unknown> = {
      id: s.id,
      name: s.name,
      rowCount: s.rowCount,
      columnCount: s.columnCount,
      columnWidths: s.columnWidths ?? [],
      defaultRowHeight: s.defaultRowHeight,
      defaultColumnWidth: s.defaultColumnWidth,
      freeze: null,
      hidden: s.hidden,
      tabColor: s.tabColor ?? null,
      showGridLines: s.showGridlines,
      showFormulas: false,
      showRowColHeaders: true,
      tables: s.tables ?? [],
      comments: s.comments ?? [],
      pivotRanges: s.pivotRanges ?? [],
    }
    return sheet
  })

  const file: Record<string, unknown> = {
    sessionId: session.sessionId,
    name: m.name,
    path: session.originalPath,
    // INCREMENT 6: Use the coordinator's diskFingerprint (computed via
    // sha256File(snapshot)) — NOT metadata.sha256, which comes from the
    // sidecar's open response and is often empty (the sidecar doesn't
    // compute sha256 for every open). The renderer's preload validates
    // sha256 as /^[a-f0-9]{64}$/, so an empty string would fail.
    sha256: session.diskFingerprint,
    entryCount: m.entryCount,
    sheets,
    activeTab: m.activeTab,
    styles: m.styles ?? [],
    dxfStyles: m.dxfStyles ?? [],
    visuals: m.visuals ?? [],
    definedNames: m.definedNames,
    readOnly: false,
    needsSaveAs: false,
    restoredFromRecovery: false,
  }
  if (m.themeColors.length > 0) file.themeColors = m.themeColors
  if (m.themeFonts.major || m.themeFonts.minor) file.themeFonts = m.themeFonts
  return file
}
