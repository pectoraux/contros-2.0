/**
 * OverviewTab — project metadata + counts.
 */
import { useEffect, useState } from 'react'
import { boqApi, estimateApi, bidApi } from '../api/client'
import { styles } from '../styles'

export function OverviewTab({ projectId }: { projectId: string }) {
  const [boqs, setBoqs] = useState(0)
  const [estimates, setEstimates] = useState(0)
  const [bids, setBids] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      boqApi.listForProject(projectId),
      estimateApi.listForProject(projectId),
      bidApi.listForProject(projectId),
    ]).then(([b, e, bi]) => {
      setBoqs(b.length); setEstimates(e.length); setBids(bi.length)
    }).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
  }, [projectId])

  return (
    <div style={styles.card}>
      <h2 style={styles.title}>Overview</h2>
      {error && <div style={styles.error}>{error}</div>}
      <div style={styles.row}>
        <div style={styles.card}><div style={styles.label}>BOQs</div><div style={styles.value}>{boqs}</div></div>
        <div style={styles.card}><div style={styles.label}>Estimates</div><div style={styles.value}>{estimates}</div></div>
        <div style={styles.card}><div style={styles.label}>Bids</div><div style={styles.value}>{bids}</div></div>
      </div>
    </div>
  )
}
