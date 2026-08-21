/**
 * DocsShellCoordinatorAdapter — the explicit bridge→impl translator.
 *
 * CONTRACT ALIGNMENT (Increment 2G):
 *
 *   The bridge-facing DocsShellCoordinator interface has NO caller identity
 *   (no wcId, no callerWindow) — it matches the frozen DesktopApi shape
 *   that the renderer calls via window.desktop. The bridge is a genuinely
 *   thin adapter and cannot invent caller identity.
 *
 *   The concrete DocsShellCoordinatorImpl (apps/docs/src/main/) REQUIRES
 *   caller identity: every open/save/pick method takes (wcId, callerWindow)
 *   for per-renderer session ownership and caller-specific dialog parenting.
 *
 *   This adapter bridges the gap. It implements the bridge-facing
 *   DocsShellCoordinator interface (no-caller methods) and delegates to
 *   DocsShellCoordinatorImpl (caller-specific methods) using a
 *   CallerContextResolver — injected by the shell — that returns the
 *   current caller's { wcId, callerWindow } at call time.
 *
 *   The resolver is NOT global state. It is NOT focused-window. It is an
 *   explicit function the shell provides, typically bound to the current IPC
 *   call's event.sender via AsyncLocalStorage or a per-call scope.
 *
 * Architecture:
 *
 *   Renderer (window.desktop)
 *       ↓
 *   DesktopApi (bridge — frozen, no caller identity)
 *       ↓
 *   DocsShellCoordinator interface (bridge-facing, no caller identity)
 *       ↓
 *   DocsShellCoordinatorAdapter (THIS — implements DocsShellCoordinator)
 *       ↓ (uses CallerContextResolver — injected by shell)
 *   DocsShellCoordinatorImpl (wcId, callerWindow, ...)
 *
 * The adapter is created by the shell (apps/docs/src/main/) and passed to
 * createDocsDesktopBridge as the `coordinator` dep. The bridge doesn't know
 * the adapter exists — it just calls the DocsShellCoordinator interface.
 *
 * IMPORTANT: the adapter does NOT introduce a global active renderer. The
 * CallerContextResolver is injected per-shell-instance and resolves the
 * caller from the current IPC context (event.sender), NOT from global state.
 */

import type { BrowserWindow } from 'electron'
import type {
  DocumentSession,
  DocumentOpenResult,
  DocumentPickImageResult,
  DocumentAttachmentAddResult,
} from '@genoffice/runtime-contracts'
import type {
  DocsShellCoordinator,
  ShellTabInfo,
  ShellMenuCommand,
} from './docs-coordinator.js'

/**
 * The caller's identity and dialog-parent window, resolved at call time.
 *
 * `wcId` — the WebContents id of the renderer that initiated the call.
 *   Used for per-renderer session ownership (Map<wcId, DocumentSession>).
 *
 * `callerWindow` — the BrowserWindow that owns the renderer, used as the
 *   parent for file-picker and message-box dialogs. null when the window
 *   can't be resolved (destroyed/unresolvable) — the impl shows a modeless
 *   dialog. NEVER derived from BrowserWindow.getFocusedWindow().
 */
export interface CallerContext {
  wcId: number
  callerWindow: BrowserWindow | null
}

/**
 * A function the shell provides that returns the current caller's context.
 *
 * The shell binds this to the current IPC call's event.sender. When the
 * bridge calls a coordinator method, the adapter invokes this resolver to
 * obtain the caller's { wcId, callerWindow } and forwards them to the impl.
 *
 * Implementation pattern (shell-side):
 *   - The shell wraps each IPC handler in a scope that sets the current
 *     event.sender (e.g., via AsyncLocalStorage or a per-call setter).
 *   - The resolver reads from that scope and returns { wcId, callerWindow }.
 *   - Outside an IPC call, the resolver throws (programming error) — the
 *     bridge must only be called from within an IPC handler's scope.
 */
export type CallerContextResolver = () => CallerContext

/**
 * The per-renderer coordinator interface that apps/docs/src/main/
 * DocsShellCoordinatorImpl satisfies. The adapter delegates to it with
 * the caller context resolved from the injected resolver.
 *
 * NOTE: this interface lives in renderer-bridge (the application boundary),
 * NOT in runtime-contracts. It references BrowserWindow (an Electron type)
 * because it is shell-side. runtime-contracts remains pure domain.
 */
export interface PerRendererDocsCoordinator {
  // ── Per-renderer lifecycle (caller-specific) ──
  registerWebContents(wcId: number, wc: unknown): void
  openDocx(wcId: number, callerWindow: BrowserWindow | null): Promise<{ result: DocumentOpenResult } | null>
  openDocxPath(wcId: number, filePath: string, callerWindow: BrowserWindow | null): Promise<{ result: DocumentOpenResult } | null>
  saveDocx(
    wcId: number,
    filePath: string,
    data: Uint8Array,
    callerWindow: BrowserWindow | null,
    auto?: boolean,
  ): Promise<{ ok: boolean; error?: string; reason?: 'external-modified' }>
  saveDocxAs(
    wcId: number,
    defaultName: string,
    data: Uint8Array,
    callerWindow: BrowserWindow | null,
  ): Promise<{ ok: boolean; path?: string; error?: string }>
  saveDocxNew(
    wcId: number,
    defaultName: string,
    data: Uint8Array,
  ): Promise<{ ok: boolean; path?: string; error?: string }>
  writeRecovery(
    wcId: number,
    filePath: string,
    data: Uint8Array,
  ): Promise<{ ok: boolean }>
  pickImage(
    wcId: number,
    callerWindow: BrowserWindow | null,
  ): Promise<DocumentPickImageResult | null>
  pickAttachments(
    wcId: number,
    callerWindow: BrowserWindow | null,
  ): Promise<DocumentAttachmentAddResult | null>
  print(wc: unknown): Promise<{ ok: boolean; error?: string }>
  printPdfBuffer(
    wc: unknown,
    pageWidthTwips: number,
    pageHeightTwips: number,
  ): Promise<{ ok: boolean; base64?: string; error?: string }>
  exportPdf(
    wcId: number,
    defaultName: string,
    pageWidthTwips: number,
    pageHeightTwips: number,
    outPath: string | undefined,
    wc: unknown,
    callerWindow: BrowserWindow | null,
  ): Promise<{ ok: boolean; path?: string; error?: string }>
  saveMergedPdf(
    wcId: number,
    defaultName: string,
    base64Parts: string[],
    outPath: string | undefined,
    callerWindow: BrowserWindow | null,
  ): Promise<{ ok: boolean; path?: string; error?: string }>

  // ── Tab operations (shell orchestration — no caller identity needed) ──
  openNewTab(openPath?: string | null): Promise<void>
  listDocsTabs(): Promise<ShellTabInfo[]>
  focusDocsTab(id: string): Promise<void>

  // ── Push events (per-wcId routing — the adapter passes through) ──
  sendOpened(wcId: number, result: DocumentOpenResult): void
  sendRenamedToCaller(oldPath: string, newPath: string): void
  sendTeardown(wcId: number): void

  // ── Shell events (stubs — owned by legacy docs-main.ts) ──
  onMenuCommand(handler: (command: ShellMenuCommand, payload?: string) => void): () => void
  reportViewMenuState(state: { aiSidebar: boolean; darkCanvas: boolean }): void
  onCloseCheck(handler: () => void): () => void
  reportCloseCheck(state: { dirty: boolean; autoSave: boolean; filePath?: string | null }): void
  onCloseSaveRequest(handler: () => void): () => void
  reportCloseSaveResult(ok: boolean): void
}

/**
 * Create a DocsShellCoordinator adapter that translates bridge-level
 * no-caller calls into per-renderer (wcId, callerWindow) calls on the impl.
 *
 * The adapter implements the bridge-facing DocsShellCoordinator interface
 * (no caller identity) and delegates to the PerRendererDocsCoordinator impl
 * (caller-specific) using the injected CallerContextResolver.
 *
 * The adapter does NOT introduce global state — the caller context is
 * resolved per-call via the injected resolver.
 *
 * Usage (shell-side, apps/docs/src/main/):
 *   const adapter = createDocsShellCoordinatorAdapter({
 *     impl: coordinatorImpl,
 *     resolveCaller: () => currentIpcContext,  // from AsyncLocalStorage
 *   })
 *   const bridge = createDocsDesktopBridge({ runtime, coordinator: adapter })
 */
export function createDocsShellCoordinatorAdapter(deps: {
  impl: PerRendererDocsCoordinator
  resolveCaller: CallerContextResolver
}): DocsShellCoordinator {
  const { impl, resolveCaller } = deps

  // Resolve the current caller's context. Called at the start of each
  // bridge method. Throws if outside an IPC call scope (programming error).
  const ctx = (): CallerContext => resolveCaller()

  // The adapter satisfies the bridge-facing DocsShellCoordinator interface.
  // Each method resolves the caller context and forwards to the impl with
  // (wcId, callerWindow, ...).
  const adapter: DocsShellCoordinator = {
    // ── File lifecycle ──
    openDocx: async () => {
      const { wcId, callerWindow } = ctx()
      return impl.openDocx(wcId, callerWindow)
    },
    openDocxPath: async (filePath) => {
      const { wcId, callerWindow } = ctx()
      return impl.openDocxPath(wcId, filePath, callerWindow)
    },
    // consumePendingOpen / consumeNewBlank are shell-state methods not yet
    // migrated to the per-renderer impl. They remain no-ops for now (the
    // legacy docs-main.ts owns the pending-open queue).
    consumePendingOpen: async () => null,
    consumeNewBlank: async () => false,

    // ── Save ──
    saveDocx: async (filePath, data, auto) => {
      const { wcId, callerWindow } = ctx()
      return impl.saveDocx(wcId, filePath, data, callerWindow, auto)
    },
    saveDocxAs: async (defaultName, data) => {
      const { wcId, callerWindow } = ctx()
      return impl.saveDocxAs(wcId, defaultName, data, callerWindow)
    },
    saveDocxNew: async (defaultName, data) => {
      const { wcId } = ctx()
      return impl.saveDocxNew(wcId, defaultName, data)
    },
    writeRecovery: async (filePath, data) => {
      const { wcId } = ctx()
      return impl.writeRecovery(wcId, filePath, data)
    },

    // ── Image & attachment picking ──
    pickImage: async () => {
      const { wcId, callerWindow } = ctx()
      return impl.pickImage(wcId, callerWindow)
    },
    pickAttachments: async () => {
      const { wcId, callerWindow } = ctx()
      return impl.pickAttachments(wcId, callerWindow)
    },

    // ── Tab operations (no caller identity needed) ──
    openNewTab: (openPath) => impl.openNewTab(openPath),
    listDocsTabs: () => impl.listDocsTabs(),
    focusDocsTab: (id) => impl.focusDocsTab(id),

    // ── Session registry ──
    // The bridge doesn't use these directly; they're on the interface for
    // legacy compatibility. The per-renderer impl owns the session registry
    // keyed by wcId (NOT by filePath — that was the old model).
    getSession: () => null,
    registerSession: () => {},

    // ── Shell events (stubs — owned by legacy docs-main.ts) ──
    onMenuCommand: (handler) => impl.onMenuCommand(handler),
    reportViewMenuState: (state) => impl.reportViewMenuState(state),
    onCloseCheck: (handler) => impl.onCloseCheck(handler),
    reportCloseCheck: (state) => impl.reportCloseCheck(state),
    onCloseSaveRequest: (handler) => impl.onCloseSaveRequest(handler),
    reportCloseSaveResult: (ok) => impl.reportCloseSaveResult(ok),
  }

  return adapter
}
