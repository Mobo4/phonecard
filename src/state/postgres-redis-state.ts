import crypto from "node:crypto";
import { Pool } from "pg";
import { createClient } from "redis";
import { hashToken } from "../lib/hash.js";
import type { RateAuthorizeResult, TokenVerifyResult } from "../domain/types.js";
import type { AuditEntry, DestinationRate, StateStore } from "./state-store.js";

const MIN_CONNECT_SECONDS = 60;
const SAFETY_BUFFER_SECONDS = 5;
const LOCK_SECONDS = 15 * 60;
const FAIL_WINDOW_SECONDS = 15 * 60;
const BLOCKED_COUNTRY_PREFIXES = (process.env.BLOCKED_COUNTRY_PREFIXES ?? "")
  .split(",")
  .map((p) => p.trim())
  .filter((p) => p.length > 0);
const RATE_MARGIN_PERCENT = Number.parseFloat(process.env.RATE_MARGIN_PERCENT ?? "115");
const RATE_MARGIN_MULTIPLIER = Number.isFinite(RATE_MARGIN_PERCENT)
  ? 1 + RATE_MARGIN_PERCENT / 100
  : 2.15;

const toRetailRate = (wholesaleRateUsdPerMin: number): number =>
  Number((wholesaleRateUsdPerMin * RATE_MARGIN_MULTIPLIER).toFixed(4));

const blockedCountry = (destination: string): boolean =>
  BLOCKED_COUNTRY_PREFIXES.some((prefix) => destination.startsWith(prefix));

const fallbackRate = (destination: string): number | null => {
  if (destination.startsWith("+989")) {
    return toRetailRate(0.22);
  }
  if (destination.startsWith("+98")) {
    return toRetailRate(0.16);
  }
  if (destination.startsWith("+937")) {
    return toRetailRate(0.1116);
  }
  if (destination.startsWith("+93")) {
    return toRetailRate(0.093);
  }
  return null;
};

export type PostgresRedisConfig = {
  databaseUrl: string;
  redisUrl: string;
  redisToken?: string;
};

export class PostgresRedisState implements StateStore {
  private readonly pool: Pool;
  private readonly redis: ReturnType<typeof createClient>;

  private constructor(pool: Pool, redis: ReturnType<typeof createClient>) {
    this.pool = pool;
    this.redis = redis;
  }

  static async create(cfg: PostgresRedisConfig): Promise<PostgresRedisState> {
    const pool = new Pool({
      connectionString: cfg.databaseUrl,
      ssl: cfg.databaseUrl.includes("localhost")
        ? undefined
        : { rejectUnauthorized: false },
    });
    const redis = createClient({
      url: cfg.redisUrl,
      password: cfg.redisToken,
    });
    await redis.connect();

    const state = new PostgresRedisState(pool, redis);
    await state.ensureSchema();
    return state;
  }

  async bootstrapUser(
    googleUserId: string,
    email: string,
    nowMs: number,
  ): Promise<{ userId: string; token: string }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      let userId: string | undefined;
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE google_user_id = $1 LIMIT 1`,
        [googleUserId],
      );
      if (existing.rowCount && existing.rows[0]) {
        userId = existing.rows[0].id;
      } else {
        userId = `u_${crypto.randomUUID()}`;
        const inserted = await client.query<{ id: string }>(
          `
          INSERT INTO users (id, google_user_id, email, created_at)
          VALUES ($1, $2, $3, $4)
          RETURNING id
          `,
          [userId, googleUserId, email, new Date(nowMs)],
        );
        userId = inserted.rows[0]?.id ?? userId;
        if (!userId) {
          throw new Error("user_insert_failed");
        }
        await client.query(
          `INSERT INTO wallet_balances (user_id, balance_usd) VALUES ($1, 0)`,
          [userId],
        );
      }

      const token = this.generateToken();
      const tokenHash = hashToken(token);
      await client.query(`UPDATE auth_tokens SET active = false WHERE user_id = $1`, [
        userId,
      ]);
      await client.query(
        `
        INSERT INTO auth_tokens (user_id, token_hash, active, created_at)
        VALUES ($1, $2, true, $3)
        `,
        [userId, tokenHash, new Date(nowMs)],
      );

      await client.query("COMMIT");
      return { userId, token };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async creditWallet(
    userId: string,
    amountUsd: number,
    source: string,
    sourceId: string,
    nowMs: number,
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const idem = await client.query<{ id: string }>(
        `
        INSERT INTO idempotency_registry (source, source_id, created_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (source, source_id) DO NOTHING
        RETURNING id
        `,
        [source, sourceId, new Date(nowMs)],
      );
      if (!idem.rowCount) {
        await client.query("ROLLBACK");
        return false;
      }

      await client.query(
        `
        INSERT INTO wallet_ledger (user_id, amount_usd, entry_type, source, source_id, created_at)
        VALUES ($1, $2, 'credit', $3, $4, $5)
        `,
        [userId, amountUsd, source, sourceId, new Date(nowMs)],
      );

      await client.query(
        `
        UPDATE wallet_balances
        SET balance_usd = balance_usd + $2
        WHERE user_id = $1
        `,
        [userId, amountUsd],
      );

      await client.query("COMMIT");
      return true;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async verifyToken(
    callSessionId: string,
    ani: string,
    token: string,
    nowMs: number,
  ): Promise<TokenVerifyResult> {
    const lockKey = `token:lock:${ani}`;
    const failKey = `token:fail:${ani}`;
    const locked = await this.redis.get(lockKey);
    if (locked) {
      return { allow: false, statusCode: 423, reasonCode: "TOKEN_LOCKED" };
    }

    const tokenHash = hashToken(token);
    const q = await this.pool.query<{ user_id: string; active: boolean }>(
      `
      SELECT user_id, active
      FROM auth_tokens
      WHERE token_hash = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [tokenHash],
    );
    const row = q.rows[0];
    if (!row) {
      const attempts = await this.redis.incr(failKey);
      if (attempts === 1) {
        await this.redis.expire(failKey, FAIL_WINDOW_SECONDS);
      }
      if (attempts >= 3) {
        await this.redis.set(lockKey, "1", { EX: LOCK_SECONDS });
        await this.redis.del(failKey);
        return { allow: false, statusCode: 423, reasonCode: "TOKEN_LOCKED" };
      }
      return { allow: false, statusCode: 401, reasonCode: "TOKEN_INVALID" };
    }
    if (!row.active) {
      return { allow: false, statusCode: 403, reasonCode: "TOKEN_INACTIVE" };
    }

    await this.redis.del(failKey);
    await this.pool.query(
      `
      INSERT INTO call_sessions (
        call_session_id, user_id, destination, retail_rate_usd_per_min,
        authorized_max_seconds, announced_minutes, status, created_at
      )
      VALUES ($1, $2, '', 0, 0, 0, 'authorized', $3)
      ON CONFLICT (call_session_id) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          status = 'authorized',
          created_at = EXCLUDED.created_at
      `,
      [callSessionId, row.user_id, new Date(nowMs)],
    );

    return {
      allow: true,
      statusCode: 200,
      reasonCode: "ALLOW",
      userId: row.user_id,
    };
  }

  async rateAuthorize(
    callSessionId: string,
    userId: string,
    destination: string,
    nowMs: number,
  ): Promise<RateAuthorizeResult> {
    const existing = await this.pool.query<{ user_id: string }>(
      `SELECT user_id FROM call_sessions WHERE call_session_id = $1 LIMIT 1`,
      [callSessionId],
    );
    const boundUserId = existing.rows[0]?.user_id;
    if (boundUserId && boundUserId !== userId) {
      return { allow: false, statusCode: 403, reasonCode: "USER_MISMATCH" };
    }

    if (blockedCountry(destination)) {
      await this.pool.query(
        `
        INSERT INTO call_sessions (
          call_session_id, user_id, destination, retail_rate_usd_per_min,
          authorized_max_seconds, announced_minutes, status, created_at
        )
        VALUES ($1, $2, $3, 0, 0, 0, 'denied', $4)
        ON CONFLICT (call_session_id) DO UPDATE
        SET user_id = EXCLUDED.user_id,
            destination = EXCLUDED.destination,
            status = 'denied'
        `,
        [callSessionId, userId, destination, new Date(nowMs)],
      );
      return { allow: false, statusCode: 403, reasonCode: "COUNTRY_BLOCKED" };
    }

    const rate = await this.lookupRate(destination);
    if (rate === null) {
      return { allow: false, statusCode: 403, reasonCode: "DESTINATION_UNSUPPORTED" };
    }

    const balance = await this.getBalance(userId);
    const rawSeconds = Math.floor((balance / rate) * 60);
    const maxCallSeconds = Math.max(0, rawSeconds - SAFETY_BUFFER_SECONDS);
    if (maxCallSeconds < MIN_CONNECT_SECONDS) {
      return { allow: false, statusCode: 402, reasonCode: "INSUFFICIENT_BALANCE" };
    }
    const announcedMinutes = Math.floor(maxCallSeconds / 60);

    await this.pool.query(
      `
      INSERT INTO call_sessions (
        call_session_id, user_id, destination, retail_rate_usd_per_min,
        authorized_max_seconds, announced_minutes, status, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'authorized', $7)
      ON CONFLICT (call_session_id) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          destination = EXCLUDED.destination,
          retail_rate_usd_per_min = EXCLUDED.retail_rate_usd_per_min,
          authorized_max_seconds = EXCLUDED.authorized_max_seconds,
          announced_minutes = EXCLUDED.announced_minutes,
          status = 'authorized'
      `,
      [callSessionId, userId, destination, rate, maxCallSeconds, announcedMinutes, new Date(nowMs)],
    );

    return {
      allow: true,
      statusCode: 200,
      reasonCode: "ALLOW",
      rate,
      announcedMinutes,
      maxCallSeconds,
    };
  }

  async settleCall(
    eventId: string,
    callSessionId: string,
    durationSeconds: number,
    nowMs: number,
  ): Promise<{ idempotent: boolean; pending: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const idem = await client.query<{ id: string }>(
        `
        INSERT INTO idempotency_registry (source, source_id, created_at)
        VALUES ('telnyx', $1, $2)
        ON CONFLICT (source, source_id) DO NOTHING
        RETURNING id
        `,
        [eventId, new Date(nowMs)],
      );
      if (!idem.rowCount) {
        await client.query("ROLLBACK");
        return { idempotent: true, pending: false };
      }

      const sessionQ = await client.query<{
        call_session_id: string;
        user_id: string;
        retail_rate_usd_per_min: string;
        authorized_max_seconds: number;
        status: string;
      }>(
        `
        SELECT call_session_id, user_id, retail_rate_usd_per_min, authorized_max_seconds, status
        FROM call_sessions
        WHERE call_session_id = $1
        FOR UPDATE
        `,
        [callSessionId],
      );
      const session = sessionQ.rows[0];
      if (!session || session.status === "denied") {
        await client.query(
          `
          INSERT INTO pending_settlements (event_id, call_session_id, duration_seconds, created_at)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (event_id) DO NOTHING
          `,
          [eventId, callSessionId, durationSeconds, new Date(nowMs)],
        );
        await client.query("COMMIT");
        return { idempotent: false, pending: true };
      }
      if (session.status === "settled") {
        await client.query("COMMIT");
        return { idempotent: true, pending: false };
      }

      const rate = Number(session.retail_rate_usd_per_min);
      const billableSeconds = Math.min(durationSeconds, session.authorized_max_seconds);
      const debit = Number(((rate * billableSeconds) / 60).toFixed(4));

      const balQ = await client.query<{ balance_usd: string }>(
        `SELECT balance_usd FROM wallet_balances WHERE user_id = $1 FOR UPDATE`,
        [session.user_id],
      );
      const balance = Number(balQ.rows[0]?.balance_usd ?? 0);
      const debitApplied = Math.min(balance, debit);

      await client.query(
        `
        INSERT INTO wallet_ledger (user_id, amount_usd, entry_type, source, source_id, created_at)
        VALUES ($1, $2, 'debit', 'telnyx', $3, $4)
        `,
        [session.user_id, -debitApplied, eventId, new Date(nowMs)],
      );
      await client.query(
        `UPDATE wallet_balances SET balance_usd = GREATEST(balance_usd - $2, 0) WHERE user_id = $1`,
        [session.user_id, debitApplied],
      );
      await client.query(
        `
        UPDATE call_sessions
        SET status = 'settled', settled_at = $2
        WHERE call_session_id = $1
        `,
        [callSessionId, new Date(nowMs)],
      );

      await client.query("COMMIT");
      return { idempotent: false, pending: false };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async reconcilePending(nowMs: number): Promise<{ resolved: number; pending: number }> {
    const pending = await this.pool.query<{
      event_id: string;
      call_session_id: string;
      duration_seconds: number;
    }>(
      `
      SELECT event_id, call_session_id, duration_seconds
      FROM pending_settlements
      ORDER BY created_at ASC
      LIMIT 100
      `,
    );
    let resolved = 0;
    for (const row of pending.rows) {
      const result = await this.settleCall(
        `${row.event_id}:reconcile`,
        row.call_session_id,
        row.duration_seconds,
        nowMs,
      );
      if (!result.pending) {
        await this.pool.query(`DELETE FROM pending_settlements WHERE event_id = $1`, [
          row.event_id,
        ]);
        resolved += 1;
      }
    }

    const remaining = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM pending_settlements`,
    );
    return { resolved, pending: Number(remaining.rows[0]?.count ?? 0) };
  }

  async getBalance(userId: string): Promise<number> {
    const q = await this.pool.query<{ balance_usd: string }>(
      `SELECT balance_usd FROM wallet_balances WHERE user_id = $1`,
      [userId],
    );
    return Number(q.rows[0]?.balance_usd ?? 0);
  }

  async upsertDestinationRate(
    prefix: string,
    rateUsdPerMin: number,
    actorUserId: string,
    nowMs: number,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `
        INSERT INTO destination_rates (prefix, rate_usd_per_min)
        VALUES ($1, $2)
        ON CONFLICT (prefix) DO UPDATE
        SET rate_usd_per_min = EXCLUDED.rate_usd_per_min
        `,
        [prefix, rateUsdPerMin],
      );
      await client.query(
        `
        INSERT INTO admin_audit_log (action, actor_user_id, details, created_at)
        VALUES ('RATE_UPSERT', $1, $2, $3)
        `,
        [actorUserId, JSON.stringify({ prefix, rateUsdPerMin }), new Date(nowMs)],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async listDestinationRates(): Promise<DestinationRate[]> {
    const q = await this.pool.query<{ prefix: string; rate_usd_per_min: string }>(
      `
      SELECT prefix, rate_usd_per_min
      FROM destination_rates
      ORDER BY prefix ASC
      `,
    );
    return q.rows.map((r) => ({
      prefix: r.prefix,
      rateUsdPerMin: Number(r.rate_usd_per_min),
    }));
  }

  async listAuditEntries(limit: number): Promise<AuditEntry[]> {
    const q = await this.pool.query<{
      action: string;
      actor_user_id: string;
      details: string;
      created_at: Date;
    }>(
      `
      SELECT action, actor_user_id, details, created_at
      FROM admin_audit_log
      ORDER BY created_at DESC
      LIMIT $1
      `,
      [limit],
    );
    return q.rows.map((r) => ({
      action: r.action,
      actorUserId: r.actor_user_id,
      details: r.details,
      createdAtMs: new Date(r.created_at).getTime(),
    }));
  }

  private generateToken(): string {
    return String(crypto.randomInt(10000000, 99999999));
  }

  private async lookupRate(destination: string): Promise<number | null> {
    const q = await this.pool.query<{ rate_usd_per_min: string }>(
      `
      SELECT rate_usd_per_min
      FROM destination_rates
      WHERE $1 LIKE prefix || '%'
      ORDER BY LENGTH(prefix) DESC
      LIMIT 1
      `,
      [destination],
    );
    if (q.rowCount && q.rows[0]) {
      return toRetailRate(Number(q.rows[0].rate_usd_per_min));
    }
    return fallbackRate(destination);
  }

  private async ensureSchema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
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
      `);
    } finally {
      client.release();
    }
  }
}
