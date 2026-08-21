var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// packages/contractor-core/src/domain/errors.ts
function httpStatusForError(kind) {
  switch (kind) {
    case "unauthenticated":
      return 401;
    case "unauthorized":
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "validation":
      return 400;
    case "conflict":
      return 409;
    case "immutable_revision_mutation":
    case "immutable_audit_mutation":
      return 409;
    case "internal":
      return 500;
  }
}
function asDomainError(e) {
  if (e instanceof DomainError) return e;
  return null;
}
var DomainError, UnauthenticatedError, UnauthorizedError, NotFoundError, ValidationError, ConflictError, ImmutableRevisionMutationError;
var init_errors = __esm({
  "packages/contractor-core/src/domain/errors.ts"() {
    "use strict";
    DomainError = class extends Error {
      kind;
      details;
      constructor(kind, message, details) {
        super(message);
        this.name = "DomainError";
        this.kind = kind;
        if (details) this.details = details;
      }
    };
    UnauthenticatedError = class extends DomainError {
      constructor(message = "Authentication required") {
        super("unauthenticated", message);
      }
    };
    UnauthorizedError = class extends DomainError {
      constructor(message = "Not authorized") {
        super("unauthorized", message);
      }
    };
    NotFoundError = class extends DomainError {
      constructor(entityType, id) {
        super("not_found", `${entityType} not found: ${id}`, { entityType, id });
      }
    };
    ValidationError = class extends DomainError {
      constructor(message, details) {
        super("validation", message, details);
      }
    };
    ConflictError = class extends DomainError {
      constructor(message, details) {
        super("conflict", message, details);
      }
    };
    ImmutableRevisionMutationError = class extends DomainError {
      constructor(revisionId, operation) {
        super(
          "immutable_revision_mutation",
          `Cannot ${operation} finalized/superseded revision: ${revisionId}`,
          { revisionId, operation }
        );
      }
    };
  }
});

// packages/contractor-core/src/domain/membership.ts
function permissionsForRole(role) {
  return new Set(ROLE_PERMISSIONS[role]);
}
var ROLE_PERMISSIONS;
var init_membership = __esm({
  "packages/contractor-core/src/domain/membership.ts"() {
    "use strict";
    ROLE_PERMISSIONS = {
      owner: /* @__PURE__ */ new Set([
        "org:read",
        "org:admin",
        "workspace:read",
        "workspace:write",
        "project:read",
        "project:write",
        "audit:read",
        "revision:finalize",
        "revision:read",
        "plan:read",
        "plan:write",
        "boq:read",
        "boq:write",
        "estimate:read",
        "estimate:write",
        "estimate:finalize",
        "bid:read",
        "bid:write",
        "bid:submit"
      ]),
      admin: /* @__PURE__ */ new Set([
        "org:read",
        "workspace:read",
        "workspace:write",
        "project:read",
        "project:write",
        "audit:read",
        "revision:finalize",
        "revision:read",
        "plan:read",
        "plan:write",
        "boq:read",
        "boq:write",
        "estimate:read",
        "estimate:write",
        "estimate:finalize",
        "bid:read",
        "bid:write",
        "bid:submit"
      ]),
      member: /* @__PURE__ */ new Set([
        "org:read",
        "workspace:read",
        "project:read",
        "project:write",
        "audit:read",
        "revision:read",
        "plan:read",
        "plan:write",
        "boq:read",
        "boq:write",
        "estimate:read",
        "estimate:write",
        "bid:read",
        "bid:write"
      ]),
      viewer: /* @__PURE__ */ new Set([
        "org:read",
        "workspace:read",
        "project:read",
        "audit:read",
        "revision:read",
        "plan:read",
        "boq:read",
        "estimate:read",
        "bid:read"
      ])
    };
  }
});

// packages/contractor-core/src/domain/tenant-context.ts
var tenant_context_exports = {};
__export(tenant_context_exports, {
  actorIdOf: () => actorIdOf,
  createServiceTenantContext: () => createServiceTenantContext,
  createTenantContext: () => createTenantContext,
  hasPermission: () => hasPermission,
  requirePermission: () => requirePermission
});
function createTenantContext(tenantId, userId, membership) {
  if (!tenantId || typeof tenantId !== "string") {
    throw new Error("TenantContext: tenantId is required");
  }
  if (!userId || typeof userId !== "string") {
    throw new Error("TenantContext: userId is required");
  }
  if (membership && membership.organizationId !== tenantId) {
    throw new Error(
      `TenantContext invariant violation: membership.organizationId (${membership.organizationId}) !== tenantId (${tenantId})`
    );
  }
  const actor = { kind: "user", userId };
  const permissions = membership ? permissionsForRole(membership.role) : /* @__PURE__ */ new Set();
  return deepFreeze({
    tenantId,
    actor,
    membership,
    permissions
  });
}
function createServiceTenantContext(tenantId, serviceId, label, permissions = /* @__PURE__ */ new Set()) {
  if (!tenantId || typeof tenantId !== "string") {
    throw new Error("TenantContext: tenantId is required");
  }
  if (!serviceId || typeof serviceId !== "string") {
    throw new Error("TenantContext: serviceId is required");
  }
  const actor = { kind: "service", serviceId, label };
  return deepFreeze({
    tenantId,
    actor,
    membership: null,
    permissions
  });
}
function requirePermission(ctx, perm) {
  if (!ctx.permissions.has(perm)) {
    throw new UnauthorizedError(
      `Actor ${ctx.actor.kind}:${ctx.actor.kind === "user" ? ctx.actor.userId : ctx.actor.serviceId} lacks permission ${perm} in tenant ${ctx.tenantId}`
    );
  }
  return ctx;
}
function hasPermission(ctx, perm) {
  return ctx.permissions.has(perm);
}
function actorIdOf(ctx) {
  return ctx.actor.kind === "user" ? ctx.actor.userId : ctx.actor.serviceId;
}
function deepFreeze(obj) {
  if (obj && typeof obj === "object") {
    Object.freeze(obj);
    for (const v of Object.values(obj)) {
      if (v && typeof v === "object" && !Object.isFrozen(v)) {
        deepFreeze(v);
      }
    }
  }
  return obj;
}
var init_tenant_context = __esm({
  "packages/contractor-core/src/domain/tenant-context.ts"() {
    "use strict";
    init_errors();
    init_membership();
  }
});

// packages/web-host/src/vercel-handler.ts
import { Pool } from "pg";

// packages/contractor-core/src/persistence/postgres-client.ts
var PostgresClient = class {
  pool;
  constructor(pool) {
    this.pool = pool;
  }
  /**
   * Check out a connection for a single non-transactional query, then release
   * it immediately. The instance never holds a connection between calls.
   */
  async query(sql, params = []) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(sql, params);
      return result.rows;
    } finally {
      client.release();
    }
  }
  async execute(sql, params = []) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(sql, params);
      return { affectedRows: result.rowCount ?? 0 };
    } finally {
      client.release();
    }
  }
  async queryReturning(sql, params = []) {
    return this.query(sql, params);
  }
  /**
   * Run a function inside a transaction. A single connection is checked out
   * for the duration of the transaction (BEGIN … COMMIT/ROLLBACK) and
   * released in `finally`. The instance carries NO transaction state —
   * `txDepth` is a local variable, not instance state, so concurrent
   * invocations on a shared module-global `PostgresClient` do not corrupt
   * each other.
   *
   * Nested `tx()` calls (a tx within a tx) use SAVEPOINT on the SAME checked-out
   * connection. The connection is released only when the outermost tx commits
   * or rolls back. This is correct PostgreSQL nesting behavior.
   */
  async tx(fn) {
    const client = await this.pool.connect();
    let depth = 0;
    const savepoints = [];
    try {
      await client.query("BEGIN");
      depth = 1;
      const nestedClient = {
        query: async (sql, params = []) => {
          const result2 = await client.query(sql, params);
          return result2.rows;
        },
        execute: async (sql, params = []) => {
          const result2 = await client.query(sql, params);
          return { affectedRows: result2.rowCount ?? 0 };
        },
        queryReturning: async (sql, params = []) => {
          const result2 = await client.query(sql, params);
          return result2.rows;
        },
        tx: async (nestedFn) => {
          const sp = `sp_${depth}`;
          savepoints.push(sp);
          await client.query(`SAVEPOINT ${sp}`);
          depth++;
          try {
            const result2 = await nestedFn(nestedClient);
            await client.query(`RELEASE SAVEPOINT ${sp}`);
            depth--;
            return result2;
          } catch (e) {
            await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
            await client.query(`RELEASE SAVEPOINT ${sp}`);
            depth--;
            throw e;
          }
        },
        execRaw: async (sql) => {
          await client.query(sql);
        }
      };
      const result = await fn(nestedClient);
      await client.query("COMMIT");
      return result;
    } catch (e) {
      try {
        if (depth > 0) {
          await client.query("ROLLBACK");
        }
      } catch {
      }
      throw e;
    } finally {
      client.release();
    }
  }
  async close() {
  }
  async execRaw(sql) {
    const client = await this.pool.connect();
    try {
      await client.query(sql);
    } finally {
      client.release();
    }
  }
};

// packages/contractor-core/src/persistence/pglite-client.ts
import { PGlite } from "@electric-sql/pglite";
var PgLiteClient = class {
  pg;
  txState = { depth: 0 };
  /** Mutex: ensures only one tx runs at a time on the single pglite connection. */
  txLock = Promise.resolve();
  constructor(pg, _opts) {
    this.pg = pg ?? new PGlite();
  }
  async query(sql, params = []) {
    const result = await this.pg.query(sql, params);
    return result.rows ?? [];
  }
  async execute(sql, params = []) {
    const result = await this.pg.query(sql, params);
    const affected = result.affectedRows ?? 0;
    return { affectedRows: affected };
  }
  async queryReturning(sql, params = []) {
    return this.query(sql, params);
  }
  /**
   * Run a function inside a transaction. Serialized via an async mutex
   * because pglite is a single-connection database — concurrent BEGIN/COMMIT
   * on the same connection would interleave and corrupt state. The mutex
   * ensures each top-level transaction completes before the next begins.
   *
   * Nested transactions (tx called within tx) use SAVEPOINT and do NOT
   * re-acquire the mutex (the outer transaction already holds it).
   * (Phase 2B.1.1 H1 fix: nested tx must not deadlock on the mutex.)
   */
  async tx(fn) {
    if (this.txState.depth > 0) {
      const savepoint = `sp_${this.txState.depth}`;
      try {
        await this.pg.query(`SAVEPOINT ${savepoint}`);
        this.txState.depth++;
        const result = await fn(this);
        await this.pg.query(`RELEASE SAVEPOINT ${savepoint}`);
        return result;
      } catch (e) {
        try {
          await this.pg.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          await this.pg.query(`RELEASE SAVEPOINT ${savepoint}`);
        } catch {
        }
        throw e;
      } finally {
        this.txState.depth = Math.max(0, this.txState.depth - 1);
      }
    }
    let release;
    const acquired = new Promise((resolve) => {
      release = () => resolve();
    });
    const previous = this.txLock;
    this.txLock = previous.then(() => acquired);
    await previous;
    try {
      await this.pg.query("BEGIN");
      this.txState.depth++;
      const result = await fn(this);
      await this.pg.query("COMMIT");
      return result;
    } catch (e) {
      try {
        await this.pg.query("ROLLBACK");
      } catch {
      }
      throw e;
    } finally {
      this.txState.depth = Math.max(0, this.txState.depth - 1);
      release();
    }
  }
  async close() {
    await this.pg.close();
  }
  async execRaw(sql) {
    await this.pg.exec(sql);
  }
};

// packages/contractor-core/src/persistence/db-client.ts
async function applyMigration(db, sql) {
  await db.execRaw(sql);
}

// packages/contractor-core/src/persistence/migrations-generated.ts
var FOUNDATION_MIGRATION_SQL = "-- Contractor GenOffice \u2014 Foundation Schema (PostgreSQL)\n-- Migration 0001: identity, organization/tenant, membership, workspace,\n-- project, audit, revision framework.\n--\n-- Foundation tables ONLY. No Commercial/Programme/BIM/Goals tables.\n-- (Phase 1 section 16: \"Only establish foundation tables required by this phase.\")\n--\n-- Every tenant-scoped table carries `tenant_id`. Every repository query\n-- enforces `WHERE ... AND tenant_id = $...`. (Phase 1 section 7.)\n--\n-- audit_events: append-only. The repository exposes NO update/delete.\n-- revisions: finalized/superseded rows are immutable. The repository\n--   enforces this (no update/delete for non-draft rows).\n\n-- \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n-- Users (identity)\n-- \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nCREATE TABLE IF NOT EXISTS users (\n  id           TEXT PRIMARY KEY,\n  email        TEXT UNIQUE,\n  display_name TEXT,\n  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),\n  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()\n);\n\n-- \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n-- AuthProvider bindings (Genspark, OIDC, SAML, password, ...)\n-- A user may have multiple bindings. (provider, subject) is globally unique.\n-- \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nCREATE TABLE IF NOT EXISTS auth_provider_bindings (\n  id           TEXT PRIMARY KEY,\n  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n  provider     TEXT NOT NULL,\n  subject      TEXT NOT NULL,\n  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),\n  last_used_at TIMESTAMPTZ,\n  UNIQUE (provider, subject)\n);\nCREATE INDEX IF NOT EXISTS idx_auth_bindings_user ON auth_provider_bindings(user_id);\n\n-- \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n-- Organizations (the Tenant). tenant_id == id.\n-- \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nCREATE TABLE IF NOT EXISTS organizations (\n  id         TEXT PRIMARY KEY,\n  tenant_id  TEXT NOT NULL,  -- == id; denormalized for uniform tenant scoping\n  name       TEXT NOT NULL,\n  slug       TEXT NOT NULL,\n  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),\n  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),\n  UNIQUE (slug)\n);\n\n-- \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n-- Memberships (User x Organization with Role)\n-- Membership is EXPLICIT. (Phase 1 section 5/11.)\n-- \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nCREATE TABLE IF NOT EXISTS memberships (\n  id              TEXT PRIMARY KEY,\n  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,\n  tenant_id       TEXT NOT NULL,  -- == organization_id; for uniform tenant scoping\n  role            TEXT NOT NULL CHECK (role IN ('owner','admin','member','viewer')),\n  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),\n  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),\n  UNIQUE (user_id, organization_id)\n);\nCREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);\nCREATE INDEX IF NOT EXISTS idx_memberships_tenant ON memberships(tenant_id);\n\n-- \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n-- Workspaces (organizational container inside a Tenant; owns Projects)\n-- \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nCREATE TABLE IF NOT EXISTS workspaces (\n  id              TEXT PRIMARY KEY,\n  tenant_id       TEXT NOT NULL,\n  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,\n  name            TEXT NOT NULL,\n  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()\n);\nCREATE INDEX IF NOT EXISTS idx_workspaces_tenant ON workspaces(tenant_id);\n\n-- \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n-- Projects (canonical business identity). ONE model.\n-- Referenced by future domain authorities (EstimateRevision, etc.)\n-- via project_id. No OfficeProject/ProgrammeProject/etc. (Phase 1 \xA78.)\n-- \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nCREATE TABLE IF NOT EXISTS projects (\n  id           TEXT PRIMARY KEY,\n  tenant_id    TEXT NOT NULL,\n  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,\n  name         TEXT NOT NULL,\n  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),\n  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()\n);\nCREATE INDEX IF NOT EXISTS idx_projects_tenant ON projects(tenant_id);\nCREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id);\n\n-- \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n-- Audit events (append-only). NO update/delete from the repository.\n-- (Phase 1 section 12; ADR-0005 Decision 6.)\n-- \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nCREATE TABLE IF NOT EXISTS audit_events (\n  event_id    TEXT PRIMARY KEY,\n  tenant_id   TEXT NOT NULL,\n  actor_id    TEXT NOT NULL,\n  actor_kind  TEXT NOT NULL CHECK (actor_kind IN ('user','service')),\n  timestamp   TIMESTAMPTZ NOT NULL DEFAULT now(),\n  action      TEXT NOT NULL,\n  entity_type TEXT NOT NULL,\n  entity_id   TEXT NOT NULL,\n  operation   TEXT NOT NULL,\n  metadata    JSONB\n);\nCREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_events(tenant_id);\nCREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events(tenant_id, entity_type, entity_id);\nCREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_events(tenant_id, timestamp DESC);\n\n-- Block UPDATE and DELETE on audit_events at the database level.\n-- (Defense in depth \u2014 the repository also exposes no update/delete.)\nCREATE OR REPLACE FUNCTION block_audit_mutation() RETURNS TRIGGER AS $$\nBEGIN\n  RAISE EXCEPTION 'audit_events is append-only: UPDATE and DELETE are forbidden';\nEND;\n$$ LANGUAGE plpgsql;\nDROP TRIGGER IF EXISTS trg_block_audit_update ON audit_events;\nDROP TRIGGER IF EXISTS trg_block_audit_delete ON audit_events;\nCREATE TRIGGER trg_block_audit_update BEFORE UPDATE ON audit_events\n  FOR EACH ROW EXECUTE FUNCTION block_audit_mutation();\nCREATE TRIGGER trg_block_audit_delete BEFORE DELETE ON audit_events\n  FOR EACH ROW EXECUTE FUNCTION block_audit_mutation();\n\n-- \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n-- Revisions (generic revision framework). Domain-specific payload is\n-- NOT stored here \u2014 this is the metadata infrastructure for immutable\n-- historical truth. (Phase 1 section 13.)\n--\n-- finalized/superseded rows are IMMUTABLE. The repository enforces this\n-- (no update/delete for non-draft rows). A trigger provides defense in depth.\n-- \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n-- C2: revisions are historical authority. They must NEVER be destroyed by\n-- a parent (project/workspace/org) deletion. The FK to projects uses\n-- ON DELETE RESTRICT \u2014 a project with revisions cannot be hard-deleted.\n-- (Phase 1.1 C2 fix.)\nCREATE TABLE IF NOT EXISTS revisions (\n  revision_id       TEXT PRIMARY KEY,\n  tenant_id         TEXT NOT NULL,\n  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,\n  authority_kind    TEXT NOT NULL,\n  revision_number   INTEGER NOT NULL,\n  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','finalized','superseded')),\n  created_by        TEXT NOT NULL,\n  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),\n  algorithm_version TEXT NOT NULL,\n  content_hash      TEXT NOT NULL,\n  parent_revision_id TEXT REFERENCES revisions(revision_id),\n  finalized_at      TIMESTAMPTZ,\n  UNIQUE (tenant_id, project_id, authority_kind, revision_number)\n);\nCREATE INDEX IF NOT EXISTS idx_revisions_tenant ON revisions(tenant_id);\nCREATE INDEX IF NOT EXISTS idx_revisions_project ON revisions(tenant_id, project_id, authority_kind);\n\n-- H1: dedicated revision-number counter. Each (tenant, project, authority_kind)\n-- has a monotonic counter row. Allocation is atomic via UPSERT + RETURNING \u2014\n-- no race window, no serialization failures, no retry needed.\n-- (Phase 1.1 H1 fix: replaces SELECT MAX(revision_number)+1 under READ COMMITTED.)\nCREATE TABLE IF NOT EXISTS revision_counters (\n  tenant_id       TEXT NOT NULL,\n  project_id      TEXT NOT NULL,\n  authority_kind  TEXT NOT NULL,\n  next_number     INTEGER NOT NULL DEFAULT 1,\n  PRIMARY KEY (tenant_id, project_id, authority_kind)\n);\n\n-- C1: finalized/superseded revisions are IMMUTABLE except for the\n-- controlled status transition finalized->superseded (and draft->superseded,\n-- draft->finalized). The trigger enforces that ONLY `status` (and\n-- `finalized_at` during draft->finalized) may change; every identity/content\n-- field is frozen once finalized. (Phase 1.1 C1 fix.)\n--\n-- Immutable fields (must not change after finalization):\n--   revision_id, tenant_id, project_id, authority_kind, revision_number,\n--   created_by, created_at, algorithm_version, content_hash,\n--   parent_revision_id\n-- Mutable fields (controlled lifecycle only):\n--   status (draft->finalized, draft->superseded, finalized->superseded)\n--   finalized_at (set when draft->finalized; unchanged thereafter)\nCREATE OR REPLACE FUNCTION block_immutable_revision_update() RETURNS TRIGGER AS $$\nBEGIN\n  -- From draft: any field may change (working state).\n  IF OLD.status = 'draft' THEN\n    RETURN NEW;\n  END IF;\n\n  -- From finalized: only the finalized->superseded transition is allowed,\n  -- and ONLY the status field may change. Every other field must be identical.\n  IF OLD.status = 'finalized' THEN\n    IF NEW.status = 'superseded' THEN\n      -- Verify NO field other than status changed.\n      IF NEW.revision_id IS DISTINCT FROM OLD.revision_id\n         OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id\n         OR NEW.project_id IS DISTINCT FROM OLD.project_id\n         OR NEW.authority_kind IS DISTINCT FROM OLD.authority_kind\n         OR NEW.revision_number IS DISTINCT FROM OLD.revision_number\n         OR NEW.created_by IS DISTINCT FROM OLD.created_by\n         OR NEW.created_at IS DISTINCT FROM OLD.created_at\n         OR NEW.algorithm_version IS DISTINCT FROM OLD.algorithm_version\n         OR NEW.content_hash IS DISTINCT FROM OLD.content_hash\n         OR NEW.parent_revision_id IS DISTINCT FROM OLD.parent_revision_id\n         OR NEW.finalized_at IS DISTINCT FROM OLD.finalized_at THEN\n        RAISE EXCEPTION 'revision % is finalized: only status may change during finalized->superseded (identity/content fields are immutable)', OLD.revision_id;\n      END IF;\n      RETURN NEW;\n    END IF;\n    -- Any other transition from finalized is forbidden.\n    RAISE EXCEPTION 'revision % is finalized: UPDATE forbidden (only finalized->superseded is allowed)', OLD.revision_id;\n  END IF;\n\n  -- From superseded: terminal state. No UPDATE at all.\n  IF OLD.status = 'superseded' THEN\n    RAISE EXCEPTION 'revision % is superseded (terminal): UPDATE forbidden', OLD.revision_id;\n  END IF;\n\n  RETURN NEW;\nEND;\n$$ LANGUAGE plpgsql;\nDROP TRIGGER IF EXISTS trg_block_immutable_rev_update ON revisions;\nCREATE TRIGGER trg_block_immutable_rev_update BEFORE UPDATE ON revisions\n  FOR EACH ROW EXECUTE FUNCTION block_immutable_revision_update();\n\n-- Block DELETE on finalized/superseded revisions (defense in depth).\nCREATE OR REPLACE FUNCTION block_immutable_revision_delete() RETURNS TRIGGER AS $$\nBEGIN\n  IF OLD.status IN ('finalized','superseded') THEN\n    RAISE EXCEPTION 'revision % is immutable (status=%): DELETE forbidden', OLD.revision_id, OLD.status;\n  END IF;\n  RETURN OLD;\nEND;\n$$ LANGUAGE plpgsql;\nDROP TRIGGER IF EXISTS trg_block_immutable_rev_delete ON revisions;\nCREATE TRIGGER trg_block_immutable_rev_delete BEFORE DELETE ON revisions\n  FOR EACH ROW EXECUTE FUNCTION block_immutable_revision_delete();\n";
var COMMERCIAL_MIGRATION_SQL = "-- Contractor GenOffice \u2014 Commercial Schema (PostgreSQL)\n-- Migration 0002: PlanMeasurement, BOQ, BOQItem, EstimateRevision payload, Bid.\n--\n-- Commercial persistence ONLY. No application services, no HTTP, no UI.\n-- (Phase 2B.1.)\n--\n-- Reuses the foundation revision infrastructure:\n--   - revisions table (generic RevisionMetadata)\n--   - revision_counters table (atomic revision number allocation)\n--   - immutability triggers on revisions (block UPDATE/DELETE on finalized/superseded)\n--\n-- The EstimateRevision = generic RevisionMetadata + EstimateRevisionPayload.\n-- The payload is stored as canonical immutable JSONB in estimate_revision_payloads.\n-- JSONB is the canonical authority; denormalized fields are indexed projections only.\n--\n-- Tenant enforcement: every table carries tenant_id and every query enforces it.\n-- Historical authority: RESTRICT on FKs that protect EstimateRevision/Bid.\n-- (Phase 2B.1 \xA76, \xA716, \xA721.)\n\n-- \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n-- PlanMeasurement (measurement evidence \u2014 NOT commercial authority)\n-- \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nCREATE TABLE IF NOT EXISTS plan_measurements (\n  measurement_id            TEXT PRIMARY KEY,\n  tenant_id                 TEXT NOT NULL,\n  project_id                TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,\n  source_artifact_id        TEXT NOT NULL,\n  source_artifact_hash      TEXT NOT NULL,\n  sheet_id                  TEXT,\n  sheet_revision            TEXT,\n  element_reference         TEXT NOT NULL,\n  quantity_value             NUMERIC(20,4) NOT NULL,\n  quantity_unit              TEXT NOT NULL,\n  measurement_method        TEXT NOT NULL CHECK (measurement_method IN ('manual-takeoff','auto-takeoff','ai-proposed','imported')),\n  measurement_basis         TEXT NOT NULL CHECK (measurement_basis IN ('count','length','area','volume','mass','time')),\n  measurement_engine_version TEXT NOT NULL,\n  actor_id                  TEXT NOT NULL,\n  measured_at               TIMESTAMPTZ NOT NULL,\n  provisional               BOOLEAN NOT NULL DEFAULT false,\n  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()\n);\nCREATE INDEX IF NOT EXISTS idx_pm_tenant ON plan_measurements(tenant_id);\nCREATE INDEX IF NOT EXISTS idx_pm_project ON plan_measurements(tenant_id, project_id);\nCREATE INDEX IF NOT EXISTS idx_pm_artifact ON plan_measurements(tenant_id, source_artifact_id);\n\n-- \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n-- BOQ (scope structure \u2014 NOT commercial authority)\n-- \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nCREATE TABLE IF NOT EXISTS boqs (\n  boq_id     TEXT PRIMARY KEY,\n  tenant_id  TEXT NOT NULL,\n  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,\n  name       TEXT,\n  created_at TIMESTAMPTZ NOT NULL DEFAULT now()\n);\nCREATE INDEX IF NOT EXISTS idx_boqs_tenant ON boqs(tenant_id);\nCREATE INDEX IF NOT EXISTS idx_boqs_project ON boqs(tenant_id, project_id);\n\n-- BOQItem (scope line within a BOQ)\nCREATE TABLE IF NOT EXISTS boq_items (\n  item_id                TEXT PRIMARY KEY,\n  boq_id                 TEXT NOT NULL REFERENCES boqs(boq_id) ON DELETE CASCADE,\n  tenant_id              TEXT NOT NULL,\n  item_code              TEXT NOT NULL,\n  description            TEXT NOT NULL,\n  unit                   TEXT NOT NULL,\n  quantity_value          NUMERIC(20,4) NOT NULL,\n  quantity_unit           TEXT NOT NULL,\n  provenance             TEXT NOT NULL CHECK (provenance IN ('plan-measurement','imported','manual')),\n  source_measurement_ids  JSONB,\n  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()\n);\nCREATE INDEX IF NOT EXISTS idx_boq_items_tenant ON boq_items(tenant_id);\nCREATE INDEX IF NOT EXISTS idx_boq_items_boq ON boq_items(boq_id);\n\n-- \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n-- EstimateRevision payload (canonical immutable commercial content)\n--\n-- The EstimateRevisionPayload is stored as JSONB \u2014 the canonical authority.\n-- Denormalized fields (currency, target_profit_mode) are indexed projections\n-- for queryability ONLY; they are NOT a second authority.\n--\n-- The revision_id FK references the generic revisions table (which stores\n-- RevisionMetadata + immutability triggers). The payload_json is immutable\n-- once the revision is finalized; a trigger blocks mutation.\n-- (Phase 2B.1 \xA76, \xA77, \xA78.)\n-- \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nCREATE TABLE IF NOT EXISTS estimate_revision_payloads (\n  revision_id          TEXT PRIMARY KEY REFERENCES revisions(revision_id) ON DELETE RESTRICT,\n  tenant_id             TEXT NOT NULL,\n  project_id            TEXT NOT NULL,\n  payload_json          JSONB NOT NULL,\n  -- Denormalized index fields (NOT canonical \u2014 derived from payload_json)\n  currency              CHAR(3) NOT NULL,\n  target_profit_mode    TEXT NOT NULL,\n  target_profit_ratio   NUMERIC(6,5) NOT NULL,\n  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()\n);\nCREATE INDEX IF NOT EXISTS idx_erp_tenant ON estimate_revision_payloads(tenant_id);\nCREATE INDEX IF NOT EXISTS idx_erp_project ON estimate_revision_payloads(tenant_id, project_id);\n\n-- Immutability trigger: block UPDATE/DELETE on finalized/superseded payloads.\n-- The generic revisions trigger protects the revisions table; this trigger\n-- protects the payload JSONB. (Phase 2B.1 \xA78, \xA733.)\n--\n-- For draft status, the function returns NEW (allow the UPDATE \u2014 drafts are\n-- working state). For finalized/superseded, it raises (mutation forbidden).\n-- Returning OLD for draft status would silently discard every payload UPDATE,\n-- causing stored content_hash / payload_json drift \u2014 a serious correctness bug.\n-- (Phase 2B.2 trigger correctness fix.)\nCREATE OR REPLACE FUNCTION block_estimate_payload_mutation() RETURNS TRIGGER AS $$\nDECLARE\n  rev_status TEXT;\nBEGIN\n  SELECT status INTO rev_status FROM revisions WHERE revision_id = OLD.revision_id;\n  IF rev_status IN ('finalized', 'superseded') THEN\n    RAISE EXCEPTION 'estimate revision payload % is immutable (revision status=%): mutation forbidden', OLD.revision_id, rev_status;\n  END IF;\n  -- draft status: allow the UPDATE to proceed with the new row.\n  RETURN NEW;\nEND;\n$$ LANGUAGE plpgsql;\n\nDROP TRIGGER IF EXISTS trg_block_erp_update ON estimate_revision_payloads;\nCREATE TRIGGER trg_block_erp_update BEFORE UPDATE ON estimate_revision_payloads\n  FOR EACH ROW EXECUTE FUNCTION block_estimate_payload_mutation();\n\nDROP TRIGGER IF EXISTS trg_block_erp_delete ON estimate_revision_payloads;\nCREATE TRIGGER trg_block_erp_delete BEFORE DELETE ON estimate_revision_payloads\n  FOR EACH ROW EXECUTE FUNCTION block_estimate_payload_mutation();\n\n-- \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n-- Bid (commercial submission decision \u2014 references finalized EstimateRevision)\n-- \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nCREATE TABLE IF NOT EXISTS bids (\n  bid_id                          TEXT PRIMARY KEY,\n  tenant_id                       TEXT NOT NULL,\n  project_id                      TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,\n  estimate_revision_id            TEXT NOT NULL REFERENCES revisions(revision_id) ON DELETE RESTRICT,\n  estimate_revision_content_hash  TEXT NOT NULL,\n  status                          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','won','lost','withdrawn')),\n  final_price_minor                BIGINT,\n  final_price_currency             CHAR(3),\n  director_adjustment_minor        BIGINT,\n  director_adjustment_currency      CHAR(3),\n  adjustment_rationale             TEXT,\n  submitted_at                     TIMESTAMPTZ,\n  outcome_at                       TIMESTAMPTZ,\n  outcome_note                     TEXT,\n  created_at                       TIMESTAMPTZ NOT NULL DEFAULT now()\n);\nCREATE INDEX IF NOT EXISTS idx_bids_tenant ON bids(tenant_id);\nCREATE INDEX IF NOT EXISTS idx_bids_project ON bids(tenant_id, project_id);\nCREATE INDEX IF NOT EXISTS idx_bids_revision ON bids(tenant_id, estimate_revision_id);\n";
var MAGIC_LINKS_MIGRATION_SQL = "-- \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n-- 0003_magic_links.sql \u2014 passwordless email magic-link auth tokens (Phase 2C.2)\n--\n-- ADR-0009 Decision 3: production auth is passwordless email magic-link.\n-- The browser posts an email to /api/auth/request-link; the server generates\n-- a single-use, short-lived HMAC-signed token, stores it here, and emails it.\n-- On verify, the token is consumed (used_at set) and a session cookie issued.\n--\n-- This migration is ADDITIVE \u2014 it does NOT modify 0001_foundation.sql or\n-- 0002_commercial.sql. The frozen architecture is unchanged.\n-- \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nCREATE TABLE IF NOT EXISTS magic_links (\n  token_hash      TEXT PRIMARY KEY,          -- SHA-256 of the token (we never store the raw token)\n  email           TEXT NOT NULL,             -- the email the link was sent to\n  expires_at      TIMESTAMPTZ NOT NULL,      -- short-lived (default 15 minutes)\n  used_at         TIMESTAMPTZ,               -- NULL until consumed; single-use enforced\n  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()\n);\n\n-- Index for lookup by token_hash (the verify path).\nCREATE INDEX IF NOT EXISTS idx_magic_links_token_hash ON magic_links(token_hash) WHERE used_at IS NULL;\n\n-- Index for periodic cleanup of expired tokens.\nCREATE INDEX IF NOT EXISTS idx_magic_links_expires_at ON magic_links(expires_at);\n";
var AUTH_MIGRATION_SQL = "-- \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n-- 0004_auth.sql \u2014 password auth + waitlist (Phase 2C.3, additive)\n--\n-- ADR-0009 D3 (magic-link) is supplemented by password auth for the admin\n-- and approved users. The waitlist captures sign-up requests; the admin\n-- approves them to create real accounts.\n--\n-- This migration is ADDITIVE \u2014 it does NOT modify 0001/0002/0003.\n-- \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\n-- Add password_hash to users (nullable \u2014 null for magic-link-only users)\nALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;\n\n-- Add is_demo flag to users (for demo accounts with quick-login)\nALTER TABLE users ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;\n\n-- Waitlist table\nCREATE TABLE IF NOT EXISTS waitlist (\n  id              TEXT PRIMARY KEY,\n  email           TEXT NOT NULL UNIQUE,\n  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),\n  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),\n  approved_by     TEXT REFERENCES users(id),\n  approved_at     TIMESTAMPTZ,\n  created_user_id TEXT REFERENCES users(id),\n  display_name    TEXT\n);\n\nCREATE INDEX IF NOT EXISTS idx_waitlist_status ON waitlist(status);\n";

// packages/contractor-core/src/persistence/repositories/organization.repository.ts
function mapRow(r) {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    slug: r.slug,
    status: r.status,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)
  };
}
var OrganizationRepository = class {
  constructor(db) {
    this.db = db;
  }
  db;
  async create(org) {
    const rows = await this.db.queryReturning(
      `INSERT INTO organizations (id, tenant_id, name, slug, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [org.id, org.tenantId, org.name, org.slug, org.status, org.createdAt]
    );
    return mapRow(rows[0]);
  }
  /**
   * Get an organization by id, ENFORCING tenant scope.
   * A request from tenant A for an org in tenant B returns null (not found),
   * NOT the other tenant's data. (Phase 1 section 7/21.)
   */
  async getById(id, tenantId) {
    const rows = await this.db.query(
      `SELECT * FROM organizations WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }
  /**
   * Get an organization by slug (globally unique). Used for lookup before
   * tenant context is established (e.g. login flow). Tenant scope is NOT
   * applied here because the org IS the tenant.
   */
  async getBySlug(slug) {
    const rows = await this.db.query(
      `SELECT * FROM organizations WHERE slug = $1`,
      [slug]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }
  /**
   * List organizations for a tenant (typically just the tenant itself,
   * but the query still enforces scope).
   */
  async listForTenant(tenantId) {
    const rows = await this.db.query(
      `SELECT * FROM organizations WHERE tenant_id = $1 ORDER BY created_at`,
      [tenantId]
    );
    return rows.map(mapRow);
  }
};

// packages/contractor-core/src/persistence/repositories/user.repository.ts
function mapUser(r) {
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    status: r.status,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)
  };
}
function mapBinding(r) {
  return {
    id: r.id,
    userId: r.user_id,
    provider: r.provider,
    subject: r.subject,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    lastUsedAt: r.last_used_at instanceof Date ? r.last_used_at.toISOString() : r.last_used_at ? String(r.last_used_at) : null
  };
}
var UserRepository = class {
  constructor(db) {
    this.db = db;
  }
  db;
  async create(user) {
    const rows = await this.db.queryReturning(
      `INSERT INTO users (id, email, display_name, status, created_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [user.id, user.email, user.displayName, user.status, user.createdAt]
    );
    return mapUser(rows[0]);
  }
  async getById(id) {
    const rows = await this.db.query(`SELECT * FROM users WHERE id = $1`, [id]);
    return rows[0] ? mapUser(rows[0]) : null;
  }
  async getByEmail(email) {
    const rows = await this.db.query(`SELECT * FROM users WHERE email = $1`, [email]);
    return rows[0] ? mapUser(rows[0]) : null;
  }
  async createBinding(b) {
    const rows = await this.db.queryReturning(
      `INSERT INTO auth_provider_bindings (id, user_id, provider, subject, created_at, last_used_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [b.id, b.userId, b.provider, b.subject, b.createdAt, b.lastUsedAt]
    );
    return mapBinding(rows[0]);
  }
  async getBindingBySubject(provider, subject) {
    const rows = await this.db.query(
      `SELECT * FROM auth_provider_bindings WHERE provider = $1 AND subject = $2`,
      [provider, subject]
    );
    return rows[0] ? mapBinding(rows[0]) : null;
  }
  async listBindingsForUser(userId) {
    const rows = await this.db.query(
      `SELECT * FROM auth_provider_bindings WHERE user_id = $1 ORDER BY created_at`,
      [userId]
    );
    return rows.map(mapBinding);
  }
  // ── Phase 2C.3.2: password-auth support (repository owns the SQL) ──────
  /**
   * Create a user with a password_hash (for password-auth users).
   * The password_hash is already hashed by the caller (PasswordAuthService).
   */
  async createWithPassword(user, passwordHash) {
    const rows = await this.db.queryReturning(
      `INSERT INTO users (id, email, display_name, status, created_at, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [user.id, user.email, user.displayName, user.status, user.createdAt, passwordHash]
    );
    return mapUser(rows[0]);
  }
  /**
   * Get a user's password_hash (for login verification).
   * Returns null if no password is set.
   */
  async getPasswordHash(userId) {
    const rows = await this.db.query(
      `SELECT password_hash FROM users WHERE id = $1`,
      [userId]
    );
    return rows[0]?.password_hash ?? null;
  }
  /**
   * Update a user's password_hash.
   */
  async updatePasswordHash(userId, passwordHash) {
    await this.db.execute(
      `UPDATE users SET password_hash = $2 WHERE id = $1`,
      [userId, passwordHash]
    );
  }
  /**
   * Get the is_demo flag for a user.
   */
  async getIsDemo(userId) {
    const rows = await this.db.query(
      `SELECT is_demo FROM users WHERE id = $1`,
      [userId]
    );
    return rows[0]?.is_demo ?? false;
  }
  /**
   * Create a demo user (is_demo=true, no password). For the bootstrap script.
   */
  async createDemoUser(user) {
    const rows = await this.db.queryReturning(
      `INSERT INTO users (id, email, display_name, status, created_at, is_demo)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING *`,
      [user.id, user.email, user.displayName, user.status, user.createdAt]
    );
    return mapUser(rows[0]);
  }
  /**
   * Set the is_demo flag for an existing user. Used by the bootstrap script
   * to ensure demo users created before the is_demo column existed get the flag.
   */
  async setDemoFlag(userId, isDemo) {
    await this.db.execute(
      `UPDATE users SET is_demo = $2 WHERE id = $1`,
      [userId, isDemo]
    );
  }
};

// packages/contractor-core/src/persistence/repositories/membership.repository.ts
function mapRow2(r) {
  return {
    id: r.id,
    userId: r.user_id,
    organizationId: r.organization_id,
    role: r.role,
    status: r.status,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)
  };
}
var MembershipRepository = class {
  constructor(db) {
    this.db = db;
  }
  db;
  async create(m) {
    const rows = await this.db.queryReturning(
      `INSERT INTO memberships (id, user_id, organization_id, tenant_id, role, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [m.id, m.userId, m.organizationId, m.organizationId, m.role, m.status, m.createdAt]
    );
    return mapRow2(rows[0]);
  }
  /**
   * Get a membership by id, ENFORCING tenant scope.
   * Cross-tenant lookup returns null (not found). (Phase 1 section 7/21.)
   */
  async getById(id, tenantId) {
    const rows = await this.db.query(
      `SELECT * FROM memberships WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );
    return rows[0] ? mapRow2(rows[0]) : null;
  }
  /**
   * Get a user's membership in a specific tenant. Used to resolve
   * TenantContext from the authenticated session. (Phase 1 section 6.)
   */
  async getForUserInTenant(userId, tenantId) {
    const rows = await this.db.query(
      `SELECT * FROM memberships WHERE user_id = $1 AND organization_id = $2 AND tenant_id = $2 AND status = 'active'`,
      [userId, tenantId]
    );
    return rows[0] ? mapRow2(rows[0]) : null;
  }
  /**
   * List all memberships in a tenant (ENFORCING tenant scope).
   */
  async listForTenant(tenantId) {
    const rows = await this.db.query(
      `SELECT * FROM memberships WHERE tenant_id = $1 AND status = 'active' ORDER BY created_at`,
      [tenantId]
    );
    return rows.map(mapRow2);
  }
  /**
   * List all tenants a user belongs to (NOT tenant-scoped — used to resolve
   * which tenants an authenticated user may access). Returns active memberships.
   */
  async listTenantsForUser(userId) {
    const rows = await this.db.query(
      `SELECT * FROM memberships WHERE user_id = $1 AND status = 'active' ORDER BY created_at`,
      [userId]
    );
    return rows.map(mapRow2);
  }
  /**
   * Revoke a membership (soft-delete via status). Enforces tenant scope.
   */
  async revoke(id, tenantId) {
    const result = await this.db.execute(
      `UPDATE memberships SET status = 'revoked' WHERE id = $1 AND tenant_id = $2 AND status = 'active'`,
      [id, tenantId]
    );
    return result.affectedRows > 0;
  }
};

// packages/contractor-core/src/persistence/repositories/workspace.repository.ts
function mapRow3(r) {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    organizationId: r.organization_id,
    name: r.name,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)
  };
}
var WorkspaceRepository = class {
  constructor(db) {
    this.db = db;
  }
  db;
  async create(ws) {
    const rows = await this.db.queryReturning(
      `INSERT INTO workspaces (id, tenant_id, organization_id, name, created_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [ws.id, ws.tenantId, ws.organizationId, ws.name, ws.createdAt]
    );
    return mapRow3(rows[0]);
  }
  /**
   * Get a workspace by id, ENFORCING tenant scope.
   * Cross-tenant lookup returns null. (Phase 1 section 7/21.)
   */
  async getById(id, tenantId) {
    const rows = await this.db.query(
      `SELECT * FROM workspaces WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );
    return rows[0] ? mapRow3(rows[0]) : null;
  }
  async listForTenant(tenantId) {
    const rows = await this.db.query(
      `SELECT * FROM workspaces WHERE tenant_id = $1 ORDER BY created_at`,
      [tenantId]
    );
    return rows.map(mapRow3);
  }
};

// packages/contractor-core/src/persistence/repositories/project.repository.ts
function mapRow4(r) {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    workspaceId: r.workspace_id,
    name: r.name,
    status: r.status,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)
  };
}
var ProjectRepository = class {
  constructor(db) {
    this.db = db;
  }
  db;
  async create(p) {
    const rows = await this.db.queryReturning(
      `INSERT INTO projects (id, tenant_id, workspace_id, name, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [p.id, p.tenantId, p.workspaceId, p.name, p.status, p.createdAt]
    );
    return mapRow4(rows[0]);
  }
  /**
   * Get a project by id, ENFORCING tenant scope.
   * Cross-tenant lookup returns null (not found), NOT the other tenant's
   * data. (Phase 1 section 7/21.)
   *
   * This is the canonical Project identity lookup. All future domain
   * authorities resolve their project via this (or an equivalent
   * tenant-scoped query).
   */
  async getById(id, tenantId) {
    const rows = await this.db.query(
      `SELECT * FROM projects WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );
    return rows[0] ? mapRow4(rows[0]) : null;
  }
  async listForWorkspace(workspaceId, tenantId) {
    const rows = await this.db.query(
      `SELECT * FROM projects WHERE workspace_id = $1 AND tenant_id = $2 ORDER BY created_at`,
      [workspaceId, tenantId]
    );
    return rows.map(mapRow4);
  }
  async listForTenant(tenantId) {
    const rows = await this.db.query(
      `SELECT * FROM projects WHERE tenant_id = $1 ORDER BY created_at`,
      [tenantId]
    );
    return rows.map(mapRow4);
  }
  async archive(id, tenantId) {
    const result = await this.db.execute(
      `UPDATE projects SET status = 'archived' WHERE id = $1 AND tenant_id = $2 AND status = 'active'`,
      [id, tenantId]
    );
    return result.affectedRows > 0;
  }
};

// packages/contractor-core/src/persistence/repositories/audit.repository.ts
function mapRow5(r) {
  return {
    eventId: r.event_id,
    tenantId: r.tenant_id,
    actorId: r.actor_id,
    actorKind: r.actor_kind,
    timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : String(r.timestamp),
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    operation: r.operation,
    // pglite/pg parse JSONB columns into objects already; handle both.
    metadata: r.metadata ? typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata : null
  };
}
var AuditRepository = class {
  constructor(db) {
    this.db = db;
  }
  db;
  /**
   * Append an audit event. This is the ONLY write method.
   * There are NO update or delete methods. (Phase 1 section 12/14.)
   */
  async append(e) {
    const rows = await this.db.queryReturning(
      `INSERT INTO audit_events (event_id, tenant_id, actor_id, actor_kind, timestamp, action, entity_type, entity_id, operation, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        e.eventId,
        e.tenantId,
        e.actorId,
        e.actorKind,
        e.timestamp,
        e.action,
        e.entityType,
        e.entityId,
        e.operation,
        e.metadata ? JSON.stringify(e.metadata) : null
      ]
    );
    return mapRow5(rows[0]);
  }
  /**
   * List audit events for a tenant, ENFORCING tenant scope.
   * Cross-tenant query returns nothing. (Phase 1 section 7/21.)
   */
  async listForTenant(tenantId, limit = 100) {
    const rows = await this.db.query(
      `SELECT * FROM audit_events WHERE tenant_id = $1 ORDER BY timestamp DESC LIMIT $2`,
      [tenantId, limit]
    );
    return rows.map(mapRow5);
  }
  /**
   * List audit events for a specific entity, ENFORCING tenant scope.
   */
  async listForEntity(tenantId, entityType, entityId2, limit = 100) {
    const rows = await this.db.query(
      `SELECT * FROM audit_events WHERE tenant_id = $1 AND entity_type = $2 AND entity_id = $3 ORDER BY timestamp DESC LIMIT $4`,
      [tenantId, entityType, entityId2, limit]
    );
    return rows.map(mapRow5);
  }
  // NOTE: There are intentionally NO update() or delete() methods.
  // Audit history is append-only. The database enforces this via triggers.
  // (Phase 1 section 14 — immutability rule.)
};

// packages/contractor-core/src/domain/revision.ts
init_errors();
function isMutable(status) {
  return status === "draft";
}
function assertMutable(revisionId, status) {
  if (!isMutable(status)) {
    throw new ImmutableRevisionMutationError(revisionId, `mutate (status=${status})`);
  }
}

// packages/contractor-core/src/persistence/repositories/revision.repository.ts
function mapRow6(r) {
  return {
    revisionId: r.revision_id,
    tenantId: r.tenant_id,
    projectId: r.project_id,
    authorityKind: r.authority_kind,
    revisionNumber: r.revision_number,
    status: r.status,
    createdBy: r.created_by,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    algorithmVersion: r.algorithm_version,
    contentHash: r.content_hash,
    parentRevisionId: r.parent_revision_id,
    finalizedAt: r.finalized_at instanceof Date ? r.finalized_at.toISOString() : r.finalized_at ? String(r.finalized_at) : null
  };
}
var RevisionRepository = class {
  constructor(db) {
    this.db = db;
  }
  db;
  /**
   * Create a new draft revision. The revision number is allocated
   * atomically from a dedicated counter row (revision_counters table),
   * NOT via SELECT MAX(revision_number)+1. This is concurrency-safe:
   * concurrent createDraft calls for the same (tenant, project,
   * authorityKind) each get a unique sequential number with no race
   * window and no retry. (Phase 1.1 H1 fix.)
   */
  async createDraft(tenantId, projectId, authorityKind, createdBy, algorithmVersion, contentHash2, parentRevisionId, createdAt) {
    return this.db.tx(async (tx) => {
      const counterRows = await tx.query(
        `INSERT INTO revision_counters (tenant_id, project_id, authority_kind, next_number)
         VALUES ($1, $2, $3, 2)
         ON CONFLICT (tenant_id, project_id, authority_kind)
         DO UPDATE SET next_number = revision_counters.next_number + 1
         RETURNING next_number - 1 AS next_num`,
        [tenantId, projectId, authorityKind]
      );
      const nextNum = counterRows[0].next_num;
      const rows = await tx.queryReturning(
        `INSERT INTO revisions (revision_id, tenant_id, project_id, authority_kind, revision_number, status, created_by, created_at, algorithm_version, content_hash, parent_revision_id, finalized_at)
         VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9, $10, NULL)
         RETURNING *`,
        [
          `rev_${cryptoRandomId()}`,
          tenantId,
          projectId,
          authorityKind,
          nextNum,
          createdBy,
          createdAt,
          algorithmVersion,
          contentHash2,
          parentRevisionId
        ]
      );
      return mapRow6(rows[0]);
    });
  }
  /**
   * Get a revision by id, ENFORCING tenant scope.
   * Cross-tenant lookup returns null. (Phase 1 section 7/21.)
   */
  async getById(revisionId, tenantId) {
    const rows = await this.db.query(
      `SELECT * FROM revisions WHERE revision_id = $1 AND tenant_id = $2`,
      [revisionId, tenantId]
    );
    return rows[0] ? mapRow6(rows[0]) : null;
  }
  /**
   * List revisions for a project + authorityKind, ENFORCING tenant scope.
   */
  async listForProject(tenantId, projectId, authorityKind) {
    const rows = await this.db.query(
      `SELECT * FROM revisions WHERE tenant_id = $1 AND project_id = $2 AND authority_kind = $3 ORDER BY revision_number DESC`,
      [tenantId, projectId, authorityKind]
    );
    return rows.map(mapRow6);
  }
  /**
   * Finalize a draft revision (draft -> finalized). After this, the
   * revision is IMMUTABLE — no update or delete is possible.
   * Returns the finalized revision, or null if not found / not a draft.
   */
  async finalize(revisionId, tenantId, finalizedAt) {
    const rows = await this.db.queryReturning(
      `UPDATE revisions SET status = 'finalized', finalized_at = $3
       WHERE revision_id = $1 AND tenant_id = $2 AND status = 'draft'
       RETURNING *`,
      [revisionId, tenantId, finalizedAt]
    );
    return rows[0] ? mapRow6(rows[0]) : null;
  }
  /**
   * Supersede a revision (draft->superseded OR finalized->superseded).
   * The superseded revision remains immutable and present for historical
   * reconstruction. (master prompt §13.)
   */
  async supersede(revisionId, tenantId) {
    const rows = await this.db.queryReturning(
      `UPDATE revisions SET status = 'superseded'
       WHERE revision_id = $1 AND tenant_id = $2 AND status IN ('draft','finalized')
       RETURNING *`,
      [revisionId, tenantId]
    );
    return rows[0] ? mapRow6(rows[0]) : null;
  }
  /**
   * Attempt to update a draft revision's content hash. Throws if the
   * revision is NOT a draft (immutable). Used to update working state
   * before finalization. (Phase 1 section 14.)
   *
   * This method exists ONLY for draft revisions. Once finalized, no
   * update is possible — the database trigger blocks it, and this method
   * checks status first.
   */
  async updateDraftContent(revisionId, tenantId, contentHash2, algorithmVersion) {
    const existing = await this.getById(revisionId, tenantId);
    if (!existing) return null;
    assertMutable(revisionId, existing.status);
    const rows = await this.db.queryReturning(
      `UPDATE revisions SET content_hash = $3, algorithm_version = $4
       WHERE revision_id = $1 AND tenant_id = $2 AND status = 'draft'
       RETURNING *`,
      [revisionId, tenantId, contentHash2, algorithmVersion]
    );
    return rows[0] ? mapRow6(rows[0]) : null;
  }
  // NOTE: There is intentionally NO delete() method and NO update method
  // for finalized/superseded revisions. The database triggers block such
  // operations as defense in depth. (Phase 1 section 14 — immutability rule.)
};
function cryptoRandomId() {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// packages/contractor-core/src/persistence/repositories/plan-measurement.repository.ts
function mapRow7(r) {
  return {
    __brand: "PlanMeasurement",
    measurementId: r.measurement_id,
    sourceArtifactId: r.source_artifact_id,
    sourceArtifactHash: r.source_artifact_hash,
    sheetId: r.sheet_id,
    sheetRevision: r.sheet_revision,
    elementReference: r.element_reference,
    quantity: {
      __brand: "Quantity",
      value: Number(r.quantity_value),
      unit: r.quantity_unit
    },
    measurementMethod: r.measurement_method,
    measurementBasis: r.measurement_basis,
    measurementEngineVersion: r.measurement_engine_version,
    actorId: r.actor_id,
    measuredAt: r.measured_at instanceof Date ? r.measured_at.toISOString() : String(r.measured_at),
    provisional: r.provisional
  };
}
var PlanMeasurementRepository = class {
  constructor(db) {
    this.db = db;
  }
  db;
  async create(pm, tenantId, projectId) {
    const rows = await this.db.queryReturning(
      `INSERT INTO plan_measurements (measurement_id, tenant_id, project_id, source_artifact_id, source_artifact_hash, sheet_id, sheet_revision, element_reference, quantity_value, quantity_unit, measurement_method, measurement_basis, measurement_engine_version, actor_id, measured_at, provisional)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING *`,
      [
        pm.measurementId,
        tenantId,
        projectId,
        pm.sourceArtifactId,
        pm.sourceArtifactHash,
        pm.sheetId,
        pm.sheetRevision,
        pm.elementReference,
        pm.quantity.value,
        pm.quantity.unit,
        pm.measurementMethod,
        pm.measurementBasis,
        pm.measurementEngineVersion,
        pm.actorId,
        pm.measuredAt,
        pm.provisional
      ]
    );
    return mapRow7(rows[0]);
  }
  async getById(measurementId, tenantId) {
    const rows = await this.db.query(
      `SELECT * FROM plan_measurements WHERE measurement_id = $1 AND tenant_id = $2`,
      [measurementId, tenantId]
    );
    return rows[0] ? mapRow7(rows[0]) : null;
  }
  async listForProject(tenantId, projectId) {
    const rows = await this.db.query(
      `SELECT * FROM plan_measurements WHERE tenant_id = $1 AND project_id = $2 ORDER BY measured_at DESC`,
      [tenantId, projectId]
    );
    return rows.map(mapRow7);
  }
};

// packages/contractor-core/src/persistence/repositories/boq.repository.ts
function mapBOQRow(r) {
  return {
    __brand: "BOQ",
    boqId: r.boq_id,
    projectId: r.project_id,
    items: []
    // loaded separately via getItems
  };
}
function mapItemRow(r) {
  let sourceIds = [];
  if (r.source_measurement_ids) {
    try {
      const parsed = typeof r.source_measurement_ids === "string" ? JSON.parse(r.source_measurement_ids) : r.source_measurement_ids;
      if (Array.isArray(parsed)) sourceIds = parsed;
    } catch {
    }
  }
  return {
    __brand: "BOQItem",
    itemId: r.item_id,
    itemCode: r.item_code,
    description: r.description,
    unit: r.unit,
    quantity: {
      __brand: "Quantity",
      value: Number(r.quantity_value),
      unit: r.quantity_unit
    },
    provenance: r.provenance,
    sourceMeasurementIds: sourceIds
  };
}
var BOQRepository = class {
  constructor(db) {
    this.db = db;
  }
  db;
  async create(boqId, tenantId, projectId, name) {
    const rows = await this.db.queryReturning(
      `INSERT INTO boqs (boq_id, tenant_id, project_id, name) VALUES ($1, $2, $3, $4) RETURNING *`,
      [boqId, tenantId, projectId, name ?? null]
    );
    return mapBOQRow(rows[0]);
  }
  async getById(boqId, tenantId) {
    const rows = await this.db.query(
      `SELECT * FROM boqs WHERE boq_id = $1 AND tenant_id = $2`,
      [boqId, tenantId]
    );
    if (!rows[0]) return null;
    const items = await this.listItems(boqId, tenantId);
    return { ...mapBOQRow(rows[0]), items };
  }
  async listForProject(tenantId, projectId) {
    const rows = await this.db.query(
      `SELECT * FROM boqs WHERE tenant_id = $1 AND project_id = $2 ORDER BY created_at`,
      [tenantId, projectId]
    );
    const result = [];
    for (const r of rows) {
      const items = await this.listItems(r.boq_id, tenantId);
      result.push({ ...mapBOQRow(r), items });
    }
    return result;
  }
  async addItem(item, boqId, tenantId) {
    const rows = await this.db.queryReturning(
      `INSERT INTO boq_items (item_id, boq_id, tenant_id, item_code, description, unit, quantity_value, quantity_unit, provenance, source_measurement_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        item.itemId,
        boqId,
        tenantId,
        item.itemCode,
        item.description,
        item.unit,
        item.quantity.value,
        item.quantity.unit,
        item.provenance,
        item.sourceMeasurementIds.length > 0 ? JSON.stringify(item.sourceMeasurementIds) : null
      ]
    );
    return mapItemRow(rows[0]);
  }
  async listItems(boqId, tenantId) {
    const rows = await this.db.query(
      `SELECT * FROM boq_items WHERE boq_id = $1 AND tenant_id = $2 ORDER BY item_code`,
      [boqId, tenantId]
    );
    return rows.map(mapItemRow);
  }
  async getItem(itemId, tenantId) {
    const rows = await this.db.query(
      `SELECT * FROM boq_items WHERE item_id = $1 AND tenant_id = $2`,
      [itemId, tenantId]
    );
    return rows[0] ? mapItemRow(rows[0]) : null;
  }
  async updateItemQuantity(itemId, tenantId, quantityValue, quantityUnit) {
    const result = await this.db.execute(
      `UPDATE boq_items SET quantity_value = $3, quantity_unit = $4 WHERE item_id = $1 AND tenant_id = $2`,
      [itemId, tenantId, quantityValue, quantityUnit]
    );
    return result.affectedRows > 0;
  }
};

// packages/contractor-core/src/domain/commercial/currency.ts
function currencyCode(code) {
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new Error(`Invalid currency code (must be 3 uppercase letters): ${code}`);
  }
  return code;
}
var CURRENCIES = {
  GHS: { code: currencyCode("GHS"), decimals: 2 },
  USD: { code: currencyCode("USD"), decimals: 2 },
  EUR: { code: currencyCode("EUR"), decimals: 2 },
  GBP: { code: currencyCode("GBP"), decimals: 2 },
  NGN: { code: currencyCode("NGN"), decimals: 2 },
  KES: { code: currencyCode("KES"), decimals: 2 },
  ZAR: { code: currencyCode("ZAR"), decimals: 2 },
  JPY: { code: currencyCode("JPY"), decimals: 0 },
  KWD: { code: currencyCode("KWD"), decimals: 3 }
};

// packages/contractor-core/src/domain/commercial/money.ts
function moneyFromMinor(minorUnits, currency) {
  if (!Number.isInteger(minorUnits)) {
    throw new Error(`moneyFromMinor: minorUnits must be an integer, got ${minorUnits}`);
  }
  const c = typeof currency === "string" ? currencyCode(currency) : currency;
  return { __brand: "Money", amount: minorUnits, currency: c };
}
function assertSameCurrency(a, b) {
  if (a.currency !== b.currency) {
    throw new Error(`Money currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}
function add(a, b) {
  assertSameCurrency(a, b);
  return { __brand: "Money", amount: a.amount + b.amount, currency: a.currency };
}
function subtract(a, b) {
  assertSameCurrency(a, b);
  return { __brand: "Money", amount: a.amount - b.amount, currency: a.currency };
}
function multiply(m, scalar) {
  const product = m.amount * scalar;
  const rounded = bankerRound(product);
  return { __brand: "Money", amount: rounded, currency: m.currency };
}
function divide(m, scalar) {
  if (scalar === 0) throw new Error("Money divide by zero");
  const quotient = m.amount / scalar;
  const rounded = bankerRound(quotient);
  return { __brand: "Money", amount: rounded, currency: m.currency };
}
function bankerRound(n) {
  if (!Number.isFinite(n)) return 0;
  const floor = Math.floor(n);
  const frac = n - floor;
  if (frac < 0.5) return floor;
  if (frac > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

// packages/contractor-core/src/domain/commercial/pricing.ts
function ratio(r) {
  if (!Number.isFinite(r) || r < 0 || r > 1) {
    throw new Error(`Invalid ratio (must be 0..1, got ${r})`);
  }
  return r;
}
function grossMargin(sellPrice, cost) {
  if (sellPrice.amount === 0) return 0;
  const profit = subtract(sellPrice, cost);
  return profit.amount / sellPrice.amount;
}
function extendLine(rate, qty) {
  const product = rate.amount * qty.value;
  const rounded = bankerRound(product);
  return moneyFromMinor(rounded, rate.currency);
}

// packages/contractor-core/src/domain/hashing.ts
import { createHash } from "node:crypto";
function canonicalize(value) {
  return canonicalizeValue(value, "");
}
function canonicalizeValue(value, indent) {
  if (value === null) return "null";
  if (value === void 0) return "undefined";
  const t = typeof value;
  if (t === "string") return JSON.stringify(value);
  if (t === "number") return Number.isFinite(value) ? String(value) : "NaN";
  if (t === "boolean") return String(value);
  if (t === "bigint") return `${value}n`;
  if (value instanceof Date) {
    return `date:${value.toISOString()}`;
  }
  if (Array.isArray(value)) {
    const items = value.filter((v) => v !== void 0).map((v) => canonicalizeValue(v, indent + "  ")).join(",");
    return `[${items}]`;
  }
  if (t === "object" && value !== null) {
    const obj = value;
    const keys = Object.keys(obj).filter((k) => obj[k] !== void 0).sort();
    const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalizeValue(obj[k], indent + "  ")}`).join(",");
    return `{${entries}}`;
  }
  return "unhashable";
}
function contentHash(value) {
  const canon = canonicalize(value);
  return createHash("sha256").update(canon, "utf8").digest("hex");
}

// packages/contractor-core/src/domain/commercial/estimate-revision.ts
init_errors();
function estimateRevisionContentHash(payload) {
  return contentHash(payload);
}
function computeEstimateRevisionTotals(payload) {
  let lineCostMinor = 0;
  const c = payload.currency;
  for (const line of payload.lines) {
    const cost = lineCostOf(line);
    if (cost.currency !== c) {
      throw new Error(
        `EstimateRevisionTotals: currency mismatch in line ${line.lineId}: expected ${c}, got ${cost.currency}`
      );
    }
    lineCostMinor += cost.amount;
  }
  const totalLineCost = { __brand: "Money", amount: lineCostMinor, currency: c };
  const overhead = multiply(totalLineCost, payload.policy.overheadPct);
  const contingency = multiply(totalLineCost, payload.policy.contingencyPct);
  const totalCost = add(add(totalLineCost, overhead), contingency);
  let profit;
  let sellPrice;
  if (payload.policy.targetProfitMode === "margin") {
    if (payload.policy.targetProfitRatio >= 1) {
      throw new ValidationError(
        `Target profit margin must be less than 100% (got ${payload.policy.targetProfitRatio}). A margin of 100% or more makes the sell price undefined.`,
        { targetProfitMode: "margin", targetProfitRatio: payload.policy.targetProfitRatio }
      );
    }
    sellPrice = divide(totalCost, 1 - payload.policy.targetProfitRatio);
    profit = subtract(sellPrice, totalCost);
  } else {
    profit = multiply(totalCost, payload.policy.targetProfitRatio);
    sellPrice = add(totalCost, profit);
  }
  const grossProfit2 = subtract(sellPrice, totalCost);
  return {
    totalLineCost,
    overhead,
    contingency,
    totalCost,
    profit,
    sellPrice,
    grossProfit: grossProfit2,
    grossMargin: grossMargin(sellPrice, totalCost)
  };
}
function replayEstimateRevision(revision) {
  return computeEstimateRevisionTotals(revision.payload);
}
function estimateRevisionPayload(input) {
  if (!input.projectId) throw new Error("EstimateRevisionPayload: projectId required");
  if (!input.pricingAlgorithmVersion) throw new Error("EstimateRevisionPayload: pricingAlgorithmVersion required");
  for (const line of input.lines) {
    if (line.currency !== input.currency) {
      throw new Error(
        `EstimateRevisionPayload currency mismatch: payload currency is ${input.currency} but line ${line.lineId} has currency ${line.currency}. A mixed-currency payload is invalid and cannot become canonical content.`
      );
    }
  }
  return {
    __brand: "EstimateRevisionPayload",
    projectId: input.projectId,
    currency: input.currency,
    policy: input.policy,
    lines: input.lines,
    note: input.note ?? null,
    pricingAlgorithmVersion: input.pricingAlgorithmVersion
  };
}
function lineCostOf(line) {
  if (line.costBasis === "lump-sum" || line.costBasis === "provisional") {
    return line.rate;
  }
  return extendLine(line.rate, line.quantity);
}

// packages/contractor-core/src/persistence/repositories/estimate-revision.repository.ts
var EstimateRevisionRepository = class {
  constructor(db) {
    this.db = db;
    this.revisions = new RevisionRepository(db);
  }
  db;
  revisions;
  /**
   * Create a draft EstimateRevision ATOMICALLY: allocate revision number,
   * insert revision metadata, AND insert the canonical payload JSONB — all
   * within ONE transaction. If the payload INSERT fails, the entire
   * transaction (including the revision metadata + counter allocation) is
   * rolled back. No orphaned revision without payload can persist.
   * (Phase 2B.1.1 H1 fix.)
   *
   * The RevisionRepository.createDraft() call uses this.db.tx() internally,
   * which — when called from within this outer tx() — creates a SAVEPOINT
   * rather than a new top-level transaction. This is the correct nesting
   * behavior for DbClient.tx().
   */
  async createDraft(tenantId, projectId, payload, createdBy, createdAt) {
    const contentHash2 = estimateRevisionContentHash(payload);
    return this.db.tx(async (tx) => {
      const metadata = await this.revisions.createDraft(
        tenantId,
        projectId,
        "estimate",
        createdBy,
        payload.pricingAlgorithmVersion,
        contentHash2,
        null,
        createdAt
      );
      await tx.queryReturning(
        `INSERT INTO estimate_revision_payloads (revision_id, tenant_id, project_id, payload_json, currency, target_profit_mode, target_profit_ratio)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          metadata.revisionId,
          tenantId,
          projectId,
          JSON.stringify(payload),
          payload.currency,
          payload.policy.targetProfitMode,
          payload.policy.targetProfitRatio
        ]
      );
      return { __brand: "EstimateRevision", metadata, payload };
    });
  }
  /**
   * Get an EstimateRevision by id, ENFORCING tenant scope.
   * Joins revisions + estimate_revision_payloads, reconstructs the full
   * EstimateRevision (metadata + payload). Cross-tenant returns null.
   */
  async getById(revisionId, tenantId) {
    const metadata = await this.revisions.getById(revisionId, tenantId);
    if (!metadata) return null;
    const payloadRows = await this.db.query(
      `SELECT * FROM estimate_revision_payloads WHERE revision_id = $1 AND tenant_id = $2`,
      [revisionId, tenantId]
    );
    if (!payloadRows[0]) return null;
    const payload = this.deserializePayload(payloadRows[0].payload_json);
    return { __brand: "EstimateRevision", metadata, payload };
  }
  /**
   * Update a draft revision's payload ATOMICALLY: update content_hash on
   * the revisions table AND update the payload JSONB — all within ONE
   * transaction. If either write fails, neither persists.
   * (Phase 2B.1.1 H1 fix.)
   *
   * The RevisionRepository.updateDraftContent() fetches the revision first
   * (to check status) then updates. When called from within this outer tx,
   * its internal operations participate in the same transaction.
   */
  async updateDraftPayload(revisionId, tenantId, payload) {
    const contentHash2 = estimateRevisionContentHash(payload);
    return this.db.tx(async (tx) => {
      const metadata = await this.revisions.updateDraftContent(
        revisionId,
        tenantId,
        contentHash2,
        payload.pricingAlgorithmVersion
      );
      if (!metadata) return null;
      await tx.queryReturning(
        `UPDATE estimate_revision_payloads
         SET payload_json = $3, currency = $4, target_profit_mode = $5, target_profit_ratio = $6
         WHERE revision_id = $1 AND tenant_id = $2
         RETURNING *`,
        [
          revisionId,
          tenantId,
          JSON.stringify(payload),
          payload.currency,
          payload.policy.targetProfitMode,
          payload.policy.targetProfitRatio
        ]
      );
      return { __brand: "EstimateRevision", metadata, payload };
    });
  }
  /**
   * Finalize a draft revision (draft → finalized). Delegates to the generic
   * RevisionRepository. After this, the revision + payload are IMMUTABLE.
   */
  async finalize(revisionId, tenantId, finalizedAt) {
    const metadata = await this.revisions.finalize(revisionId, tenantId, finalizedAt);
    if (!metadata) return null;
    return this.getById(revisionId, tenantId);
  }
  /**
   * Supersede a revision (draft/finalized → superseded). Delegates to the
   * generic RevisionRepository. The revision remains immutable and present.
   */
  async supersede(revisionId, tenantId) {
    const metadata = await this.revisions.supersede(revisionId, tenantId);
    if (!metadata) return null;
    return this.getById(revisionId, tenantId);
  }
  /**
   * List EstimateRevisions for a project. Joins revisions + payloads,
   * enforces tenant scope. Returns full EstimateRevision objects.
   */
  async listForProject(tenantId, projectId) {
    const metadatas = await this.revisions.listForProject(tenantId, projectId, "estimate");
    const result = [];
    for (const metadata of metadatas) {
      const payloadRows = await this.db.query(
        `SELECT payload_json FROM estimate_revision_payloads WHERE revision_id = $1 AND tenant_id = $2`,
        [metadata.revisionId, tenantId]
      );
      if (payloadRows[0]) {
        const payload = this.deserializePayload(payloadRows[0].payload_json);
        result.push({ __brand: "EstimateRevision", metadata, payload });
      }
    }
    return result;
  }
  /**
   * Deserialize the JSONB payload back to an EstimateRevisionPayload.
   * The branded types (__brand) are compile-time phantom types — they survive
   * JSON serialization/deserialization. The contentHash is recomputed from
   * the deserialized payload and must match the stored hash.
   */
  deserializePayload(json2) {
    const obj = typeof json2 === "string" ? JSON.parse(json2) : json2;
    return obj;
  }
};

// packages/contractor-core/src/persistence/repositories/bid.repository.ts
function toMoney(minor, currency) {
  if (minor === null || currency === null) return null;
  const amount = typeof minor === "bigint" ? Number(minor) : minor;
  return { __brand: "Money", amount, currency };
}
function mapRow8(r) {
  return {
    __brand: "Bid",
    bidId: r.bid_id,
    projectId: r.project_id,
    estimateRevisionId: r.estimate_revision_id,
    estimateRevisionContentHash: r.estimate_revision_content_hash,
    status: r.status,
    finalPrice: toMoney(r.final_price_minor, r.final_price_currency),
    directorAdjustment: toMoney(r.director_adjustment_minor, r.director_adjustment_currency),
    adjustmentRationale: r.adjustment_rationale,
    submittedAt: r.submitted_at instanceof Date ? r.submitted_at.toISOString() : r.submitted_at ? String(r.submitted_at) : null,
    outcomeAt: r.outcome_at instanceof Date ? r.outcome_at.toISOString() : r.outcome_at ? String(r.outcome_at) : null,
    outcomeNote: r.outcome_note
  };
}
var BidRepository = class {
  constructor(db) {
    this.db = db;
  }
  db;
  async create(b, tenantId) {
    const rows = await this.db.queryReturning(
      `INSERT INTO bids (bid_id, tenant_id, project_id, estimate_revision_id, estimate_revision_content_hash, status, final_price_minor, final_price_currency, director_adjustment_minor, director_adjustment_currency, adjustment_rationale, submitted_at, outcome_at, outcome_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
      [
        b.bidId,
        tenantId,
        b.projectId,
        b.estimateRevisionId,
        b.estimateRevisionContentHash,
        b.status,
        b.finalPrice?.amount ?? null,
        b.finalPrice?.currency ?? null,
        b.directorAdjustment?.amount ?? null,
        b.directorAdjustment?.currency ?? null,
        b.adjustmentRationale,
        b.submittedAt,
        b.outcomeAt,
        b.outcomeNote
      ]
    );
    return mapRow8(rows[0]);
  }
  async getById(bidId, tenantId) {
    const rows = await this.db.query(
      `SELECT * FROM bids WHERE bid_id = $1 AND tenant_id = $2`,
      [bidId, tenantId]
    );
    return rows[0] ? mapRow8(rows[0]) : null;
  }
  async listForProject(tenantId, projectId) {
    const rows = await this.db.query(
      `SELECT * FROM bids WHERE tenant_id = $1 AND project_id = $2 ORDER BY created_at DESC`,
      [tenantId, projectId]
    );
    return rows.map(mapRow8);
  }
  async updateStatus(bidId, tenantId, status) {
    const rows = await this.db.queryReturning(
      `UPDATE bids SET status = $3 WHERE bid_id = $1 AND tenant_id = $2 RETURNING *`,
      [bidId, tenantId, status]
    );
    return rows[0] ? mapRow8(rows[0]) : null;
  }
  /**
   * Submit a bid: set status=submitted + submitted_at atomically.
   * (Phase 2B.2.1 Me2 fix: submittedAt populated.)
   */
  async submit(bidId, tenantId, submittedAt) {
    const rows = await this.db.queryReturning(
      `UPDATE bids SET status = 'submitted', submitted_at = $3
       WHERE bid_id = $1 AND tenant_id = $2 AND status = 'draft'
       RETURNING *`,
      [bidId, tenantId, submittedAt]
    );
    return rows[0] ? mapRow8(rows[0]) : null;
  }
  /**
   * Record bid outcome: set status + outcome_at + outcome_note atomically.
   */
  async recordOutcome(bidId, tenantId, outcome, outcomeAt, note) {
    const rows = await this.db.queryReturning(
      `UPDATE bids SET status = $3, outcome_at = $4, outcome_note = $5
       WHERE bid_id = $1 AND tenant_id = $2 AND status = 'submitted'
       RETURNING *`,
      [bidId, tenantId, outcome, outcomeAt, note ?? null]
    );
    return rows[0] ? mapRow8(rows[0]) : null;
  }
};

// packages/contractor-core/src/persistence/repositories/magic-link.repository.ts
function mapRow9(r) {
  return {
    tokenHash: r.token_hash,
    email: r.email,
    expiresAt: r.expires_at instanceof Date ? r.expires_at.toISOString() : String(r.expires_at),
    usedAt: r.used_at instanceof Date ? r.used_at.toISOString() : r.used_at ? String(r.used_at) : null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)
  };
}
var MagicLinkRepository = class {
  constructor(db) {
    this.db = db;
  }
  db;
  /**
   * Create a magic-link token. The tokenHash is the SHA-256 of the raw token;
   * the raw token is never stored. Returns the stored record.
   */
  async create(tokenHash, email, expiresAt, createdAt) {
    const rows = await this.db.queryReturning(
      `INSERT INTO magic_links (token_hash, email, expires_at, created_at)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [tokenHash, email, expiresAt, createdAt]
    );
    return mapRow9(rows[0]);
  }
  /**
   * Find an unused, non-expired magic link by token hash. Returns null if not
   * found, already used, or expired.
   */
  async findValid(tokenHash) {
    const rows = await this.db.query(
      `SELECT * FROM magic_links
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
      [tokenHash]
    );
    return rows[0] ? mapRow9(rows[0]) : null;
  }
  /**
   * Consume a magic-link token (mark it used). Single-use enforcement: the
   * UPDATE only succeeds if used_at is still NULL. Returns true if consumed,
   * false if already used (race-safe via the WHERE clause).
   */
  async consume(tokenHash) {
    const result = await this.db.execute(
      `UPDATE magic_links SET used_at = now()
       WHERE token_hash = $1 AND used_at IS NULL`,
      [tokenHash]
    );
    return result.affectedRows > 0;
  }
  /**
   * Delete expired tokens (housekeeping). Returns the number deleted.
   */
  async deleteExpired() {
    const result = await this.db.execute(
      `DELETE FROM magic_links WHERE expires_at < now()`,
      []
    );
    return result.affectedRows;
  }
};

// packages/contractor-core/src/persistence/repositories/waitlist.repository.ts
function mapRow10(r) {
  return {
    id: r.id,
    email: r.email,
    status: r.status,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    approvedBy: r.approved_by,
    approvedAt: r.approved_at instanceof Date ? r.approved_at.toISOString() : r.approved_at ? String(r.approved_at) : null,
    createdUserId: r.created_user_id,
    displayName: r.display_name
  };
}
var WaitlistRepository = class {
  constructor(db) {
    this.db = db;
  }
  db;
  async create(id, email, displayName) {
    const rows = await this.db.queryReturning(
      `INSERT INTO waitlist (id, email, display_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING
       RETURNING *`,
      [id, email.toLowerCase(), displayName]
    );
    if (rows.length === 0) {
      const existing = await this.db.query(`SELECT * FROM waitlist WHERE email = $1`, [email.toLowerCase()]);
      return mapRow10(existing[0]);
    }
    return mapRow10(rows[0]);
  }
  async listPending() {
    const rows = await this.db.query(`SELECT * FROM waitlist WHERE status = 'pending' ORDER BY created_at`);
    return rows.map(mapRow10);
  }
  async listAll() {
    const rows = await this.db.query(`SELECT * FROM waitlist ORDER BY created_at DESC`);
    return rows.map(mapRow10);
  }
  async getById(id) {
    const rows = await this.db.query(`SELECT * FROM waitlist WHERE id = $1`, [id]);
    return rows[0] ? mapRow10(rows[0]) : null;
  }
  async approve(id, approvedBy, createdUserId) {
    const rows = await this.db.queryReturning(
      `UPDATE waitlist SET status = 'approved', approved_by = $2, approved_at = now(), created_user_id = $3
       WHERE id = $1 AND status = 'pending' RETURNING *`,
      [id, approvedBy, createdUserId]
    );
    return rows[0] ? mapRow10(rows[0]) : null;
  }
  async findByEmail(email) {
    const rows = await this.db.query(`SELECT * FROM waitlist WHERE email = $1`, [email.toLowerCase()]);
    return rows[0] ? mapRow10(rows[0]) : null;
  }
};

// packages/contractor-core/src/service/identity.service.ts
init_tenant_context();

// packages/contractor-core/src/domain/ids.ts
import { webcrypto } from "node:crypto";
var CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
var ENCODE_TIME_LEN = 10;
var ENCODE_RAND_LEN = 16;
function encodeTime(now) {
  let ts = Math.floor(now);
  if (ts < 0) ts = 0;
  let out = "";
  for (let i = ENCODE_TIME_LEN - 1; i >= 0; i--) {
    const mod = ts % 32;
    out = CROCKFORD[mod] + out;
    ts = Math.floor(ts / 32);
  }
  return out;
}
function encodeRandom() {
  const bytes = new Uint8Array(ENCODE_RAND_LEN);
  webcrypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < ENCODE_RAND_LEN; i++) {
    out += CROCKFORD[bytes[i] % 32];
  }
  return out;
}
function ulid(now = Date.now()) {
  return encodeTime(now) + encodeRandom();
}
function entityId(prefix, now = Date.now()) {
  return `${prefix}_${ulid(now)}`;
}
var ID_PREFIX = {
  user: "usr",
  authBinding: "auth",
  organization: "org",
  membership: "mbr",
  workspace: "ws",
  project: "proj",
  audit: "aud",
  revision: "rev"
};

// packages/contractor-core/src/service/identity.service.ts
init_errors();
var IdentityService = class {
  constructor(users, memberships) {
    this.users = users;
    this.memberships = memberships;
  }
  users;
  memberships;
  /**
   * Resolve a TenantContext from an authenticated session.
   *
   * The session provides (provider, subject) from the AuthProvider binding.
   * The tenantId is resolved SERVER-SIDE from the membership — never from
   * the client. (Phase 1 section 6: "It must never originate from request
   * body, URL tenantId, frontend selector, hidden form field, client
   * project choice.")
   */
  async resolveTenantContext(provider, subject, tenantId) {
    const binding = await this.users.getBindingBySubject(provider, subject);
    if (!binding) throw new UnauthorizedError("No auth binding for provider/subject");
    const user = await this.users.getById(binding.userId);
    if (!user) throw new UnauthorizedError("User not found for auth binding");
    if (user.status !== "active") throw new UnauthorizedError("User is disabled");
    const membership = await this.memberships.getForUserInTenant(user.id, tenantId);
    const ctx = createTenantContext(tenantId, user.id, membership);
    return { ctx, user, membership };
  }
  async createUser(email, displayName) {
    return this.users.create({
      id: entityId(ID_PREFIX.user),
      email,
      displayName,
      status: "active",
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  async bindAuthProvider(userId, provider, subject) {
    const existing = await this.users.getBindingBySubject(provider, subject);
    if (existing) return existing;
    return this.users.createBinding({
      id: entityId(ID_PREFIX.authBinding),
      userId,
      provider,
      subject,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      lastUsedAt: null
    });
  }
};

// packages/contractor-core/src/service/organization.service.ts
init_tenant_context();
init_errors();
var OrganizationService = class {
  constructor(orgs, memberships, audit) {
    this.orgs = orgs;
    this.memberships = memberships;
    this.audit = audit;
  }
  orgs;
  memberships;
  audit;
  async createOrganization(creatorUserId, name, slug) {
    const existing = await this.orgs.getBySlug(slug);
    if (existing) throw new ConflictError(`Organization slug already exists: ${slug}`);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const orgId = entityId(ID_PREFIX.organization);
    const organization = await this.orgs.create({
      id: orgId,
      tenantId: orgId,
      // tenant_id == org id
      name,
      slug,
      status: "active",
      createdAt: now
    });
    const membership = await this.memberships.create({
      id: entityId(ID_PREFIX.membership),
      userId: creatorUserId,
      organizationId: orgId,
      role: "owner",
      status: "active",
      createdAt: now
    });
    const { createTenantContext: createTenantContext2 } = await Promise.resolve().then(() => (init_tenant_context(), tenant_context_exports));
    const tenantContext = createTenantContext2(orgId, creatorUserId, membership);
    await this.audit.append({
      eventId: entityId(ID_PREFIX.audit),
      tenantId: orgId,
      actorId: creatorUserId,
      actorKind: "user",
      timestamp: now,
      action: "organization.created",
      entityType: "organization",
      entityId: orgId,
      operation: "create",
      metadata: { name, slug }
    });
    return { organization, tenantContext };
  }
  async getOrganization(tenantId, ctx) {
    requirePermission(ctx, "org:read");
    const org = await this.orgs.getById(tenantId, tenantId);
    if (!org) throw new NotFoundError("organization", tenantId);
    return org;
  }
};

// packages/contractor-core/src/service/workspace.service.ts
init_tenant_context();
init_errors();
var WorkspaceService = class {
  constructor(workspaces, audit) {
    this.workspaces = workspaces;
    this.audit = audit;
  }
  workspaces;
  audit;
  async createWorkspace(ctx, name) {
    requirePermission(ctx, "workspace:write");
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const ws = await this.workspaces.create({
      id: entityId(ID_PREFIX.workspace),
      tenantId: ctx.tenantId,
      organizationId: ctx.tenantId,
      // workspace's org == the tenant
      name,
      createdAt: now
    });
    await this.audit.append({
      eventId: entityId(ID_PREFIX.audit),
      tenantId: ctx.tenantId,
      actorId: ctx.actor.kind === "user" ? ctx.actor.userId : ctx.actor.serviceId,
      actorKind: ctx.actor.kind,
      timestamp: now,
      action: "workspace.created",
      entityType: "workspace",
      entityId: ws.id,
      operation: "create",
      metadata: { name }
    });
    return ws;
  }
  async getWorkspace(ctx, workspaceId) {
    requirePermission(ctx, "workspace:read");
    const ws = await this.workspaces.getById(workspaceId, ctx.tenantId);
    if (!ws) throw new NotFoundError("workspace", workspaceId);
    return ws;
  }
  async listWorkspaces(ctx) {
    requirePermission(ctx, "workspace:read");
    return this.workspaces.listForTenant(ctx.tenantId);
  }
};

// packages/contractor-core/src/service/project.service.ts
init_tenant_context();
init_errors();
var ProjectService = class {
  constructor(projects, workspaces, audit) {
    this.projects = projects;
    this.workspaces = workspaces;
    this.audit = audit;
  }
  projects;
  workspaces;
  audit;
  async createProject(ctx, workspaceId, name) {
    requirePermission(ctx, "project:write");
    const ws = await this.workspaces.getById(workspaceId, ctx.tenantId);
    if (!ws) throw new ValidationError(`Workspace not found in this tenant: ${workspaceId}`);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const project = await this.projects.create({
      id: entityId(ID_PREFIX.project),
      tenantId: ctx.tenantId,
      workspaceId,
      name,
      status: "active",
      createdAt: now
    });
    await this.audit.append({
      eventId: entityId(ID_PREFIX.audit),
      tenantId: ctx.tenantId,
      actorId: actorIdOf(ctx),
      actorKind: ctx.actor.kind,
      timestamp: now,
      action: "project.created",
      entityType: "project",
      entityId: project.id,
      operation: "create",
      metadata: { name, workspaceId }
    });
    return project;
  }
  /**
   * Get a project by id, ENFORCING tenant scope.
   * Cross-tenant lookup throws NotFound (existence not leaked). (Phase 1 §21.)
   */
  async getProject(ctx, projectId) {
    requirePermission(ctx, "project:read");
    const project = await this.projects.getById(projectId, ctx.tenantId);
    if (!project) throw new NotFoundError("project", projectId);
    return project;
  }
  async listProjectsForWorkspace(ctx, workspaceId) {
    requirePermission(ctx, "project:read");
    return this.projects.listForWorkspace(workspaceId, ctx.tenantId);
  }
  async listProjectsForTenant(ctx) {
    requirePermission(ctx, "project:read");
    return this.projects.listForTenant(ctx.tenantId);
  }
  async archiveProject(ctx, projectId) {
    requirePermission(ctx, "project:write");
    const project = await this.projects.getById(projectId, ctx.tenantId);
    if (!project) throw new NotFoundError("project", projectId);
    const archived = await this.projects.archive(projectId, ctx.tenantId);
    if (archived) {
      await this.audit.append({
        eventId: entityId(ID_PREFIX.audit),
        tenantId: ctx.tenantId,
        actorId: actorIdOf(ctx),
        actorKind: ctx.actor.kind,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        action: "project.archived",
        entityType: "project",
        entityId: projectId,
        operation: "archive",
        metadata: null
      });
    }
    return archived;
  }
};

// packages/contractor-core/src/service/audit.service.ts
init_tenant_context();
var AuditService = class {
  constructor(audit) {
    this.audit = audit;
  }
  audit;
  /**
   * Record an audit event. Tenant-scoped, append-only.
   * There is NO update or delete — the repository does not expose them.
   */
  async record(ctx, action, entityType, targetEntityId, operation, metadata) {
    requirePermission(ctx, "audit:read");
    return this.audit.append({
      eventId: entityId(ID_PREFIX.audit),
      tenantId: ctx.tenantId,
      actorId: actorIdOf(ctx),
      actorKind: ctx.actor.kind,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      action,
      entityType,
      entityId: targetEntityId,
      operation,
      metadata
    });
  }
  async listForTenant(ctx, limit = 100) {
    requirePermission(ctx, "audit:read");
    return this.audit.listForTenant(ctx.tenantId, limit);
  }
  async listForEntity(ctx, entityType, entityId2, limit = 100) {
    requirePermission(ctx, "audit:read");
    return this.audit.listForEntity(ctx.tenantId, entityType, entityId2, limit);
  }
};

// packages/contractor-core/src/service/revision.service.ts
init_tenant_context();
init_errors();
var RevisionService = class {
  constructor(revisions, projects, audit) {
    this.revisions = revisions;
    this.projects = projects;
    this.audit = audit;
  }
  revisions;
  projects;
  audit;
  /**
   * Create a new draft revision. The contentHash is computed by the caller
   * (the domain layer) using the canonical hashing mechanism. The
   * algorithmVersion records which algorithm + contract produced the
   * derived fields, for deterministic replay. (master prompt §13.)
   */
  async createDraft(ctx, projectId, authorityKind, algorithmVersion, contentHash2, parentRevisionId) {
    requirePermission(ctx, "project:write");
    const project = await this.projects.getById(projectId, ctx.tenantId);
    if (!project) throw new ValidationError(`Project not found in this tenant: ${projectId}`);
    const revision = await this.revisions.createDraft(
      ctx.tenantId,
      projectId,
      authorityKind,
      actorIdOf(ctx),
      algorithmVersion,
      contentHash2,
      parentRevisionId,
      (/* @__PURE__ */ new Date()).toISOString()
    );
    await this.audit.append({
      eventId: entityId(ID_PREFIX.audit),
      tenantId: ctx.tenantId,
      actorId: actorIdOf(ctx),
      actorKind: ctx.actor.kind,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      action: "revision.draft_created",
      entityType: "revision",
      entityId: revision.revisionId,
      operation: "create_draft",
      metadata: { authorityKind, projectId, revisionNumber: revision.revisionNumber }
    });
    return revision;
  }
  /**
   * Finalize a draft revision (draft -> finalized). After this, the
   * revision is IMMUTABLE — no update or delete is possible.
   * (Phase 1 section 14.)
   */
  async finalize(ctx, revisionId) {
    requirePermission(ctx, "revision:finalize");
    const existing = await this.revisions.getById(revisionId, ctx.tenantId);
    if (!existing) throw new NotFoundError("revision", revisionId);
    if (existing.status !== "draft") {
      throw new ValidationError(`Revision is not a draft (status=${existing.status}): ${revisionId}`);
    }
    const finalized = await this.revisions.finalize(revisionId, ctx.tenantId, (/* @__PURE__ */ new Date()).toISOString());
    if (!finalized) throw new NotFoundError("revision", revisionId);
    await this.audit.append({
      eventId: entityId(ID_PREFIX.audit),
      tenantId: ctx.tenantId,
      actorId: actorIdOf(ctx),
      actorKind: ctx.actor.kind,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      action: "revision.finalized",
      entityType: "revision",
      entityId: revisionId,
      operation: "finalize",
      metadata: { authorityKind: existing.authorityKind, contentHash: existing.contentHash }
    });
    return finalized;
  }
  /**
   * Supersede a revision (a newer finalized revision replaces it).
   * The superseded revision remains immutable and present for historical
   * reconstruction. (master prompt §13.)
   */
  async supersede(ctx, revisionId) {
    requirePermission(ctx, "revision:finalize");
    const existing = await this.revisions.getById(revisionId, ctx.tenantId);
    if (!existing) throw new NotFoundError("revision", revisionId);
    const superseded = await this.revisions.supersede(revisionId, ctx.tenantId);
    if (!superseded) throw new NotFoundError("revision", revisionId);
    await this.audit.append({
      eventId: entityId(ID_PREFIX.audit),
      tenantId: ctx.tenantId,
      actorId: actorIdOf(ctx),
      actorKind: ctx.actor.kind,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      action: "revision.superseded",
      entityType: "revision",
      entityId: revisionId,
      operation: "supersede",
      metadata: { authorityKind: existing.authorityKind }
    });
    return superseded;
  }
  async getById(ctx, revisionId) {
    requirePermission(ctx, "revision:read");
    const revision = await this.revisions.getById(revisionId, ctx.tenantId);
    if (!revision) throw new NotFoundError("revision", revisionId);
    return revision;
  }
  async listForProject(ctx, projectId, authorityKind) {
    requirePermission(ctx, "revision:read");
    return this.revisions.listForProject(ctx.tenantId, projectId, authorityKind);
  }
};

// packages/contractor-core/src/service/plan-measurement.service.ts
init_tenant_context();
init_errors();

// packages/contractor-core/src/domain/commercial/plan-measurement.ts
function planMeasurement(input) {
  if (!input.sourceArtifactId) throw new Error("PlanMeasurement: sourceArtifactId required");
  if (!input.sourceArtifactHash) throw new Error("PlanMeasurement: sourceArtifactHash required");
  if (!input.elementReference) throw new Error("PlanMeasurement: elementReference required");
  if (!input.measurementEngineVersion) throw new Error("PlanMeasurement: measurementEngineVersion required");
  return {
    __brand: "PlanMeasurement",
    ...input,
    provisional: input.provisional ?? false
  };
}

// packages/contractor-core/src/service/plan-measurement.service.ts
var PlanMeasurementService = class {
  constructor(db, measurements, projects, audit) {
    this.db = db;
    this.measurements = measurements;
    this.projects = projects;
    this.audit = audit;
  }
  db;
  measurements;
  projects;
  audit;
  async createMeasurement(ctx, projectId, input) {
    requirePermission(ctx, "plan:write");
    const project = await this.projects.getById(projectId, ctx.tenantId);
    if (!project) throw new NotFoundError("project", projectId);
    const { quantityValue, quantityUnit, ...rest } = input;
    const pm = planMeasurement({
      measurementId: entityId(ID_PREFIX.audit),
      quantity: { __brand: "Quantity", value: quantityValue, unit: quantityUnit },
      actorId: actorIdOf(ctx),
      measuredAt: (/* @__PURE__ */ new Date()).toISOString(),
      provisional: false,
      ...rest
    });
    return this.db.tx(async () => {
      const created = await this.measurements.create(pm, ctx.tenantId, projectId);
      await this.audit.append({
        eventId: entityId(ID_PREFIX.audit),
        tenantId: ctx.tenantId,
        actorId: actorIdOf(ctx),
        actorKind: ctx.actor.kind,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        action: "plan.measurement_created",
        entityType: "plan_measurement",
        entityId: created.measurementId,
        operation: "create",
        metadata: { projectId, elementReference: input.elementReference }
      });
      return created;
    });
  }
  async getMeasurement(ctx, measurementId) {
    requirePermission(ctx, "plan:read");
    const pm = await this.measurements.getById(measurementId, ctx.tenantId);
    if (!pm) throw new NotFoundError("plan_measurement", measurementId);
    return pm;
  }
  async listMeasurements(ctx, projectId) {
    requirePermission(ctx, "plan:read");
    return this.measurements.listForProject(ctx.tenantId, projectId);
  }
};

// packages/contractor-core/src/service/boq.service.ts
init_tenant_context();
init_errors();

// packages/contractor-core/src/domain/commercial/boq.ts
function boqItem(input) {
  if (!input.itemCode) throw new Error("BOQItem: itemCode required");
  if (!input.description) throw new Error("BOQItem: description required");
  return {
    __brand: "BOQItem",
    ...input,
    sourceMeasurementIds: input.sourceMeasurementIds ?? []
  };
}

// packages/contractor-core/src/domain/commercial/quantity.ts
function unit(u) {
  if (!u || typeof u !== "string") throw new Error(`Invalid unit: ${u}`);
  return u;
}
var UNITS = {
  SQUARE_METRE: unit("m2"),
  CUBIC_METRE: unit("m3"),
  LINEAR_METRE: unit("m"),
  NUMBER: unit("nos"),
  HOUR: unit("hr"),
  DAY: unit("day"),
  TONNE: unit("t"),
  KILOGRAM: unit("kg"),
  LITRE: unit("l"),
  SET: unit("set")
};
var QUANTITY_DECIMALS = 4;
var QUANTITY_FACTOR = Math.pow(10, QUANTITY_DECIMALS);
function quantity(amount, u) {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`Invalid quantity (negative or non-finite): ${amount}`);
  }
  const uVal = typeof u === "string" ? unit(u) : u;
  const noiseAbsorber = Math.pow(10, QUANTITY_DECIMALS + 6);
  const scaled = Math.round(amount * noiseAbsorber) / (noiseAbsorber / QUANTITY_FACTOR);
  const rounded = bankerRound4(scaled);
  return { __brand: "Quantity", value: rounded / QUANTITY_FACTOR, unit: uVal };
}
function bankerRound4(n) {
  if (!Number.isFinite(n)) return 0;
  const floor = Math.floor(n);
  const frac = n - floor;
  if (frac < 0.5) return floor;
  if (frac > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

// packages/contractor-core/src/service/boq.service.ts
var BOQService = class {
  constructor(db, boqs, projects, audit) {
    this.db = db;
    this.boqs = boqs;
    this.projects = projects;
    this.audit = audit;
  }
  db;
  boqs;
  projects;
  audit;
  async createBOQ(ctx, projectId, name) {
    requirePermission(ctx, "boq:write");
    const project = await this.projects.getById(projectId, ctx.tenantId);
    if (!project) throw new NotFoundError("project", projectId);
    const boqId = entityId(ID_PREFIX.workspace);
    return this.db.tx(async () => {
      const created = await this.boqs.create(boqId, ctx.tenantId, projectId, name);
      await this.audit.append({
        eventId: entityId(ID_PREFIX.audit),
        tenantId: ctx.tenantId,
        actorId: actorIdOf(ctx),
        actorKind: ctx.actor.kind,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        action: "boq.created",
        entityType: "boq",
        entityId: boqId,
        operation: "create",
        metadata: { projectId, name: name ?? null }
      });
      return created;
    });
  }
  async getBOQ(ctx, boqId) {
    requirePermission(ctx, "boq:read");
    const boq = await this.boqs.getById(boqId, ctx.tenantId);
    if (!boq) throw new NotFoundError("boq", boqId);
    return boq;
  }
  async listBOQs(ctx, projectId) {
    requirePermission(ctx, "boq:read");
    return this.boqs.listForProject(ctx.tenantId, projectId);
  }
  async addBOQItem(ctx, boqId, input) {
    requirePermission(ctx, "boq:write");
    const boq = await this.boqs.getById(boqId, ctx.tenantId);
    if (!boq) throw new NotFoundError("boq", boqId);
    const item = boqItem({
      itemId: entityId(ID_PREFIX.project),
      itemCode: input.itemCode,
      description: input.description,
      unit: input.unit,
      quantity: quantity(input.quantityValue, input.quantityUnit),
      provenance: input.provenance,
      sourceMeasurementIds: input.sourceMeasurementIds ?? []
    });
    return this.db.tx(async () => {
      const created = await this.boqs.addItem(item, boqId, ctx.tenantId);
      await this.audit.append({
        eventId: entityId(ID_PREFIX.audit),
        tenantId: ctx.tenantId,
        actorId: actorIdOf(ctx),
        actorKind: ctx.actor.kind,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        action: "boq.item_added",
        entityType: "boq_item",
        entityId: created.itemId,
        operation: "create",
        metadata: { boqId, itemCode: input.itemCode }
      });
      return created;
    });
  }
  async updateBOQItemQuantity(ctx, itemId, quantityValue, quantityUnit) {
    requirePermission(ctx, "boq:write");
    const item = await this.boqs.getItem(itemId, ctx.tenantId);
    if (!item) throw new NotFoundError("boq_item", itemId);
    return this.db.tx(async () => {
      const updated = await this.boqs.updateItemQuantity(itemId, ctx.tenantId, quantityValue, quantityUnit);
      if (updated) {
        await this.audit.append({
          eventId: entityId(ID_PREFIX.audit),
          tenantId: ctx.tenantId,
          actorId: actorIdOf(ctx),
          actorKind: ctx.actor.kind,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          action: "boq.item_quantity_updated",
          entityType: "boq_item",
          entityId: itemId,
          operation: "update",
          metadata: { quantityValue, quantityUnit }
        });
      }
      return updated;
    });
  }
  async getBOQItems(ctx, boqId) {
    requirePermission(ctx, "boq:read");
    return this.boqs.listItems(boqId, ctx.tenantId);
  }
};

// packages/contractor-core/src/service/estimate.service.ts
init_tenant_context();
init_errors();
var EstimateService = class {
  constructor(db, estimates, projects, audit) {
    this.db = db;
    this.estimates = estimates;
    this.projects = projects;
    this.audit = audit;
  }
  db;
  estimates;
  projects;
  audit;
  async createEstimateDraft(ctx, projectId, payload) {
    requirePermission(ctx, "estimate:write");
    const project = await this.projects.getById(projectId, ctx.tenantId);
    if (!project) throw new NotFoundError("project", projectId);
    if (payload.projectId !== projectId) {
      throw new ValidationError(`Payload projectId (${payload.projectId}) does not match the requested project (${projectId})`);
    }
    return this.db.tx(async () => {
      const created = await this.estimates.createDraft(
        ctx.tenantId,
        projectId,
        payload,
        actorIdOf(ctx),
        (/* @__PURE__ */ new Date()).toISOString()
      );
      await this.audit.append({
        eventId: entityId(ID_PREFIX.audit),
        tenantId: ctx.tenantId,
        actorId: actorIdOf(ctx),
        actorKind: ctx.actor.kind,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        action: "estimate.draft_created",
        entityType: "revision",
        entityId: created.metadata.revisionId,
        operation: "create_draft",
        metadata: { projectId, revisionNumber: created.metadata.revisionNumber }
      });
      return created;
    });
  }
  async getEstimateRevision(ctx, revisionId) {
    requirePermission(ctx, "estimate:read");
    const rev = await this.estimates.getById(revisionId, ctx.tenantId);
    if (!rev) throw new NotFoundError("revision", revisionId);
    return rev;
  }
  async listEstimateRevisions(ctx, projectId) {
    requirePermission(ctx, "estimate:read");
    return this.estimates.listForProject(ctx.tenantId, projectId);
  }
  async updateEstimateDraft(ctx, revisionId, payload) {
    requirePermission(ctx, "estimate:write");
    const existing = await this.estimates.getById(revisionId, ctx.tenantId);
    if (!existing) throw new NotFoundError("revision", revisionId);
    if (existing.metadata.status !== "draft") {
      throw new ConflictError(`Cannot update revision ${revisionId}: status is ${existing.metadata.status} (only draft can be updated)`);
    }
    if (payload.projectId !== existing.metadata.projectId) {
      throw new ValidationError(`Payload projectId (${payload.projectId}) does not match the revision's project (${existing.metadata.projectId})`);
    }
    return this.db.tx(async () => {
      const updated = await this.estimates.updateDraftPayload(revisionId, ctx.tenantId, payload);
      if (!updated) throw new NotFoundError("revision", revisionId);
      await this.audit.append({
        eventId: entityId(ID_PREFIX.audit),
        tenantId: ctx.tenantId,
        actorId: actorIdOf(ctx),
        actorKind: ctx.actor.kind,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        action: "estimate.draft_updated",
        entityType: "revision",
        entityId: revisionId,
        operation: "update_draft",
        metadata: { contentHash: updated.metadata.contentHash }
      });
      return updated;
    });
  }
  async finalizeEstimate(ctx, revisionId) {
    requirePermission(ctx, "estimate:finalize");
    const existing = await this.estimates.getById(revisionId, ctx.tenantId);
    if (!existing) throw new NotFoundError("revision", revisionId);
    if (existing.metadata.status !== "draft") {
      throw new ConflictError(`Cannot finalize revision ${revisionId}: status is ${existing.metadata.status}`);
    }
    const calculatedHash = estimateRevisionContentHash(existing.payload);
    if (calculatedHash !== existing.metadata.contentHash) {
      throw new ConflictError(
        `Cannot finalize revision ${revisionId}: stored content hash (${existing.metadata.contentHash}) does not match recalculated hash (${calculatedHash})`,
        { revisionId, storedHash: existing.metadata.contentHash, calculatedHash }
      );
    }
    return this.db.tx(async () => {
      const finalized = await this.estimates.finalize(revisionId, ctx.tenantId, (/* @__PURE__ */ new Date()).toISOString());
      if (!finalized) throw new NotFoundError("revision", revisionId);
      await this.audit.append({
        eventId: entityId(ID_PREFIX.audit),
        tenantId: ctx.tenantId,
        actorId: actorIdOf(ctx),
        actorKind: ctx.actor.kind,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        action: "estimate.finalized",
        entityType: "revision",
        entityId: revisionId,
        operation: "finalize",
        metadata: { contentHash: finalized.metadata.contentHash }
      });
      return finalized;
    });
  }
  async supersedeEstimate(ctx, revisionId) {
    requirePermission(ctx, "estimate:finalize");
    const existing = await this.estimates.getById(revisionId, ctx.tenantId);
    if (!existing) throw new NotFoundError("revision", revisionId);
    if (existing.metadata.status !== "finalized") {
      throw new ConflictError(`Cannot supersede revision ${revisionId}: status is ${existing.metadata.status} (only finalized can be superseded)`);
    }
    return this.db.tx(async () => {
      const superseded = await this.estimates.supersede(revisionId, ctx.tenantId);
      if (!superseded) throw new NotFoundError("revision", revisionId);
      await this.audit.append({
        eventId: entityId(ID_PREFIX.audit),
        tenantId: ctx.tenantId,
        actorId: actorIdOf(ctx),
        actorKind: ctx.actor.kind,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        action: "estimate.superseded",
        entityType: "revision",
        entityId: revisionId,
        operation: "supersede",
        metadata: null
      });
      return superseded;
    });
  }
  async replayEstimate(ctx, revisionId) {
    requirePermission(ctx, "estimate:read");
    const rev = await this.estimates.getById(revisionId, ctx.tenantId);
    if (!rev) throw new NotFoundError("revision", revisionId);
    const calculatedHash = estimateRevisionContentHash(rev.payload);
    const totals = replayEstimateRevision(rev);
    return {
      contentHashMatches: calculatedHash === rev.metadata.contentHash,
      storedHash: rev.metadata.contentHash,
      calculatedHash,
      totals
    };
  }
};

// packages/contractor-core/src/domain/commercial/bid.ts
function validateBidSubmission(bid2, revision) {
  const errors = [];
  if (!bid2.estimateRevisionId) {
    errors.push("Bid cannot be submitted without an estimateRevisionId.");
  }
  if (!revision) {
    errors.push("The referenced estimate revision does not exist.");
  } else if (revision.metadata.status !== "finalized") {
    errors.push(`The referenced estimate revision is not finalized (status=${revision.metadata.status}).`);
  }
  if (!bid2.finalPrice) {
    errors.push("Final price is not set \u2014 cannot submit.");
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}
function bid(input) {
  if (!input.bidId) throw new Error("Bid: bidId required");
  if (!input.projectId) throw new Error("Bid: projectId required");
  if (!input.estimateRevisionId) throw new Error("Bid: estimateRevisionId required");
  if (!input.estimateRevisionContentHash) throw new Error("Bid: estimateRevisionContentHash required");
  return {
    __brand: "Bid",
    bidId: input.bidId,
    projectId: input.projectId,
    estimateRevisionId: input.estimateRevisionId,
    estimateRevisionContentHash: input.estimateRevisionContentHash,
    status: input.status,
    finalPrice: input.finalPrice ?? null,
    directorAdjustment: input.directorAdjustment ?? null,
    adjustmentRationale: input.adjustmentRationale ?? null,
    submittedAt: input.submittedAt ?? null,
    outcomeAt: input.outcomeAt ?? null,
    outcomeNote: input.outcomeNote ?? null
  };
}

// packages/contractor-core/src/service/bid.service.ts
init_tenant_context();
init_errors();
var TERMINAL_STATUSES = /* @__PURE__ */ new Set(["won", "lost", "withdrawn"]);
var BidService = class {
  constructor(db, bids, estimates, audit) {
    this.db = db;
    this.bids = bids;
    this.estimates = estimates;
    this.audit = audit;
  }
  db;
  bids;
  estimates;
  audit;
  async createBid(ctx, projectId, estimateRevisionId, finalPrice, directorAdjustment = null, adjustmentRationale = null) {
    requirePermission(ctx, "bid:write");
    const revision = await this.estimates.getById(estimateRevisionId, ctx.tenantId);
    if (!revision) {
      throw new NotFoundError("revision", estimateRevisionId);
    }
    if (revision.metadata.projectId !== projectId) {
      throw new ValidationError(
        `Bid project (${projectId}) does not match estimate revision project (${revision.metadata.projectId})`
      );
    }
    const actualHash = estimateRevisionContentHash(revision.payload);
    const b = bid({
      bidId: entityId(ID_PREFIX.audit),
      projectId,
      estimateRevisionId,
      estimateRevisionContentHash: actualHash,
      status: "draft",
      finalPrice,
      directorAdjustment,
      adjustmentRationale
    });
    return this.db.tx(async () => {
      const created = await this.bids.create(b, ctx.tenantId);
      await this.audit.append({
        eventId: entityId(ID_PREFIX.audit),
        tenantId: ctx.tenantId,
        actorId: actorIdOf(ctx),
        actorKind: ctx.actor.kind,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        action: "bid.created",
        entityType: "bid",
        entityId: created.bidId,
        operation: "create",
        metadata: { projectId, estimateRevisionId }
      });
      return created;
    });
  }
  async getBid(ctx, bidId) {
    requirePermission(ctx, "bid:read");
    const b = await this.bids.getById(bidId, ctx.tenantId);
    if (!b) throw new NotFoundError("bid", bidId);
    return b;
  }
  async listBids(ctx, projectId) {
    requirePermission(ctx, "bid:read");
    return this.bids.listForProject(ctx.tenantId, projectId);
  }
  async submitBid(ctx, bidId) {
    requirePermission(ctx, "bid:submit");
    const bid2 = await this.bids.getById(bidId, ctx.tenantId);
    if (!bid2) throw new NotFoundError("bid", bidId);
    if (bid2.status !== "draft") {
      throw new ConflictError(`Cannot submit bid ${bidId}: status is ${bid2.status} (only draft can be submitted)`);
    }
    const revision = await this.estimates.getById(bid2.estimateRevisionId, ctx.tenantId);
    if (!revision) {
      throw new NotFoundError("revision", bid2.estimateRevisionId);
    }
    const actualHash = estimateRevisionContentHash(revision.payload);
    if (bid2.estimateRevisionContentHash !== actualHash) {
      throw new ConflictError(
        `Bid content hash (${bid2.estimateRevisionContentHash}) does not match the revision's actual hash (${actualHash})`,
        { bidId, storedHash: bid2.estimateRevisionContentHash, actualHash }
      );
    }
    const validation = validateBidSubmission(bid2, revision);
    if (!validation.ok) {
      throw new ValidationError(`Bid submission validation failed: ${validation.errors.join("; ")}`);
    }
    const submittedAt = (/* @__PURE__ */ new Date()).toISOString();
    return this.db.tx(async () => {
      const updated = await this.bids.submit(bidId, ctx.tenantId, submittedAt);
      if (!updated) throw new NotFoundError("bid", bidId);
      await this.audit.append({
        eventId: entityId(ID_PREFIX.audit),
        tenantId: ctx.tenantId,
        actorId: actorIdOf(ctx),
        actorKind: ctx.actor.kind,
        timestamp: submittedAt,
        action: "bid.submitted",
        entityType: "bid",
        entityId: bidId,
        operation: "submit",
        metadata: { estimateRevisionId: bid2.estimateRevisionId }
      });
      return updated;
    });
  }
  async recordBidOutcome(ctx, bidId, outcome, note) {
    requirePermission(ctx, "bid:submit");
    const bid2 = await this.bids.getById(bidId, ctx.tenantId);
    if (!bid2) throw new NotFoundError("bid", bidId);
    if (bid2.status !== "submitted") {
      throw new ConflictError(`Cannot record outcome for bid ${bidId}: status is ${bid2.status} (only submitted bids can have outcomes)`);
    }
    if (TERMINAL_STATUSES.has(bid2.status)) {
      throw new ConflictError(`Cannot record outcome for bid ${bidId}: status ${bid2.status} is terminal`);
    }
    const outcomeAt = (/* @__PURE__ */ new Date()).toISOString();
    return this.db.tx(async () => {
      const updated = await this.bids.recordOutcome(bidId, ctx.tenantId, outcome, outcomeAt, note);
      if (!updated) throw new NotFoundError("bid", bidId);
      await this.audit.append({
        eventId: entityId(ID_PREFIX.audit),
        tenantId: ctx.tenantId,
        actorId: actorIdOf(ctx),
        actorKind: ctx.actor.kind,
        timestamp: outcomeAt,
        action: `bid.${outcome}`,
        entityType: "bid",
        entityId: bidId,
        operation: outcome,
        metadata: { note: note ?? null }
      });
      return updated;
    });
  }
  async withdrawBid(ctx, bidId) {
    requirePermission(ctx, "bid:submit");
    const bid2 = await this.bids.getById(bidId, ctx.tenantId);
    if (!bid2) throw new NotFoundError("bid", bidId);
    if (TERMINAL_STATUSES.has(bid2.status)) {
      throw new ConflictError(`Cannot withdraw bid ${bidId}: status ${bid2.status} is terminal`);
    }
    return this.db.tx(async () => {
      const updated = await this.bids.updateStatus(bidId, ctx.tenantId, "withdrawn");
      if (!updated) throw new NotFoundError("bid", bidId);
      await this.audit.append({
        eventId: entityId(ID_PREFIX.audit),
        tenantId: ctx.tenantId,
        actorId: actorIdOf(ctx),
        actorKind: ctx.actor.kind,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        action: "bid.withdrawn",
        entityType: "bid",
        entityId: bidId,
        operation: "withdraw",
        metadata: null
      });
      return updated;
    });
  }
};

// packages/contractor-core/src/api/core-api.ts
init_errors();
init_errors();

// packages/contractor-core/src/api/commercial-routes.ts
init_errors();

// packages/contractor-core/src/api/commercial-mappers.ts
function mapMoney(m) {
  if (!m) return null;
  return { amount: m.amount, currency: m.currency };
}
function mapEstimateRevision(r) {
  return {
    revisionId: r.metadata.revisionId,
    tenantId: r.metadata.tenantId,
    projectId: r.metadata.projectId,
    authorityKind: r.metadata.authorityKind,
    revisionNumber: r.metadata.revisionNumber,
    status: r.metadata.status,
    createdBy: r.metadata.createdBy,
    createdAt: r.metadata.createdAt,
    finalizedAt: r.metadata.finalizedAt ?? null,
    algorithmVersion: r.metadata.algorithmVersion,
    contentHash: r.metadata.contentHash,
    payload: mapEstimatePayload(r.payload)
  };
}
function mapEstimatePayload(p) {
  return {
    projectId: p.projectId,
    currency: p.currency,
    policy: {
      overheadPct: p.policy.overheadPct,
      contingencyPct: p.policy.contingencyPct,
      targetProfitMode: p.policy.targetProfitMode,
      targetProfitRatio: p.policy.targetProfitRatio
    },
    lines: p.lines.map((l) => ({
      lineId: l.lineId,
      boqItemId: l.boqItemId,
      description: l.description,
      quantity: { value: l.quantity.value, unit: l.quantity.unit },
      costBasis: l.costBasis,
      rate: mapMoney(l.rate),
      pricingStrategy: l.pricingStrategy,
      pricingRatio: l.pricingRatio
    })),
    note: p.note,
    pricingAlgorithmVersion: p.pricingAlgorithmVersion
  };
}
function mapEstimateReplay(revisionId, replay) {
  return {
    revisionId,
    contentHashMatches: replay.contentHashMatches,
    storedHash: replay.storedHash,
    calculatedHash: replay.calculatedHash,
    totals: mapTotals(replay.totals)
  };
}
function mapTotals(t) {
  return {
    totalLineCost: mapMoney(t.totalLineCost),
    overhead: mapMoney(t.overhead),
    contingency: mapMoney(t.contingency),
    totalCost: mapMoney(t.totalCost),
    profit: mapMoney(t.profit),
    sellPrice: mapMoney(t.sellPrice),
    grossProfit: mapMoney(t.grossProfit),
    grossMargin: t.grossMargin
  };
}
function mapBid(b) {
  return {
    bidId: b.bidId,
    projectId: b.projectId,
    estimateRevisionId: b.estimateRevisionId,
    estimateRevisionContentHash: b.estimateRevisionContentHash,
    status: b.status,
    finalPrice: mapMoney(b.finalPrice),
    directorAdjustment: mapMoney(b.directorAdjustment),
    adjustmentRationale: b.adjustmentRationale,
    submittedAt: b.submittedAt,
    outcomeAt: b.outcomeAt,
    outcomeNote: b.outcomeNote
  };
}
function mapBOQ(b) {
  return {
    boqId: b.boqId,
    projectId: b.projectId
  };
}
function mapBOQItem(item) {
  return {
    itemId: item.itemId,
    itemCode: item.itemCode,
    description: item.description,
    unit: item.unit,
    quantity: { value: item.quantity.value, unit: item.quantity.unit },
    provenance: item.provenance,
    sourceMeasurementIds: item.sourceMeasurementIds
  };
}
function mapPlanMeasurement(pm) {
  return {
    measurementId: pm.measurementId,
    sourceArtifactId: pm.sourceArtifactId,
    sourceArtifactHash: pm.sourceArtifactHash,
    sheetId: pm.sheetId,
    sheetRevision: pm.sheetRevision,
    elementReference: pm.elementReference,
    quantity: { value: pm.quantity.value, unit: pm.quantity.unit },
    measurementMethod: pm.measurementMethod,
    measurementBasis: pm.measurementBasis,
    measurementEngineVersion: pm.measurementEngineVersion,
    actorId: pm.actorId,
    measuredAt: pm.measuredAt,
    provisional: pm.provisional
  };
}

// packages/contractor-core/src/domain/commercial/estimate-line.ts
function estimateLine(input) {
  if (!input.lineId) throw new Error("EstimateLine: lineId required");
  if (!input.description) throw new Error("EstimateLine: description required");
  if (input.pricingStrategy === "margin" && input.pricingRatio >= 1) {
    throw new Error(`EstimateLine: margin must be < 1, got ${input.pricingRatio}`);
  }
  return {
    __brand: "EstimateLine",
    lineId: input.lineId,
    boqItemId: input.boqItemId,
    description: input.description,
    quantity: input.quantity,
    costBasis: input.costBasis,
    rate: input.rate,
    pricingStrategy: input.pricingStrategy,
    pricingRatio: input.pricingRatio,
    currency: input.rate.currency
  };
}

// packages/contractor-core/src/api/commercial-routes.ts
async function routeCommercial(segments, method, body, ctx, services) {
  if (segments[0] === "projects" && segments[2] === "measurements") {
    const projectId = segments[1];
    if (method === "POST") {
      const b = asObject(body);
      const pm = await services.measurements.createMeasurement(ctx, projectId, {
        sourceArtifactId: asString(b, "sourceArtifactId"),
        sourceArtifactHash: asString(b, "sourceArtifactHash"),
        sheetId: asStringOrNull(b, "sheetId"),
        sheetRevision: asStringOrNull(b, "sheetRevision"),
        elementReference: asString(b, "elementReference"),
        quantityValue: asNumber(b, "quantityValue"),
        quantityUnit: asString(b, "quantityUnit"),
        measurementMethod: asEnum(b, "measurementMethod", ["manual-takeoff", "auto-takeoff", "ai-proposed", "imported"]),
        measurementBasis: asEnum(b, "measurementBasis", ["count", "length", "area", "volume", "mass", "time"]),
        measurementEngineVersion: asString(b, "measurementEngineVersion")
      });
      return ok(mapPlanMeasurement(pm));
    }
    if (method === "GET") {
      const list = await services.measurements.listMeasurements(ctx, projectId);
      return ok(list.map(mapPlanMeasurement));
    }
  }
  if (segments[0] === "measurements" && segments[1] && !segments[2]) {
    if (method === "GET") {
      const pm = await services.measurements.getMeasurement(ctx, segments[1]);
      return ok(mapPlanMeasurement(pm));
    }
  }
  if (segments[0] === "projects" && segments[2] === "boqs") {
    const projectId = segments[1];
    if (method === "POST") {
      const b = asObject(body);
      const boq = await services.boqs.createBOQ(ctx, projectId, asStringOrNull(b, "name") ?? void 0);
      return ok(mapBOQ(boq));
    }
    if (method === "GET") {
      const list = await services.boqs.listBOQs(ctx, projectId);
      return ok(list.map(mapBOQ));
    }
  }
  if (segments[0] === "boqs" && segments[1]) {
    const boqId = segments[1];
    if (method === "GET" && !segments[2]) {
      const boq = await services.boqs.getBOQ(ctx, boqId);
      return ok(mapBOQ(boq));
    }
    if (method === "POST" && segments[2] === "items") {
      const b = asObject(body);
      const item = await services.boqs.addBOQItem(ctx, boqId, {
        itemCode: asString(b, "itemCode"),
        description: asString(b, "description"),
        unit: asString(b, "unit"),
        quantityValue: asNumber(b, "quantityValue"),
        quantityUnit: asString(b, "quantityUnit"),
        provenance: asEnum(b, "provenance", ["plan-measurement", "imported", "manual"]),
        sourceMeasurementIds: asStringArray(b, "sourceMeasurementIds")
      });
      return ok(mapBOQItem(item));
    }
    if (method === "GET" && segments[2] === "items") {
      const items = await services.boqs.getBOQItems(ctx, boqId);
      return ok(items.map(mapBOQItem));
    }
  }
  if (segments[0] === "boq-items" && segments[1] && segments[2] === "quantity" && !segments[3]) {
    if (method === "PATCH") {
      const b = asObject(body);
      const updated = await services.boqs.updateBOQItemQuantity(
        ctx,
        segments[1],
        asNumber(b, "quantityValue"),
        asString(b, "quantityUnit")
      );
      return ok({ updated });
    }
  }
  if (segments[0] === "projects" && segments[2] === "estimates") {
    const projectId = segments[1];
    if (method === "POST") {
      const payload = parseEstimatePayload(asObject(body), projectId);
      const rev = await services.estimates.createEstimateDraft(ctx, projectId, payload);
      return ok(mapEstimateRevision(rev));
    }
    if (method === "GET") {
      const list = await services.estimates.listEstimateRevisions(ctx, projectId);
      return ok(list.map(mapEstimateRevision));
    }
  }
  if (segments[0] === "estimates" && segments[1]) {
    const revisionId = segments[1];
    if (method === "GET" && !segments[2]) {
      const rev = await services.estimates.getEstimateRevision(ctx, revisionId);
      return ok(mapEstimateRevision(rev));
    }
    if (method === "PATCH" && !segments[2]) {
      const existing = await services.estimates.getEstimateRevision(ctx, revisionId);
      const payload = parseEstimatePayload(asObject(body), existing.metadata.projectId);
      const updated = await services.estimates.updateEstimateDraft(ctx, revisionId, payload);
      return ok(mapEstimateRevision(updated));
    }
    if (method === "POST" && segments[2] === "finalize" && !segments[3]) {
      const finalized = await services.estimates.finalizeEstimate(ctx, revisionId);
      return ok(mapEstimateRevision(finalized));
    }
    if (method === "POST" && segments[2] === "supersede" && !segments[3]) {
      const superseded = await services.estimates.supersedeEstimate(ctx, revisionId);
      return ok(mapEstimateRevision(superseded));
    }
    if (method === "GET" && segments[2] === "replay" && !segments[3]) {
      const replay = await services.estimates.replayEstimate(ctx, revisionId);
      return ok(mapEstimateReplay(revisionId, replay));
    }
  }
  if (segments[0] === "projects" && segments[2] === "bids") {
    const projectId = segments[1];
    if (method === "POST") {
      const b = asObject(body);
      const bid2 = await services.bids.createBid(
        ctx,
        projectId,
        asString(b, "estimateRevisionId"),
        parseMoney(b, "finalPrice"),
        parseMoneyOrNull(b, "directorAdjustment"),
        asStringOrNull(b, "adjustmentRationale")
      );
      return ok(mapBid(bid2));
    }
    if (method === "GET") {
      const list = await services.bids.listBids(ctx, projectId);
      return ok(list.map(mapBid));
    }
  }
  if (segments[0] === "bids" && segments[1]) {
    const bidId = segments[1];
    if (method === "GET" && !segments[2]) {
      const bid2 = await services.bids.getBid(ctx, bidId);
      return ok(mapBid(bid2));
    }
    if (method === "POST" && segments[2] === "submit" && !segments[3]) {
      const submitted = await services.bids.submitBid(ctx, bidId);
      return ok(mapBid(submitted));
    }
    if (method === "POST" && segments[2] === "outcome" && !segments[3]) {
      const b = asObject(body);
      const outcome = asEnum(b, "outcome", ["won", "lost"]);
      const note = asStringOrNull(b, "note") ?? void 0;
      const updated = await services.bids.recordBidOutcome(ctx, bidId, outcome, note);
      return ok(mapBid(updated));
    }
    if (method === "POST" && segments[2] === "withdraw" && !segments[3]) {
      const withdrawn = await services.bids.withdrawBid(ctx, bidId);
      return ok(mapBid(withdrawn));
    }
  }
  return null;
}
function parseEstimatePayload(b, expectedProjectId) {
  const projectId = asString(b, "projectId");
  if (projectId !== expectedProjectId) {
    throw new ValidationError(`Payload projectId (${projectId}) does not match the route project (${expectedProjectId})`);
  }
  const currencyStr = asString(b, "currency");
  const policyRaw = asObjectField(b, "policy");
  const linesRaw = asArrayField(b, "lines");
  return estimateRevisionPayload({
    projectId,
    currency: currencyCode(currencyStr),
    policy: {
      overheadPct: ratio(asNumber(policyRaw, "overheadPct")),
      contingencyPct: ratio(asNumber(policyRaw, "contingencyPct")),
      targetProfitMode: asEnum(policyRaw, "targetProfitMode", ["markup", "margin"]),
      targetProfitRatio: ratio(asNumber(policyRaw, "targetProfitRatio"))
    },
    lines: linesRaw.map((l, i) => {
      const lineObj = asObjectValue(l, `lines[${i}]`);
      return estimateLine({
        lineId: asString(lineObj, "lineId"),
        boqItemId: asStringOrNull(lineObj, "boqItemId"),
        description: asString(lineObj, "description"),
        quantity: quantity(asNumber(lineObj, "quantityValue"), asString(lineObj, "quantityUnit")),
        costBasis: asEnum(lineObj, "costBasis", ["unit-rate", "lump-sum", "provisional", "scheduled"]),
        rate: moneyFromMinor(asNumber(lineObj, "rateMinor"), currencyStr),
        pricingStrategy: asEnum(lineObj, "pricingStrategy", ["markup", "margin"]),
        pricingRatio: ratio(asNumber(lineObj, "pricingRatio"))
      });
    }),
    note: asStringOrNull(b, "note"),
    pricingAlgorithmVersion: asString(b, "pricingAlgorithmVersion")
  });
}
function parseMoney(b, field) {
  const raw = b[field];
  if (raw === null || raw === void 0) return null;
  if (typeof raw !== "object") throw new ValidationError(`'${field}' must be an object { amount, currency }`);
  const o = raw;
  return moneyFromMinor(asNumber(o, "amount"), asString(o, "currency"));
}
function parseMoneyOrNull(b, field) {
  if (!(field in b) || b[field] === null || b[field] === void 0) return null;
  return parseMoney(b, field);
}
function ok(body) {
  return { status: 200, body };
}
function asObject(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("Request body must be a JSON object");
  }
  return body;
}
function asObjectField(b, field) {
  const v = b[field];
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    throw new ValidationError(`Field '${field}' must be an object`);
  }
  return v;
}
function asArrayField(b, field) {
  const v = b[field];
  if (!Array.isArray(v)) throw new ValidationError(`Field '${field}' must be an array`);
  return v;
}
function asObjectValue(v, ctx) {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    throw new ValidationError(`Field '${ctx}' must be an object`);
  }
  return v;
}
function asString(b, field) {
  const v = b[field];
  if (typeof v !== "string" || v.length === 0) {
    throw new ValidationError(`Field '${field}' must be a non-empty string`);
  }
  return v;
}
function asStringOrNull(b, field) {
  const v = b[field];
  if (v === null || v === void 0) return null;
  if (typeof v !== "string") throw new ValidationError(`Field '${field}' must be a string or null`);
  return v;
}
function asStringArray(b, field) {
  const v = b[field];
  if (v === void 0 || v === null) return [];
  if (!Array.isArray(v)) throw new ValidationError(`Field '${field}' must be an array of strings`);
  return v.map((x, i) => {
    if (typeof x !== "string") throw new ValidationError(`Field '${field}[${i}]' must be a string`);
    return x;
  });
}
function asNumber(b, field) {
  const v = b[field];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new ValidationError(`Field '${field}' must be a finite number`);
  }
  return v;
}
function asEnum(b, field, allowed) {
  const v = b[field];
  if (typeof v !== "string" || !allowed.includes(v)) {
    throw new ValidationError(`Field '${field}' must be one of: ${allowed.join(", ")}`);
  }
  return v;
}

// packages/contractor-core/src/api/core-api.ts
var CoreApi = class {
  constructor(services, sessionResolver) {
    this.services = services;
    this.sessionResolver = sessionResolver;
  }
  services;
  sessionResolver;
  async handle(req) {
    try {
      const authHeader = req.headers["authorization"] ?? "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : void 0;
      const session = await this.sessionResolver.resolveSession(token);
      if (!session) {
        return errorResponse(new UnauthenticatedError());
      }
      const { ctx } = await this.services.identity.resolveTenantContext(
        session.provider,
        session.subject,
        session.tenantId
      );
      return await this.route(req, ctx);
    } catch (e) {
      const de = asDomainError(e);
      if (de) return errorResponse(de);
      return { status: 500, body: { error: "internal_error" } };
    }
  }
  async route(req, ctx) {
    const segments = req.path.split("/").filter(Boolean);
    const commercialServices = {
      measurements: this.services.measurements,
      boqs: this.services.boqs,
      estimates: this.services.estimates,
      bids: this.services.bids
    };
    const commercial = await routeCommercial(segments, req.method, req.body, ctx, commercialServices);
    if (commercial) return commercial;
    const [resource, id] = segments;
    switch (resource) {
      case "workspaces":
        if (req.method === "GET" && !id) return json(await this.services.workspaces.listWorkspaces(ctx));
        if (req.method === "POST" && !id) return json(await this.services.workspaces.createWorkspace(ctx, asString2(req.body, "name")));
        if (req.method === "GET" && id) return json(await this.services.workspaces.getWorkspace(ctx, id));
        break;
      case "projects":
        if (req.method === "POST" && !id) {
          const b = asObject2(req.body, ["workspaceId", "name"]);
          return json(await this.services.projects.createProject(ctx, b.workspaceId, b.name));
        }
        if (req.method === "GET" && id) return json(await this.services.projects.getProject(ctx, id));
        if (req.method === "GET" && !id) return json(await this.services.projects.listProjectsForTenant(ctx));
        if (req.method === "GET" && id && req.path.endsWith("projects/" + id)) return json(await this.services.projects.getProject(ctx, id));
        break;
      case "audit":
        if (req.method === "GET" && !id) return json(await this.services.audit.listForTenant(ctx));
        break;
      case "revisions":
        if (req.method === "POST" && !id) {
          const b = asObject2(req.body, ["projectId", "authorityKind", "algorithmVersion", "contentHash"]);
          return json(await this.services.revisions.createDraft(ctx, b.projectId, b.authorityKind, b.algorithmVersion, b.contentHash, null));
        }
        if (req.method === "GET" && id) return json(await this.services.revisions.getById(ctx, id));
        if (req.method === "POST" && id && req.path.endsWith("/finalize"))
          return json(await this.services.revisions.finalize(ctx, id));
        break;
    }
    return { status: 404, body: { error: "not_found" } };
  }
};
function json(body) {
  return { status: 200, body };
}
function errorResponse(e, _fallbackMsg) {
  return {
    status: httpStatusForError(e.kind),
    body: { error: e.kind, message: e.message, details: e.details }
  };
}
function asString2(body, field) {
  if (body && typeof body === "object" && field in body) {
    const v = body[field];
    if (typeof v === "string") return v;
  }
  throw new Error(`validation: missing string field '${field}'`);
}
function asObject2(body, fields) {
  if (!body || typeof body !== "object") throw new Error("validation: body is not an object");
  const obj = body;
  const result = {};
  for (const f of fields) {
    const v = obj[f];
    if (typeof v !== "string") throw new Error(`validation: missing string field '${f}'`);
    result[f] = v;
  }
  return result;
}

// packages/web-host/src/session.ts
import { createHmac, timingSafeEqual } from "node:crypto";
var COOKIE_NAME = "cg_session";
var SIG_BYTES = 32;
function signSession(payload, secret) {
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadJson, "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}
function verifySession(token, secret) {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expectedSig = createHmac("sha256", secret).update(payloadB64).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payloadJson = Buffer.from(payloadB64, "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson);
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1e3)) return null;
    if (typeof payload.userId !== "string" || payload.userId.length === 0) return null;
    return payload;
  } catch {
    return null;
  }
}
function sessionCookieHeader(token, ttlSeconds, secure) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${ttlSeconds}`,
    "Path=/"
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
function clearSessionCookieHeader(secure) {
  const parts = [`${COOKIE_NAME}=`, "HttpOnly", "SameSite=Strict", "Max-Age=0", "Path=/"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
function readSessionCookie(cookieHeader) {
  if (!cookieHeader) return void 0;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${COOKIE_NAME}=`)) {
      return trimmed.slice(COOKIE_NAME.length + 1);
    }
  }
  return void 0;
}
function validateSessionConfig(cfg) {
  if (!cfg.sessionSecret || cfg.sessionSecret.length < SIG_BYTES) {
    throw new Error(
      `CG_SESSION_SECRET must be set to at least ${SIG_BYTES} bytes. Refusing to start without a valid session secret.`
    );
  }
  if (cfg.devAuthEnabled && cfg.devCredential === null) {
    throw new Error(
      "DEV auth is enabled (CONTRACTOR_DEV_AUTH=1) but CG_DEV_CREDENTIAL is not set. Refusing to start without a dev credential."
    );
  }
  if (cfg.devAuthEnabled && process.env.NODE_ENV === "production") {
    throw new Error(
      "DEV auth (CONTRACTOR_DEV_AUTH=1) is forbidden in production (NODE_ENV=production). Refusing to start. Wire a real auth provider instead (ADR-0008 D4)."
    );
  }
}
function loadSessionConfigFromEnv() {
  const sessionSecret = process.env.CG_SESSION_SECRET ?? "";
  const devAuthEnabled = process.env.CONTRACTOR_DEV_AUTH === "1" && process.env.NODE_ENV !== "production";
  const devCredential = process.env.CG_DEV_CREDENTIAL ?? null;
  const sessionTtlSeconds = Number(process.env.CG_SESSION_TTL_SECONDS ?? 86400);
  const cfg = { sessionSecret, sessionTtlSeconds, devAuthEnabled, devCredential };
  validateSessionConfig(cfg);
  return cfg;
}

// packages/web-host/src/resolver.ts
var WebSessionResolver = class {
  constructor(deps) {
    this.deps = deps;
  }
  deps;
  async resolveSession(token) {
    const payload = this.resolvePayload(token);
    if (!payload) return null;
    if (!payload.selectedMembershipId) return null;
    const userMemberships = await this.deps.memberships.listTenantsForUser(payload.userId);
    const found = userMemberships.find((m) => m.id === payload.selectedMembershipId);
    if (!found) return null;
    return { provider: "web", subject: payload.userId, tenantId: found.organizationId };
  }
  /**
   * Resolve the session payload (without a tenant) — used by auth routes
   * that need the userId but not a tenant context (login, tenant selection).
   */
  resolvePayload(token) {
    const sessionToken = readSessionCookie(token);
    return verifySession(sessionToken, this.deps.config.sessionSecret);
  }
};

// packages/web-host/src/magic-link.ts
import { createHash as createHash2, createHmac as createHmac2, randomBytes } from "node:crypto";

// packages/contractor-core/src/domain/index.ts
init_errors();
init_tenant_context();
init_membership();

// packages/web-host/src/magic-link.ts
var TOKEN_BYTES = 32;
var MagicLinkAuthService = class {
  constructor(users, magicLinks, config) {
    this.users = users;
    this.magicLinks = magicLinks;
    this.config = config;
  }
  users;
  magicLinks;
  config;
  /**
   * Step 1: generate + store a magic-link token for the given email.
   * Returns the raw token + link URL. The caller delivers the link.
   */
  async requestLink(email) {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("valid email required");
    }
    const raw = randomBytes(TOKEN_BYTES).toString("base64url");
    const signed = `${raw}.${createHmac2("sha256", this.config.linkSecret).update(raw).digest("base64url")}`;
    const tokenHash = createHash2("sha256").update(signed).digest("hex");
    const now = Date.now();
    const expiresAt = new Date(now + this.config.linkTtlSeconds * 1e3).toISOString();
    await this.magicLinks.create(tokenHash, email.toLowerCase(), expiresAt, new Date(now).toISOString());
    const linkUrl = `${this.config.appBaseUrl}/api/auth/verify?token=${encodeURIComponent(signed)}`;
    return { token: signed, linkUrl, email };
  }
  /**
   * Step 2: verify a magic-link token. Consumes it (single-use), resolves or
   * creates the User + AuthProviderBinding, returns the userId. The caller
   * issues the session cookie.
   */
  async verifyLink(rawToken) {
    const tokenHash = createHash2("sha256").update(rawToken).digest("hex");
    const link = await this.magicLinks.findValid(tokenHash);
    if (!link) {
      throw new Error("invalid_or_expired_token");
    }
    const consumed = await this.magicLinks.consume(tokenHash);
    if (!consumed) {
      throw new Error("token_already_used");
    }
    const email = link.email;
    let isNewUser = false;
    let userId;
    const existingBinding = await this.users.getBindingBySubject("email", email);
    if (existingBinding) {
      const user = await this.users.getById(existingBinding.userId);
      if (!user || user.status !== "active") {
        throw new Error("user_inactive");
      }
      userId = user.id;
    } else {
      userId = entityId(ID_PREFIX.user);
      await this.users.create({
        id: userId,
        email,
        displayName: email.split("@")[0] ?? email,
        status: "active",
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      await this.users.createBinding({
        id: entityId(ID_PREFIX.authBinding),
        userId,
        provider: "email",
        subject: email,
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        lastUsedAt: null
      });
      isNewUser = true;
    }
    return { userId, email, isNewUser };
  }
};

// packages/web-host/src/password-auth.ts
import { scryptSync, randomBytes as randomBytes2, timingSafeEqual as timingSafeEqual2 } from "node:crypto";
function hashPassword(password) {
  const salt = randomBytes2(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const colonIndex = stored.indexOf(":");
  if (colonIndex === -1) return false;
  const salt = stored.slice(0, colonIndex);
  const hash = stored.slice(colonIndex + 1);
  const hashBuf = Buffer.from(hash, "hex");
  const testBuf = scryptSync(password, salt, 64);
  if (hashBuf.length !== testBuf.length) return false;
  return timingSafeEqual2(hashBuf, testBuf);
}
var PasswordAuthService = class {
  constructor(deps) {
    this.deps = deps;
  }
  deps;
  /**
   * Login with email + password. Returns userId if valid, null otherwise.
   * Uses UserRepository.getPasswordHash (no raw SQL in the service).
   */
  async login(email, password) {
    const user = await this.deps.users.getByEmail(email.toLowerCase());
    if (!user || user.status !== "active") return null;
    const passwordHash = await this.deps.users.getPasswordHash(user.id);
    if (!passwordHash) return null;
    if (!verifyPassword(password, passwordHash)) return null;
    return { userId: user.id };
  }
  /**
   * Join the waitlist. Returns the entry (idempotent — if already on the list, returns existing).
   */
  async joinWaitlist(email, displayName) {
    const id = entityId(ID_PREFIX.membership);
    const entry = await this.deps.waitlist.create(id, email, displayName);
    return { id: entry.id, email: entry.email, status: entry.status };
  }
  /**
   * Admin approves a waitlist entry. Creates a user with the given password,
   * adds them to the SELECTED tenant as a member, marks the waitlist entry approved,
   * and emits an audit event — ALL in ONE transaction (db.tx).
   *
   * Phase 2C.3.2:
   *  - Uses repository methods (no raw SQL in the service — H5).
   *  - Emits an audit event inside the same tx (ADR-0007 D18 — H3/H4).
   *  - The tenantId comes from the admin's SELECTED membership (not client-supplied — H4).
   */
  async approveWaitlistEntry(waitlistId, adminUserId, tenantId, password) {
    const entry = await this.deps.waitlist.getById(waitlistId);
    if (!entry) throw new Error("waitlist entry not found");
    if (entry.status !== "pending") throw new Error(`entry is already ${entry.status}`);
    return this.deps.db.tx(async (tx) => {
      const userId = entityId(ID_PREFIX.user);
      const email = entry.email;
      const displayName = entry.displayName ?? email.split("@")[0] ?? email;
      await this.deps.users.createWithPassword(
        { id: userId, email, displayName, status: "active", createdAt: (/* @__PURE__ */ new Date()).toISOString() },
        hashPassword(password)
      );
      await this.deps.users.createBinding({
        id: entityId(ID_PREFIX.authBinding),
        userId,
        provider: "email",
        subject: email,
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        lastUsedAt: null
      });
      const membership = {
        id: entityId(ID_PREFIX.membership),
        userId,
        organizationId: tenantId,
        role: "member",
        status: "active",
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      await this.deps.memberships.create(membership);
      const approved = await this.deps.waitlist.approve(waitlistId, adminUserId, userId);
      if (!approved) throw new Error("waitlist entry could not be approved (race condition or already approved)");
      await this.deps.audit.append({
        eventId: entityId(ID_PREFIX.audit),
        tenantId,
        actorId: adminUserId,
        actorKind: "user",
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        action: "waitlist.approved",
        entityType: "waitlist",
        entityId: waitlistId,
        operation: "approve",
        metadata: { createdUserId: userId, email }
      });
      return { userId, email };
    });
  }
  /**
   * Demo login — returns the userId for a demo user of the given role.
   * Demo users must already exist in the DB (seeded by the deploy script).
   * Uses UserRepository.getIsDemo (no raw SQL).
   */
  async demoLogin(role) {
    const email = `demo-${role}@contractor.dev`;
    const user = await this.deps.users.getByEmail(email);
    if (!user) return null;
    const isDemo = await this.deps.users.getIsDemo(user.id);
    if (!isDemo) return null;
    return { userId: user.id };
  }
  /**
   * Bootstrap the admin user (if not exists). Called by the deploy script.
   * Uses UserRepository methods (no raw SQL).
   */
  async bootstrapAdmin(email, password) {
    const existing = await this.deps.users.getByEmail(email.toLowerCase());
    let userId;
    if (existing) {
      userId = existing.id;
      await this.deps.users.updatePasswordHash(userId, hashPassword(password));
    } else {
      userId = entityId(ID_PREFIX.user);
      await this.deps.users.createWithPassword(
        { id: userId, email: email.toLowerCase(), displayName: "Admin", status: "active", createdAt: (/* @__PURE__ */ new Date()).toISOString() },
        hashPassword(password)
      );
      await this.deps.users.createBinding({
        id: entityId(ID_PREFIX.authBinding),
        userId,
        provider: "email",
        subject: email.toLowerCase(),
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        lastUsedAt: null
      });
    }
    const memberships = await this.deps.memberships.listTenantsForUser(userId);
    if (memberships.length > 0) {
      return { userId, orgId: memberships[0].organizationId };
    }
    const orgId = entityId(ID_PREFIX.organization);
    await this.deps.organizations.create({
      id: orgId,
      tenantId: orgId,
      name: "Contractor GenOffice",
      slug: "contractor-genoffice",
      status: "active",
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    const membership = {
      id: entityId(ID_PREFIX.membership),
      userId,
      organizationId: orgId,
      role: "admin",
      status: "active",
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await this.deps.memberships.create(membership);
    return { userId, orgId };
  }
  /**
   * Bootstrap demo users (owner/member/viewer). Called by the deploy script.
   * Uses UserRepository methods (no raw SQL).
   */
  async bootstrapDemoUsers(orgId) {
    for (const role of ["owner", "member", "viewer"]) {
      const email = `demo-${role}@contractor.dev`;
      const existing = await this.deps.users.getByEmail(email);
      let userId;
      if (existing) {
        userId = existing.id;
      } else {
        userId = entityId(ID_PREFIX.user);
        await this.deps.users.createDemoUser(
          { id: userId, email, displayName: `Demo ${role}`, status: "active", createdAt: (/* @__PURE__ */ new Date()).toISOString() }
        );
        await this.deps.users.createBinding({
          id: entityId(ID_PREFIX.authBinding),
          userId,
          provider: "email",
          subject: email,
          createdAt: (/* @__PURE__ */ new Date()).toISOString(),
          lastUsedAt: null
        });
        const membership = {
          id: entityId(ID_PREFIX.membership),
          userId,
          organizationId: orgId,
          role,
          status: "active",
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        await this.deps.memberships.create(membership);
      }
    }
  }
};

// packages/web-host/src/vercel-handler.ts
var cachedDeps = null;
function setCachedDepsForTesting(deps) {
  cachedDeps = deps;
}
async function getDeps() {
  if (cachedDeps) return cachedDeps;
  const db = createDb();
  await applyMigrations(db);
  const users = new UserRepository(db);
  const memberships = new MembershipRepository(db);
  const organizations = new OrganizationRepository(db);
  const workspaces = new WorkspaceRepository(db);
  if (demoMode) {
    await seedDemoData({ users, memberships, organizations, workspaces });
  }
  const projects = new ProjectRepository(db);
  const audit = new AuditRepository(db);
  const revisions = new RevisionRepository(db);
  const pm = new PlanMeasurementRepository(db);
  const boq = new BOQRepository(db);
  const estRev = new EstimateRevisionRepository(db);
  const bids = new BidRepository(db);
  const magicLinks = new MagicLinkRepository(db);
  const waitlist = new WaitlistRepository(db);
  const identity = new IdentityService(users, memberships);
  const orgService = new OrganizationService(organizations, memberships, audit);
  const wsService = new WorkspaceService(workspaces, audit);
  const projService = new ProjectService(projects, workspaces, audit);
  const auditService = new AuditService(audit);
  const revService = new RevisionService(revisions, projects, audit);
  const measurements = new PlanMeasurementService(db, pm, projects, audit);
  const boqs = new BOQService(db, boq, projects, audit);
  const estimates = new EstimateService(db, estRev, projects, audit);
  const bidService = new BidService(db, bids, estRev, audit);
  const config = loadSessionConfigFromEnv();
  const resolver = new WebSessionResolver({ users, memberships, config });
  const coreApi = new CoreApi(
    {
      identity,
      organizations: orgService,
      workspaces: wsService,
      projects: projService,
      audit: auditService,
      revisions: revService,
      measurements,
      boqs,
      estimates,
      bids: bidService
    },
    resolver
  );
  const magicLinkConfig = {
    linkSecret: process.env.CG_MAGIC_LINK_SECRET ?? "",
    linkTtlSeconds: Number(process.env.CG_MAGIC_LINK_TTL_SECONDS ?? 900),
    appBaseUrl: process.env.CG_APP_BASE_URL ?? ""
  };
  if (!magicLinkConfig.linkSecret || magicLinkConfig.linkSecret.length < 32) {
    if (!config.devAuthEnabled) {
      throw new Error("CG_MAGIC_LINK_SECRET must be set (min 32 bytes) for production magic-link auth");
    }
  }
  const magicLinkAuth = new MagicLinkAuthService(users, magicLinks, magicLinkConfig);
  const passwordAuth = new PasswordAuthService({ db, users, memberships, organizations, waitlist, audit });
  cachedDeps = {
    coreApi,
    resolver,
    users,
    memberships,
    organizations,
    magicLinks,
    magicLinkAuth,
    passwordAuth,
    waitlist,
    audit,
    config,
    magicLinkConfig
  };
  return cachedDeps;
}
var demoMode = false;
function createDb() {
  if (process.env.DATABASE_URL && /^postgres(ql)?:\/\//.test(process.env.DATABASE_URL)) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 3e4,
      connectionTimeoutMillis: 1e4,
      ssl: process.env.DATABASE_SSL === "1" ? { rejectUnauthorized: false } : void 0
    });
    return new PostgresClient(pool);
  }
  demoMode = true;
  return new PgLiteClient();
}
var DEMO_ORG_ID = "org_demo_0001";
var DEMO_ORG_SLUG = "genoffice-demo";
var DEMO_WS_ID = "ws_demo_default";
var DEMO_USERS = [
  { id: "usr_demo_owner", role: "owner", email: "demo-owner@contractor.dev", name: "Demo Owner" },
  { id: "usr_demo_member", role: "member", email: "demo-member@contractor.dev", name: "Demo Member" },
  { id: "usr_demo_viewer", role: "viewer", email: "demo-viewer@contractor.dev", name: "Demo Viewer" }
];
async function seedDemoData(deps) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const existingOrg = await deps.organizations.getById(DEMO_ORG_ID, DEMO_ORG_ID);
  if (!existingOrg) {
    await deps.organizations.create({
      id: DEMO_ORG_ID,
      tenantId: DEMO_ORG_ID,
      name: "GenOffice Demo",
      slug: DEMO_ORG_SLUG,
      status: "active",
      createdAt: now
    });
  }
  if (!await deps.workspaces.getById(DEMO_WS_ID, DEMO_ORG_ID)) {
    await deps.workspaces.create({
      id: DEMO_WS_ID,
      tenantId: DEMO_ORG_ID,
      organizationId: DEMO_ORG_ID,
      name: "Default Workspace",
      createdAt: now
    });
  }
  for (const u of DEMO_USERS) {
    if (await deps.users.getByEmail(u.email)) continue;
    await deps.users.createDemoUser(
      { id: u.id, email: u.email, displayName: u.name, status: "active", createdAt: now }
    );
    await deps.users.createBinding({
      id: `auth_${u.id}`,
      userId: u.id,
      provider: "email",
      subject: u.email,
      createdAt: now,
      lastUsedAt: null
    });
    await deps.users.createBinding({
      id: `web_${u.id}`,
      userId: u.id,
      provider: "web",
      subject: u.id,
      createdAt: now,
      lastUsedAt: null
    });
    const membership = {
      id: `mbr_${u.id}`,
      userId: u.id,
      organizationId: DEMO_ORG_ID,
      role: u.role,
      status: "active",
      createdAt: now
    };
    await deps.memberships.create(membership);
  }
}
async function applyMigrations(db) {
  await applyMigration(db, FOUNDATION_MIGRATION_SQL);
  await applyMigration(db, COMMERCIAL_MIGRATION_SQL);
  await applyMigration(db, MAGIC_LINKS_MIGRATION_SQL);
  await applyMigration(db, AUTH_MIGRATION_SQL);
}
async function handler(req, res) {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const method = req.method ?? "GET";
    if (path === "/api/auth/dev-mode" && method === "GET") {
      const devAuthEnabled = process.env.CONTRACTOR_DEV_AUTH === "1";
      return sendJson(res, 200, { devAuth: devAuthEnabled });
    }
    if (path === "/api/auth/logout" && method === "POST") {
      res.setHeader("Set-Cookie", clearSessionCookieHeader(process.env.NODE_ENV === "production"));
      return sendJson(res, 200, { ok: true });
    }
    const deps = await getDeps();
    if (path === "/api/auth/password-login" && method === "POST") {
      return handlePasswordLogin(req, res, deps);
    }
    if (path === "/api/auth/signup" && method === "POST") {
      return handleSignup(req, res, deps);
    }
    if (path === "/api/auth/demo-login" && method === "POST") {
      return handleDemoLogin(req, res, deps);
    }
    if (path === "/api/auth/waitlist" && method === "GET") {
      return handleListWaitlist(req, res, deps);
    }
    if (path === "/api/auth/waitlist" && method === "POST") {
      return handleApproveWaitlist(req, res, deps);
    }
    if (path === "/api/auth/dev-login" && method === "POST") {
      return handleDevLogin(req, res, deps);
    }
    if (path === "/api/auth/request-link" && method === "POST") {
      return handleRequestLink(req, res, deps);
    }
    if (path === "/api/auth/verify" && method === "GET") {
      return handleVerify(req, res, deps, url);
    }
    if (path === "/api/auth/memberships" && method === "GET") {
      return handleListMemberships(req, res, deps);
    }
    if (path === "/api/auth/select-tenant" && method === "POST") {
      return handleSelectTenant(req, res, deps);
    }
    if (path === "/api/auth/session" && method === "GET") {
      return handleSession(req, res, deps);
    }
    if (path.startsWith("/api/")) {
      let body;
      try {
        body = method === "GET" || method === "HEAD" ? null : await readJsonBody(req);
      } catch {
        return sendJson(res, 400, { error: "validation", message: "Invalid JSON body" });
      }
      const cookieHeader = req.headers.cookie;
      const apiReq = {
        method,
        path: path.slice("/api".length),
        headers: { authorization: `Bearer ${cookieHeader ?? ""}` },
        body
      };
      const apiRes = await deps.coreApi.handle(apiReq);
      return sendApiResponse(res, apiRes);
    }
    return sendJson(res, 404, { error: "not_found", message: "Not found" });
  } catch (e) {
    console.error("[vercel-handler] internal error:", e);
    return sendJson(res, 500, { error: "internal_error", message: "Internal server error" });
  }
}
async function handleDevLogin(req, res, deps) {
  if (!deps.config.devAuthEnabled) {
    return sendJson(res, 404, { error: "not_found", message: "Dev auth is not enabled" });
  }
  const body = await readJsonBody(req);
  if (!body || typeof body !== "object") return sendJson(res, 400, { error: "validation", message: "Invalid body" });
  const credential = body.credential;
  if (typeof credential !== "string" || credential.length === 0) {
    return sendJson(res, 400, { error: "validation", message: "credential required" });
  }
  if (credential !== deps.config.devCredential) {
    return sendJson(res, 401, { error: "unauthenticated", message: "Invalid dev credential" });
  }
  const devUserEmail = process.env.CG_DEV_USER_EMAIL;
  if (!devUserEmail) return sendJson(res, 500, { error: "internal_error", message: "Dev user email not configured" });
  const user = await deps.users.getByEmail(devUserEmail);
  if (!user || user.status !== "active") {
    return sendJson(res, 401, { error: "unauthenticated", message: "Dev user not found or inactive" });
  }
  const existingBinding = await deps.users.getBindingBySubject("web", user.id);
  if (!existingBinding) {
    await deps.users.createBinding({
      id: "dev-binding-" + user.id,
      userId: user.id,
      provider: "web",
      subject: user.id,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      lastUsedAt: null
    });
  }
  const exp = Math.floor(Date.now() / 1e3) + deps.config.sessionTtlSeconds;
  const token = signSession({ userId: user.id, selectedMembershipId: null, exp }, deps.config.sessionSecret);
  res.setHeader("Set-Cookie", sessionCookieHeader(token, deps.config.sessionTtlSeconds, process.env.NODE_ENV === "production"));
  return sendJson(res, 200, { userId: user.id, email: user.email, displayName: user.displayName });
}
async function handleRequestLink(req, res, deps) {
  const body = await readJsonBody(req);
  if (!body || typeof body !== "object") return sendJson(res, 400, { error: "validation", message: "Invalid body" });
  const email = body.email;
  if (typeof email !== "string" || email.length === 0) {
    return sendJson(res, 400, { error: "validation", message: "email required" });
  }
  try {
    const result = await deps.magicLinkAuth.requestLink(email);
    if (deps.config.devAuthEnabled) {
      console.log(`[magic-link] Dev mode \u2014 link for ${result.email}: ${result.linkUrl}`);
    }
    return sendJson(res, 200, { sent: true, email: result.email });
  } catch (e) {
    return sendJson(res, 400, { error: "validation", message: e instanceof Error ? e.message : "Failed" });
  }
}
async function handleVerify(req, res, deps, url) {
  const token = url.searchParams.get("token");
  if (!token) return sendJson(res, 400, { error: "validation", message: "token required" });
  try {
    const result = await deps.magicLinkAuth.verifyLink(token);
    const exp = Math.floor(Date.now() / 1e3) + deps.config.sessionTtlSeconds;
    const sessionToken = signSession({ userId: result.userId, selectedMembershipId: null, exp }, deps.config.sessionSecret);
    res.setHeader("Set-Cookie", sessionCookieHeader(sessionToken, deps.config.sessionTtlSeconds, process.env.NODE_ENV === "production"));
    res.writeHead(302, { Location: "/" });
    res.end();
    return;
  } catch (e) {
    return sendJson(res, 401, { error: "unauthenticated", message: e instanceof Error ? e.message : "Invalid token" });
  }
}
async function handleListMemberships(req, res, deps) {
  const payload = deps.resolver.resolvePayload(req.headers.cookie);
  if (!payload) return sendJson(res, 401, { error: "unauthenticated", message: "Not authenticated" });
  const user = await deps.users.getById(payload.userId);
  if (!user || user.status !== "active") return sendJson(res, 401, { error: "unauthenticated", message: "User not found" });
  const memberships = await deps.memberships.listTenantsForUser(payload.userId);
  const result = [];
  for (const m of memberships) {
    const org = await deps.organizations.getById(m.organizationId, m.organizationId);
    result.push({ membershipId: m.id, organizationId: m.organizationId, organizationName: org?.name ?? m.organizationId, role: m.role });
  }
  return sendJson(res, 200, { memberships: result });
}
async function handleSelectTenant(req, res, deps) {
  const payload = deps.resolver.resolvePayload(req.headers.cookie);
  if (!payload) return sendJson(res, 401, { error: "unauthenticated", message: "Not authenticated" });
  const body = await readJsonBody(req);
  if (!body || typeof body !== "object") return sendJson(res, 400, { error: "validation", message: "Invalid body" });
  const membershipId = body.membershipId;
  if (typeof membershipId !== "string" || membershipId.length === 0) {
    return sendJson(res, 400, { error: "validation", message: "membershipId required" });
  }
  const userMemberships = await deps.memberships.listTenantsForUser(payload.userId);
  const found = userMemberships.find((m) => m.id === membershipId);
  if (!found) return sendJson(res, 403, { error: "forbidden", message: "Membership not found or not yours" });
  const exp = Math.floor(Date.now() / 1e3) + deps.config.sessionTtlSeconds;
  const token = signSession({ userId: payload.userId, selectedMembershipId: membershipId, exp }, deps.config.sessionSecret);
  res.setHeader("Set-Cookie", sessionCookieHeader(token, deps.config.sessionTtlSeconds, process.env.NODE_ENV === "production"));
  return sendJson(res, 200, { tenantId: found.organizationId, membershipId: found.id, role: found.role });
}
async function handleSession(req, res, deps) {
  const payload = deps.resolver.resolvePayload(req.headers.cookie);
  if (!payload) return sendJson(res, 200, { authenticated: false });
  const user = await deps.users.getById(payload.userId);
  if (!user || user.status !== "active") return sendJson(res, 200, { authenticated: false });
  return sendJson(res, 200, {
    authenticated: true,
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    tenantSelected: payload.selectedMembershipId !== null
  });
}
async function handlePasswordLogin(req, res, deps) {
  const body = await readJsonBody(req);
  if (!body || typeof body !== "object") return sendJson(res, 400, { error: "validation", message: "Invalid body" });
  const b = body;
  const email = typeof b.email === "string" ? b.email : "";
  const password = typeof b.password === "string" ? b.password : "";
  if (!email || !password) return sendJson(res, 400, { error: "validation", message: "email and password required" });
  const result = await deps.passwordAuth.login(email, password);
  if (!result) return sendJson(res, 401, { error: "unauthenticated", message: "Invalid email or password" });
  const exp = Math.floor(Date.now() / 1e3) + deps.config.sessionTtlSeconds;
  const token = signSession({ userId: result.userId, selectedMembershipId: null, exp }, deps.config.sessionSecret);
  res.setHeader("Set-Cookie", sessionCookieHeader(token, deps.config.sessionTtlSeconds, process.env.NODE_ENV === "production"));
  return sendJson(res, 200, { userId: result.userId });
}
async function handleSignup(req, res, deps) {
  const body = await readJsonBody(req);
  if (!body || typeof body !== "object") return sendJson(res, 400, { error: "validation", message: "Invalid body" });
  const b = body;
  const email = typeof b.email === "string" ? b.email : "";
  const displayName = typeof b.displayName === "string" ? b.displayName : null;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return sendJson(res, 400, { error: "validation", message: "valid email required" });
  }
  const entry = await deps.passwordAuth.joinWaitlist(email, displayName);
  return sendJson(res, 200, { id: entry.id, email: entry.email, status: entry.status, message: "You are on the waitlist. An admin will review your request." });
}
async function handleDemoLogin(req, res, deps) {
  const body = await readJsonBody(req);
  if (!body || typeof body !== "object") return sendJson(res, 400, { error: "validation", message: "Invalid body" });
  const role = body.role;
  if (role !== "owner" && role !== "member" && role !== "viewer") {
    return sendJson(res, 400, { error: "validation", message: "role must be owner, member, or viewer" });
  }
  const result = await deps.passwordAuth.demoLogin(role);
  if (!result) return sendJson(res, 401, { error: "unauthenticated", message: "Demo user not found. Run the bootstrap script." });
  const exp = Math.floor(Date.now() / 1e3) + deps.config.sessionTtlSeconds;
  const token = signSession({ userId: result.userId, selectedMembershipId: null, exp }, deps.config.sessionSecret);
  res.setHeader("Set-Cookie", sessionCookieHeader(token, deps.config.sessionTtlSeconds, process.env.NODE_ENV === "production"));
  return sendJson(res, 200, { userId: result.userId, role });
}
async function handleListWaitlist(req, res, deps) {
  const payload = deps.resolver.resolvePayload(req.headers.cookie);
  if (!payload) return sendJson(res, 401, { error: "unauthenticated", message: "Not authenticated" });
  if (!payload.selectedMembershipId) {
    return sendJson(res, 403, { error: "forbidden", message: "No tenant selected" });
  }
  const userMemberships = await deps.memberships.listTenantsForUser(payload.userId);
  const selectedM = userMemberships.find((m) => m.id === payload.selectedMembershipId);
  if (!selectedM || selectedM.status !== "active" || selectedM.role !== "admin" && selectedM.role !== "owner") {
    return sendJson(res, 403, { error: "forbidden", message: "Admin or owner role required for the selected tenant" });
  }
  const entries = await deps.waitlist.listAll();
  return sendJson(res, 200, { entries });
}
async function handleApproveWaitlist(req, res, deps) {
  const payload = deps.resolver.resolvePayload(req.headers.cookie);
  if (!payload) return sendJson(res, 401, { error: "unauthenticated", message: "Not authenticated" });
  if (!payload.selectedMembershipId) {
    return sendJson(res, 403, { error: "forbidden", message: "No tenant selected" });
  }
  const userMemberships = await deps.memberships.listTenantsForUser(payload.userId);
  const selectedM = userMemberships.find((m) => m.id === payload.selectedMembershipId);
  if (!selectedM) {
    return sendJson(res, 403, { error: "forbidden", message: "Selected membership not found or revoked" });
  }
  if (selectedM.status !== "active") {
    return sendJson(res, 403, { error: "forbidden", message: "Selected membership is not active" });
  }
  if (selectedM.role !== "admin" && selectedM.role !== "owner") {
    return sendJson(res, 403, { error: "forbidden", message: "Admin or owner role required for the selected tenant" });
  }
  const body = await readJsonBody(req);
  if (!body || typeof body !== "object") return sendJson(res, 400, { error: "validation", message: "Invalid body" });
  const b = body;
  const waitlistId = typeof b.waitlistId === "string" ? b.waitlistId : "";
  const password = typeof b.password === "string" ? b.password : "";
  if (!waitlistId || !password || password.length < 6) {
    return sendJson(res, 400, { error: "validation", message: "waitlistId and password (min 6 chars) required" });
  }
  try {
    const result = await deps.passwordAuth.approveWaitlistEntry(
      waitlistId,
      payload.userId,
      selectedM.organizationId,
      password
    );
    return sendJson(res, 200, { userId: result.userId, email: result.email, message: "User created. They can now login with their email + the password you set." });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to approve";
    if (msg.includes("not found") || msg.includes("already") || msg.includes("could not be approved")) {
      return sendJson(res, 409, { error: "conflict", message: msg });
    }
    return sendJson(res, 500, { error: "internal_error", message: "Failed to approve waitlist entry" });
  }
}
async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 1024 * 1024) throw new Error("payload_too_large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return null;
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.length === 0) return null;
  return JSON.parse(text);
}
function sendJson(res, status, body) {
  const json2 = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(json2) });
  res.end(json2);
}
function sendApiResponse(res, apiRes) {
  const body = typeof apiRes.body === "string" ? apiRes.body : JSON.stringify(apiRes.body);
  const headers = {
    "Content-Type": typeof apiRes.body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(body))
  };
  res.writeHead(apiRes.status, headers);
  res.end(body);
}
export {
  handler as default,
  setCachedDepsForTesting
};
