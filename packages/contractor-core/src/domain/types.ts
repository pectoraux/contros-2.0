/**
 * Contractor GenOffice — Domain Contracts
 *
 * Pure TypeScript type definitions + value objects for the platform
 * foundation. Zero external dependencies (only `node:crypto` for hashing).
 * Zero Electron dependency. Zero database dependency.
 *
 * These contracts are the foundation every future domain (Commercial,
 * Programme, Plans/BIM, Execution, Goals, AI) builds on. They must be
 * stable, explicit, and enforceable.
 *
 * See: architecture/ADR/0001-foundation.md, 0005-multitenancy.md,
 *      architecture/DOMAIN-AUTHORITY.md, architecture/BOUNDARIES.md.
 */

import type { DomainError } from './errors.js'

// ────────────────────────────────────────────────────────────
// Identity
// ────────────────────────────────────────────────────────────

/**
 * An Actor is any principal that can perform actions in the system.
 * Either a User (a person) or a Service (a system principal).
 * Every authority-changing action records its actor in the audit log.
 * (architecture/DOMAIN-AUTHORITY.md section 3.5 — audit identity is
 * separate from content integrity hash.)
 */
export type Actor = UserActor | ServiceActor

export interface UserActor {
  readonly kind: 'user'
  readonly userId: string
}

export interface ServiceActor {
  readonly kind: 'service'
  readonly serviceId: string
  /** A human-readable label for the service principal (e.g. "migration-runner"). */
  readonly label: string
}

/**
 * A User is the canonical identity record for a person.
 * A User authenticates via one or more AuthProviders, then is authorized
 * per Organization via Memberships.
 */
export interface User {
  readonly id: string
  readonly email: string | null
  readonly displayName: string | null
  readonly status: 'active' | 'disabled'
  readonly createdAt: string
}

/**
 * An AuthProvider binding links an external identity (Genspark account,
 * OIDC, SAML, email/password) to a User. A User may have multiple bindings.
 *
 * Genspark account auth is ONE AuthProvider — useful for desktop AI and
 * single-user mode — but it is NOT the Contractor tenant authority.
 * (ADR-0005 Q4 Decision.)
 */
export interface AuthProviderBinding {
  readonly id: string
  readonly userId: string
  /** Provider kind: 'genspark' | 'oidc' | 'saml' | 'password' | ... */
  readonly provider: string
  /** Subject identifier at the provider (e.g. OIDC sub, Genspark user id). */
  readonly subject: string
  readonly createdAt: string
  /** Last successful authentication (audit/reprovenance; not part of content hash). */
  readonly lastUsedAt: string | null
}

// ────────────────────────────────────────────────────────────
// Organization / Tenant
// ────────────────────────────────────────────────────────────

/**
 * An Organization is the top-level isolation boundary (the Tenant).
 * Every tenant-scoped record carries the organization's id as `tenantId`.
 * Cross-tenant data access is forbidden unless explicitly authorized + audited.
 * (ADR-0005 Decision 1.)
 */
export interface Organization {
  readonly id: string
  /** This organization's own id IS the tenantId for all its data. */
  readonly tenantId: string
  readonly name: string
  readonly slug: string
  readonly status: 'active' | 'disabled'
  readonly createdAt: string
}

/**
 * A Membership links a User to an Organization with a Role.
 * Membership is EXPLICIT — an authenticated user does not automatically
 * have access to every tenant. (Phase 1 section 5/11.)
 */
export interface Membership {
  readonly id: string
  readonly userId: string
  readonly organizationId: string
  readonly role: Role
  readonly status: 'active' | 'revoked'
  readonly createdAt: string
}

/**
 * Roles are explicit and extensible. The initial model is minimal;
 * a full ACL engine is NOT built in this phase. (Phase 1 section 11.)
 */
export type Role = 'owner' | 'admin' | 'member' | 'viewer'

/**
 * Permission checks are derived from Role + the action. The initial
 * mapping is simple and extensible.
 */
export type Permission =
  | 'org:read'
  | 'org:admin'
  | 'workspace:read'
  | 'workspace:write'
  | 'project:read'
  | 'project:write'
  | 'audit:read'
  | 'revision:finalize'
  | 'revision:read'

// ────────────────────────────────────────────────────────────
// Workspace
// ────────────────────────────────────────────────────────────

/**
 * A Workspace is an organizational container inside a Tenant. It owns
 * Projects. Distinct from LocalWorkspace (the GenOffice project-store
 * local representation). (ADR-0005 Decision 9; DOMAIN-AUTHORITY.md §4.)
 */
export interface Workspace {
  readonly id: string
  readonly tenantId: string
  readonly organizationId: string
  readonly name: string
  readonly createdAt: string
}

// ────────────────────────────────────────────────────────────
// Project (canonical)
// ────────────────────────────────────────────────────────────

/**
 * A Project is the ONE canonical business/project identity.
 * Belongs to: Tenant -> Workspace -> Project.
 *
 * Referenced by future domain authorities: Opportunity, Plans, BOQ,
 * EstimateRevision, Bid, ProgrammeRevision, ProjectActual, Goal.
 *
 * NOT to be confused with LocalWorkspace (the GenOffice project-store
 * local Office/document representation). A LocalWorkspace may LINK to a
 * canonical Project by reference (projectId), but the link is a
 * reference, not authority. (ADR-0005 Decision 9.)
 *
 * There are NO separate OfficeProject / ProgrammeProject / BIMProject /
 * CommercialProject authorities. (Phase 1 section 8.)
 */
export interface Project {
  readonly id: string
  readonly tenantId: string
  readonly workspaceId: string
  readonly name: string
  readonly status: 'active' | 'archived'
  readonly createdAt: string
}

// ────────────────────────────────────────────────────────────
// TenantContext (trusted)
// ────────────────────────────────────────────────────────────

/**
 * TenantContext is the trusted context object application services use to
 * enforce authorization and scope. It originates from the authenticated
 * session — NEVER from request body, URL, frontend selector, hidden form
 * field, or client project choice. (Phase 1 section 6; ADR-0005 Decision 2.)
 *
 * Repositories receive the tenantId from this context (or an equivalent
 * server-side tenant identifier). The client is never trusted to select
 * the tenant.
 *
 * This is a frozen value object created by a validated factory
 * (createTenantContext), not a mutable class.
 */
export interface TenantContext {
  readonly tenantId: string
  readonly actor: Actor
  readonly membership: Membership | null
  /** Resolved permissions for this actor in this tenant. */
  readonly permissions: ReadonlySet<Permission>
}

// ────────────────────────────────────────────────────────────
// AuditEvent (append-only)
// ────────────────────────────────────────────────────────────

/**
 * An AuditEvent is an append-only record of an authority-changing action.
 * Tenant-scoped. Content integrity hash is SEPARATE from audit actor.
 * (ADR-0005 Decision 6; DOMAIN-AUTHORITY.md §3.5; master prompt §15.)
 *
 * UPDATE and DELETE are forbidden on audit history.
 */
export interface AuditEvent {
  readonly eventId: string
  readonly tenantId: string
  readonly actorId: string
  readonly actorKind: 'user' | 'service'
  readonly timestamp: string
  readonly action: string
  readonly entityType: string
  readonly entityId: string
  /** Operation/context (e.g. "create", "finalize", "supersede"). */
  readonly operation: string
  /** Structured metadata (JSON-serialized in persistence). */
  readonly metadata: Readonly<Record<string, unknown>> | null
}

// ────────────────────────────────────────────────────────────
// Revision framework (generic infrastructure)
// ────────────────────────────────────────────────────────────

/**
 * RevisionStatus — the lifecycle of an authority-critical revision.
 *
 *   draft     -> editable working state
 *   finalized -> IMMUTABLE. UPDATE forbidden, DELETE forbidden.
 *                Corrections occur through a new revision that supersedes.
 *   superseded-> replaced by a newer finalized revision (still immutable,
 *                still present for historical reconstruction).
 *
 * (architecture/DOMAIN-AUTHORITY.md §6; ADR-0005; master prompt §13/§14.)
 */
export type RevisionStatus = 'draft' | 'finalized' | 'superseded'

/**
 * RevisionMetadata — reusable revision infrastructure. Supports future
 * authorities (EstimateRevision, ProgrammeRevision, ...) WITHOUT
 * implementing either domain yet.
 *
 * The domain-specific payload (estimate lines, programme activities) is
 * NOT defined here — this is the generic infrastructure for immutable
 * historical truth. (Phase 1 section 13.)
 */
export interface RevisionMetadata {
  readonly revisionId: string
  readonly tenantId: string
  /** The project this revision belongs to. */
  readonly projectId: string
  /**
   * The authority kind (e.g. "estimate", "programme"). Used to namespace
   * revisions by domain without coupling this infrastructure to any domain.
   */
  readonly authorityKind: string
  /** Revision number within (tenant, project, authorityKind). 1-based. */
  readonly revisionNumber: number
  readonly status: RevisionStatus
  readonly createdBy: string
  readonly createdAt: string
  /**
   * Algorithm version — the deterministic algorithm + contract version that
   * produced derived fields. Same inputs + same algorithm version = same
   * historical result. (master prompt §13.)
   */
  readonly algorithmVersion: string
  /**
   * Content hash — canonicalized content hash (SHA-256). Identifies content;
   * does NOT establish authorship. Separate from actor/timestamp/audit.
   * (master prompt §15; DOMAIN-AUTHORITY.md §7.)
   */
  readonly contentHash: string
  /** Parent revision this one supersedes (null for the first revision). */
  readonly parentRevisionId: string | null
  /** When the revision was finalized (null while draft). */
  readonly finalizedAt: string | null
}

/**
 * Allowed transitions for revision status. Pure function in revision.ts.
 */
export interface RevisionTransition {
  readonly from: RevisionStatus
  readonly to: RevisionStatus
}

// ────────────────────────────────────────────────────────────
// Object storage (abstraction interface — see src/storage)
// ────────────────────────────────────────────────────────────

/**
 * An immutable artifact stored in object storage (Plan source artifacts,
 * generated Office representations, AI logs). Identified by content hash —
 * same content = same artifact. (Phase 1 section 17.)
 */
export interface StoredArtifact {
  readonly artifactId: string
  readonly contentHash: string
  readonly sizeBytes: number
  readonly contentType: string
  readonly storedAt: string
}

// ────────────────────────────────────────────────────────────
// Result / error helpers
// ────────────────────────────────────────────────────────────

/**
 * A Result type for service-layer operations that can fail with a known
 * domain error rather than throwing. Services return Result for expected
 * failures (not-found, unauthorized, conflict) and throw only for
 * unexpected internal errors.
 */
export type Result<T, E = DomainError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value }
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error }
}
