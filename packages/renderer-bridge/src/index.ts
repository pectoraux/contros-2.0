/**
 * @genoffice/renderer-bridge — barrel export.
 *
 * Pure object factories that return the existing window.* API shapes.
 * NO window mutation inside this package (ADR-002 §2.3).
 * NO Proxy (ADR-002 §2.2 — explicit typed method mappings only).
 * ZERO type assertions (`as never`, `as any`, `as T`, `as LegacyType`)
 * — all conversions use runtime-validated type guards.
 *
 * Inventory: 11 bridge factories covering 10 distinct window.* global names.
 */
export { createHomeBridge } from './bridges/home-bridge.js'
export { createTabsBridge } from './bridges/tabs-bridge.js'
export {
  createProjectApiBridge,
  createProjectHomeBridge,
  type ProjectHomeBridgeDeps,
} from './bridges/project-bridge.js'
export { createUpdateBridge, type UpdateBridgeDeps } from './bridges/update-bridge.js'
export { createDocsDesktopBridge, type DocsBridgeDeps } from './bridges/docs-bridge.js'
export { createSheetsDesktopApiBridge } from './bridges/sheets-bridge.js'
export { createSlidesApiBridge } from './bridges/slides-bridge.js'
export { createSlidesDesktopBridge } from './bridges/slides-desktop-bridge.js'
export { createPdfApiBridge } from './bridges/pdf-bridge.js'
export { createMarkdownApiBridge } from './bridges/markdown-bridge.js'

// Shell types (application-boundary, NOT runtime-contracts)
export type { DocsShellCoordinator, ShellTabInfo, ShellMenuCommand } from './shell/docs-coordinator.js'

// Conversion functions (runtime-validated, tested explicitly)
export {
  toLegacyLanguage,
  wrapLanguageHandler,
  fromStorageStringArray,
  fromStorageProjectSummary,
  fromStorageRecentEntries,
  fromStorageRecentPage,
  fromStorageStarPrompt,
  fromStorageCloudProjects,
  type LegacyLanguage,
  type RecentEntryFields,
  type RecentPageFields,
  type StarPromptShowFields,
  type CloudProjectsSnapshotFields,
  type CloudProjectEntryFields,
  type ProjectSummaryFields,
} from './conversions/docs-conversions.js'
