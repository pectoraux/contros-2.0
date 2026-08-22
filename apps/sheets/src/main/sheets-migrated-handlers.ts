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
      `${request.range.startRow}:${request.range.startColumn}-${request.range.endRow}:${request.range.endColumn}`,
    )
    // Map EngineRangeResult → WorkbookRangeResult
    return workbookRangeResultSchema.parse(result)
  })

  // ── workbook:read-formulas ──
  ipcMain.removeHandler(IPC_CHANNELS.readWorkbookFormulas)
  ipcMain.handle(IPC_CHANNELS.readWorkbookFormulas, async (event, input: unknown) => {
    const wcId = wcIdFromEvent(event)
    const request = workbookFormulaCellsRequestSchema.parse(input)
    const result = await coordinator.readFormulaCells(
      wcId, request.sessionId, request.sheetId,
    )
    // Map EngineFormulaCellsResult → WorkbookFormulaCellsResult
    return workbookFormulaCellsResultSchema.parse({
      cells: result.cells.map(c => ({
        row: c.row,
        column: c.column,
        value: c.formula,
      })),
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
