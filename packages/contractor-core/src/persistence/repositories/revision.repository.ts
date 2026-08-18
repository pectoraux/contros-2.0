/**
 * Revision repository — tenant-scoped, with IMMATABILITY enforcement.
 *
 * Generic revision metadata infrastructure. Supports future authorities
 * (EstimateRevision, ProgrammeRevision, ...) without implementing either
 * domain yet. (Phase 1 section 13.)
 *
 * finalized/superseded revisions CANNOT be updated or deleted:
 *  - This repository exposes NO update/delete methods for non-draft rows.
 *  - The database has triggers that block UPDATE/DELETE on
 *    finalized/superseded rows as defense in depth. (Phase 1 section 14.)
 *
 * Corrections occur through a NEW revision that supersedes the old one.
 */

import type { DbClient, DbRow } from '../db-client.js'
import type { RevisionMetadata, RevisionStatus } from '../../domain/types.js'
import { assertMutable } from '../../domain/revision.js'

interface RevisionRow extends DbRow {
  revision_id: string
  tenant_id: string
  project_id: string
  authority_kind: string
  revision_number: number
  status: string
  created_by: string
  created_at: Date
  algorithm_version: string
  content_hash: string
  parent_revision_id: string | null
  finalized_at: Date | null
}

function mapRow(r: RevisionRow): RevisionMetadata {
  return {
    revisionId: r.revision_id,
    tenantId: r.tenant_id,
    projectId: r.project_id,
    authorityKind: r.authority_kind,
    revisionNumber: r.revision_number,
    status: r.status as RevisionStatus,
    createdBy: r.created_by,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    algorithmVersion: r.algorithm_version,
    contentHash: r.content_hash,
    parentRevisionId: r.parent_revision_id,
    finalizedAt: r.finalized_at instanceof Date ? r.finalized_at.toISOString() : (r.finalized_at ? String(r.finalized_at) : null),
  }
}

export class RevisionRepository {
  constructor(private readonly db: DbClient) {}

  /**
   * Create a new draft revision. The revision number is assigned
   * automatically (next in sequence for tenant+project+authorityKind).
   */
  async createDraft(
    tenantId: string,
    projectId: string,
    authorityKind: string,
    createdBy: string,
    algorithmVersion: string,
    contentHash: string,
    parentRevisionId: string | null,
    createdAt: string,
  ): Promise<RevisionMetadata> {
    return this.db.tx(async (tx) => {
      // Assign the next revision number within (tenant, project, authorityKind)
      const seqRows = await tx.query<{ max_num: number | null }>(
        `SELECT MAX(revision_number) as max_num FROM revisions WHERE tenant_id = $1 AND project_id = $2 AND authority_kind = $3`,
        [tenantId, projectId, authorityKind],
      )
      const nextNum = (seqRows[0]?.max_num ?? 0) + 1
      const rows = await tx.queryReturning<RevisionRow>(
        `INSERT INTO revisions (revision_id, tenant_id, project_id, authority_kind, revision_number, status, created_by, created_at, algorithm_version, content_hash, parent_revision_id, finalized_at)
         VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9, $10, NULL)
         RETURNING *`,
        [
          `rev_${cryptoRandomId()}`,
          tenantId,
          projectId,
          authorityKind,
          nextNum,
          createdBy,
          createdAt,
          algorithmVersion,
          contentHash,
          parentRevisionId,
        ],
      )
      return mapRow(rows[0]!)
    })
  }

  /**
   * Get a revision by id, ENFORCING tenant scope.
   * Cross-tenant lookup returns null. (Phase 1 section 7/21.)
   */
  async getById(revisionId: string, tenantId: string): Promise<RevisionMetadata | null> {
    const rows = await this.db.query<RevisionRow>(
      `SELECT * FROM revisions WHERE revision_id = $1 AND tenant_id = $2`,
      [revisionId, tenantId],
    )
    return rows[0] ? mapRow(rows[0]) : null
  }

  /**
   * List revisions for a project + authorityKind, ENFORCING tenant scope.
   */
  async listForProject(
    tenantId: string,
    projectId: string,
    authorityKind: string,
  ): Promise<RevisionMetadata[]> {
    const rows = await this.db.query<RevisionRow>(
      `SELECT * FROM revisions WHERE tenant_id = $1 AND project_id = $2 AND authority_kind = $3 ORDER BY revision_number DESC`,
      [tenantId, projectId, authorityKind],
    )
    return rows.map(mapRow)
  }

  /**
   * Finalize a draft revision (draft -> finalized). After this, the
   * revision is IMMUTABLE — no update or delete is possible.
   * Returns the finalized revision, or null if not found / not a draft.
   */
  async finalize(revisionId: string, tenantId: string, finalizedAt: string): Promise<RevisionMetadata | null> {
    // Only draft revisions can be finalized. The status check is enforced
    // here AND by the database trigger (which blocks UPDATE on non-draft).
    const rows = await this.db.queryReturning<RevisionRow>(
      `UPDATE revisions SET status = 'finalized', finalized_at = $3
       WHERE revision_id = $1 AND tenant_id = $2 AND status = 'draft'
       RETURNING *`,
      [revisionId, tenantId, finalizedAt],
    )
    return rows[0] ? mapRow(rows[0]) : null
  }

  /**
   * Supersede a revision (draft->superseded OR finalized->superseded).
   * The superseded revision remains immutable and present for historical
   * reconstruction. (master prompt §13.)
   */
  async supersede(revisionId: string, tenantId: string): Promise<RevisionMetadata | null> {
    const rows = await this.db.queryReturning<RevisionRow>(
      `UPDATE revisions SET status = 'superseded'
       WHERE revision_id = $1 AND tenant_id = $2 AND status IN ('draft','finalized')
       RETURNING *`,
      [revisionId, tenantId],
    )
    return rows[0] ? mapRow(rows[0]) : null
  }

  /**
   * Attempt to update a draft revision's content hash. Throws if the
   * revision is NOT a draft (immutable). Used to update working state
   * before finalization. (Phase 1 section 14.)
   *
   * This method exists ONLY for draft revisions. Once finalized, no
   * update is possible — the database trigger blocks it, and this method
   * checks status first.
   */
  async updateDraftContent(
    revisionId: string,
    tenantId: string,
    contentHash: string,
    algorithmVersion: string,
  ): Promise<RevisionMetadata | null> {
    // Fetch first to check status (defense in depth before the DB trigger)
    const existing = await this.getById(revisionId, tenantId)
    if (!existing) return null
    assertMutable(revisionId, existing.status) // throws if immutable

    const rows = await this.db.queryReturning<RevisionRow>(
      `UPDATE revisions SET content_hash = $3, algorithm_version = $4
       WHERE revision_id = $1 AND tenant_id = $2 AND status = 'draft'
       RETURNING *`,
      [revisionId, tenantId, contentHash, algorithmVersion],
    )
    return rows[0] ? mapRow(rows[0]) : null
  }

  // NOTE: There is intentionally NO delete() method and NO update method
  // for finalized/superseded revisions. The database triggers block such
  // operations as defense in depth. (Phase 1 section 14 — immutability rule.)
}

function cryptoRandomId(): string {
  // 16 hex chars of randomness for the revision id suffix.
  const bytes = new Uint8Array(8)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
