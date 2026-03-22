import { hashToken } from "../lib/hash.js";
import type {
  CallSession,
  RateAuthorizeResult,
  TokenVerifyResult,
  TokenRecord,
  User,
  WalletLedgerEntry,
} from "../domain/types.js";
import type { AuditEntry, DestinationRate, StateStore } from "./state-store.js";

type PendingSettlement = {
  eventId: string;
  callSessionId: string;
  durationSeconds: number;
  createdAtMs: number;
};

const MIN_CONNECT_SECONDS = 60;
const SAFETY_BUFFER_SECONDS = 5;
const LOCK_MS = 15 * 60 * 1000;
const BLOCKED_COUNTRY_PREFIXES = (process.env.BLOCKED_COUNTRY_PREFIXES ?? "")
  .split(",")
  .map((p) => p.trim())
  .filter((p) => p.length > 0);

const fallbackRateForDestination = (destination: string): number | null => {
  if (destination.startsWith("+98")) {
    return 0.35;
  }
  if (destination.startsWith("+937")) {
    return 0.24;
  }
  if (destination.startsWith("+93")) {
    return 0.2;
  }
  return null;
};

const countryBlocked = (destination: string): boolean =>
  BLOCKED_COUNTRY_PREFIXES.some((prefix) => destination.startsWith(prefix));

export class InMemoryState implements StateStore {
  private userSeq = 1;
  private tokenSeq = 10000000;
  private ledgerSeq = 1;

  private usersById = new Map<string, User>();
  private usersByGoogleId = new Map<string, User>();
  private tokensByHash = new Map<string, TokenRecord>();
  private walletBalanceByUserId = new Map<string, number>();
  private walletLedger: WalletLedgerEntry[] = [];
  private callSessionsById = new Map<string, CallSession>();
  private idempotencySources = new Set<string>();
  private tokenFailByAni = new Map<string, number>();
  private tokenLockUntilByAni = new Map<string, number>();
  private pendingSettlements: PendingSettlement[] = [];
  private destinationRateOverrides = new Map<string, number>();
  private auditEntries: AuditEntry[] = [];

  bootstrapUser(
    googleUserId: string,
    email: string,
    nowMs: number,
  ): Promise<{ userId: string; token: string }> {
    const existing = this.usersByGoogleId.get(googleUserId);
    if (existing) {
      const token = this.rotateToken(existing.id, nowMs);
      return Promise.resolve({ userId: existing.id, token });
    }

    const user: User = {
      id: `u_${this.userSeq++}`,
      googleUserId,
      email,
      createdAtMs: nowMs,
    };
    this.usersById.set(user.id, user);
    this.usersByGoogleId.set(user.googleUserId, user);
    this.walletBalanceByUserId.set(user.id, 0);
    const token = this.rotateToken(user.id, nowMs);
    return Promise.resolve({ userId: user.id, token });
  }

  rotateToken(userId: string, nowMs: number): string {
    const token = String(this.tokenSeq++);
    const tokenRecord: TokenRecord = {
      userId,
      tokenHash: hashToken(token),
      active: true,
      createdAtMs: nowMs,
    };
    this.tokensByHash.set(tokenRecord.tokenHash, tokenRecord);
    return token;
  }

  creditWallet(
    userId: string,
    amountUsd: number,
    source: string,
    sourceId: string,
    nowMs: number,
  ): Promise<boolean> {
    const idemKey = `${source}:${sourceId}`;
    if (this.idempotencySources.has(idemKey)) {
      return Promise.resolve(false);
    }
    this.idempotencySources.add(idemKey);
    const current = this.walletBalanceByUserId.get(userId) ?? 0;
    this.walletBalanceByUserId.set(userId, current + amountUsd);
    this.walletLedger.push({
      id: `l_${this.ledgerSeq++}`,
      userId,
      amountUsd,
      type: "credit",
      source,
      sourceId,
      createdAtMs: nowMs,
    });
    return Promise.resolve(true);
  }

  verifyToken(
    callSessionId: string,
    ani: string,
    token: string,
    nowMs: number,
  ): Promise<TokenVerifyResult> {
    const lockUntil = this.tokenLockUntilByAni.get(ani);
    if (lockUntil && lockUntil > nowMs) {
      return Promise.resolve({ allow: false, statusCode: 423, reasonCode: "TOKEN_LOCKED" });
    }

    const record = this.tokensByHash.get(hashToken(token));
    if (!record) {
      const attempts = (this.tokenFailByAni.get(ani) ?? 0) + 1;
      this.tokenFailByAni.set(ani, attempts);
      if (attempts >= 3) {
        this.tokenLockUntilByAni.set(ani, nowMs + LOCK_MS);
        return Promise.resolve({ allow: false, statusCode: 423, reasonCode: "TOKEN_LOCKED" });
      }
      return Promise.resolve({ allow: false, statusCode: 401, reasonCode: "TOKEN_INVALID" });
    }

    if (!record.active) {
      return Promise.resolve({ allow: false, statusCode: 403, reasonCode: "TOKEN_INACTIVE" });
    }

    this.tokenFailByAni.delete(ani);
    this.callSessionsById.set(callSessionId, {
      callSessionId,
      userId: record.userId,
      destination: "",
      retailRateUsdPerMin: 0,
      authorizedMaxSeconds: 0,
      announcedMinutes: 0,
      status: "authorized",
      createdAtMs: nowMs,
    });
    return Promise.resolve({
      allow: true,
      statusCode: 200,
      reasonCode: "ALLOW",
      userId: record.userId,
    });
  }

  rateAuthorize(
    callSessionId: string,
    userId: string,
    destination: string,
    nowMs: number,
  ): Promise<RateAuthorizeResult> {
    const existing = this.callSessionsById.get(callSessionId);
    if (existing && existing.userId !== userId) {
      return Promise.resolve({
        allow: false,
        statusCode: 403,
        reasonCode: "USER_MISMATCH",
      });
    }

    if (countryBlocked(destination)) {
      this.callSessionsById.set(callSessionId, {
        callSessionId,
        userId,
        destination,
        retailRateUsdPerMin: 0,
        authorizedMaxSeconds: 0,
        announcedMinutes: 0,
        status: "denied",
        createdAtMs: nowMs,
      });
      return Promise.resolve({
        allow: false,
        statusCode: 403,
        reasonCode: "COUNTRY_BLOCKED",
      });
    }

    const rate = this.lookupRate(destination);
    if (rate === null) {
      return Promise.resolve({
        allow: false,
        statusCode: 403,
        reasonCode: "DESTINATION_UNSUPPORTED",
      });
    }

    const balance = this.walletBalanceByUserId.get(userId) ?? 0;
    const rawSeconds = Math.floor((balance / rate) * 60);
    const maxCallSeconds = Math.max(0, rawSeconds - SAFETY_BUFFER_SECONDS);
    if (maxCallSeconds < MIN_CONNECT_SECONDS) {
      return Promise.resolve({
        allow: false,
        statusCode: 402,
        reasonCode: "INSUFFICIENT_BALANCE",
      });
    }

    const announcedMinutes = Math.floor(maxCallSeconds / 60);
    this.callSessionsById.set(callSessionId, {
      callSessionId,
      userId,
      destination,
      retailRateUsdPerMin: rate,
      authorizedMaxSeconds: maxCallSeconds,
      announcedMinutes,
      status: "authorized",
      createdAtMs: nowMs,
    });
    return Promise.resolve({
      allow: true,
      statusCode: 200,
      reasonCode: "ALLOW",
      rate,
      announcedMinutes,
      maxCallSeconds,
    });
  }

  settleCall(
    eventId: string,
    callSessionId: string,
    durationSeconds: number,
    nowMs: number,
  ): Promise<{ idempotent: boolean; pending: boolean }> {
    const idemKey = `telnyx:${eventId}`;
    if (this.idempotencySources.has(idemKey)) {
      return Promise.resolve({ idempotent: true, pending: false });
    }
    this.idempotencySources.add(idemKey);

    const session = this.callSessionsById.get(callSessionId);
    if (!session || session.status === "denied") {
      this.pendingSettlements.push({
        eventId,
        callSessionId,
        durationSeconds,
        createdAtMs: nowMs,
      });
      return Promise.resolve({ idempotent: false, pending: true });
    }

    if (session.status === "settled") {
      return Promise.resolve({ idempotent: true, pending: false });
    }

    const billableSeconds = Math.min(durationSeconds, session.authorizedMaxSeconds);
    const debit = Number(
      ((session.retailRateUsdPerMin * billableSeconds) / 60).toFixed(4),
    );
    const current = this.walletBalanceByUserId.get(session.userId) ?? 0;
    const debitApplied = Math.min(current, debit);
    this.walletBalanceByUserId.set(session.userId, current - debitApplied);
    this.walletLedger.push({
      id: `l_${this.ledgerSeq++}`,
      userId: session.userId,
      amountUsd: -debitApplied,
      type: "debit",
      source: "telnyx",
      sourceId: eventId,
      createdAtMs: nowMs,
    });
    session.status = "settled";
    session.settledAtMs = nowMs;
    this.callSessionsById.set(session.callSessionId, session);
    return Promise.resolve({ idempotent: false, pending: false });
  }

  async reconcilePending(nowMs: number): Promise<{ resolved: number; pending: number }> {
    const stillPending: PendingSettlement[] = [];
    let resolved = 0;
    for (const p of this.pendingSettlements) {
      const session = this.callSessionsById.get(p.callSessionId);
      if (!session) {
        stillPending.push(p);
        continue;
      }
      await this.settleCall(`${p.eventId}:reconcile`, p.callSessionId, p.durationSeconds, nowMs);
      resolved += 1;
    }
    this.pendingSettlements = stillPending;
    return Promise.resolve({ resolved, pending: stillPending.length });
  }

  getBalance(userId: string): Promise<number> {
    return Promise.resolve(this.walletBalanceByUserId.get(userId) ?? 0);
  }

  upsertDestinationRate(
    prefix: string,
    rateUsdPerMin: number,
    actorUserId: string,
    nowMs: number,
  ): Promise<void> {
    this.destinationRateOverrides.set(prefix, rateUsdPerMin);
    this.auditEntries.push({
      action: "RATE_UPSERT",
      actorUserId,
      details: JSON.stringify({ prefix, rateUsdPerMin }),
      createdAtMs: nowMs,
    });
    return Promise.resolve();
  }

  listDestinationRates(): Promise<DestinationRate[]> {
    const rates = Array.from(this.destinationRateOverrides.entries()).map(
      ([prefix, rateUsdPerMin]) => ({ prefix, rateUsdPerMin }),
    );
    rates.sort((a, b) => a.prefix.localeCompare(b.prefix));
    return Promise.resolve(rates);
  }

  listAuditEntries(limit: number): Promise<AuditEntry[]> {
    const entries = [...this.auditEntries]
      .sort((a, b) => b.createdAtMs - a.createdAtMs)
      .slice(0, limit);
    return Promise.resolve(entries);
  }

  private lookupRate(destination: string): number | null {
    let selectedPrefix: string | null = null;
    let selectedRate: number | null = null;
    for (const [prefix, rate] of this.destinationRateOverrides.entries()) {
      if (!destination.startsWith(prefix)) {
        continue;
      }
      if (!selectedPrefix || prefix.length > selectedPrefix.length) {
        selectedPrefix = prefix;
        selectedRate = rate;
      }
    }
    if (selectedRate !== null) {
      return selectedRate;
    }
    return fallbackRateForDestination(destination);
  }
}
