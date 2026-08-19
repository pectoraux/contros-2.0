/**
 * Contractor GenOffice — browser entry.
 *
 * Thin client of the Core API. No Electron, no direct DB, no pricing computation.
 * The browser is NEVER the authority — after every mutation, re-fetch authoritative
 * server state. (ADR-0008; Phase 2C.1 §14.)
 */

import { StrictMode, useState, useEffect, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { authApi, type SessionInfo, type MembershipChoice } from './api/client'
import { LoginScreen } from './screens/Login'
import { TenantSelectScreen } from './screens/TenantSelect'
import { AppShell } from './screens/AppShell'
import { ErrorBoundary } from './components/ErrorBoundary'
import { styles } from './styles'

function Root() {
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [memberships, setMemberships] = useState<MembershipChoice[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [route, setRoute] = useState(window.location.hash.slice(1) || '/')

  useEffect(() => {
    const onHash = () => setRoute(window.location.hash.slice(1) || '/')
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const refreshSession = useCallback(async () => {
    try {
      const s = await authApi.session()
      setSession(s)
      if (s.authenticated && !s.tenantSelected) {
        const m = await authApi.memberships()
        setMemberships(m.memberships)
      } else {
        setMemberships(null)
      }
    } catch {
      setSession({ authenticated: false })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refreshSession() }, [refreshSession])

  if (loading) {
    return <div style={styles.loading}>Loading…</div>
  }

  if (!session?.authenticated) {
    return <LoginScreen onLoggedIn={refreshSession} />
  }

  if (!session.tenantSelected) {
    return (
      <TenantSelectScreen
        memberships={memberships ?? []}
        onSelected={refreshSession}
      />
    )
  }

  return <AppShell route={route} onRoute={setRoute} onLogout={refreshSession} />
}

const root = createRoot(document.getElementById('root')!)
root.render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
)
