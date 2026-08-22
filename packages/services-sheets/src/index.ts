/**
 * @genoffice/services-sheets — barrel export.
 *
 * The runtime-independent Sheets domain service. Composes SpreadsheetEngine
 * (from runtime-contracts) with an injected SavePlanTranslator (provided by
 * the shell at the engine boundary).
 *
 * ZERO Electron imports. ZERO node:* imports. ZERO app imports.
 * The service receives SpreadsheetEngine + SavePlanTranslator via constructor
 * injection.
 *
 * DOMAIN-EVENT PURITY (Increment 3A):
 *   The service does NOT export a SheetsEventBus or any onOpened/onRenamed/
 *   onTeardown surface. The shell coordinator owns renderer/event routing.
 *
 * SAVE DOMAIN MODEL (Increment 3B):
 *   The service exports the domain SavePlan types (SheetCellEdit,
 *   SheetStructuralOp, SheetOp, etc.) so the shell can construct save
 *   requests from the renderer's mutation model. The SavePlanTranslator
 *   interface is exported so the shell can provide an implementation.
 */
export {
  SpreadsheetServiceImpl,
} from './spreadsheet-service.js'
