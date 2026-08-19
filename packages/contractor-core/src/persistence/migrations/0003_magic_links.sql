-- ────────────────────────────────────────────────────────────────────────────
-- 0003_magic_links.sql — passwordless email magic-link auth tokens (Phase 2C.2)
--
-- ADR-0009 Decision 3: production auth is passwordless email magic-link.
-- The browser posts an email to /api/auth/request-link; the server generates
-- a single-use, short-lived HMAC-signed token, stores it here, and emails it.
-- On verify, the token is consumed (used_at set) and a session cookie issued.
--
-- This migration is ADDITIVE — it does NOT modify 0001_foundation.sql or
-- 0002_commercial.sql. The frozen architecture is unchanged.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS magic_links (
  token_hash      TEXT PRIMARY KEY,          -- SHA-256 of the token (we never store the raw token)
  email           TEXT NOT NULL,             -- the email the link was sent to
  expires_at      TIMESTAMPTZ NOT NULL,      -- short-lived (default 15 minutes)
  used_at         TIMESTAMPTZ,               -- NULL until consumed; single-use enforced
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for lookup by token_hash (the verify path).
CREATE INDEX IF NOT EXISTS idx_magic_links_token_hash ON magic_links(token_hash) WHERE used_at IS NULL;

-- Index for periodic cleanup of expired tokens.
CREATE INDEX IF NOT EXISTS idx_magic_links_expires_at ON magic_links(expires_at);
