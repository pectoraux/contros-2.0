import { describe, it, expect } from 'vitest'
import { createTenantContext, createServiceTenantContext, requirePermission, hasPermission, actorIdOf } from '../../src/domain/tenant-context.js'
import type { Membership } from '../../src/domain/types.js'
import { UnauthorizedError } from '../../src/domain/errors.js'

function membership(role: Membership['role'], orgId = 'org_1', userId = 'usr_1'): Membership {
  return {
    id: 'mbr_1',
    userId,
    organizationId: orgId,
    role,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('TenantContext (trusted, pure)', () => {
  it('creates a context for a member with permissions', () => {
    const ctx = createTenantContext('org_1', 'usr_1', membership('member'))
    expect(ctx.tenantId).toBe('org_1')
    expect(ctx.actor).toEqual({ kind: 'user', userId: 'usr_1' })
    expect(ctx.membership).not.toBeNull()
    expect(hasPermission(ctx, 'project:read')).toBe(true)
    expect(hasPermission(ctx, 'project:write')).toBe(true)
    expect(hasPermission(ctx, 'revision:finalize')).toBe(false) // member cannot finalize
  })

  it('creates a context for an owner with all permissions', () => {
    const ctx = createTenantContext('org_1', 'usr_1', membership('owner'))
    expect(hasPermission(ctx, 'org:admin')).toBe(true)
    expect(hasPermission(ctx, 'revision:finalize')).toBe(true)
  })

  it('creates a context for a user with no membership (no permissions)', () => {
    const ctx = createTenantContext('org_1', 'usr_1', null)
    expect(ctx.membership).toBeNull()
    expect(ctx.permissions.size).toBe(0)
    expect(hasPermission(ctx, 'org:read')).toBe(false)
  })

  it('is deeply frozen (immutable value object)', () => {
    const ctx = createTenantContext('org_1', 'usr_1', membership('member'))
    expect(Object.isFrozen(ctx)).toBe(true)
    expect(Object.isFrozen(ctx.permissions)).toBe(true)
    expect(() => (ctx as unknown as { tenantId: string }).tenantId = 'hack').toThrow()
  })

  it('rejects missing tenantId (server-side bug, throws)', () => {
    expect(() => createTenantContext('', 'usr_1', null)).toThrow(/tenantId/)
    expect(() => createTenantContext(undefined as unknown as string, 'usr_1', null)).toThrow()
  })

  it('rejects missing userId', () => {
    expect(() => createTenantContext('org_1', '', null)).toThrow(/userId/)
  })

  it('rejects a membership whose organizationId does not match tenantId (invariant)', () => {
    // This is a server-side bug — the membership must belong to this tenant.
    const wrongMembership = membership('member', 'org_OTHER')
    expect(() => createTenantContext('org_1', 'usr_1', wrongMembership)).toThrow(/invariant/i)
  })

  it('requirePermission returns ctx when permission is held', () => {
    const ctx = createTenantContext('org_1', 'usr_1', membership('admin'))
    expect(requirePermission(ctx, 'project:write')).toBe(ctx)
  })

  it('requirePermission throws Unauthorized when permission is absent', () => {
    const ctx = createTenantContext('org_1', 'usr_1', membership('viewer'))
    expect(() => requirePermission(ctx, 'project:write')).toThrow(UnauthorizedError)
  })

  it('actorIdOf returns userId for user actors', () => {
    const ctx = createTenantContext('org_1', 'usr_1', membership('member'))
    expect(actorIdOf(ctx)).toBe('usr_1')
  })

  it('createServiceTenantContext produces a service actor context', () => {
    const ctx = createServiceTenantContext('org_1', 'svc_migration', 'migration-runner')
    expect(ctx.actor.kind).toBe('service')
    expect(actorIdOf(ctx)).toBe('svc_migration')
    expect(ctx.membership).toBeNull()
  })
})
