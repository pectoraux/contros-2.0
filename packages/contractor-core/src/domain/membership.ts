/**
 * Membership authorization rules — PURE.
 *
 * Maps Role -> Permission set. The initial model is explicit and
 * extensible; a full ACL engine is NOT built in this phase.
 * (Phase 1 section 11.)
 */

import type { Permission, Role } from './types.js'

/**
 * The permission set granted by each role. This is the complete,
 * explicit authorization table. To add a role or permission, extend
 * this table and the Permission type — there is no hidden dynamic ACL.
 */
const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set<Permission>([
    'org:read',
    'org:admin',
    'workspace:read',
    'workspace:write',
    'project:read',
    'project:write',
    'audit:read',
    'revision:finalize',
    'revision:read',
  ]),
  admin: new Set<Permission>([
    'org:read',
    'workspace:read',
    'workspace:write',
    'project:read',
    'project:write',
    'audit:read',
    'revision:finalize',
    'revision:read',
  ]),
  member: new Set<Permission>([
    'org:read',
    'workspace:read',
    'project:read',
    'project:write',
    'audit:read',
    'revision:read',
  ]),
  viewer: new Set<Permission>([
    'org:read',
    'workspace:read',
    'project:read',
    'audit:read',
    'revision:read',
  ]),
}

/**
 * Resolve the permission set for a role. Returns a FRESH copy each call
 * so the caller cannot mutate the shared role-permission table.
 * (The table itself is a frozen constant; copies protect it.)
 */
export function permissionsForRole(role: Role): ReadonlySet<Permission> {
  return new Set<Permission>(ROLE_PERMISSIONS[role])
}

/**
 * Does a role grant a permission?
 */
export function roleHasPermission(role: Role, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(perm)
}

/**
 * Is the role a valid role? (guard against invalid role values)
 */
export function isValidRole(role: unknown): role is Role {
  return (
    typeof role === 'string' &&
    (role === 'owner' || role === 'admin' || role === 'member' || role === 'viewer')
  )
}

/**
 * Roles that can manage other members. Used by the identity service.
 */
export function canManageMemberships(role: Role): boolean {
  return role === 'owner' || role === 'admin'
}
