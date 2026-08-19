/**
 * BidTab — Bid = commercial submission decision.
 *
 * Bid.finalPrice is an explicit commercial decision — NOT derived from
 * EstimateRevision.sellPrice. The UI preserves this distinction.
 * (Phase 2C.1 §15; ADR-0007 D7)
 *
 * A draft Bid may reference a draft EstimateRevision (ADR-0007 D19); submission
 * requires a finalized revision. The server enforces this; the UI reflects it.
 */
import { useEffect, useState } from 'react'
import { bidApi, estimateApi, type Bid, type EstimateRevision } from '../api/client'
import { styles } from '../styles'

export function BidTab({ projectId }: { projectId: string }) {
  const [bids, setBids] = useState<Bid[]>([])
  const [estimates, setEstimates] = useState<EstimateRevision[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Bid | null>(null)
  // create form
  const [estimateRevisionId, setEstimateRevisionId] = useState('')
  const [finalPriceMinor, setFinalPriceMinor] = useState(0)
  const [confirmingOutcome, setConfirmingOutcome] = useState<null | 'won' | 'lost'>(null)

  const refresh = async () => {
    setError(null)
    try {
      const [bs, es] = await Promise.all([bidApi.listForProject(projectId), estimateApi.listForProject(projectId)])
      setBids(bs); setEstimates(es)
      if (es.length > 0 && !estimateRevisionId) setEstimateRevisionId(es[0]!.revisionId)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load') }
  }

  useEffect(() => { refresh() }, [projectId])

  const create = async () => {
    if (!estimateRevisionId) return
    setError(null)
    try {
      const b = await bidApi.create(projectId, {
        estimateRevisionId,
        finalPrice: { amount: finalPriceMinor, currency: 'GHS' },
      })
      await refresh(); setSelected(b)
    } catch (e) { setError(e instanceof Error ? e.message : 'Create failed') }
  }

  const submit = async (bidId: string) => {
    setError(null)
    try {
      const b = await bidApi.submit(bidId); setSelected(b); await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Submit failed') }
  }

  const recordOutcome = async (bidId: string, outcome: 'won' | 'lost') => {
    setError(null); setConfirmingOutcome(null)
    try {
      const b = await bidApi.recordOutcome(bidId, outcome); setSelected(b); await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Outcome failed') }
  }

  const withdraw = async (bidId: string) => {
    setError(null)
    try {
      const b = await bidApi.withdraw(bidId); setSelected(b); await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Withdraw failed') }
  }

  const money = (m: { amount: number; currency: string } | null) => m ? `${(m.amount / 100).toFixed(2)} ${m.currency}` : '—'
  const finalizedEstimates = estimates.filter((e) => e.status === 'finalized')

  return (
    <div style={styles.column}>
      {error && <div style={styles.error}>{error}</div>}
      <div style={styles.card}>
        <h2 style={styles.title}>Bids</h2>
        <p style={styles.muted}>Bid.finalPrice is an explicit commercial decision, not derived from the estimate.</p>
        <div style={styles.row}>
          <label style={styles.label}>Estimate revision
            <select style={styles.input} value={estimateRevisionId} onChange={(e) => setEstimateRevisionId(e.target.value)}>
              <option value="">Select…</option>
              {estimates.map((e) => (
                <option key={e.revisionId} value={e.revisionId}>
                  rev {e.revisionNumber} ({e.status})
                </option>
              ))}
            </select>
          </label>
          <label style={styles.label}>Final price (minor)
            <input type="number" style={styles.input} value={finalPriceMinor} onChange={(e) => setFinalPriceMinor(Number(e.target.value))} />
          </label>
          <button style={styles.buttonPrimary} onClick={create} disabled={!estimateRevisionId}>Create draft bid</button>
        </div>
        {finalizedEstimates.length === 0 && (
          <div style={styles.warning}>Submission requires a finalized estimate revision. Finalize one in the Estimate tab first.</div>
        )}
      </div>

      {bids.length > 0 && (
        <div style={styles.card}>
          <h3 style={styles.title}>Bids</h3>
          <table style={styles.table}>
            <thead><tr><th style={styles.th}>Bid</th><th style={styles.th}>Status</th><th style={styles.th}>Final price</th><th style={styles.th}>Submitted</th><th style={styles.th}>Outcome</th><th style={styles.th}></th></tr></thead>
            <tbody>
              {bids.map((b) => (
                <tr key={b.bidId}>
                  <td style={styles.td} className="mono">{b.bidId.slice(-8)}</td>
                  <td style={styles.td}>
                    <span style={b.status === 'submitted' ? styles.badgeSubmitted : (b.status === 'won' || b.status === 'lost' || b.status === 'withdrawn') ? styles.badgeFinalized : styles.badge}>{b.status}</span>
                  </td>
                  <td style={styles.td}>{money(b.finalPrice)}</td>
                  <td style={styles.td}>{b.submittedAt ? new Date(b.submittedAt).toLocaleString() : '—'}</td>
                  <td style={styles.td}>{b.outcomeAt ? `${b.status} ${new Date(b.outcomeAt).toLocaleDateString()}` : '—'}{b.outcomeNote ? ` (${b.outcomeNote})` : ''}</td>
                  <td style={styles.td}>
                    {b.status === 'draft' && <button style={styles.buttonPrimary} onClick={() => submit(b.bidId)} disabled={!finalizedEstimates.find((e) => e.revisionId === b.estimateRevisionId)}>Submit</button>}
                    {(b.status === 'draft' || b.status === 'submitted') && <button style={styles.button} onClick={() => withdraw(b.bidId)}>Withdraw</button>}
                    {b.status === 'submitted' && (
                      <>
                        <button style={styles.buttonPrimary} onClick={() => setConfirmingOutcome('won')}>Won</button>
                        <button style={styles.button} onClick={() => setConfirmingOutcome('lost')}>Lost</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {selected && confirmingOutcome && (
            <div style={styles.card}>
              <div style={styles.warning}>Record outcome "{confirmingOutcome}" for bid {selected.bidId.slice(-8)}?</div>
              <div style={styles.row}>
                <button style={styles.buttonPrimary} onClick={() => recordOutcome(selected.bidId, confirmingOutcome)}>Confirm</button>
                <button style={styles.button} onClick={() => setConfirmingOutcome(null)}>Cancel</button>
              </div>
            </div>
          )}
          {selected && (
            <div style={styles.card}>
              <h4 style={styles.title}>Selected bid</h4>
              <div style={styles.mono}>estimateRevisionContentHash: {selected.estimateRevisionContentHash}</div>
              <div style={styles.muted}>submittedAt: {selected.submittedAt ?? '—'}</div>
              <div style={styles.muted}>outcomeAt: {selected.outcomeAt ?? '—'}</div>
              <div style={styles.muted}>outcomeNote: {selected.outcomeNote ?? '—'}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
