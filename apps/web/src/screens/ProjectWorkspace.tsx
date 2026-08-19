/**
 * ProjectWorkspace — single project with tabs: Overview / BOQ / Estimate / Bids.
 *
 * One application, not separate mini-apps. (Phase 2C.1 §11)
 */
import { useState } from 'react'
import { styles } from '../styles'
import { BOQTab } from './BOQ'
import { EstimateTab } from './Estimate'
import { BidTab } from './Bid'
import { OverviewTab } from './Overview'

type Tab = 'overview' | 'boq' | 'estimate' | 'bids'

export function ProjectWorkspace({
  projectId, onRoute,
}: { projectId: string; onRoute: (r: string) => void }) {
  const [tab, setTab] = useState<Tab>('overview')

  return (
    <div style={styles.screen}>
      <div style={styles.row}>
        <button style={styles.button} onClick={() => onRoute('/projects')}>← Projects</button>
        <h1 style={styles.title}>Project</h1>
        <span style={styles.mono}>{projectId}</span>
      </div>
      <div style={styles.tabRow}>
        {(['overview', 'boq', 'estimate', 'bids'] as const).map((t) => (
          <button
            key={t} style={tab === t ? styles.tabActive : styles.tab}
            onClick={() => setTab(t)}
          >
            {t === 'boq' ? 'BOQ' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <div>
        {tab === 'overview' && <OverviewTab projectId={projectId} />}
        {tab === 'boq' && <BOQTab projectId={projectId} />}
        {tab === 'estimate' && <EstimateTab projectId={projectId} />}
        {tab === 'bids' && <BidTab projectId={projectId} />}
      </div>
    </div>
  )
}
