/**
 * EstimateRevision repository — tenant-scoped.
 *
 * Wraps the generic RevisionRepository (for metadata: createDraft, finalize,
 * supersede, getById, listForProject) and adds commercial payload storage
 * (JSONB in estimate_revision_payloads). The JSONB is the canonical immutable
 * EstimateRevisionPayload; denormalized fields are indexed projections only.
 * (Phase 2B.1 §3, §6, §7, §8, §16.)
 *
 * Reuses:
 *   - RevisionRepository (generic revision metadata + counter + immutability triggers)
 *   - revision_counters table (atomic revision number allocation)
 *   - block_immutable_revision_update/delete triggers on revisions
 *   - block_estimate_payload_mutation trigger on estimate_revision_payloads
 *
 * EstimateRevision = RevisionMetadata (revisions table) + EstimateRevisionPayload (JSONB).
 * No competing revision mechanism.
 */

import type { DbClient, DbRow } from '../db-client.js'
import type { RevisionMetadata } from '../../domain/types.js'
import type { EstimateRevision, EstimateRevisionPayload } from '../../domain/commercial/estimate-revision.js'
import { estimateRevisionContentHash } from '../../domain/commercial/estimate-revision.js'
import { RevisionRepository } from './revision.repository.js'

interface PayloadRow extends DbRow {
  revision_id: string
  tenant_id: string
  project_id: string
  payload_json: string | Record<string, unknown>
  currency: string
  target_profit_mode: string
  target_profit_ratio: number
  created_at: Date
}

export class EstimateRevisionRepository {
  private readonly revisions: RevisionRepository

  constructor(private readonly db: DbClient) {
    this.revisions = new RevisionRepository(db)
  }

  /**
   * Create a draft EstimateRevision ATOMICALLY: allocate revision number,
   * insert revision metadata, AND insert the canonical payload JSONB — all
   * within ONE transaction. If the payload INSERT fails, the entire
   * transaction (including the revision metadata + counter allocation) is
   * rolled back. No orphaned revision without payload can persist.
   * (Phase 2B.1.1 H1 fix.)
   *
   * The RevisionRepository.createDraft() call uses this.db.tx() internally,
   * which — when called from within this outer tx() — creates a SAVEPOINT
   * rather than a new top-level transaction. This is the correct nesting
   * behavior for DbClient.tx().
   */
  async createDraft(
    tenantId: string,
    projectId: string,
    payload: EstimateRevisionPayload,
    createdBy: string,
    createdAt: string,
  ): Promise<EstimateRevision> {
    const contentHash = estimateRevisionContentHash(payload)
    return this.db.tx(async (tx) => {
      // Step 1: allocate revision number + insert revision metadata.
      // This calls tx.tx() internally → SAVEPOINT (nested tx).
      // The RevisionRepository uses `this.db` (the same client), so its
      // internal tx() will nest as a SAVEPOINT within this outer tx.
      const metadata = await this.revisions.createDraft(
        tenantId, projectId, 'estimate', createdBy,
        payload.pricingAlgorithmVersion, contentHash, null, createdAt,
      )
      // Step 2: insert the canonical payload JSONB.
      // If this fails, the outer tx rolls back — including the revision
      // metadata and counter allocation from Step 1.
      await tx.queryReturning<PayloadRow>(
        `INSERT INTO estimate_revision_payloads (revision_id, tenant_id, project_id, payload_json, currency, target_profit_mode, target_profit_ratio)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          metadata.revisionId, tenantId, projectId,
          JSON.stringify(payload),
          payload.currency,
          payload.policy.targetProfitMode,
          payload.policy.targetProfitRatio,
        ],
      )
      return { __brand: 'EstimateRevision' as const, metadata, payload }
    })
  }

  /**
   * Get an EstimateRevision by id, ENFORCING tenant scope.
   * Joins revisions + estimate_revision_payloads, reconstructs the full
   * EstimateRevision (metadata + payload). Cross-tenant returns null.
   */
  async getById(revisionId: string, tenantId: string): Promise<EstimateRevision | null> {
    // Fetch metadata from revisions (tenant-scoped)
    const metadata = await this.revisions.getById(revisionId, tenantId)
    if (!metadata) return null
    // Fetch payload JSONB (tenant-scoped)
    const payloadRows = await this.db.query<PayloadRow>(
      `SELECT * FROM estimate_revision_payloads WHERE revision_id = $1 AND tenant_id = $2`,
      [revisionId, tenantId],
    )
    if (!payloadRows[0]) return null
    const payload = this.deserializePayload(payloadRows[0]!.payload_json)
    return { __brand: 'EstimateRevision', metadata, payload }
  }

  /**
   * Update a draft revision's payload ATOMICALLY: update content_hash on
   * the revisions table AND update the payload JSONB — all within ONE
   * transaction. If either write fails, neither persists.
   * (Phase 2B.1.1 H1 fix.)
   *
   * The RevisionRepository.updateDraftContent() fetches the revision first
   * (to check status) then updates. When called from within this outer tx,
   * its internal operations participate in the same transaction.
   */
  async updateDraftPayload(
    revisionId: string,
    tenantId: string,
    payload: EstimateRevisionPayload,
  ): Promise<EstimateRevision | null> {
    const contentHash = estimateRevisionContentHash(payload)
    return this.db.tx(async (tx) => {
      // Step 1: check status + update content_hash on the revisions table.
      // updateDraftContent does a SELECT (status check) + UPDATE (hash).
      // Both participate in this transaction.
      // The RevisionRepository uses `this.db` (the same client).
      const metadata = await this.revisions.updateDraftContent(
        revisionId, tenantId, contentHash, payload.pricingAlgorithmVersion,
      )
      if (!metadata) return null
      // Step 2: update the payload JSONB.
      // If this fails, the outer tx rolls back — content_hash reverts too.
      await tx.queryReturning<PayloadRow>(
        `UPDATE estimate_revision_payloads
         SET payload_json = $3, currency = $4, target_profit_mode = $5, target_profit_ratio = $6
         WHERE revision_id = $1 AND tenant_id = $2
         RETURNING *`,
        [
          revisionId, tenantId,
          JSON.stringify(payload),
          payload.currency,
          payload.policy.targetProfitMode,
          payload.policy.targetProfitRatio,
        ],
      )
      return { __brand: 'EstimateRevision' as const, metadata, payload }
    })
  }

  /**
   * Finalize a draft revision (draft → finalized). Delegates to the generic
   * RevisionRepository. After this, the revision + payload are IMMUTABLE.
   */
  async finalize(revisionId: string, tenantId: string, finalizedAt: string): Promise<EstimateRevision | null> {
    const metadata = await this.revisions.finalize(revisionId, tenantId, finalizedAt)
    if (!metadata) return null
    return this.getById(revisionId, tenantId)
  }

  /**
   * Supersede a revision (draft/finalized → superseded). Delegates to the
   * generic RevisionRepository. The revision remains immutable and present.
   */
  async supersede(revisionId: string, tenantId: string): Promise<EstimateRevision | null> {
    const metadata = await this.revisions.supersede(revisionId, tenantId)
    if (!metadata) return null
    return this.getById(revisionId, tenantId)
  }

  /**
   * List EstimateRevisions for a project. Joins revisions + payloads,
   * enforces tenant scope. Returns full EstimateRevision objects.
   */
  async listForProject(tenantId: string, projectId: string): Promise<EstimateRevision[]> {
    const metadatas = await this.revisions.listForProject(tenantId, projectId, 'estimate')
    const result: EstimateRevision[] = []
    for (const metadata of metadatas) {
      const payloadRows = await this.db.query<PayloadRow>(
        `SELECT payload_json FROM estimate_revision_payloads WHERE revision_id = $1 AND tenant_id = $2`,
        [metadata.revisionId, tenantId],
      )
      if (payloadRows[0]) {
        const payload = this.deserializePayload(payloadRows[0]!.payload_json)
        result.push({ __brand: 'EstimateRevision', metadata, payload })
      }
    }
    return result
  }

  /**
   * Deserialize the JSONB payload back to an EstimateRevisionPayload.
   * The branded types (__brand) are compile-time phantom types — they survive
   * JSON serialization/deserialization. The contentHash is recomputed from
   * the deserialized payload and must match the stored hash.
   */
  private deserializePayload(json: string | Record<string, unknown>): EstimateRevisionPayload {
    const obj = typeof json === 'string' ? JSON.parse(json) : json
    return obj as EstimateRevisionPayload
  }
}
