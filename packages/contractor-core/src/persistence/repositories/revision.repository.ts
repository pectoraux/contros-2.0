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
   * Create a new draft revision. The revision number is allocated
   * atomically from a dedicated counter row (revision_counters table),
   * NOT via SELECT MAX(revision_number)+1. This is concurrency-safe:
   * concurrent createDraft calls for the same (tenant, project,
   * authorityKind) each get a unique sequential number with no race
   * window and no retry. (Phase 1.1 H1 fix.)
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
      // Atomically allocate the next revision number.
      // INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING is a single
      // atomic statement; the row-level lock on the counter row serializes
      // concurrent allocations. No MAX()+1 race, no serialization failure.
      const counterRows = await tx.query<{ next_num: number }>(
        `INSERT INTO revision_counters (tenant_id, project_id, authority_kind, next_number)
         VALUES ($1, $2, $3, 2)
         ON CONFLICT (tenant_id, project_id, authority_kind)
         DO UPDATE SET next_number = revision_counters.next_number + 1
         RETURNING next_number - 1 AS next_num`,
        [tenantId, projectId, authorityKind],
      )
      const nextNum = counterRows[0]!.next_num
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
