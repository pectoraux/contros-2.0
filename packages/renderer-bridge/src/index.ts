/**
 * @genoffice/renderer-bridge — barrel export.
 *
 * Pure object factories that return the existing window.* API shapes.
 * NO window mutation inside this package (ADR-002 §2.3).
 * NO Proxy (ADR-002 §2.2 — explicit typed method mappings only).
 *
 * The preload (Electron) or iframe bootstrap (Web) calls these factories
 * and installs the result onto window.
 *
 * Inventory: 11 bridge factories covering 10 distinct `window.*` global names.
 * The +1 is because `window.desktop` has TWO different TypeScript shapes:
 *   - createDocsDesktopBridge returns `DesktopApi` (~35 methods, docs preload)
 *   - createSlidesDesktopBridge returns `DesktopFilesApi` (6 methods, slides preload)
 * Same global name, different shapes — each editor bundle declares its own
 * `Window` augmentation. Two factories are required.
 *
 * The Project pair (createProjectApiBridge + createProjectHomeBridge) covers
 * two DIFFERENT global names with DIFFERENT shapes:
 *   - window.projectApi (ProjectApi, 10 methods) — used by editor renderers
 *   - window.aiOfficeProject (ProjectHomeApi, 7 methods) — used by shell renderer
 *
 * BOUNDARY CORRECTION (2026-08-21, final): createDocsDesktopBridge now takes
 * a DocsBridgeDeps object (runtime + SessionRegistry) instead of just the runtime.
 * The registry is owned by the shell; the bridge queries it for sessions.
 *
 * Authoritative contract source: the actual checked-in TypeScript interface files
 * under apps/ (in each app's src/shared/ directory). ADR pseudocode is illustrative only.
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
