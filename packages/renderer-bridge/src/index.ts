/**
 * @genoffice/renderer-bridge — barrel export.
 *
 * Pure object factories that return the existing window.* API shapes.
 * NO window mutation inside this package (ADR-002 §2.3).
 * NO Proxy (ADR-002 §2.2 — explicit typed method mappings only).
 * NO `as never` / `as any` casts (Phase 1 final correction).
 *
 * Inventory: 11 bridge factories covering 10 distinct window.* global names.
 *
 * BOUNDARY CORRECTION (2026-08-21, final): createDocsDesktopBridge takes
 * DocsBridgeDeps (runtime + coordinator). The coordinator lives in
 * renderer-bridge/src/shell/ (application boundary, not runtime-contracts).
 */
export { createHomeBridge } from './bridges/home-bridge.js'
export { createTabsBridge } from './bridges/tabs-bridge.js'
export { createProjectApiBridge, createProjectHomeBridge } from './bridges/project-bridge.js'
export { createUpdateBridge } from './bridges/update-bridge.js'
export { createDocsDesktopBridge, type DocsBridgeDeps } from './bridges/docs-bridge.js'
export { createSheetsDesktopApiBridge } from './bridges/sheets-bridge.js'
export { createSlidesApiBridge } from './bridges/slides-bridge.js'
export { createSlidesDesktopBridge } from './bridges/slides-desktop-bridge.js'
export { createPdfApiBridge } from './bridges/pdf-bridge.js'
export { createMarkdownApiBridge } from './bridges/markdown-bridge.js'

// Shell types (application-boundary, NOT runtime-contracts)
export type { DocsShellCoordinator, ShellTabInfo, ShellMenuCommand } from './shell/docs-coordinator.js'

// Conversion functions (tested explicitly)
export { toLegacyLanguage, wrapLanguageHandler, fromStorage, fromStorageOrNull, type LegacyLanguage } from './conversions/docs-conversions.js'
