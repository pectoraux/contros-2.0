/**
 * RuntimeContext — the platform-neutral runtime bundle.
 *
 * Holds the 9 platform capabilities + 5 domain services + the project store.
 * Produced by a Layer 4 adapter (ElectronRuntime or WebRuntime) and consumed
 * by the renderer-bridge factories.
 *
 * ARCHITECTURAL RULE (ADR-001 Correction A):
 *   getRuntime() / setRuntime() is the SOLE permitted runtime mechanism in
 *   this package. Domain services MUST NOT call getRuntime() internally —
 *   they receive their dependencies via constructor injection.
 *
 *   getRuntime() is bootstrap infrastructure (called once at app startup
 *   by the Electron preload or the Web iframe bootstrap), NOT a domain
 *   dependency. The renderer-bridge factories receive the runtime as a
 *   parameter; they do not call getRuntime() either.
 */
import type {
  Storage,
  Files,
  Identity,
  AI,
  Printing,
  Clipboard,
  Notifications,
  Windowing,
  Settings,
} from '@genoffice/platform'

import type { DocumentService } from './services/docs.js'
import type { SpreadsheetService } from './services/sheets.js'
import type { PresentationService } from './services/slides.js'
import type { PdfService } from './services/pdf.js'
import type { MarkdownService } from './services/markdown.js'
import type { ProjectStoreService } from './services/project.js'

export interface RuntimeContext {
  /** Which adapter produced this runtime. */
  readonly platform: 'electron' | 'web'
  /** Application version (from package.json / app.getVersion). */
  readonly version: string

  // ── Platform capabilities (Layer 3) ─────────────────────────────────
  readonly storage: Storage
  readonly files: Files
  readonly identity: Identity
  readonly ai: AI
  readonly printing: Printing
  readonly clipboard: Clipboard
  readonly notifications: Notifications
  readonly windowing: Windowing
  readonly settings: Settings

  // ── Domain services (Layer 2) ───────────────────────────────────────
  readonly docs: DocumentService
  readonly sheets: SpreadsheetService
  readonly slides: PresentationService
  readonly pdf: PdfService
  readonly markdown: MarkdownService

  // ── Project store (cross-editor — chat history + file grouping) ─────
  readonly project: ProjectStoreService
}

// ── Bootstrap-only runtime mechanism ────────────────────────────────────
//
// getRuntime() / setRuntime() is the SOLE runtime mechanism permitted in
// @genoffice/runtime-contracts (per user instruction). Everything else in
// this package is contracts/types.
//
// The mutable singleton exists for bootstrap (Electron preload, Web iframe
// bootstrap). Domain services MUST NOT call getRuntime() internally — they
// receive their dependencies via constructor injection (ADR-001 Correction A).
//
// The renderer-bridge factories receive the runtime as a parameter; they do
// not call getRuntime() either. This keeps the bridge testable and prevents
// hidden global coupling.

let current: RuntimeContext | null = null

/** Initialize the runtime. Called once at app startup by the adapter bootstrap. */
export function setRuntime(ctx: RuntimeContext): void {
  current = ctx
}

/**
 * Read the current runtime. Throws when called before setRuntime().
 *
 * BOOTSTRAP USE ONLY. Domain services MUST NOT call this — receive deps
 * via constructor instead.
 */
export function getRuntime(): RuntimeContext {
  if (!current) {
    throw new Error(
      'RuntimeContext not initialized — call setRuntime() first (from the adapter bootstrap). ' +
        'Domain services must receive dependencies via constructor, not via getRuntime().',
    )
  }
  return current
}

/** Test-only: reset the runtime (for vitest isolation). */
export function __resetRuntimeForTesting(): void {
  current = null
}
