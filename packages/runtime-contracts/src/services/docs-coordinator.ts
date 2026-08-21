/**
 * DocsShellCoordinator — the shell/application coordinator for the docs editor.
 *
 * BOUNDARY CORRECTION (2026-08-21, contract direction + bridge purity):
 *   The bridge was doing session registration, lookup, error policy, and
 *   isWired branching — that's application orchestration, not type conversion.
 *   This interface extracts all of that into a coordinator that the shell
 *   owns and the bridge delegates to.
 *
 *   The coordinator owns:
 *     - Session registry (Map<filePath, DocumentSession>)
 *     - Pending-open queue (shell state)
 *     - New-blank flag (shell state)
 *     - Tab operations (openNewTab, listDocsTabs, focusDocsTab)
 *     - Save coordination (session lookup + service call + session update)
 *
 *   The bridge is a PURE type adapter:
 *     - Convert legacy types → runtime types
 *     - Delegate to coordinator
 *     - Convert runtime types → legacy types
 *
 *   The coordinator is constructed by the shell (apps/docs/src/main/ for
 *   Electron, apps/web-shell/src/ for Web). It wraps the DocumentService +
 *   SessionRegistry + shell state.
 *
 * IMPORTANT (ADR-001 Correction A): the coordinator receives its dependencies
 * via constructor. It does NOT call getRuntime() internally.
 */
import type { DocumentSession } from '../services/docs.js'
import type {
  DocumentOpenResult,
  DocumentTabInfo,
} from '../types/docs.js'

export interface DocsShellCoordinator {
  // ── File lifecycle — the coordinator manages sessions internally ──
  openDocx(): Promise<{ session: DocumentSession; result: DocumentOpenResult } | null>
  openDocxPath(path: string): Promise<{ session: DocumentSession; result: DocumentOpenResult } | null>
  consumePendingOpen(): Promise<{ session: DocumentSession; result: DocumentOpenResult } | null>
  consumeNewBlank(): Promise<boolean>

  // ── Save — the coordinator looks up the session, calls the service,
  //    and registers the updated session. Error policy (unregistered path)
  //    lives here, NOT in the bridge. ──────────────────────────────────
  saveDocx(
    path: string,
    data: Uint8Array,
    auto?: boolean,
  ): Promise<{ ok: boolean; error?: string; reason?: 'external-modified' }>
  saveDocxAs(
    defaultName: string,
    data: Uint8Array,
  ): Promise<{ ok: boolean; path?: string; error?: string }>
  saveDocxNew(
    defaultName: string,
    data: Uint8Array,
  ): Promise<{ ok: boolean; path?: string; error?: string }>
  writeRecovery(path: string, data: Uint8Array): Promise<{ ok: boolean }>

  // ── Tab operations (shell orchestration) ──────────────────────────
  openNewTab(openPath?: string | null): Promise<void>
  listDocsTabs(): Promise<DocumentTabInfo[]>
  focusDocsTab(id: string): Promise<void>

  // ── Session registry access (for the bridge's open/openPath methods
  //    that need to return the result to the renderer) ────────────────
  getSession(filePath: string): DocumentSession | null
  registerSession(session: DocumentSession): void
}
