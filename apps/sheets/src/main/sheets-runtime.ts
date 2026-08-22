/**
 * Sheets runtime bundle — constructs the runtime-independent service stack
 * and the shell coordinator for the Sheets editor.
 *
 * Architecture:
 *   ElectronXlsxSidecarEngine (platform-electron)
 *     ↓ implements SpreadsheetEngine
 *   SpreadsheetServiceImpl (services-sheets)
 *     ↓ implements SpreadsheetService
 *   SheetsShellCoordinator (shell coordinator)
 *     ↓ owns session lifecycle
 *   Migrated IPC handlers (thin adapter)
 *
 * The coordinator receives ONLY SpreadsheetService — it does NOT import
 * or depend on XlsxSidecarClient, xlsx-gateway, child_process, or any
 * engine-specific code.
 */

import { ElectronXlsxSidecarEngine, type ElectronXlsxSidecarEngineConfig } from '@genoffice/platform-electron'
import { SpreadsheetServiceImpl } from '@genoffice/services-sheets/src/spreadsheet-service.js'
import { SheetsShellCoordinator } from './sheets-shell-coordinator'
import type { SpreadsheetEngine } from '@genoffice/runtime-contracts'

export interface SheetsRuntimeBundle {
  readonly engine: ElectronXlsxSidecarEngine
  readonly service: SpreadsheetServiceImpl
  readonly coordinator: SheetsShellCoordinator
}

/**
 * Construct the Sheets runtime bundle.
 *
 * @param config — sidecar binary path + optional temp dir
 * @returns the runtime bundle (engine + service + coordinator)
 */
export function initSheetsRuntime(config: ElectronXlsxSidecarEngineConfig): SheetsRuntimeBundle {
  const engine = new ElectronXlsxSidecarEngine(config)
  engine.start()

  const service = new SpreadsheetServiceImpl({ engine })

  const coordinator = new SheetsShellCoordinator({ service })

  return { engine, service, coordinator }
}
