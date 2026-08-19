/**
 * Bid repository — tenant-scoped.
 *
 * Stores commercial submission decisions. References a finalized
 * EstimateRevision by revisionId + contentHash. Does NOT duplicate the
 * estimate payload. Every query enforces tenant scope. (Phase 2B.1 §14, §16.)
 */

import type { DbClient, DbRow } from '../db-client.js'
import type { Bid, BidStatus } from '../../domain/commercial/bid.js'
import type { Money } from '../../domain/commercial/money.js'

interface BidRow extends DbRow {
  bid_id: string
  tenant_id: string
  project_id: string
  estimate_revision_id: string
  estimate_revision_content_hash: string
  status: string
  final_price_minor: bigint | number | null
  final_price_currency: string | null
  director_adjustment_minor: bigint | number | null
  director_adjustment_currency: string | null
  adjustment_rationale: string | null
  submitted_at: Date | null
  outcome_at: Date | null
  outcome_note: string | null
  created_at: Date
}

function toMoney(minor: bigint | number | null, currency: string | null): Money | null {
  if (minor === null || currency === null) return null
  const amount = typeof minor === 'bigint' ? Number(minor) : minor
  return { __brand: 'Money', amount, currency } as Money
}

function mapRow(r: BidRow): Bid {
  return {
    __brand: 'Bid',
    bidId: r.bid_id,
    projectId: r.project_id,
    estimateRevisionId: r.estimate_revision_id,
    estimateRevisionContentHash: r.estimate_revision_content_hash,
    status: r.status as BidStatus,
    finalPrice: toMoney(r.final_price_minor, r.final_price_currency),
    directorAdjustment: toMoney(r.director_adjustment_minor, r.director_adjustment_currency),
    adjustmentRationale: r.adjustment_rationale,
    submittedAt: r.submitted_at instanceof Date ? r.submitted_at.toISOString() : (r.submitted_at ? String(r.submitted_at) : null),
    outcomeAt: r.outcome_at instanceof Date ? r.outcome_at.toISOString() : (r.outcome_at ? String(r.outcome_at) : null),
    outcomeNote: r.outcome_note,
  }
}

export class BidRepository {
  constructor(private readonly db: DbClient) {}

  async create(b: Bid, tenantId: string): Promise<Bid> {
    const rows = await this.db.queryReturning<BidRow>(
      `INSERT INTO bids (bid_id, tenant_id, project_id, estimate_revision_id, estimate_revision_content_hash, status, final_price_minor, final_price_currency, director_adjustment_minor, director_adjustment_currency, adjustment_rationale, submitted_at, outcome_at, outcome_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
      [
        b.bidId, tenantId, b.projectId, b.estimateRevisionId, b.estimateRevisionContentHash,
        b.status,
        b.finalPrice?.amount ?? null, b.finalPrice?.currency ?? null,
        b.directorAdjustment?.amount ?? null, b.directorAdjustment?.currency ?? null,
        b.adjustmentRationale,
        b.submittedAt, b.outcomeAt, b.outcomeNote,
      ],
    )
    return mapRow(rows[0]!)
  }

  async getById(bidId: string, tenantId: string): Promise<Bid | null> {
    const rows = await this.db.query<BidRow>(
      `SELECT * FROM bids WHERE bid_id = $1 AND tenant_id = $2`, [bidId, tenantId],
    )
    return rows[0] ? mapRow(rows[0]) : null
  }

  async listForProject(tenantId: string, projectId: string): Promise<Bid[]> {
    const rows = await this.db.query<BidRow>(
      `SELECT * FROM bids WHERE tenant_id = $1 AND project_id = $2 ORDER BY created_at DESC`, [tenantId, projectId],
    )
    return rows.map(mapRow)
  }

  async updateStatus(bidId: string, tenantId: string, status: BidStatus): Promise<Bid | null> {
    const rows = await this.db.queryReturning<BidRow>(
      `UPDATE bids SET status = $3 WHERE bid_id = $1 AND tenant_id = $2 RETURNING *`,
      [bidId, tenantId, status],
    )
    return rows[0] ? mapRow(rows[0]) : null
  }

  /**
   * Submit a bid: set status=submitted + submitted_at atomically.
   * (Phase 2B.2.1 Me2 fix: submittedAt populated.)
   */
  async submit(bidId: string, tenantId: string, submittedAt: string): Promise<Bid | null> {
    const rows = await this.db.queryReturning<BidRow>(
      `UPDATE bids SET status = 'submitted', submitted_at = $3
       WHERE bid_id = $1 AND tenant_id = $2 AND status = 'draft'
       RETURNING *`,
      [bidId, tenantId, submittedAt],
    )
    return rows[0] ? mapRow(rows[0]) : null
  }

  /**
   * Record bid outcome: set status + outcome_at + outcome_note atomically.
   */
  async recordOutcome(bidId: string, tenantId: string, outcome: 'won' | 'lost', outcomeAt: string, note?: string): Promise<Bid | null> {
    const rows = await this.db.queryReturning<BidRow>(
      `UPDATE bids SET status = $3, outcome_at = $4, outcome_note = $5
       WHERE bid_id = $1 AND tenant_id = $2 AND status = 'submitted'
       RETURNING *`,
      [bidId, tenantId, outcome, outcomeAt, note ?? null],
    )
    return rows[0] ? mapRow(rows[0]) : null
  }
}
