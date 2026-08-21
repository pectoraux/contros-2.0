/**
 * ElectronWindowing — implements the Windowing capability using BrowserWindow +
 * WebContentsView + nativeTheme + shell.openExternal.
 *
 * For Phase 1 increment 1 (Docs), this is wired only for the docs editor. The
 * tab management methods are stubbed because the docs editor doesn't use them
 * (tab management is the shell's responsibility; the docs editor uses
 * shellHooks for tab creation/listing/focus, which live in apps/docs/src/main/).
 *
 * The shell-level Windowing capability (for the Web shell) is wired in a later
 * phase when the shell is migrated.
 */
import { GITHUB_REPO_URL } from '@genoffice/electron-utils'
import type { Windowing, TabSummary, UiTheme } from '@genoffice/platform'

export interface ElectronWindowingDeps {
  /** shell.openExternal (validated URL). */
  openExternal: (url: string) => Promise<void>
  /** Active BrowserWindow (for setProgressBar), or null. */
  getActiveWindow: () => { setProgressBar: (p: number) => void; isDestroyed: () => boolean } | null
}

export class ElectronWindowing implements Windowing {
  private tabsListeners = new Set<(tabs: TabSummary[]) => void>()
  private chromeListeners = new Set<() => void>()
  private themeListeners = new Set<(t: UiTheme) => void>()

  constructor(private readonly deps: ElectronWindowingDeps) {}

  // ── Tab management (Phase 1: stubs; shell wires these in a later phase) ──

  async listTabs(): Promise<TabSummary[]> {
    // For Phase 1 increment 1, the docs editor calls win:list which is handled
    // by the docs-main.ts shell hooks (NOT through this capability).
    // This method exists for the bridge to delegate to, but the bridge for docs
    // calls docs.listDocsTabs() (which goes to the docs service), not this.
    return []
  }

  async activateTab(_id: string): Promise<void> {
    /* no-op for Phase 1 — shell wires in a later phase */
  }

  async closeTab(_id: string): Promise<void> {
    /* no-op for Phase 1 */
  }

  async reorderTab(_id: string, _toIndex: number): Promise<void> {
    /* no-op for Phase 1 */
  }

  async showTabMenu(_x: number, _y: number): Promise<void> {
    /* no-op for Phase 1 — handled by docs-main shell hooks */
  }

  async showNewMenu(_x: number, _y: number): Promise<void> {
    /* no-op for Phase 1 — handled by docs-main shell hooks */
  }

  notifyChromePressed(): void {
    for (const fn of this.chromeListeners) fn()
  }

  onTabsChanged(handler: (tabs: TabSummary[]) => void): () => void {
    this.tabsListeners.add(handler)
    return () => this.tabsListeners.delete(handler)
  }

  onChromePressed(handler: () => void): () => void {
    this.chromeListeners.add(handler)
    return () => this.chromeListeners.delete(handler)
  }

  // ── Window-level ─────────────────────────────────────────────────────

  async setProgressBar(progress: number): Promise<void> {
    const win = this.deps.getActiveWindow()
    if (win && !win.isDestroyed()) {
      win.setProgressBar(progress)
    }
  }

  onThemeChanged(handler: (theme: UiTheme) => void): () => void {
    this.themeListeners.add(handler)
    return () => this.themeListeners.delete(handler)
  }

  // ── External links ───────────────────────────────────────────────────

  async openExternal(url: string): Promise<void> {
    await this.deps.openExternal(url)
  }

  async openGitHubRepo(): Promise<void> {
    await this.deps.openExternal(GITHUB_REPO_URL)
  }
}
