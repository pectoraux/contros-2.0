/**
 * SpreadsheetService — domain runtime service for the sheets (`.xlsx`) editor.
 *
 * BOUNDARY CORRECTION (2026-08-21, contract direction):
 *   This interface does NOT import from @genoffice/sheets-shared (which is a
 *   path alias to apps/sheets/src/shared/desktop-api.ts). The full
 *   SpreadsheetService interface (with all ~35 typed methods) will be defined
 *   when the Sheets editor is extracted in Phase 1 increment 3.
 *
 *   For now, the service is NOT_YET_WIRED. This placeholder type allows the
 *   renderer-bridge to compile without depending on the app's shared contracts.
 *
 * IMPORTANT (ADR-001 Correction A): constructor injection. No getRuntime().
 */

/**
 * Placeholder type for the SpreadsheetService.
 *
 * When Phase 1 increment 3 (Sheets) begins, this will be replaced with the
 * full typed interface (with all workbook/read/recalc/save/export methods).
 * The types will be defined in runtime-contracts, NOT imported from
 * @genoffice/sheets-shared.
 */
export type SpreadsheetService = Record<string, (...args: unknown[]) => unknown>
