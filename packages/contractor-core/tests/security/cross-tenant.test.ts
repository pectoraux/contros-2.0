/**
 * Security tests — cross-tenant rejection at every layer + malicious inputs.
 * (Phase 1 section 24.)
 *
 * Run against REAL PostgreSQL (pglite). NOT mocked.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { TestFixture } from '../integration/setup.js'
import { createTestFixture } from '../integration/setup.js'
import { UnauthorizedError, NotFoundError, ValidationError, ForbiddenError } from '../../src/domain/errors.js'

let fx: TestFixture
beforeAll(async () => { fx = await createTestFixture() })
afterAll(async () => { await fx.cleanup() })

describe('cross-tenant security (real PostgreSQL)', () => {
  it('User A cannot access Tenant B’s projects via the service layer', async () => {
    const a = await fx.bootstrapTenant('SecA', 'seca', 'a@seca.test')
    const b = await fx.bootstrapTenant('SecB', 'secb', 'b@secb.test')
    const bWs = await fx.services.workspaces.createWorkspace(b.ctx, 'B WS')
    const bProj = await fx.services.projects.createProject(b.ctx, bWs.id, 'B Project')
    // User A (in tenant A) tries to read B's project → NotFound (existence not leaked)
    await expect(fx.services.projects.getProject(a.ctx, bProj.id)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('User A cannot list Tenant B’s workspaces', async () => {
    const a = await fx.bootstrapTenant('SecC', 'secc', 'c@secc.test')
    const b = await fx.bootstrapTenant('SecD', 'secd', 'd@secd.test')
    await fx.services.workspaces.createWorkspace(b.ctx, 'B Only WS')
    const aList = await fx.services.workspaces.listWorkspaces(a.ctx)
    expect(aList.find((w) => w.name === 'B Only WS')).toBeUndefined()
  })

  it('User A cannot create a project in Tenant B’s workspace', async () => {
    const a = await fx.bootstrapTenant('SecE', 'sece', 'e@sece.test')
    const b = await fx.bootstrapTenant('SecF', 'secf', 'f@secf.test')
    const bWs = await fx.services.workspaces.createWorkspace(b.ctx, 'B WS for cross-create')
    // A tries to create a project in B's workspace → validation fails (workspace not in A's tenant)
    await expect(fx.services.projects.createProject(a.ctx, bWs.id, 'injected'))
      .rejects.toBeInstanceOf(ValidationError)
  })

  it('User A cannot read Tenant B’s audit events', async () => {
    const a = await fx.bootstrapTenant('SecG', 'secg', 'g@secg.test')
    const b = await fx.bootstrapTenant('SecH', 'sech', 'h@sech.test')
    await fx.services.audit.record(b.ctx, 'b.action', 'entity', 'ent_b', 'create', { secret: 'b' })
    const aAudit = await fx.services.audit.listForTenant(a.ctx)
    expect(aAudit.find((e) => e.metadata && (e.metadata as Record<string, unknown>).secret === 'b')).toBeUndefined()
  })

  it('User A cannot read Tenant B’s revisions', async () => {
    const a = await fx.bootstrapTenant('SecI', 'seci', 'i@seci.test')
    const b = await fx.bootstrapTenant('SecJ', 'secj', 'j@secj.test')
    const bWs = await fx.services.workspaces.createWorkspace(b.ctx, 'B WS')
    const bProj = await fx.services.projects.createProject(b.ctx, bWs.id, 'B Proj')
    const bDraft = await fx.services.revisions.createDraft(b.ctx, bProj.id, 'estimate', 'v1', 'hash_b', null)
    // A tries to read B's revision → NotFound
    await expect(fx.services.revisions.getById(a.ctx, bDraft.revisionId)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('User A cannot finalize Tenant B’s revision', async () => {
    const a = await fx.bootstrapTenant('SecK', 'seck', 'k@seck.test')
    const b = await fx.bootstrapTenant('SecL', 'secl', 'l@secl.test')
    const bWs = await fx.services.workspaces.createWorkspace(b.ctx, 'B WS')
    const bProj = await fx.services.projects.createProject(b.ctx, bWs.id, 'B Proj')
    const bDraft = await fx.services.revisions.createDraft(b.ctx, bProj.id, 'estimate', 'v1', 'hash_b2', null)
    // A tries to finalize B's draft → NotFound (cross-tenant)
    await expect(fx.services.revisions.finalize(a.ctx, bDraft.revisionId)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('A viewer cannot create projects (authorization denied)', async () => {
    const boot = await fx.bootstrapTenant('SecM', 'secm', 'm@secm.test', 'viewer')
    const ws = await fx.services.workspaces.createWorkspace(
      // Create WS as an owner (the bootstrap gave 'viewer' to the test user, so create WS as a different bootstrap)
      (await fx.bootstrapTenant('SecM2', 'secm2', 'm2@secm2.test', 'owner')).ctx,
      'M WS',
    )
    // The viewer tries to create a project → UnauthorizedError (viewer lacks project:write)
    await expect(fx.services.projects.createProject(boot.ctx, ws.id, 'viewer attempt'))
      .rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('A member cannot finalize revisions (authorization denied)', async () => {
    const boot = await fx.bootstrapTenant('SecN', 'secn', 'n@secn.test', 'member')
    const ws = await fx.services.workspaces.createWorkspace(
      (await fx.bootstrapTenant('SecN2', 'secn2', 'n2@secn2.test', 'owner')).ctx,
      'N WS',
    )
    // owner creates the project + draft, then member tries to finalize
    const ownerBoot = await fx.bootstrapTenant('SecN3', 'secn3', 'n3@secn3.test', 'owner')
    const ws2 = await fx.services.workspaces.createWorkspace(ownerBoot.ctx, 'N3 WS')
    const proj = await fx.services.projects.createProject(ownerBoot.ctx, ws2.id, 'N3 Proj')
    const draft = await fx.services.revisions.createDraft(ownerBoot.ctx, proj.id, 'estimate', 'v1', 'h', null)
    // member tries to finalize → UnauthorizedError
    const memberBoot = await fx.bootstrapTenant('SecN4', 'secn4', 'n4@secn4.test', 'member')
    await expect(fx.services.revisions.finalize(memberBoot.ctx, draft.revisionId))
      .rejects.toBeInstanceOf(UnauthorizedError)
  })
})

describe('malicious inputs around IDs and authorization context', () => {
  it('malicious project ID (SQL injection attempt) is parameterized-safe', async () => {
    const { ctx } = await fx.bootstrapTenant('SecO', 'seco', 'o@seco.test')
    const malicious = "proj_1'; DROP TABLE projects; --"
    await expect(fx.services.projects.getProject(ctx, malicious)).rejects.toBeInstanceOf(NotFoundError)
    // The table still exists (parameterized query prevented injection)
    const stillThere = await fx.repos.projects.listForTenant(ctx.tenantId)
    expect(Array.isArray(stillThere)).toBe(true)
  })

  it('malicious workspace ID in createProject is safe', async () => {
    const { ctx } = await fx.bootstrapTenant('SecP', 'secp', 'p@secp.test')
    const malicious = "ws_1'; DROP TABLE workspaces; --"
    await expect(fx.services.projects.createProject(ctx, malicious, 'inject'))
      .rejects.toBeInstanceOf(ValidationError)
  })

  it('empty project ID resolves to not-found, not a crash', async () => {
    const { ctx } = await fx.bootstrapTenant('SecQ', 'secq', 'q@secq.test')
    await expect(fx.services.projects.getProject(ctx, '')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('very long ID is handled safely', async () => {
    const { ctx } = await fx.bootstrapTenant('SecR', 'secr', 'r@secr.test')
    const longId = 'proj_' + 'A'.repeat(10_000)
    await expect(fx.services.projects.getProject(ctx, longId)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('a TenantContext with no membership has no permissions (cannot mutate)', async () => {
    const boot = await fx.bootstrapTenant('SecS', 'secs', 's@secs.test', 'member')
    // Create a context for a user with NO membership in this tenant
    const { createTenantContext } = await import('../../src/domain/tenant-context.js')
    const noMembershipCtx = createTenantContext(boot.org.id, boot.user.id, null)
    // The user has no permissions → cannot create a project
    await expect(fx.services.projects.createProject(noMembershipCtx, 'any-ws', 'attempt'))
      .rejects.toBeInstanceOf(UnauthorizedError)
  })
})
