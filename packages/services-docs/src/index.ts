/**
 * @genoffice/services-docs — barrel export.
 *
 * The Docs domain service. Composes @genoffice/docx-engine + platform
 * capabilities to deliver the byte-preserving document lifecycle.
 *
 * IMPORTANT (ADR-001 Correction A): DocumentServiceImpl receives dependencies
 * via constructor. It does NOT call getRuntime() internally.
 *
 * BOUNDARY CORRECTION (2026-08-21, final): the service has ZERO node:* /
 * Electron imports, ZERO shell-hook deps, and ZERO tab/window operations.
 * Tab/window ops belong in the shell; the service publishes domain events
 * only via DocsEventBus.
 */
export {
  DocumentServiceImpl,
  type DocumentServiceDeps,
  type DocsEventBus,
} from './document-service.js'
export type { SessionRegistry } from './session-registry.js'
export { InMemorySessionRegistry } from './session-registry.js'
