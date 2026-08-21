/**
 * ElectronIdentity — implements the Identity capability using the gsk CLI via
 * @genoffice/ai-search.
 *
 * Wraps the existing startGenofficeLogin / loadGenofficeAuth / gskLoginInfo /
 * genofficeLogout functions.
 *
 * IMPORTANT (ADR-001 Correction A): constructor injection. No getRuntime().
 */
import {
  loadGenofficeAuth,
  gskLoginInfo,
  startGenofficeLogin,
  genofficeLogout,
} from '@genoffice/ai-search'
import type { Identity, AccountStatus, AccountLoginEvent } from '@genoffice/platform'

export interface ElectronIdentityDeps {
  /** Function to open a URL in the system browser (shell.openExternal). */
  openExternal: (url: string) => Promise<void>
  /** Function to open the credit-usage page (shell.openExternal('https://www.genspark.ai/credit-usage')). */
  openCreditUsageUrl: () => Promise<void>
  /** Function to open the GenTeam page. */
  openGenTeamUrl: () => Promise<void>
}

export class ElectronIdentity implements Identity {
  private loginListeners = new Set<(ev: AccountLoginEvent) => void>()

  constructor(private readonly deps: ElectronIdentityDeps) {}

  async accountStatus(): Promise<AccountStatus> {
    const auth = loadGenofficeAuth()
    if (!auth) return { loggedIn: false }
    const info = await gskLoginInfo()
    return info
      ? { loggedIn: true, email: info.email, creditBalance: info.creditBalance }
      : { loggedIn: true }
  }

  async login(): Promise<boolean> {
    try {
      await startGenofficeLogin((progress) => {
        const ev: AccountLoginEvent = {
          phase: progress.phase as 'launched' | 'url' | 'success' | 'error',
          url: progress.url,
          expiresInSec: progress.expiresInSec,
          error: progress.error,
        }
        for (const fn of this.loginListeners) fn(ev)
        if (progress.phase === 'url' && progress.url) {
          void this.deps.openExternal(progress.url)
        }
      })
      return true
    } catch {
      return false
    }
  }

  async logout(): Promise<void> {
    await genofficeLogout()
  }

  onLoginEvent(handler: (ev: AccountLoginEvent) => void): () => void {
    this.loginListeners.add(handler)
    return () => this.loginListeners.delete(handler)
  }

  async openLoginUrl(): Promise<void> {
    // Re-trigger login (the gsk CLI prints the URL again)
    await this.login()
  }

  async openCreditUsage(): Promise<void> {
    await this.deps.openCreditUsageUrl()
  }

  async openGenTeam(): Promise<void> {
    await this.deps.openGenTeamUrl()
  }
}
