import type { RateAuthorizeResult, TokenVerifyResult } from "../domain/types.js";

export type DestinationRate = {
  prefix: string;
  rateUsdPerMin: number;
};

export type AuditEntry = {
  action: string;
  actorUserId: string;
  details: string;
  createdAtMs: number;
};

export interface StateStore {
  bootstrapUser(
    googleUserId: string,
    email: string,
    nowMs: number,
  ): Promise<{ userId: string; token: string }>;
  creditWallet(
    userId: string,
    amountUsd: number,
    source: string,
    sourceId: string,
    nowMs: number,
  ): Promise<boolean>;
  verifyToken(
    callSessionId: string,
    ani: string,
    token: string,
    nowMs: number,
  ): Promise<TokenVerifyResult>;
  rateAuthorize(
    callSessionId: string,
    userId: string,
    destination: string,
    nowMs: number,
  ): Promise<RateAuthorizeResult>;
  settleCall(
    eventId: string,
    callSessionId: string,
    durationSeconds: number,
    nowMs: number,
  ): Promise<{ idempotent: boolean; pending: boolean }>;
  reconcilePending(nowMs: number): Promise<{ resolved: number; pending: number }>;
  getBalance(userId: string): Promise<number>;
  upsertDestinationRate(
    prefix: string,
    rateUsdPerMin: number,
    actorUserId: string,
    nowMs: number,
  ): Promise<void>;
  listDestinationRates(): Promise<DestinationRate[]>;
  listAuditEntries(limit: number): Promise<AuditEntry[]>;
}
