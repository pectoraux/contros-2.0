/**
 * @genoffice/services-sheets — barrel export.
 *
 * The runtime-independent Sheets domain service. Composes SpreadsheetEngine
 * (from runtime-contracts) with platform capabilities.
 *
 * ZERO Electron imports. ZERO node:* imports. ZERO app imports.
 * The service receives SpreadsheetEngine via constructor injection.
 */
export {
  SpreadsheetServiceImpl,
  type SpreadsheetServiceDeps,
  type SheetsEventBus,
} from './spreadsheet-service.js'
