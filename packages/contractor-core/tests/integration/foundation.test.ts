/**
 * Integration tests — tenant isolation, project isolation, workspace
 * isolation, membership isolation, audit append-only, revision immutability.
 *
 * Run against REAL PostgreSQL (pglite — PostgreSQL 16 WASM). NOT mocked.
 * (Phase 1 section 22.)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { TestFixture } from './setup.js'
import { createTestFixture } from './setup.js'

let fx: TestFixture

beforeAll(async () => {
  fx = await createTestFixture()
})
afterAll(async () => {
  await fx.cleanup()
})

describe('tenant isolation (real PostgreSQL)', () => {
  it('tenant A and tenant B get separate organizations', async () => {
    const a = await fx.bootstrapTenant('Acme Corp', 'acme', 'alice@acme.test')
    const b = await fx.bootstrapTenant('Beta Inc', 'beta', 'bob@beta.test')
    expect(a.org.id).not.toBe(b.org.id)
    expect(a.org.tenantId).toBe(a.org.id)
    expect(b.org.tenantId).toBe(b.org.id)
  })

  it('tenant A cannot read tenant B’s organization (getById returns null)', async () => {
    const a = await fx.bootstrapTenant('Gamma Co', 'gamma', 'gina@gamma.test')
    const b = await fx.bootstrapTenant('Delta Co', 'delta', 'dave@delta.test')
    // Tenant A queries tenant B's org id → null (not found, existence not leaked)
    const cross = await fx.repos.orgs.getById(b.org.id, a.org.id)
    expect(cross).toBeNull()
  })

  it('tenant A cannot read tenant B’s projects', async () => {
    const a = await fx.bootstrapTenant('Epsilon', 'epsilon', 'eve@epsilon.test')
    const b = await fx.bootstrapTenant('Zeta', 'zeta', 'zac@zeta.test')
    // Tenant B creates a workspace + project
    const bWs = await fx.repos.workspaces.create({
      id: 'ws_b1', tenantId: b.org.id, organizationId: b.org.id, name: 'B WS', createdAt: new Date().toISOString(),
    })
    const bProj = await fx.repos.projects.create({
      id: 'proj_b1', tenantId: b.org.id, workspaceId: bWs.id, name: 'B Project', status: 'active', createdAt: new Date().toISOString(),
    })
    // Tenant A queries B's project by id with A's tenantId → null
    const cross = await fx.repos.projects.getById(bProj.id, a.org.id)
    expect(cross).toBeNull()
    // Tenant A lists projects in A's tenant → does not include B's project
    const aList = await fx.repos.projects.listForTenant(a.org.id)
    expect(aList.find((p) => p.id === bProj.id)).toBeUndefined()
  })

  it('tenant A cannot read tenant B’s workspaces', async () => {
    const a = await fx.bootstrapTenant('Eta', 'eta', 'emma@eta.test')
    const b = await fx.bootstrapTenant('Theta', 'theta', 'tom@theta.test')
    const bWs = await fx.repos.workspaces.create({
      id: 'ws_t1', tenantId: b.org.id, organizationId: b.org.id, name: 'Theta WS', createdAt: new Date().toISOString(),
    })
    const cross = await fx.repos.workspaces.getById(bWs.id, a.org.id)
    expect(cross).toBeNull()
  })

  it('tenant A cannot read tenant B’s memberships', async () => {
    const a = await fx.bootstrapTenant('Iota', 'iota', 'ivan@iota.test')
    const b = await fx.bootstrapTenant('Kappa', 'kappa', 'kate@kappa.test')
    const bMemberships = await fx.repos.memberships.listForTenant(b.org.id)
    expect(bMemberships.length).toBeGreaterThan(0)
    // Tenant A lists memberships in A's tenant → does not include B's
    const aList = await fx.repos.memberships.listForTenant(a.org.id)
    expect(aList.find((m) => m.id === bMemberships[0]!.id)).toBeUndefined()
  })
})

describe('audit append-only (real PostgreSQL)', () => {
  it('can append audit events', async () => {
    const { ctx } = await fx.bootstrapTenant('Lambda', 'lambda', 'leo@lambda.test')
    const event = await fx.services.audit.record(ctx, 'test.action', 'entity', 'ent_1', 'create', { foo: 'bar' })
    expect(event.eventId).toMatch(/^aud_/)
    expect(event.metadata).toEqual({ foo: 'bar' })
  })

  it('UPDATE on audit_events is blocked by a database trigger', async () => {
    const { ctx } = await fx.bootstrapTenant('Mu', 'mu', 'mia@mu.test')
    const event = await fx.services.audit.record(ctx, 'test.update_block', 'entity', 'ent_2', 'create', null)
    // Attempting to UPDATE the audit event should fail at the DB level
    await expect(fx.db.execute('UPDATE audit_events SET action = $1 WHERE event_id = $2', ['hacked', event.eventId]))
      .rejects.toThrow(/append-only|forbidden/i)
  })

  it('DELETE on audit_events is blocked by a database trigger', async () => {
    const { ctx } = await fx.bootstrapTenant('Nu', 'nu', 'nia@nu.test')
    const event = await fx.services.audit.record(ctx, 'test.delete_block', 'entity', 'ent_3', 'create', null)
    await expect(fx.db.execute('DELETE FROM audit_events WHERE event_id = $1', [event.eventId]))
      .rejects.toThrow(/append-only|forbidden/i)
  })

  it('the AuditRepository exposes no update or delete methods', () => {
    const repo = fx.repos.audit
    expect((repo as unknown as { update?: unknown }).update).toBeUndefined()
    expect((repo as unknown as { delete?: unknown }).delete).toBeUndefined()
  })
})

describe('revision immutability (real PostgreSQL)', () => {
  it('can create a draft revision and finalize it', async () => {
    const { ctx, org } = await fx.bootstrapTenant('Xi', 'xi', 'xena@xi.test')
    const ws = await fx.repos.workspaces.create({
      id: 'ws_x1', tenantId: org.id, organizationId: org.id, name: 'X WS', createdAt: new Date().toISOString(),
    })
    const proj = await fx.repos.projects.create({
      id: 'proj_x1', tenantId: org.id, workspaceId: ws.id, name: 'X Project', status: 'active', createdAt: new Date().toISOString(),
    })
    const draft = await fx.services.revisions.createDraft(ctx, proj.id, 'estimate', 'v1', 'abc123hash', null)
    expect(draft.status).toBe('draft')
    expect(draft.revisionNumber).toBe(1)
    const finalized = await fx.services.revisions.finalize(ctx, draft.revisionId)
    expect(finalized.status).toBe('finalized')
    expect(finalized.finalizedAt).not.toBeNull()
  })

  it('UPDATE on a finalized revision is blocked by a database trigger', async () => {
    const { ctx, org } = await fx.bootstrapTenant('Omicron', 'omicron', 'otto@omicron.test')
    const ws = await fx.repos.workspaces.create({
      id: 'ws_o1', tenantId: org.id, organizationId: org.id, name: 'O WS', createdAt: new Date().toISOString(),
    })
    const proj = await fx.repos.projects.create({
      id: 'proj_o1', tenantId: org.id, workspaceId: ws.id, name: 'O Project', status: 'active', createdAt: new Date().toISOString(),
    })
    const draft = await fx.services.revisions.createDraft(ctx, proj.id, 'estimate', 'v1', 'hash_o', null)
    await fx.services.revisions.finalize(ctx, draft.revisionId)
    // Attempting to UPDATE the finalized revision's content_hash → DB trigger blocks it
    await expect(fx.db.execute('UPDATE revisions SET content_hash = $1 WHERE revision_id = $2', ['hacked', draft.revisionId]))
      .rejects.toThrow(/immutable|forbidden/i)
  })

  it('DELETE on a finalized revision is blocked by a database trigger', async () => {
    const { ctx, org } = await fx.bootstrapTenant('Pi', 'pi', 'piper@pi.test')
    const ws = await fx.repos.workspaces.create({
      id: 'ws_p1', tenantId: org.id, organizationId: org.id, name: 'P WS', createdAt: new Date().toISOString(),
    })
    const proj = await fx.repos.projects.create({
      id: 'proj_p1', tenantId: org.id, workspaceId: ws.id, name: 'P Project', status: 'active', createdAt: new Date().toISOString(),
    })
    const draft = await fx.services.revisions.createDraft(ctx, proj.id, 'estimate', 'v1', 'hash_p', null)
    await fx.services.revisions.finalize(ctx, draft.revisionId)
    await expect(fx.db.execute('DELETE FROM revisions WHERE revision_id = $1', [draft.revisionId]))
      .rejects.toThrow(/immutable|forbidden/i)
  })

  it('can supersede a finalized revision (the old one remains immutable)', async () => {
    const { ctx, org } = await fx.bootstrapTenant('Rho', 'rho', 'rhea@rho.test')
    const ws = await fx.repos.workspaces.create({
      id: 'ws_r1', tenantId: org.id, organizationId: org.id, name: 'R WS', createdAt: new Date().toISOString(),
    })
    const proj = await fx.repos.projects.create({
      id: 'proj_r1', tenantId: org.id, workspaceId: ws.id, name: 'R Project', status: 'active', createdAt: new Date().toISOString(),
    })
    const r1 = await fx.services.revisions.createDraft(ctx, proj.id, 'estimate', 'v1', 'hash_r1', null)
    await fx.services.revisions.finalize(ctx, r1.revisionId)
    const r2 = await fx.services.revisions.createDraft(ctx, proj.id, 'estimate', 'v1', 'hash_r2', r1.revisionId)
    await fx.services.revisions.finalize(ctx, r2.revisionId)
    // Supersede r1
    const superseded = await fx.services.revisions.supersede(ctx, r1.revisionId)
    expect(superseded.status).toBe('superseded')
    // The superseded revision is STILL immutable — UPDATE/DELETE blocked
    await expect(fx.db.execute('DELETE FROM revisions WHERE revision_id = $1', [r1.revisionId]))
      .rejects.toThrow(/immutable|forbidden/i)
  })

  it('revision numbers are sequential within (tenant, project, authorityKind)', async () => {
    const { ctx, org } = await fx.bootstrapTenant('Sigma', 'sigma', 'sam@sigma.test')
    const ws = await fx.repos.workspaces.create({
      id: 'ws_s1', tenantId: org.id, organizationId: org.id, name: 'S WS', createdAt: new Date().toISOString(),
    })
    const proj = await fx.repos.projects.create({
      id: 'proj_s1', tenantId: org.id, workspaceId: ws.id, name: 'S Project', status: 'active', createdAt: new Date().toISOString(),
    })
    const r1 = await fx.services.revisions.createDraft(ctx, proj.id, 'estimate', 'v1', 'h1', null)
    const r2 = await fx.services.revisions.createDraft(ctx, proj.id, 'estimate', 'v1', 'h2', r1.revisionId)
    const r3 = await fx.services.revisions.createDraft(ctx, proj.id, 'estimate', 'v1', 'h3', r2.revisionId)
    expect([r1.revisionNumber, r2.revisionNumber, r3.revisionNumber]).toEqual([1, 2, 3])
  })
})

describe('revision cross-tenant isolation (real PostgreSQL)', () => {
  it('tenant A cannot read tenant B’s revision', async () => {
    const a = await fx.bootstrapTenant('Tau', 'tau', 'tia@tau.test')
    const b = await fx.bootstrapTenant('Upsilon', 'upsilon', 'uma@upsilon.test')
    const bWs = await fx.repos.workspaces.create({
      id: 'ws_u1', tenantId: b.org.id, organizationId: b.org.id, name: 'U WS', createdAt: new Date().toISOString(),
    })
    const bProj = await fx.repos.projects.create({
      id: 'proj_u1', tenantId: b.org.id, workspaceId: bWs.id, name: 'U Project', status: 'active', createdAt: new Date().toISOString(),
    })
    const bDraft = await fx.services.revisions.createDraft(b.ctx, bProj.id, 'estimate', 'v1', 'hash_u', null)
    // Tenant A queries B's revision → null (not found)
    const cross = await fx.repos.revisions.getById(bDraft.revisionId, a.org.id)
    expect(cross).toBeNull()
  })
})
