/**
 * ProjectsScreen — list + create projects via Core API.
 *
 * The browser sends NO tenantId; the server derives it from the session.
 * Project creation goes through ProjectService → repository (never direct).
 */
import { useEffect, useState } from 'react'
import { projectsApi, workspacesApi, type Project, type Workspace } from '../api/client'
import { styles } from '../styles'

export function ProjectsScreen({ onRoute }: { onRoute: (r: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const refresh = async () => {
    setLoading(true); setError(null)
    try {
      const [ps, ws] = await Promise.all([projectsApi.list(), workspacesApi.list()])
      setProjects(ps); setWorkspaces(ws)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally { setLoading(false) }
  }

  useEffect(() => { refresh() }, [])

  const create = async () => {
    if (!newName || workspaces.length === 0) return
    setCreating(true); setError(null)
    try {
      await projectsApi.create(workspaces[0]!.id, newName)
      setNewName('')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed')
    } finally { setCreating(false) }
  }

  return (
    <div style={styles.screen}>
      <h1 style={styles.title}>Projects</h1>
      {error && <div style={styles.error}>{error}</div>}
      <div style={styles.row}>
        <input
          style={styles.input} placeholder="New project name" value={newName}
          onChange={(e) => setNewName(e.target.value)} disabled={creating}
          onKeyDown={(e) => e.key === 'Enter' && create()}
        />
        <button style={styles.buttonPrimary} onClick={create} disabled={creating || !newName || workspaces.length === 0}>
          {creating ? 'Creating…' : 'Create project'}
        </button>
      </div>
      {loading ? (
        <div style={styles.loading}>Loading…</div>
      ) : projects.length === 0 ? (
        <p style={styles.muted}>No projects yet. Create one above.</p>
      ) : (
        <table style={styles.table}>
          <thead><tr><th style={styles.th}>Name</th><th style={styles.th}>Status</th><th style={styles.th}>Created</th><th style={styles.th}></th></tr></thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td style={styles.td}>{p.name}</td>
                <td style={styles.td}><span style={styles.badge}>{p.status}</span></td>
                <td style={styles.td}>{new Date(p.createdAt).toLocaleDateString()}</td>
                <td style={styles.td}>
                  <button style={styles.button} onClick={() => onRoute(`/projects/${p.id}`)}>Open</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
