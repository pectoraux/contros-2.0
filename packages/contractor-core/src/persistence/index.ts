/**
 * Contractor GenOffice — Persistence barrel export.
 */

export type { DbClient, DbRow } from './db-client.js'
export { applyMigration } from './db-client.js'
export { PgLiteClient } from './pglite-client.js'
export { PostgresClient } from './postgres-client.js'
export { OrganizationRepository } from './repositories/organization.repository.js'
export { UserRepository } from './repositories/user.repository.js'
export { MembershipRepository } from './repositories/membership.repository.js'
export { WorkspaceRepository } from './repositories/workspace.repository.js'
export { ProjectRepository } from './repositories/project.repository.js'
export { AuditRepository } from './repositories/audit.repository.js'
export { RevisionRepository } from './repositories/revision.repository.js'

// The migration SQL is importable for test bootstrap.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const __dirname = dirname(fileURLToPath(import.meta.url))
export const FOUNDATION_MIGRATION_SQL = readFileSync(
  join(__dirname, 'migrations/0001_foundation.sql'),
  'utf8',
)
