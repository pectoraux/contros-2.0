-- Contractor GenOffice — Foundation Schema (PostgreSQL)
-- Migration 0001: identity, organization/tenant, membership, workspace,
-- project, audit, revision framework.
--
-- Foundation tables ONLY. No Commercial/Programme/BIM/Goals tables.
-- (Phase 1 section 16: "Only establish foundation tables required by this phase.")
--
-- Every tenant-scoped table carries `tenant_id`. Every repository query
-- enforces `WHERE ... AND tenant_id = $...`. (Phase 1 section 7.)
--
-- audit_events: append-only. The repository exposes NO update/delete.
-- revisions: finalized/superseded rows are immutable. The repository
--   enforces this (no update/delete for non-draft rows).

-- ────────────────────────────────────────────────────────────
-- Users (identity)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  email        TEXT UNIQUE,
  display_name TEXT,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- AuthProvider bindings (Genspark, OIDC, SAML, password, ...)
-- A user may have multiple bindings. (provider, subject) is globally unique.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auth_provider_bindings (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL,
  subject      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  UNIQUE (provider, subject)
);
CREATE INDEX IF NOT EXISTS idx_auth_bindings_user ON auth_provider_bindings(user_id);

-- ────────────────────────────────────────────────────────────
-- Organizations (the Tenant). tenant_id == id.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,  -- == id; denormalized for uniform tenant scoping
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (slug)
);

-- ────────────────────────────────────────────────────────────
-- Memberships (User x Organization with Role)
-- Membership is EXPLICIT. (Phase 1 section 5/11.)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memberships (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tenant_id       TEXT NOT NULL,  -- == organization_id; for uniform tenant scoping
  role            TEXT NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, organization_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_tenant ON memberships(tenant_id);

-- ────────────────────────────────────────────────────────────
-- Workspaces (organizational container inside a Tenant; owns Projects)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspaces (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workspaces_tenant ON workspaces(tenant_id);

-- ────────────────────────────────────────────────────────────
-- Projects (canonical business identity). ONE model.
-- Referenced by future domain authorities (EstimateRevision, etc.)
-- via project_id. No OfficeProject/ProgrammeProject/etc. (Phase 1 §8.)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_projects_tenant ON projects(tenant_id);
CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id);

-- ────────────────────────────────────────────────────────────
-- Audit events (append-only). NO update/delete from the repository.
-- (Phase 1 section 12; ADR-0005 Decision 6.)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_events (
  event_id    TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  actor_id    TEXT NOT NULL,
  actor_kind  TEXT NOT NULL CHECK (actor_kind IN ('user','service')),
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT now(),
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  operation   TEXT NOT NULL,
  metadata    JSONB
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events(tenant_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_events(tenant_id, timestamp DESC);

-- Block UPDATE and DELETE on audit_events at the database level.
-- (Defense in depth — the repository also exposes no update/delete.)
CREATE OR REPLACE FUNCTION block_audit_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: UPDATE and DELETE are forbidden';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_block_audit_update ON audit_events;
DROP TRIGGER IF EXISTS trg_block_audit_delete ON audit_events;
CREATE TRIGGER trg_block_audit_update BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION block_audit_mutation();
CREATE TRIGGER trg_block_audit_delete BEFORE DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION block_audit_mutation();

-- ────────────────────────────────────────────────────────────
-- Revisions (generic revision framework). Domain-specific payload is
-- NOT stored here — this is the metadata infrastructure for immutable
-- historical truth. (Phase 1 section 13.)
--
-- finalized/superseded rows are IMMUTABLE. The repository enforces this
-- (no update/delete for non-draft rows). A trigger provides defense in depth.
-- ────────────────────────────────────────────────────────────
-- C2: revisions are historical authority. They must NEVER be destroyed by
-- a parent (project/workspace/org) deletion. The FK to projects uses
-- ON DELETE RESTRICT — a project with revisions cannot be hard-deleted.
-- (Phase 1.1 C2 fix.)
CREATE TABLE IF NOT EXISTS revisions (
  revision_id       TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  authority_kind    TEXT NOT NULL,
  revision_number   INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','finalized','superseded')),
  created_by        TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  algorithm_version TEXT NOT NULL,
  content_hash      TEXT NOT NULL,
  parent_revision_id TEXT REFERENCES revisions(revision_id),
  finalized_at      TIMESTAMPTZ,
  UNIQUE (tenant_id, project_id, authority_kind, revision_number)
);
CREATE INDEX IF NOT EXISTS idx_revisions_tenant ON revisions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_revisions_project ON revisions(tenant_id, project_id, authority_kind);

-- H1: dedicated revision-number counter. Each (tenant, project, authority_kind)
-- has a monotonic counter row. Allocation is atomic via UPSERT + RETURNING —
-- no race window, no serialization failures, no retry needed.
-- (Phase 1.1 H1 fix: replaces SELECT MAX(revision_number)+1 under READ COMMITTED.)
CREATE TABLE IF NOT EXISTS revision_counters (
  tenant_id       TEXT NOT NULL,
  project_id      TEXT NOT NULL,
  authority_kind  TEXT NOT NULL,
  next_number     INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, project_id, authority_kind)
);

-- C1: finalized/superseded revisions are IMMUTABLE except for the
-- controlled status transition finalized->superseded (and draft->superseded,
-- draft->finalized). The trigger enforces that ONLY `status` (and
-- `finalized_at` during draft->finalized) may change; every identity/content
-- field is frozen once finalized. (Phase 1.1 C1 fix.)
--
-- Immutable fields (must not change after finalization):
--   revision_id, tenant_id, project_id, authority_kind, revision_number,
--   created_by, created_at, algorithm_version, content_hash,
--   parent_revision_id
-- Mutable fields (controlled lifecycle only):
--   status (draft->finalized, draft->superseded, finalized->superseded)
--   finalized_at (set when draft->finalized; unchanged thereafter)
CREATE OR REPLACE FUNCTION block_immutable_revision_update() RETURNS TRIGGER AS $$
BEGIN
  -- From draft: any field may change (working state).
  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;

  -- From finalized: only the finalized->superseded transition is allowed,
  -- and ONLY the status field may change. Every other field must be identical.
  IF OLD.status = 'finalized' THEN
    IF NEW.status = 'superseded' THEN
      -- Verify NO field other than status changed.
      IF NEW.revision_id IS DISTINCT FROM OLD.revision_id
         OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
         OR NEW.project_id IS DISTINCT FROM OLD.project_id
         OR NEW.authority_kind IS DISTINCT FROM OLD.authority_kind
         OR NEW.revision_number IS DISTINCT FROM OLD.revision_number
         OR NEW.created_by IS DISTINCT FROM OLD.created_by
         OR NEW.created_at IS DISTINCT FROM OLD.created_at
         OR NEW.algorithm_version IS DISTINCT FROM OLD.algorithm_version
         OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
         OR NEW.parent_revision_id IS DISTINCT FROM OLD.parent_revision_id
         OR NEW.finalized_at IS DISTINCT FROM OLD.finalized_at THEN
        RAISE EXCEPTION 'revision % is finalized: only status may change during finalized->superseded (identity/content fields are immutable)', OLD.revision_id;
      END IF;
      RETURN NEW;
    END IF;
    -- Any other transition from finalized is forbidden.
    RAISE EXCEPTION 'revision % is finalized: UPDATE forbidden (only finalized->superseded is allowed)', OLD.revision_id;
  END IF;

  -- From superseded: terminal state. No UPDATE at all.
  IF OLD.status = 'superseded' THEN
    RAISE EXCEPTION 'revision % is superseded (terminal): UPDATE forbidden', OLD.revision_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_block_immutable_rev_update ON revisions;
CREATE TRIGGER trg_block_immutable_rev_update BEFORE UPDATE ON revisions
  FOR EACH ROW EXECUTE FUNCTION block_immutable_revision_update();

-- Block DELETE on finalized/superseded revisions (defense in depth).
CREATE OR REPLACE FUNCTION block_immutable_revision_delete() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IN ('finalized','superseded') THEN
    RAISE EXCEPTION 'revision % is immutable (status=%): DELETE forbidden', OLD.revision_id, OLD.status;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_block_immutable_rev_delete ON revisions;
CREATE TRIGGER trg_block_immutable_rev_delete BEFORE DELETE ON revisions
  FOR EACH ROW EXECUTE FUNCTION block_immutable_revision_delete();
