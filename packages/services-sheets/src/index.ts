/**
 * @genoffice/services-sheets — barrel export.
 *
 * The runtime-independent Sheets domain service. Composes SpreadsheetEngine
 * (from runtime-contracts). The engine accepts the domain SavePlan directly
 * via applySavePlan — no SavePlanTranslator needed (Increment 3C removed it;
 * the translation is now entirely below the engine boundary).
 *
 * ZERO Electron imports. ZERO node:* imports. ZERO app imports.
 * The service receives only SpreadsheetEngine via constructor injection.
 *
 * DOMAIN-EVENT PURITY (Increment 3A):
 *   The service does NOT export a SheetsEventBus or any onOpened/onRenamed/
 *   onTeardown surface. The shell coordinator owns renderer/event routing.
 *
 * SAVE DOMAIN MODEL (Increment 3B + 3C):
 *   The SavePlan types (SheetCellEdit, SheetStructuralOp, SheetOp, etc.) are
 *   re-exported from runtime-contracts so callers can construct save requests
 *   from the renderer's mutation model. The service delegates to
 *   engine.applySavePlan(handle, plan) — no EngineArchivePatch leakage.
 */
export {
  SpreadsheetServiceImpl,
} from './spreadsheet-service.js'
