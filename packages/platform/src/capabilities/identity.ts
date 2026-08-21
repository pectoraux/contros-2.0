/**
 * Identity capability — account status, login/logout flow, Genspark account events.
 *
 * Electron: gsk CLI via @genoffice/ai-search (device-code flow spawned in main process).
 * Web: backend OAuth flow (device-code) + IndexedDB session cache.
 */
import type { AccountStatus, AccountLoginEvent } from '../types.js'

export interface Identity {
  /** Current Genspark account status (gsk login state). */
  accountStatus(): Promise<AccountStatus>
  /** Start the login flow (opens browser); returns whether the launch succeeded. */
  login(): Promise<boolean>
  /** Log out (clears the saved API key). */
  logout(): Promise<void>
  /** Subscribe to login-flow progress events. */
  onLoginEvent(handler: (ev: AccountLoginEvent) => void): () => void
  /** Re-open the pending login auth URL in the default browser (rescue when auto-open failed). */
  openLoginUrl(): Promise<void>
  /** Open the Genspark credit-usage page. */
  openCreditUsage(): Promise<void>
  /** Open the GenTeam community page. */
  openGenTeam(): Promise<void>
}
