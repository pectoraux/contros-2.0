/**
 * Organization service — create + lookup the Tenant (Organization).
 *
 * An Organization IS the tenant. Creating an organization also creates
 * the first membership (owner) for the creating user. All subsequent
 * tenant-scoped operations resolve against this organization's id.
 */

import type { OrganizationRepository, MembershipRepository, AuditRepository } from '../persistence/index.js'
import type { Organization, TenantContext } from '../domain/types.js'
import { ID_PREFIX, entityId } from '../domain/ids.js'
import { requirePermission } from '../domain/tenant-context.js'
import { ConflictError, NotFoundError } from '../domain/errors.js'

export class OrganizationService {
  constructor(
    private readonly orgs: OrganizationRepository,
    private readonly memberships: MembershipRepository,
    private readonly audit: AuditRepository,
  ) {}

  async createOrganization(
    creatorUserId: string,
    name: string,
    slug: string,
  ): Promise<{ organization: Organization; tenantContext: TenantContext }> {
    // Slug is globally unique (enforced by DB)
    const existing = await this.orgs.getBySlug(slug)
    if (existing) throw new ConflictError(`Organization slug already exists: ${slug}`)

    const now = new Date().toISOString()
    const orgId = entityId(ID_PREFIX.organization)
    const organization = await this.orgs.create({
      id: orgId,
      tenantId: orgId, // tenant_id == org id
      name,
      slug,
      status: 'active',
      createdAt: now,
    })

    // Create the owner membership for the creator
    const membership = await this.memberships.create({
      id: entityId(ID_PREFIX.membership),
      userId: creatorUserId,
      organizationId: orgId,
      role: 'owner',
      status: 'active',
      createdAt: now,
    })

    // Build the TenantContext for the creator (now an owner)
    const { createTenantContext } = await import('../domain/tenant-context.js')
    const tenantContext = createTenantContext(orgId, creatorUserId, membership)

    // Audit: organization created
    await this.audit.append({
      eventId: entityId(ID_PREFIX.audit),
      tenantId: orgId,
      actorId: creatorUserId,
      actorKind: 'user',
      timestamp: now,
      action: 'organization.created',
      entityType: 'organization',
      entityId: orgId,
      operation: 'create',
      metadata: { name, slug },
    })

    return { organization, tenantContext }
  }

  async getOrganization(tenantId: string, ctx: TenantContext): Promise<Organization> {
    requirePermission(ctx, 'org:read')
    const org = await this.orgs.getById(tenantId, tenantId)
    if (!org) throw new NotFoundError('organization', tenantId)
    return org
  }
}
