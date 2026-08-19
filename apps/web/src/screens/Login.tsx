/**
 * LoginScreen — DEV-only development authentication (ADR-0008 D2).
 *
 * Visibly indicates "Development Environment" when DEV auth is active.
 * The browser sends a credential; the server validates it against a server-side
 * secret (CG_DEV_CREDENTIAL). The browser does NOT supply an arbitrary email.
 *
 * This is NOT production authentication. Production requires a real provider
 * wired to the same ApiSessionResolver seam (ADR-0008 D4).
 */
import { useEffect, useState } from 'react'
import { authApi } from '../api/client'
import { styles } from '../styles'

export function LoginScreen({ onLoggedIn }: { onLoggedIn: () => Promise<void> }) {
  const [devAuth, setDevAuth] = useState<boolean | null>(null)
  const [credential, setCredential] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    authApi.devMode().then((d) => setDevAuth(d.devAuth)).catch(() => setDevAuth(false))
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!credential) return
    setLoading(true); setError(null)
    try {
      await authApi.devLogin(credential)
      await onLoggedIn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  if (devAuth === null) return <div style={styles.loading}>Loading…</div>

  return (
    <div style={{ ...styles.app, alignItems: 'center', justifyContent: 'center' }}>
      <form onSubmit={submit} style={{ ...styles.card, width: 360, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <h1 style={styles.title}>Contractor GenOffice</h1>
          <p style={styles.subtitle}>Development Environment</p>
        </div>
        {devAuth ? (
          <>
            <div style={styles.warning}>
              DEV authentication is active. This is not production authentication.
            </div>
            <label style={styles.label} htmlFor="cred">Development credential</label>
            <input
              id="cred" type="password" style={styles.input} value={credential}
              onChange={(e) => setCredential(e.target.value)}
              autoComplete="off" autoFocus
            />
            <button type="submit" style={styles.buttonPrimary} disabled={loading || !credential}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
            {error && <div style={styles.error}>{error}</div>}
          </>
        ) : (
          <div style={styles.error}>
            DEV authentication is not enabled. Set CONTRACTOR_DEV_AUTH=1 and
            CG_DEV_CREDENTIAL in the server environment. (ADR-0008 D2)
          </div>
        )}
      </form>
    </div>
  )
}
