/**
 * MarkdownService — domain runtime service for the markdown (`.md`) editor.
 *
 * BOUNDARY CORRECTION (2026-08-21, contract direction):
 *   This interface does NOT import from @genoffice/markdown-shared (which is a
 *   path alias to apps/markdown/src/shared/ipc.ts). The full MarkdownService
 *   interface (with all ~25 typed methods) will be defined when the Markdown
 *   editor is extracted in Phase 1 increment 6.
 *
 *   For now, the service is NOT_YET_WIRED. This placeholder type allows the
 *   renderer-bridge to compile without depending on the app's shared contracts.
 *
 * IMPORTANT (ADR-001 Correction A): constructor injection. No getRuntime().
 */

/**
 * Placeholder type for the MarkdownService.
 *
 * When Phase 1 increment 6 (Markdown) begins, this will be replaced with the
 * full typed interface (with all consumePending/readFile/save/exportDocx/
 * etc. methods). The types will be defined in runtime-contracts, NOT imported
 * from @genoffice/markdown-shared.
 */
export type MarkdownService = Record<string, (...args: unknown[]) => unknown>
