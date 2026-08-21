/**
 * PresentationService — domain runtime service for the slides (`.pptx`) editor.
 *
 * BOUNDARY CORRECTION (2026-08-21, contract direction):
 *   This interface does NOT import from @genoffice/slides-shared (which is a
 *   path alias to apps/slides/src/shared/ipc.ts). The full
 *   PresentationService interface (with all ~120 typed methods) will be defined
 *   when the Slides editor is extracted in Phase 1 increment 4.
 *
 *   For now, the service is NOT_YET_WIRED. This placeholder type allows the
 *   renderer-bridge to compile without depending on the app's shared contracts.
 *
 * IMPORTANT (ADR-001 Correction A): constructor injection. No getRuntime().
 */

/**
 * Placeholder type for the PresentationService.
 *
 * When Phase 1 increment 4 (Slides) begins, this will be replaced with the
 * full typed interface (with all editText/editTransform/addElement/etc. methods).
 * The types will be defined in runtime-contracts, NOT imported from
 * @genoffice/slides-shared.
 */
export type PresentationService = Record<string, (...args: unknown[]) => unknown>
