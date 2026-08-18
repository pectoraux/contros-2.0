import { describe, it, expect } from 'vitest'
import { permissionsForRole, roleHasPermission, isValidRole, canManageMemberships } from '../../src/domain/membership.js'

describe('membership authorization rules (pure)', () => {
  it('owner has all permissions including org:admin', () => {
    const p = permissionsForRole('owner')
    expect(p.has('org:admin')).toBe(true)
    expect(p.has('revision:finalize')).toBe(true)
    expect(p.size).toBe(9)
  })

  it('admin can manage workspaces/projects but not org:admin', () => {
    const p = permissionsForRole('admin')
    expect(p.has('workspace:write')).toBe(true)
    expect(p.has('project:write')).toBe(true)
    expect(p.has('revision:finalize')).toBe(true)
    expect(p.has('org:admin')).toBe(false)
  })

  it('member can read and write projects but cannot finalize revisions', () => {
    const p = permissionsForRole('member')
    expect(p.has('project:read')).toBe(true)
    expect(p.has('project:write')).toBe(true)
    expect(p.has('revision:finalize')).toBe(false)
    expect(p.has('org:admin')).toBe(false)
    expect(p.has('workspace:write')).toBe(false)
  })

  it('viewer is read-only', () => {
    const p = permissionsForRole('viewer')
    expect(p.has('project:read')).toBe(true)
    expect(p.has('audit:read')).toBe(true)
    expect(p.has('project:write')).toBe(false)
    expect(p.has('workspace:write')).toBe(false)
    expect(p.has('revision:finalize')).toBe(false)
  })

  it('roleHasPermission checks correctly', () => {
    expect(roleHasPermission('owner', 'org:admin')).toBe(true)
    expect(roleHasPermission('viewer', 'org:admin')).toBe(false)
  })

  it('isValidRole rejects invalid roles', () => {
    expect(isValidRole('owner')).toBe(true)
    expect(isValidRole('superuser')).toBe(false)
    expect(isValidRole(null)).toBe(false)
    expect(isValidRole(123)).toBe(false)
  })

  it('canManageMemberships: only owner and admin', () => {
    expect(canManageMemberships('owner')).toBe(true)
    expect(canManageMemberships('admin')).toBe(true)
    expect(canManageMemberships('member')).toBe(false)
    expect(canManageMemberships('viewer')).toBe(false)
  })

  it('permissionsForRole returns independent copies (table protected from mutation)', () => {
    const a = permissionsForRole('member') as Set<string>
    const b = permissionsForRole('member') as Set<string>
    a.add('org:admin') // mutate a
    expect(b.has('org:admin')).toBe(false) // b unaffected
    expect(permissionsForRole('member').has('org:admin')).toBe(false) // fresh call unaffected
  })
})
