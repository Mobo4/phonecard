-- Phonecard persistent schema (Postgres)

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  google_user_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_token_hash ON auth_tokens(token_hash);

CREATE TABLE IF NOT EXISTS wallet_balances (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  balance_usd NUMERIC(12,4) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS wallet_ledger (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  amount_usd NUMERIC(12,4) NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('credit','debit')),
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS call_sessions (
  call_session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  destination TEXT NOT NULL,
  retail_rate_usd_per_min NUMERIC(12,4) NOT NULL,
  authorized_max_seconds INT NOT NULL,
  announced_minutes INT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  settled_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS idempotency_registry (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (source, source_id)
);

CREATE TABLE IF NOT EXISTS destination_rates (
  prefix TEXT PRIMARY KEY,
  rate_usd_per_min NUMERIC(12,4) NOT NULL
);

CREATE TABLE IF NOT EXISTS pending_settlements (
  event_id TEXT PRIMARY KEY,
  call_session_id TEXT NOT NULL,
  duration_seconds INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id BIGSERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  details TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
