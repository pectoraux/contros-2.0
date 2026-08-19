/**
 * C2 regression — cascading deletion of historical revisions.
 *
 * The audit found that `revisions.project_id` used ON DELETE CASCADE,
 * so deleting a project/workspace/organization would silently destroy
 * historical revisions. The FK now uses ON DELETE RESTRICT — a project
 * with revisions cannot be hard-deleted. This test proves:
 *   1. Deleting a project that HAS revisions fails (RESTRICT).
 *   2. The revisions survive the failed deletion attempt.
 *   3. Deleting a project that has NO revisions still succeeds (no over-restriction).
 *
 * Run against REAL PostgreSQL (pglite). NOT mocked. (Phase 1.1 C2 fix.)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { TestFixture } from '../integration/setup.js'
import { createTestFixture } from '../integration/setup.js'

let fx: TestFixture
beforeAll(async () => { fx = await createTestFixture() })
afterAll(async () => { await fx.cleanup() })

describe('C2 regression: historical revisions survive parent deletion', () => {
  it('deleting a project that has revisions is REJECTED (RESTRICT)', async () => {
    const { ctx, org } = await fx.bootstrapTenant('C2Rest_' + Math.random().toString(36).slice(2, 6), 'c2r-' + Math.random().toString(36).slice(2, 6), 'c2r@test')
    const ws = await fx.repos.workspaces.create({
      id: 'ws_c2r_' + Math.random().toString(36).slice(2, 6), tenantId: org.id, organizationId: org.id, name: 'C2 WS', createdAt: new Date().toISOString(),
    })
    const proj = await fx.repos.projects.create({
      id: 'proj_c2r_' + Math.random().toString(36).slice(2, 6), tenantId: org.id, workspaceId: ws.id, name: 'C2 Proj', status: 'active', createdAt: new Date().toISOString(),
    })
    // Create a revision in the project
    const draft = await fx.services.revisions.createDraft(ctx, proj.id, 'estimate', 'v1', 'hash_c2', null)
    await fx.services.revisions.finalize(ctx, draft.revisionId)

    // Attempt to delete the project — must FAIL because revisions reference it
    await expect(
      fx.db.execute('DELETE FROM projects WHERE id = $1', [proj.id]),
    ).rejects.toThrow(/restrict|violates|foreign key/i)

    // The revision MUST still exist
    const surviving = await fx.repos.revisions.getById(draft.revisionId, org.id)
    expect(surviving).not.toBeNull()
    expect(surviving!.contentHash).toBe('hash_c2')
    expect(surviving!.status).toBe('finalized')
  })

  it('deleting a project that has NO revisions succeeds (no over-restriction)', async () => {
    const { org } = await fx.bootstrapTenant('C2Empty_' + Math.random().toString(36).slice(2, 6), 'c2e-' + Math.random().toString(36).slice(2, 6), 'c2e@test')
    const ws = await fx.repos.workspaces.create({
      id: 'ws_c2e_' + Math.random().toString(36).slice(2, 6), tenantId: org.id, organizationId: org.id, name: 'C2E WS', createdAt: new Date().toISOString(),
    })
    const proj = await fx.repos.projects.create({
      id: 'proj_c2e_' + Math.random().toString(36).slice(2, 6), tenantId: org.id, workspaceId: ws.id, name: 'C2E Proj', status: 'active', createdAt: new Date().toISOString(),
    })
    // No revisions — deletion succeeds
    const result = await fx.db.execute('DELETE FROM projects WHERE id = $1', [proj.id])
    expect(result.affectedRows).toBe(1)
  })

  it('deleting a workspace cascades to projects (CASCADE retained for non-historical entities)', async () => {
    // Workspace -> Project CASCADE is retained (projects are not historical authority).
    // Only revisions (historical authority) are protected by RESTRICT.
    const { org } = await fx.bootstrapTenant('C2Ws_' + Math.random().toString(36).slice(2, 6), 'c2w-' + Math.random().toString(36).slice(2, 6), 'c2w@test')
    const ws = await fx.repos.workspaces.create({
      id: 'ws_c2w_' + Math.random().toString(36).slice(2, 6), tenantId: org.id, organizationId: org.id, name: 'C2W WS', createdAt: new Date().toISOString(),
    })
    const proj = await fx.repos.projects.create({
      id: 'proj_c2w_' + Math.random().toString(36).slice(2, 6), tenantId: org.id, workspaceId: ws.id, name: 'C2W Proj', status: 'active', createdAt: new Date().toISOString(),
    })
    // Delete workspace — project cascades (no revisions to protect it)
    await fx.db.execute('DELETE FROM workspaces WHERE id = $1', [ws.id])
    const projGone = await fx.repos.projects.getById(proj.id, org.id)
    expect(projGone).toBeNull()
  })

  it('deleting an organization fails if revisions exist (via project RESTRICT chain)', async () => {
    const { ctx, org } = await fx.bootstrapTenant('C2Org_' + Math.random().toString(36).slice(2, 6), 'c2o-' + Math.random().toString(36).slice(2, 6), 'c2o@test')
    const ws = await fx.repos.workspaces.create({
      id: 'ws_c2o_' + Math.random().toString(36).slice(2, 6), tenantId: org.id, organizationId: org.id, name: 'C2O WS', createdAt: new Date().toISOString(),
    })
    const proj = await fx.repos.projects.create({
      id: 'proj_c2o_' + Math.random().toString(36).slice(2, 6), tenantId: org.id, workspaceId: ws.id, name: 'C2O Proj', status: 'active', createdAt: new Date().toISOString(),
    })
    const draft = await fx.services.revisions.createDraft(ctx, proj.id, 'estimate', 'v1', 'hash_c2o', null)
    await fx.services.revisions.finalize(ctx, draft.revisionId)
    // Attempt to delete the org — must fail because workspace->project->revision chain
    // (workspace->project is CASCADE, but project->revision is RESTRICT, so the delete
    // fails when it tries to cascade-delete the project that has revisions)
    await expect(
      fx.db.execute('DELETE FROM organizations WHERE id = $1', [org.id]),
    ).rejects.toThrow(/restrict|violates|foreign key/i)
    // The revision MUST still exist
    const surviving = await fx.repos.revisions.getById(draft.revisionId, org.id)
    expect(surviving).not.toBeNull()
  })
})
