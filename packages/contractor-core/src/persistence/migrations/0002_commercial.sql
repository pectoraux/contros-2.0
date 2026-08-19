-- Contractor GenOffice — Commercial Schema (PostgreSQL)
-- Migration 0002: PlanMeasurement, BOQ, BOQItem, EstimateRevision payload, Bid.
--
-- Commercial persistence ONLY. No application services, no HTTP, no UI.
-- (Phase 2B.1.)
--
-- Reuses the foundation revision infrastructure:
--   - revisions table (generic RevisionMetadata)
--   - revision_counters table (atomic revision number allocation)
--   - immutability triggers on revisions (block UPDATE/DELETE on finalized/superseded)
--
-- The EstimateRevision = generic RevisionMetadata + EstimateRevisionPayload.
-- The payload is stored as canonical immutable JSONB in estimate_revision_payloads.
-- JSONB is the canonical authority; denormalized fields are indexed projections only.
--
-- Tenant enforcement: every table carries tenant_id and every query enforces it.
-- Historical authority: RESTRICT on FKs that protect EstimateRevision/Bid.
-- (Phase 2B.1 §6, §16, §21.)

-- ────────────────────────────────────────────────────────────
-- PlanMeasurement (measurement evidence — NOT commercial authority)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plan_measurements (
  measurement_id            TEXT PRIMARY KEY,
  tenant_id                 TEXT NOT NULL,
  project_id                TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  source_artifact_id        TEXT NOT NULL,
  source_artifact_hash      TEXT NOT NULL,
  sheet_id                  TEXT,
  sheet_revision            TEXT,
  element_reference         TEXT NOT NULL,
  quantity_value             NUMERIC(20,4) NOT NULL,
  quantity_unit              TEXT NOT NULL,
  measurement_method        TEXT NOT NULL CHECK (measurement_method IN ('manual-takeoff','auto-takeoff','ai-proposed','imported')),
  measurement_basis         TEXT NOT NULL CHECK (measurement_basis IN ('count','length','area','volume','mass','time')),
  measurement_engine_version TEXT NOT NULL,
  actor_id                  TEXT NOT NULL,
  measured_at               TIMESTAMPTZ NOT NULL,
  provisional               BOOLEAN NOT NULL DEFAULT false,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pm_tenant ON plan_measurements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pm_project ON plan_measurements(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_pm_artifact ON plan_measurements(tenant_id, source_artifact_id);

-- ────────────────────────────────────────────────────────────
-- BOQ (scope structure — NOT commercial authority)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS boqs (
  boq_id     TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  name       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_boqs_tenant ON boqs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_boqs_project ON boqs(tenant_id, project_id);

-- BOQItem (scope line within a BOQ)
CREATE TABLE IF NOT EXISTS boq_items (
  item_id                TEXT PRIMARY KEY,
  boq_id                 TEXT NOT NULL REFERENCES boqs(boq_id) ON DELETE CASCADE,
  tenant_id              TEXT NOT NULL,
  item_code              TEXT NOT NULL,
  description            TEXT NOT NULL,
  unit                   TEXT NOT NULL,
  quantity_value          NUMERIC(20,4) NOT NULL,
  quantity_unit           TEXT NOT NULL,
  provenance             TEXT NOT NULL CHECK (provenance IN ('plan-measurement','imported','manual')),
  source_measurement_ids  JSONB,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_boq_items_tenant ON boq_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_boq_items_boq ON boq_items(boq_id);

-- ────────────────────────────────────────────────────────────
-- EstimateRevision payload (canonical immutable commercial content)
--
-- The EstimateRevisionPayload is stored as JSONB — the canonical authority.
-- Denormalized fields (currency, target_profit_mode) are indexed projections
-- for queryability ONLY; they are NOT a second authority.
--
-- The revision_id FK references the generic revisions table (which stores
-- RevisionMetadata + immutability triggers). The payload_json is immutable
-- once the revision is finalized; a trigger blocks mutation.
-- (Phase 2B.1 §6, §7, §8.)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS estimate_revision_payloads (
  revision_id          TEXT PRIMARY KEY REFERENCES revisions(revision_id) ON DELETE RESTRICT,
  tenant_id             TEXT NOT NULL,
  project_id            TEXT NOT NULL,
  payload_json          JSONB NOT NULL,
  -- Denormalized index fields (NOT canonical — derived from payload_json)
  currency              CHAR(3) NOT NULL,
  target_profit_mode    TEXT NOT NULL,
  target_profit_ratio   NUMERIC(6,5) NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_erp_tenant ON estimate_revision_payloads(tenant_id);
CREATE INDEX IF NOT EXISTS idx_erp_project ON estimate_revision_payloads(tenant_id, project_id);

-- Immutability trigger: block UPDATE/DELETE on finalized/superseded payloads.
-- The generic revisions trigger protects the revisions table; this trigger
-- protects the payload JSONB. (Phase 2B.1 §8, §33.)
--
-- For draft status, the function returns NEW (allow the UPDATE — drafts are
-- working state). For finalized/superseded, it raises (mutation forbidden).
-- Returning OLD for draft status would silently discard every payload UPDATE,
-- causing stored content_hash / payload_json drift — a serious correctness bug.
-- (Phase 2B.2 trigger correctness fix.)
CREATE OR REPLACE FUNCTION block_estimate_payload_mutation() RETURNS TRIGGER AS $$
DECLARE
  rev_status TEXT;
BEGIN
  SELECT status INTO rev_status FROM revisions WHERE revision_id = OLD.revision_id;
  IF rev_status IN ('finalized', 'superseded') THEN
    RAISE EXCEPTION 'estimate revision payload % is immutable (revision status=%): mutation forbidden', OLD.revision_id, rev_status;
  END IF;
  -- draft status: allow the UPDATE to proceed with the new row.
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_block_erp_update ON estimate_revision_payloads;
CREATE TRIGGER trg_block_erp_update BEFORE UPDATE ON estimate_revision_payloads
  FOR EACH ROW EXECUTE FUNCTION block_estimate_payload_mutation();

DROP TRIGGER IF EXISTS trg_block_erp_delete ON estimate_revision_payloads;
CREATE TRIGGER trg_block_erp_delete BEFORE DELETE ON estimate_revision_payloads
  FOR EACH ROW EXECUTE FUNCTION block_estimate_payload_mutation();

-- ────────────────────────────────────────────────────────────
-- Bid (commercial submission decision — references finalized EstimateRevision)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bids (
  bid_id                          TEXT PRIMARY KEY,
  tenant_id                       TEXT NOT NULL,
  project_id                      TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  estimate_revision_id            TEXT NOT NULL REFERENCES revisions(revision_id) ON DELETE RESTRICT,
  estimate_revision_content_hash  TEXT NOT NULL,
  status                          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','won','lost','withdrawn')),
  final_price_minor                BIGINT,
  final_price_currency             CHAR(3),
  director_adjustment_minor        BIGINT,
  director_adjustment_currency      CHAR(3),
  adjustment_rationale             TEXT,
  submitted_at                     TIMESTAMPTZ,
  outcome_at                       TIMESTAMPTZ,
  outcome_note                     TEXT,
  created_at                       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bids_tenant ON bids(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bids_project ON bids(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_bids_revision ON bids(tenant_id, estimate_revision_id);
