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
 * DocsShellCoordinator — the bridge-facing shell coordinator interface.
 *
 * CONTRACT ALIGNMENT (Increment 2G):
 *   This interface is what createDocsDesktopBridge calls. It has NO caller
 *   identity (no wcId, no callerWindow) — it matches the frozen DesktopApi
 *   shape that the renderer calls via window.desktop.
 *
 *   The concrete DocsShellCoordinatorImpl (apps/docs/src/main/) REQUIRES
 *   caller identity for per-renderer session ownership and caller-specific
 *   dialog parenting. The explicit DocsShellCoordinatorAdapter (see
 *   docs-coordinator-adapter.ts) sits between this interface and the impl:
 *
 *     Renderer (window.desktop)
 *         ↓
 *     DesktopApi (bridge — frozen, no caller identity)
 *         ↓
 *     DocsShellCoordinator (THIS — bridge-facing, no caller identity)
 *         ↓
 *     DocsShellCoordinatorAdapter (translates no-caller → caller-specific)
 *         ↓ (uses CallerContextResolver — injected by shell)
 *     DocsShellCoordinatorImpl (wcId, callerWindow, ...)
 *
 *   The adapter does NOT introduce global state. The CallerContextResolver
 *   is injected by the shell and resolves the caller from the current IPC
 *   context (event.sender), NOT from focused-window or a global active tab.
 *
 * OWNERSHIP MODEL (Increment 2G — corrected from stale docs):
 *   The session registry is keyed by WCID, NOT by file path:
 *
 *     wcId (renderer identity)
 *         ↓
 *     DocumentSession (per-renderer, per-document)
 *         ↓
 *     file path (the session's filePath)
 *
 *   This means:
 *     - Renderer A opens /foo.docx → session A1 = { filePath: '/foo.docx', ... }
 *     - Renderer B opens /foo.docx → session B1 = { filePath: '/foo.docx', ... }
 *     - A and B have INDEPENDENT sessions for the same file path
 *     - A's save does not affect B's session
 *     - A's teardown does not tear down B
 *
 *   The old documentation said "Map<filePath, DocumentSession>" — that was
 *   incorrect (the impl has always used Map<wcId, DocumentSession>). The
 *   corrected model is wcId → session → file path.
 *
 *   The coordinator owns:
 *     - Per-wcId session registry (Map<wcId, DocumentSession>)
 *     - Per-wcId write authorization (docWritablePaths Map<wcId, Set<string>>)
 *     - Per-wcId PDF authorization (pdfWritablePaths Map<wcId, Set<string>>)
 *     - Per-wcId push-event routing (wcWebContents Map<wcId, WebContents>)
 *     - Pending-open queue (shell state — owned by legacy docs-main.ts)
 *     - New-blank flag (shell state — owned by legacy docs-main.ts)
 *     - Tab operations (openNewTab, listDocsTabs, focusDocsTab)
 *     - Save coordination (session lookup + service call + session update)
 *
 *   The bridge delegates ALL state management to the coordinator (via the
 *   adapter). The coordinator is constructed by the shell (apps/docs/src/main/)
 *   and passed to the bridge at preload time.
 */
import type { DocumentSession } from '@genoffice/runtime-contracts'
import type { DocumentOpenResult } from '@genoffice/runtime-contracts'

export interface DocsShellCoordinator {
  // ── File lifecycle — the coordinator manages sessions internally ──
  // NOTE: these methods have NO caller identity. The DocsShellCoordinatorAdapter
  // resolves the caller's { wcId, callerWindow } via the injected
  // CallerContextResolver and forwards to the per-renderer impl.
  //
  // The return type is { result: DocumentOpenResult } — the session is
  // owned by the coordinator's per-wcId registry, NOT returned to the bridge.
  // The bridge only needs the result (bytes + hash + path) to pass back to
  // the renderer via DesktopApi.
  openDocx(): Promise<{ result: DocumentOpenResult } | null>
  openDocxPath(path: string): Promise<{ result: DocumentOpenResult } | null>
  consumePendingOpen(): Promise<{ result: DocumentOpenResult } | null>
  consumeNewBlank(): Promise<boolean>

  // ── Save — the coordinator looks up the session (by wcId), calls the
  //    service, and registers the updated session. Error policy (unregistered
  //    path) lives here, NOT in the bridge. ──────────────────────────────
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

  // ── Image & attachment picking (Increment 2F) ─────────────────────
  // The bridge calls these no-arg methods. The DocsShellCoordinatorAdapter
  // resolves the caller's { wcId, callerWindow } and forwards to the impl,
  // which owns the caller-specific file-picker dialog. The service never
  // sees a dialog — it receives already-resolved paths.
  pickImage(): Promise<{ base64: string; mime: 'image/png' | 'image/jpeg' | 'image/gif'; name: string } | null>
  pickAttachments(): Promise<{ accepted: Array<{ path: string; name: string; ext: string; sizeBytes: number }>; rejected: string[] } | null>

  // ── Tab operations (shell orchestration — no caller identity needed) ──
  openNewTab(openPath?: string | null): Promise<void>
  listDocsTabs(): Promise<ShellTabInfo[]>
  focusDocsTab(id: string): Promise<void>

  // ── Session registry access (legacy — the per-renderer impl owns the
  //    real registry keyed by wcId; these are stubs on the adapter) ────
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
