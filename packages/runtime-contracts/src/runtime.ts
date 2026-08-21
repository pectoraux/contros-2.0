/**
 * RuntimeContext — the platform-neutral runtime bundle.
 *
 * BOUNDARY CORRECTION (2026-08-21, final pass):
 *   - Service slots use `ServiceSlot<T>` to explicitly represent the
 *     partial-migration state. No more `null as any` placeholders.
 *   - `NOT_YET_WIRED(reason)` is the typed marker for an unwired service.
 *   - `isWired(slot)` is the type guard.
 *
 * ARCHITECTURAL RULE (ADR-001 Correction A):
 *   getRuntime() / setRuntime() is the SOLE permitted runtime mechanism in
 *   this package. Domain services MUST NOT call getRuntime() internally —
 *   they receive their dependencies via constructor injection.
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

/**
 * A service slot during migration: either the implemented service, or a
 * typed marker indicating it's not yet wired.
 *
 * This replaces `null as any` placeholders with an explicit, type-safe
 * representation of the partial-migration state.
 */
export type ServiceSlot<T> = T | { readonly __notYetWired: true; readonly reason: string }

/** Marker for an unwired service slot. */
export function NOT_YET_WIRED(reason: string): { readonly __notYetWired: true; readonly reason: string } {
  return { __notYetWired: true as const, reason }
}

/** Type guard: is this service slot wired (i.e. is it the actual service, not the marker)? */
export function isWired<T>(slot: ServiceSlot<T>): slot is T {
  return slot !== null && typeof slot === 'object' && !((slot as { __notYetWired?: unknown }).__notYetWired)
}

export interface RuntimeContext {
  /** Which adapter produced this runtime. */
  readonly platform: 'electron' | 'web'
  /** Application version (from package.json / app.getVersion). */
  readonly version: string

  // ── Platform capabilities (Layer 3) — always present ──────────────
  readonly storage: Storage
  readonly files: Files
  readonly identity: Identity
  readonly ai: AI
  readonly printing: Printing
  readonly clipboard: Clipboard
  readonly notifications: Notifications
  readonly windowing: Windowing
  readonly settings: Settings

  // ── Domain services (Layer 2) — ServiceSlot<T> explicitly represents
  //    the migration state. Use isWired() before delegating. ───────────
  readonly docs: ServiceSlot<DocumentService>
  readonly sheets: ServiceSlot<SpreadsheetService>
  readonly slides: ServiceSlot<PresentationService>
  readonly pdf: ServiceSlot<PdfService>
  readonly markdown: ServiceSlot<MarkdownService>

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
