/**
 * TenantSelectScreen — multi-membership tenant selection (ADR-0008 D3).
 *
 * Renders ONLY server-derived memberships. The browser does not invent the
 * tenant list. On selection, the server validates the membership belongs to
 * the authenticated user + is active; a forged membershipId → 403.
 */
import { useState } from 'react'
import { authApi, type MembershipChoice } from '../api/client'
import { styles } from '../styles'

export function TenantSelectScreen({
  memberships, onSelected,
}: { memberships: MembershipChoice[]; onSelected: () => Promise<void> }) {
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const select = async (membershipId: string) => {
    setLoading(membershipId); setError(null)
    try {
      await authApi.selectTenant(membershipId)
      await onSelected()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Selection failed')
    } finally {
      setLoading(null)
    }
  }

  if (memberships.length === 0) {
    return (
      <div style={styles.app}>
        <div style={styles.main}>
          <div style={styles.error}>
            You have no active memberships. Contact your administrator.
          </div>
          <button style={styles.button} onClick={() => authApi.logout().then(onSelected)}>
            Sign out
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.app}>
      <div style={styles.main}>
        <h1 style={styles.title}>Select a workspace</h1>
        <p style={styles.subtitle}>Choose the organization/tenant to work in.</p>
        <div style={styles.column}>
          {memberships.map((m) => (
            <button
              key={m.membershipId} style={styles.card} onClick={() => select(m.membershipId)}
              disabled={loading !== null}
            >
              <div style={{ ...styles.row, justifyContent: 'space-between' }}>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontWeight: 600 }}>{m.organizationName}</div>
                  <div style={styles.muted}>{m.role}</div>
                </div>
                {loading === m.membershipId ? 'Selecting…' : 'Enter →'}
              </div>
            </button>
          ))}
        </div>
        {error && <div style={styles.error}>{error}</div>}
      </div>
    </div>
  )
}
