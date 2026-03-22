export type User = {
  id: string;
  googleUserId: string;
  email: string;
  createdAtMs: number;
};

export type TokenRecord = {
  userId: string;
  tokenHash: string;
  active: boolean;
  createdAtMs: number;
};

export type WalletLedgerEntry = {
  id: string;
  userId: string;
  amountUsd: number;
  type: "credit" | "debit";
  source: string;
  sourceId: string;
  createdAtMs: number;
};

export type CallSession = {
  callSessionId: string;
  userId: string;
  destination: string;
  retailRateUsdPerMin: number;
  authorizedMaxSeconds: number;
  announcedMinutes: number;
  status: "authorized" | "settled" | "pending_settlement" | "denied";
  createdAtMs: number;
  settledAtMs?: number;
};

export type TokenVerifyResult = {
  allow: boolean;
  statusCode: number;
  reasonCode:
    | "ALLOW"
    | "TOKEN_INVALID"
    | "TOKEN_LOCKED"
    | "TOKEN_INACTIVE";
  userId?: string;
};

export type RateAuthorizeResult = {
  allow: boolean;
  statusCode: number;
  reasonCode:
    | "ALLOW"
    | "USER_MISMATCH"
    | "COUNTRY_BLOCKED"
    | "DESTINATION_UNSUPPORTED"
    | "INSUFFICIENT_BALANCE";
  rate?: number;
  announcedMinutes?: number;
  maxCallSeconds?: number;
};
