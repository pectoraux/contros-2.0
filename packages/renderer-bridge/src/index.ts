/**
 * @genoffice/renderer-bridge — barrel export.
 *
 * Pure object factories that return the existing window.* API shapes.
 * NO window mutation inside this package (ADR-002 §2.3).
 * NO Proxy (ADR-002 §2.2 — explicit typed method mappings only).
 *
 * The preload (Electron) or iframe bootstrap (Web) calls these factories
 * and installs the result onto window.
 */
export { createHomeBridge } from './bridges/home-bridge.js'
export { createTabsBridge } from './bridges/tabs-bridge.js'
export { createProjectApiBridge, createProjectHomeBridge } from './bridges/project-bridge.js'
export { createUpdateBridge } from './bridges/update-bridge.js'
export { createDocsDesktopBridge } from './bridges/docs-bridge.js'
export { createSheetsDesktopApiBridge } from './bridges/sheets-bridge.js'
export { createSlidesApiBridge } from './bridges/slides-bridge.js'
export { createSlidesDesktopBridge } from './bridges/slides-desktop-bridge.js'
export { createPdfApiBridge } from './bridges/pdf-bridge.js'
export { createMarkdownApiBridge } from './bridges/markdown-bridge.js'
