/**
 * Windowing capability — tab management, window-level state, external links.
 *
 * Electron: TabManager (BrowserWindow.contentView.addChildView) + BrowserWindow +
 *          nativeTheme + shell.openExternal.
 * Web: in-memory TabRecord[] + iframe management + prefers-color-scheme + window.open.
 */
import type { TabSummary, UiTheme } from '../types.js'

export interface Windowing {
  // ── Tab management ───────────────────────────────────────────────────

  /** List all open tabs (Home is always id 'home' and not closable). */
  listTabs(): Promise<TabSummary[]>
  /** Activate a tab; hides all other views. */
  activateTab(id: string): Promise<void>
  /** Close a tab (may trigger a save prompt via the editor service). */
  closeTab(id: string): Promise<void>
  /** Reorder a tab to a new index (Home stays pinned at 0). */
  reorderTab(id: string, toIndex: number): Promise<void>
  /** Pop up the "all tabs" menu at window CSS coordinates. */
  showTabMenu(x: number, y: number): Promise<void>
  /** Pop up the "+ new file" menu at window CSS coordinates. */
  showNewMenu(x: number, y: number): Promise<void>
  /** Fire-and-forget: a pointer-down landed on the shell chrome. */
  notifyChromePressed(): void
  /** Subscribe to tab list changes. */
  onTabsChanged(handler: (tabs: TabSummary[]) => void): () => void
  /** Subscribe to chrome-pressed events (dismiss popovers). */
  onChromePressed(handler: () => void): () => void

  // ── Window-level state ───────────────────────────────────────────────

  /**
   * Set the window progress bar.
   *   0..1  = progress fraction
   *   -1    = clear
   *   2     = indeterminate ("busy")
   */
  setProgressBar(progress: number): Promise<void>
  /** Subscribe to theme-changed events (pushed when the user switches theme). */
  onThemeChanged(handler: (theme: UiTheme) => void): () => void

  // ── External links ──────────────────────────────────────────────────

  /** Open an external URL in the default browser. */
  openExternal(url: string): Promise<void>
  /** Open the GitHub repository page. */
  openGitHubRepo(): Promise<void>
}
