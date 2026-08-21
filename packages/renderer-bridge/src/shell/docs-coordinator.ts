/**
 * Shell types for the docs editor.
 *
 * These types are shell/UI concerns (tabs, menus, close-guard coordination).
 * They live in renderer-bridge (the application boundary), NOT in
 * runtime-contracts (the runtime-independent layer).
 *
 * The bridge uses these types when it needs to represent shell state.
 * The coordinator (constructed by apps/docs/src/main/ in Increment 2)
 * implements the DocsShellCoordinator interface using these types.
 */

/** An open docs tab, for View → Switch Tab. */
export interface ShellTabInfo {
  id: string
  title: string
  focused: boolean
}

/**
 * Commands dispatched from the native application menu to the renderer.
 * Shell concern — the native menu is shell, the command is shell.
 */
export type ShellMenuCommand =
  | 'new'
  | 'open'
  | 'open-path'
  | 'save'
  | 'save-as'
  | 'undo'
  | 'redo'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-100'
  | 'zoom-page-width'
  | 'zoom-whole-page'
  | 'toggle-ai'
  | 'toggle-dark'
  | 'insert-table'
  | 'insert-image'
  | 'insert-page-break'
  | 'insert-link'
  | 'insert-equation'
  | 'insert-comment'
  | 'font-dialog'
  | 'paragraph-dialog'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'align-left'
  | 'align-center'
  | 'align-right'
  | 'align-justify'
  | 'page-setup'
  | 'find'
  | 'print'
  | 'export-pdf'
  | 'word-count'
  | 'ai-proofread'

/**
 * DocsShellCoordinator — the shell/application coordinator for the docs editor.
 *
 * BOUNDARY CORRECTION (2026-08-21, shell contract location):
 *   This interface was previously in runtime-contracts. It has been moved
 *   to renderer-bridge (the application boundary layer) because it is an
 *   application/shell concern, NOT a runtime-independent domain contract.
 *
 *   The coordinator owns:
 *     - Session registry (Map<filePath, DocumentSession>)
 *     - Pending-open queue (shell state)
 *     - New-blank flag (shell state)
 *     - Tab operations (openNewTab, listDocsTabs, focusDocsTab)
 *     - Save coordination (session lookup + service call + session update)
 *
 *   The bridge delegates ALL state management to the coordinator.
 *   The coordinator is constructed by the shell (apps/docs/src/main/)
 *   and passed to the bridge at preload time.
 */
import type { DocumentSession } from '@genoffice/runtime-contracts'
import type { DocumentOpenResult } from '@genoffice/runtime-contracts'

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
  listDocsTabs(): Promise<ShellTabInfo[]>
  focusDocsTab(id: string): Promise<void>

  // ── Session registry access (for the bridge's open/openPath methods
  //    that need to return the result to the renderer) ────────────────
  getSession(filePath: string): DocumentSession | null
  registerSession(session: DocumentSession): void

  // ── Shell events (menu commands, view-menu state, close guard) ────
  onMenuCommand(handler: (command: ShellMenuCommand, payload?: string) => void): () => void
  reportViewMenuState(state: { aiSidebar: boolean; darkCanvas: boolean }): void

  // ── Close guard (shell orchestration — NOT domain) ──────────────
  // The close-guard flow coordinates between the shell (which intercepts
  // window/tab close) and the renderer (which reports dirty state and
  // runs the save). This is shell transport, not domain behavior.
  onCloseCheck(handler: () => void): () => void
  reportCloseCheck(state: { dirty: boolean; autoSave: boolean; filePath?: string | null }): void
  onCloseSaveRequest(handler: () => void): () => void
  reportCloseSaveResult(ok: boolean): void
}
