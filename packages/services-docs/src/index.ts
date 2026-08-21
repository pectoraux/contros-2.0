/**
 * @genoffice/services-docs — barrel export.
 *
 * The Docs domain service. Composes @genoffice/docx-engine + platform
 * capabilities to deliver the byte-preserving document lifecycle.
 *
 * IMPORTANT (ADR-001 Correction A): DocumentServiceImpl receives dependencies
 * via constructor. It does NOT call getRuntime() internally.
 */
export { DocumentServiceImpl, type DocumentServiceDeps, type DocsEventBus } from './document-service.js'
