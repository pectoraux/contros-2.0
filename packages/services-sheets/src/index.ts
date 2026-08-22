/**
 * @genoffice/services-sheets — barrel export.
 *
 * The runtime-independent Sheets domain service. Composes SpreadsheetEngine
 * (from runtime-contracts) with platform capabilities.
 *
 * ZERO Electron imports. ZERO node:* imports. ZERO app imports.
 * The service receives SpreadsheetEngine via constructor injection.
 *
 * DOMAIN-EVENT PURITY (Increment 3A):
 *   The service does NOT export a SheetsEventBus or any onOpened/onRenamed/
 *   onTeardown surface. The shell coordinator owns renderer/event routing.
 */
export {
  SpreadsheetServiceImpl,
  type SpreadsheetServiceDeps,
} from './spreadsheet-service.js'
