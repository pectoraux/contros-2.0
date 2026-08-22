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
 */

import { ipcMain, type IpcMainInvokeEvent } from 'electron'
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
} from '../shared/desktop-api'
import type { SheetsShellCoordinator } from './sheets-shell-coordinator'
import type { EngineRecalcEdit, EngineRecalcRead } from '@genoffice/runtime-contracts'

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
}
