/**
 * H1 regression — revision-number concurrency.
 *
 * The audit found that revision numbers were allocated via
 * `SELECT MAX(revision_number)+1` under default READ COMMITTED isolation,
 * which could cause concurrent callers to calculate the same next number
 * and one to fail with a unique-violation. The fix uses a dedicated
 * `revision_counters` table with atomic UPSERT+RETURNING. This test
 * proves concurrent draft creation produces unique sequential numbers with
 * no failures.
 *
 * Run against REAL PostgreSQL (pglite). NOT mocked. (Phase 1.1 H1 fix.)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { TestFixture } from '../integration/setup.js'
import { createTestFixture } from '../integration/setup.js'

let fx: TestFixture
beforeAll(async () => { fx = await createTestFixture() })
afterAll(async () => { await fx.cleanup() })

describe('H1 regression: concurrent revision-number allocation', () => {
  it('concurrent createDraft calls produce unique sequential numbers (no collisions, no failures)', async () => {
    const { ctx, org } = await fx.bootstrapTenant('H1_' + Math.random().toString(36).slice(2, 6), 'h1-' + Math.random().toString(36).slice(2, 6), 'h1@test')
    const ws = await fx.repos.workspaces.create({
      id: 'ws_h1_' + Math.random().toString(36).slice(2, 6), tenantId: org.id, organizationId: org.id, name: 'H1 WS', createdAt: new Date().toISOString(),
    })
    const proj = await fx.repos.projects.create({
      id: 'proj_h1_' + Math.random().toString(36).slice(2, 6), tenantId: org.id, workspaceId: ws.id, name: 'H1 Proj', status: 'active', createdAt: new Date().toISOString(),
    })

    // Launch N concurrent createDraft calls for the same (tenant, project, authorityKind)
    const N = 20
    const promises = Array.from({ length: N }, () =>
      fx.services.revisions.createDraft(ctx, proj.id, 'estimate', 'v1', 'hash_' + Math.random(), null),
    )
    const results = await Promise.allSettled(promises)

    // ALL must succeed (no unique-violation failures)
    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(fulfilled.length).toBe(N)
    expect(rejected.length).toBe(0)

    // All revision numbers must be unique
    const numbers = fulfilled.map((r) => (r as PromiseFulfilledResult<{ revisionNumber: number }>).value.revisionNumber)
    expect(new Set(numbers).size).toBe(N)

    // The numbers must be a contiguous sequence 1..N (no gaps, no duplicates)
    const sorted = [...numbers].sort((a, b) => a - b)
    expect(sorted).toEqual(Array.from({ length: N }, (_, i) => i + 1))
  })

  it('concurrent createDraft across different authorityKinds does not collide', async () => {
    const { ctx, org } = await fx.bootstrapTenant('H1b_' + Math.random().toString(36).slice(2, 6), 'h1b-' + Math.random().toString(36).slice(2, 6), 'h1b@test')
    const ws = await fx.repos.workspaces.create({
      id: 'ws_h1b_' + Math.random().toString(36).slice(2, 6), tenantId: org.id, organizationId: org.id, name: 'H1B WS', createdAt: new Date().toISOString(),
    })
    const proj = await fx.repos.projects.create({
      id: 'proj_h1b_' + Math.random().toString(36).slice(2, 6), tenantId: org.id, workspaceId: ws.id, name: 'H1B Proj', status: 'active', createdAt: new Date().toISOString(),
    })

    // 10 estimates + 10 programmes concurrently — each sequence independent
    const promises = [
      ...Array.from({ length: 10 }, () => fx.services.revisions.createDraft(ctx, proj.id, 'estimate', 'v1', 'h_' + Math.random(), null)),
      ...Array.from({ length: 10 }, () => fx.services.revisions.createDraft(ctx, proj.id, 'programme', 'v1', 'h_' + Math.random(), null)),
    ]
    const results = await Promise.allSettled(promises)
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true)

    const revisions = await fx.services.revisions.listForProject(ctx, proj.id, 'estimate')
    const programmeRevisions = await fx.services.revisions.listForProject(ctx, proj.id, 'programme')
    const estimateNumbers = revisions.map((r) => r.revisionNumber).sort((a, b) => a - b)
    const programmeNumbers = programmeRevisions.map((r) => r.revisionNumber).sort((a, b) => a - b)

    // Each authorityKind has its own 1..10 sequence
    expect(estimateNumbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(programmeNumbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('the revision_counters table is created and used (not MAX+1)', async () => {
    // Verify the counter table exists
    const tables = await fx.db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_name = 'revision_counters'`,
    )
    expect(tables.length).toBe(1)

    // Create a revision and verify the counter row was created
    const { ctx, org } = await fx.bootstrapTenant('H1c_' + Math.random().toString(36).slice(2, 6), 'h1c-' + Math.random().toString(36).slice(2, 6), 'h1c@test')
    const ws = await fx.repos.workspaces.create({
      id: 'ws_h1c', tenantId: org.id, organizationId: org.id, name: 'H1C WS', createdAt: new Date().toISOString(),
    })
    const proj = await fx.repos.projects.create({
      id: 'proj_h1c', tenantId: org.id, workspaceId: ws.id, name: 'H1C Proj', status: 'active', createdAt: new Date().toISOString(),
    })
    await fx.services.revisions.createDraft(ctx, proj.id, 'estimate', 'v1', 'h', null)
    const counters = await fx.db.query<{ next_number: number }>(
      `SELECT next_number FROM revision_counters WHERE tenant_id = $1 AND project_id = $2 AND authority_kind = 'estimate'`,
      [org.id, proj.id],
    )
    expect(counters.length).toBe(1)
    expect(counters[0]!.next_number).toBe(2) // next_number advanced to 2 after allocating 1
  })
})
