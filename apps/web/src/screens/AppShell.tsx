/**
 * AppShell — header + hash-based routing.
 *
 * Routes:
 *   #/projects             → ProjectsScreen
 *   #/projects/:id         → ProjectWorkspace (with tab state)
 *
 * The browser is NEVER the authority — after every mutation, re-fetch
 * authoritative server state. (Phase 2C.1 §14)
 */
import { useState, useEffect } from 'react'
import { authApi, type SessionInfo } from '../api/client'
import { styles } from '../styles'
import { ProjectsScreen } from './Projects'
import { ProjectWorkspace } from './ProjectWorkspace'

export function AppShell({
  route, onRoute, onLogout,
}: { route: string; onRoute: (r: string) => void; onLogout: () => Promise<void> }) {
  const [session, setSession] = useState<SessionInfo | null>(null)

  useEffect(() => {
    authApi.session().then(setSession).catch(() => setSession(null))
  }, [route])

  const logout = async () => {
    await authApi.logout()
    await onLogout()
  }

  // Parse route
  const m = route.match(/^\/projects\/([^/]+)$/)
  const projectId = m ? m[1] : null

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <h1 style={styles.headerTitle}>
          Contractor GenOffice
          {session?.displayName ? ` — ${session.displayName}` : ''}
        </h1>
        <div style={styles.headerRight}>
          <button
            style={styles.button}
            onClick={() => onRoute('/projects')}
          >
            Projects
          </button>
          <button style={styles.button} onClick={logout}>Sign out</button>
        </div>
      </header>
      <main style={styles.main}>
        {projectId ? (
          <ProjectWorkspace projectId={projectId} onRoute={onRoute} />
        ) : (
          <ProjectsScreen onRoute={onRoute} />
        )}
      </main>
    </div>
  )
}
