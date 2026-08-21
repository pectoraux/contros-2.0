/**
 * @genoffice/runtime-contracts — barrel export.
 *
 * Platform-neutral runtime contracts: the RuntimeContext interface, the
 * getRuntime()/setRuntime() bootstrap mechanism, and the 5 domain service
 * interfaces. Zero implementations (stubs throw 'not implemented' in Phase 1).
 *
 * Layer 1 of the GenOffice runtime stack (ADR-001). The single architectural
 * seam every other layer depends on.
 */
export * from './runtime.js'
export * from './services/docs.js'
export * from './services/sheets.js'
export * from './services/slides.js'
export * from './services/pdf.js'
export * from './services/markdown.js'
export * from './services/project.js'
