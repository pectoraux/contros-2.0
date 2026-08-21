/**
 * PdfService — domain runtime service for the PDF (`.pdf`) editor.
 *
 * BOUNDARY CORRECTION (2026-08-21, contract direction):
 *   This interface does NOT import from @genoffice/pdf-shared (which is a
 *   path alias to apps/pdf/src/shared/ipc.ts). The full PdfService interface
 *   (with all ~40 typed methods) will be defined when the PDF editor is
 *   extracted in Phase 1 increment 5.
 *
 *   For now, the service is NOT_YET_WIRED. This placeholder type allows the
 *   renderer-bridge to compile without depending on the app's shared contracts.
 *
 * IMPORTANT (ADR-001 Correction A): constructor injection. No getRuntime().
 */

/**
 * Placeholder type for the PdfService.
 *
 * When Phase 1 increment 5 (PDF) begins, this will be replaced with the
 * full typed interface (with all consumePending/readFile/save/extractPages/
 * etc. methods). The types will be defined in runtime-contracts, NOT imported
 * from @genoffice/pdf-shared.
 */
export type PdfService = Record<string, (...args: unknown[]) => unknown>
