/**
 * C1 regression — finalized revision immutability bypass.
 *
 * The audit found that a single UPDATE could rewrite a finalized revision's
 * content_hash (and every other field) by including `status='superseded'`
 * in the UPDATE. The trigger now verifies that ONLY `status` may change
 * during the finalized->superseded transition. This test exercises every
 * immutable field to prove the fix.
 *
 * Run against REAL PostgreSQL (pglite). NOT mocked. (Phase 1.1 C1 fix.)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { TestFixture } from '../integration/setup.js'
import { createTestFixture } from '../integration/setup.js'

let fx: TestFixture
beforeAll(async () => { fx = await createTestFixture() })
afterAll(async () => { await fx.cleanup() })

let c1Counter = 0
async function makeFinalizedRevision(): Promise<{ revisionId: string; projectId: string }> {
  c1Counter++
  const uniq = `${Date.now()}_${c1Counter}_${Math.random().toString(36).slice(2, 8)}`
  const { ctx } = await fx.bootstrapTenant(`C1F${uniq}`, `c1f-${uniq}`, `c1-${uniq}@audit.test`)
  const ws = await fx.repos.workspaces.create({
    id: `ws_c1_${uniq}`,
    tenantId: ctx.tenantId, organizationId: ctx.tenantId, name: 'C1 WS', createdAt: new Date().toISOString(),
  })
  const proj = await fx.repos.projects.create({
    id: `proj_c1_${uniq}`,
    tenantId: ctx.tenantId, workspaceId: ws.id, name: 'C1 Proj', status: 'active', createdAt: new Date().toISOString(),
  })
  const draft = await fx.services.revisions.createDraft(ctx, proj.id, 'estimate', 'v1', 'ORIGINAL_HASH', null)
  await fx.services.revisions.finalize(ctx, draft.revisionId)
  return { revisionId: draft.revisionId, projectId: proj.id }
}

describe('C1 regression: finalized revision immutability (all immutable fields)', () => {
  it('rejects content_hash mutation + supersede', async () => {
    const { revisionId } = await makeFinalizedRevision()
    await expect(
      fx.db.execute(`UPDATE revisions SET content_hash = $1, status = 'superseded' WHERE revision_id = $2`, ['HACKED', revisionId]),
    ).rejects.toThrow(/immutable|forbidden/i)
  })

  it('rejects tenant_id mutation + supersede', async () => {
    const { revisionId } = await makeFinalizedRevision()
    await expect(
      fx.db.execute(`UPDATE revisions SET tenant_id = $1, status = 'superseded' WHERE revision_id = $2`, ['org_evil', revisionId]),
    ).rejects.toThrow(/immutable|forbidden/i)
  })

  it('rejects project_id mutation + supersede', async () => {
    const { revisionId } = await makeFinalizedRevision()
    await expect(
      fx.db.execute(`UPDATE revisions SET project_id = $1, status = 'superseded' WHERE revision_id = $2`, ['proj_evil', revisionId]),
    ).rejects.toThrow(/immutable|forbidden/i)
  })

  it('rejects authority_kind mutation + supersede', async () => {
    const { revisionId } = await makeFinalizedRevision()
    await expect(
      fx.db.execute(`UPDATE revisions SET authority_kind = $1, status = 'superseded' WHERE revision_id = $2`, ['programme', revisionId]),
    ).rejects.toThrow(/immutable|forbidden/i)
  })

  it('rejects revision_number mutation + supersede', async () => {
    const { revisionId } = await makeFinalizedRevision()
    await expect(
      fx.db.execute(`UPDATE revisions SET revision_number = $1, status = 'superseded' WHERE revision_id = $2`, [9999, revisionId]),
    ).rejects.toThrow(/immutable|forbidden/i)
  })

  it('rejects algorithm_version mutation + supersede', async () => {
    const { revisionId } = await makeFinalizedRevision()
    await expect(
      fx.db.execute(`UPDATE revisions SET algorithm_version = $1, status = 'superseded' WHERE revision_id = $2`, ['v_evil', revisionId]),
    ).rejects.toThrow(/immutable|forbidden/i)
  })

  it('rejects parent_revision_id mutation + supersede', async () => {
    const { revisionId } = await makeFinalizedRevision()
    await expect(
      fx.db.execute(`UPDATE revisions SET parent_revision_id = $1, status = 'superseded' WHERE revision_id = $2`, ['rev_ghost', revisionId]),
    ).rejects.toThrow(/immutable|forbidden/i)
  })

  it('rejects created_by mutation + supersede', async () => {
    const { revisionId } = await makeFinalizedRevision()
    await expect(
      fx.db.execute(`UPDATE revisions SET created_by = $1, status = 'superseded' WHERE revision_id = $2`, ['usr_evil', revisionId]),
    ).rejects.toThrow(/immutable|forbidden/i)
  })

  it('rejects created_at mutation + supersede', async () => {
    const { revisionId } = await makeFinalizedRevision()
    await expect(
      fx.db.execute(`UPDATE revisions SET created_at = $1, status = 'superseded' WHERE revision_id = $2`, [new Date('1999-01-01').toISOString(), revisionId]),
    ).rejects.toThrow(/immutable|forbidden/i)
  })

  it('rejects finalized_at mutation + supersede', async () => {
    const { revisionId } = await makeFinalizedRevision()
    await expect(
      fx.db.execute(`UPDATE revisions SET finalized_at = $1, status = 'superseded' WHERE revision_id = $2`, [new Date('1999-01-01').toISOString(), revisionId]),
    ).rejects.toThrow(/immutable|forbidden/i)
  })

  it('rejects revision_id (primary key) mutation + supersede', async () => {
    const { revisionId } = await makeFinalizedRevision()
    await expect(
      fx.db.execute(`UPDATE revisions SET revision_id = $1, status = 'superseded' WHERE revision_id = $2`, ['rev_evil', revisionId]),
    ).rejects.toThrow(/immutable|forbidden/i)
  })

  it('ALLOWS a pure status-only supersede transition (finalized -> superseded)', async () => {
    const { revisionId } = await makeFinalizedRevision()
    // Only status changes — this MUST succeed
    await fx.db.execute(`UPDATE revisions SET status = 'superseded' WHERE revision_id = $1`, [revisionId])
    const rows = await fx.db.query<{ status: string; content_hash: string }>('SELECT status, content_hash FROM revisions WHERE revision_id = $1', [revisionId])
    expect(rows[0]!.status).toBe('superseded')
    expect(rows[0]!.content_hash).toBe('ORIGINAL_HASH') // unchanged
  })

  it('rejects plain content_hash mutation WITHOUT supersede (existing behavior preserved)', async () => {
    const { revisionId } = await makeFinalizedRevision()
    await expect(
      fx.db.execute(`UPDATE revisions SET content_hash = $1 WHERE revision_id = $2`, ['HACKED', revisionId]),
    ).rejects.toThrow(/immutable|forbidden/i)
  })

  it('rejects plain status mutation finalized -> draft (un-finalize forbidden)', async () => {
    const { revisionId } = await makeFinalizedRevision()
    await expect(
      fx.db.execute(`UPDATE revisions SET status = 'draft' WHERE revision_id = $1`, [revisionId]),
    ).rejects.toThrow(/immutable|forbidden|finalized/i)
  })

  it('rejects ANY update on a superseded revision (terminal state)', async () => {
    const { revisionId } = await makeFinalizedRevision()
    // First, legitimately supersede it
    await fx.db.execute(`UPDATE revisions SET status = 'superseded' WHERE revision_id = $1`, [revisionId])
    // Now any update on the superseded revision should fail
    await expect(
      fx.db.execute(`UPDATE revisions SET content_hash = $1 WHERE revision_id = $2`, ['HACKED', revisionId]),
    ).rejects.toThrow(/superseded|terminal|forbidden/i)
  })
})
