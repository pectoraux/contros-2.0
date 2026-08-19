-- ────────────────────────────────────────────────────────────────────────────
-- 0004_auth.sql — password auth + waitlist (Phase 2C.3, additive)
--
-- ADR-0009 D3 (magic-link) is supplemented by password auth for the admin
-- and approved users. The waitlist captures sign-up requests; the admin
-- approves them to create real accounts.
--
-- This migration is ADDITIVE — it does NOT modify 0001/0002/0003.
-- ────────────────────────────────────────────────────────────────────────────

-- Add password_hash to users (nullable — null for magic-link-only users)
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Add is_demo flag to users (for demo accounts with quick-login)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;

-- Waitlist table
CREATE TABLE IF NOT EXISTS waitlist (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by     TEXT REFERENCES users(id),
  approved_at     TIMESTAMPTZ,
  created_user_id TEXT REFERENCES users(id),
  display_name    TEXT
);

CREATE INDEX IF NOT EXISTS idx_waitlist_status ON waitlist(status);
