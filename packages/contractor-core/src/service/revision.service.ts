/**
 * Revision service — generic revision framework.
 *
 * Supports future authorities (EstimateRevision, ProgrammeRevision, ...)
 * WITHOUT implementing either domain. The domain-specific payload is
 * passed in as a content hash (computed by the domain layer using the
 * canonical hashing mechanism). (Phase 1 section 13.)
 *
 * Immutability: once finalized, a revision cannot be updated or deleted.
 * Corrections occur through a NEW revision that supersedes the old one.
 * (Phase 1 section 14; master prompt §13.)
 */

import type { RevisionRepository, ProjectRepository, AuditRepository } from '../persistence/index.js'
import type { RevisionMetadata, TenantContext } from '../domain/types.js'
import { requirePermission, actorIdOf } from '../domain/tenant-context.js'
import { NotFoundError, ValidationError } from '../domain/errors.js'
import { ID_PREFIX, entityId } from '../domain/ids.js'

export class RevisionService {
  constructor(
    private readonly revisions: RevisionRepository,
    private readonly projects: ProjectRepository,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * Create a new draft revision. The contentHash is computed by the caller
   * (the domain layer) using the canonical hashing mechanism. The
   * algorithmVersion records which algorithm + contract produced the
   * derived fields, for deterministic replay. (master prompt §13.)
   */
  async createDraft(
    ctx: TenantContext,
    projectId: string,
    authorityKind: string,
    algorithmVersion: string,
    contentHash: string,
    parentRevisionId: string | null,
  ): Promise<RevisionMetadata> {
    requirePermission(ctx, 'project:write')
    // Verify the project exists IN THIS TENANT (tenant-scoped check)
    const project = await this.projects.getById(projectId, ctx.tenantId)
    if (!project) throw new ValidationError(`Project not found in this tenant: ${projectId}`)

    const revision = await this.revisions.createDraft(
      ctx.tenantId,
      projectId,
      authorityKind,
      actorIdOf(ctx),
      algorithmVersion,
      contentHash,
      parentRevisionId,
      new Date().toISOString(),
    )

    await this.audit.append({
      eventId: entityId(ID_PREFIX.audit),
      tenantId: ctx.tenantId,
      actorId: actorIdOf(ctx),
      actorKind: ctx.actor.kind,
      timestamp: new Date().toISOString(),
      action: 'revision.draft_created',
      entityType: 'revision',
      entityId: revision.revisionId,
      operation: 'create_draft',
      metadata: { authorityKind, projectId, revisionNumber: revision.revisionNumber },
    })

    return revision
  }

  /**
   * Finalize a draft revision (draft -> finalized). After this, the
   * revision is IMMUTABLE — no update or delete is possible.
   * (Phase 1 section 14.)
   */
  async finalize(ctx: TenantContext, revisionId: string): Promise<RevisionMetadata> {
    requirePermission(ctx, 'revision:finalize')
    const existing = await this.revisions.getById(revisionId, ctx.tenantId)
    if (!existing) throw new NotFoundError('revision', revisionId)
    if (existing.status !== 'draft') {
      throw new ValidationError(`Revision is not a draft (status=${existing.status}): ${revisionId}`)
    }
    const finalized = await this.revisions.finalize(revisionId, ctx.tenantId, new Date().toISOString())
    if (!finalized) throw new NotFoundError('revision', revisionId)

    await this.audit.append({
      eventId: entityId(ID_PREFIX.audit),
      tenantId: ctx.tenantId,
      actorId: actorIdOf(ctx),
      actorKind: ctx.actor.kind,
      timestamp: new Date().toISOString(),
      action: 'revision.finalized',
      entityType: 'revision',
      entityId: revisionId,
      operation: 'finalize',
      metadata: { authorityKind: existing.authorityKind, contentHash: existing.contentHash },
    })
    return finalized
  }

  /**
   * Supersede a revision (a newer finalized revision replaces it).
   * The superseded revision remains immutable and present for historical
   * reconstruction. (master prompt §13.)
   */
  async supersede(ctx: TenantContext, revisionId: string): Promise<RevisionMetadata> {
    requirePermission(ctx, 'revision:finalize')
    const existing = await this.revisions.getById(revisionId, ctx.tenantId)
    if (!existing) throw new NotFoundError('revision', revisionId)
    const superseded = await this.revisions.supersede(revisionId, ctx.tenantId)
    if (!superseded) throw new NotFoundError('revision', revisionId)

    await this.audit.append({
      eventId: entityId(ID_PREFIX.audit),
      tenantId: ctx.tenantId,
      actorId: actorIdOf(ctx),
      actorKind: ctx.actor.kind,
      timestamp: new Date().toISOString(),
      action: 'revision.superseded',
      entityType: 'revision',
      entityId: revisionId,
      operation: 'supersede',
      metadata: { authorityKind: existing.authorityKind },
    })
    return superseded
  }

  async getById(ctx: TenantContext, revisionId: string): Promise<RevisionMetadata> {
    requirePermission(ctx, 'revision:read')
    const revision = await this.revisions.getById(revisionId, ctx.tenantId)
    if (!revision) throw new NotFoundError('revision', revisionId)
    return revision
  }

  async listForProject(
    ctx: TenantContext,
    projectId: string,
    authorityKind: string,
  ): Promise<RevisionMetadata[]> {
    requirePermission(ctx, 'revision:read')
    return this.revisions.listForProject(ctx.tenantId, projectId, authorityKind)
  }
}
