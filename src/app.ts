import express from "express";
import { z } from "zod";
import { InMemoryState } from "./state/in-memory-state.js";
import crypto from "node:crypto";
import type { StateStore } from "./state/state-store.js";
import type { RateAuthorizeResult } from "./domain/types.js";

type CreateAppOptions = {
  state?: StateStore;
  now?: () => number;
  webhookSecrets?: {
    stripe?: string;
    telnyx?: string;
  };
  auth?: {
    requireUserForCheckout?: boolean;
    verifyBearerToken?: (token: string) => Promise<{ userId: string; role?: string } | null>;
  };
};

const nowDefault = (): number => Date.now();

type RawBodyRequest = express.Request & { rawBody?: Buffer };

const countryNameFromDestination = (destination: string): string => {
  if (destination.startsWith("+93")) {
    return "Afghanistan";
  }
  if (destination.startsWith("+98")) {
    return "Iran";
  }
  return "this destination";
};

const xmlEscape = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const renderAllowTexml = (
  destination: string,
  rateUsdPerMin: number,
  announcedMinutes: number,
  maxCallSeconds: number,
): string => {
  const country = countryNameFromDestination(destination);
  const minuteWord = announcedMinutes === 1 ? "minute" : "minutes";
  const announcement = `This call to ${country} is estimated at ${rateUsdPerMin.toFixed(
    2,
  )} dollars per minute. You have about ${announcedMinutes} ${minuteWord}.`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>${xmlEscape(announcement)}</Say>
  <Dial timeLimit="${Math.max(1, Math.floor(maxCallSeconds))}">
    <Number>${xmlEscape(destination)}</Number>
  </Dial>
</Response>`;
};

const renderDenyTexml = (reasonCode: RateAuthorizeResult["reasonCode"]): string => {
  let message = "Your call cannot be completed at this time.";
  if (reasonCode === "INSUFFICIENT_BALANCE") {
    message = "Insufficient balance. Please top up and try again.";
  } else if (reasonCode === "COUNTRY_BLOCKED") {
    message = "Calls to this destination are not available.";
  } else if (reasonCode === "DESTINATION_UNSUPPORTED") {
    message = "That destination is not supported.";
  } else if (reasonCode === "USER_MISMATCH") {
    message = "Authentication mismatch. Please retry.";
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>${xmlEscape(message)}</Say>
  <Hangup/>
</Response>`;
};

export const createApp = (opts: CreateAppOptions = {}) => {
  const app = express();
  const state = opts.state ?? new InMemoryState();
  const now = opts.now ?? nowDefault;

  const parseBearerToken = (req: express.Request): string | null => {
    const authHeader = req.header("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return null;
    }
    return authHeader.slice("Bearer ".length).trim();
  };

  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as RawBodyRequest).rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use((req, res, next) => {
    const requestId = req.header("x-request-id") ?? crypto.randomUUID();
    res.setHeader("x-request-id", requestId);
    next();
  });

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", timestamp: now() });
  });

  app.post("/identity/bootstrap", async (req, res) => {
    const bodySchema = z.object({
      googleUserId: z.string().min(1),
      email: z.email(),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload" });
    }

    const result = await state.bootstrapUser(
      parsed.data.googleUserId,
      parsed.data.email,
      now(),
    );
    return res.status(201).json(result);
  });

  app.post("/payments/checkout-session", async (req, res) => {
    const enforceAuth = opts.auth?.requireUserForCheckout ?? false;
    const bodySchema = z.object({
      userId: z.string().min(1),
      amountUsd: z.number().positive(),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload" });
    }

    if (enforceAuth) {
      const token = parseBearerToken(req);
      if (!token) {
        return res.status(401).json({ error: "missing_bearer_token" });
      }
      if (!opts.auth?.verifyBearerToken) {
        return res.status(500).json({ error: "auth_verifier_not_configured" });
      }
      const identity = await opts.auth.verifyBearerToken(token);
      if (!identity) {
        return res.status(401).json({ error: "invalid_bearer_token" });
      }
      if (identity.userId !== parsed.data.userId) {
        return res.status(403).json({ error: "user_mismatch" });
      }
      const sessionId = `cs_${Math.random().toString(36).slice(2, 12)}`;
      return res.status(200).json({
        checkoutSessionId: sessionId,
        url: `https://checkout.stripe.com/pay/${sessionId}`,
      });
    }

    const sessionId = `cs_${Math.random().toString(36).slice(2, 12)}`;
    return res.status(200).json({
      checkoutSessionId: sessionId,
      url: `https://checkout.stripe.com/pay/${sessionId}`,
    });
  });

  const authorizeAdmin = async (
    req: express.Request,
    res: express.Response,
  ): Promise<{ userId: string; role?: string } | null> => {
    const token = parseBearerToken(req);
    if (!token) {
      res.status(401).json({ error: "missing_bearer_token" });
      return null;
    }
    if (!opts.auth?.verifyBearerToken) {
      res.status(500).json({ error: "auth_verifier_not_configured" });
      return null;
    }
    const identity = await opts.auth.verifyBearerToken(token);
    if (!identity) {
      res.status(401).json({ error: "invalid_bearer_token" });
      return null;
    }
    if (identity.role !== "admin") {
      res.status(403).json({ error: "admin_required" });
      return null;
    }
    return identity;
  };

  app.post("/admin/rates", async (req, res) => {
    const identity = await authorizeAdmin(req, res);
    if (!identity) {
      return;
    }
    const bodySchema = z.object({
      prefix: z.string().regex(/^\+\d+$/),
      rateUsdPerMin: z.number().positive(),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload" });
    }
    await state.upsertDestinationRate(
      parsed.data.prefix,
      parsed.data.rateUsdPerMin,
      identity.userId,
      now(),
    );
    return res.status(200).json({ ok: true });
  });

  app.get("/admin/rates", async (req, res) => {
    const identity = await authorizeAdmin(req, res);
    if (!identity) {
      return;
    }
    const rates = await state.listDestinationRates();
    return res.status(200).json({ rates });
  });

  app.get("/admin/audit", async (req, res) => {
    const identity = await authorizeAdmin(req, res);
    if (!identity) {
      return;
    }
    const querySchema = z.object({
      limit: z.coerce.number().int().positive().max(200).optional(),
    });
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_query" });
    }
    const limit = parsed.data.limit ?? 50;
    const entries = await state.listAuditEntries(limit);
    return res.status(200).json({ entries });
  });

  app.post("/webhooks/stripe", async (req, res) => {
    if (opts.webhookSecrets?.stripe) {
      const signature = req.header("x-webhook-signature");
      const rawBody = (req as RawBodyRequest).rawBody;
      if (!rawBody) {
        return res.status(400).json({ error: "missing_raw_body" });
      }
      const expected = crypto
        .createHmac("sha256", opts.webhookSecrets.stripe)
        .update(rawBody)
        .digest("hex");
      if (!signature || signature !== expected) {
        return res.status(401).json({ error: "invalid_signature" });
      }
    }

    const bodySchema = z.object({
      id: z.string().min(1),
      type: z.string(),
      data: z.object({
        userId: z.string().min(1),
        amountUsd: z.number().positive(),
      }),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload" });
    }
    if (parsed.data.type !== "checkout.session.completed") {
      return res.status(200).json({ accepted: false, reason: "event_ignored" });
    }
    const created = await state.creditWallet(
      parsed.data.data.userId,
      parsed.data.data.amountUsd,
      "stripe",
      parsed.data.id,
      now(),
    );
    return res.status(200).json({ accepted: true, idempotent: !created });
  });

  app.post("/voice/token-verify", async (req, res) => {
    const bodySchema = z.object({
      callSessionId: z.string().min(1),
      ani: z.string().min(5),
      token: z.string().length(8),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload" });
    }
    const result = await state.verifyToken(
      parsed.data.callSessionId,
      parsed.data.ani,
      parsed.data.token,
      now(),
    );
    return res.status(result.statusCode).json(result);
  });

  app.post("/voice/rate-and-authorize", async (req, res) => {
    const bodySchema = z.object({
      callSessionId: z.string().min(1),
      userId: z.string().min(1),
      destination: z.string().min(5),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload" });
    }
    const result = await state.rateAuthorize(
      parsed.data.callSessionId,
      parsed.data.userId,
      parsed.data.destination,
      now(),
    );
    const announcementText =
      result.allow && typeof result.rate === "number" && typeof result.announcedMinutes === "number"
        ? `This call is estimated at ${result.rate.toFixed(2)} dollars per minute. You have about ${result.announcedMinutes} ${
            result.announcedMinutes === 1 ? "minute" : "minutes"
          }.`
        : undefined;
    return res.status(result.statusCode).json({
      allow: result.allow,
      reason_code: result.reasonCode,
      rate: result.rate,
      announced_minutes: result.announcedMinutes,
      max_call_seconds: result.maxCallSeconds,
      announcement_text: announcementText,
    });
  });

  app.post("/voice/texml/connect", async (req, res) => {
    const bodySchema = z.object({
      callSessionId: z.string().min(1),
      userId: z.string().min(1),
      destination: z.string().min(5),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload" });
    }

    const result = await state.rateAuthorize(
      parsed.data.callSessionId,
      parsed.data.userId,
      parsed.data.destination,
      now(),
    );

    if (
      result.allow &&
      typeof result.rate === "number" &&
      typeof result.announcedMinutes === "number" &&
      typeof result.maxCallSeconds === "number"
    ) {
      const xml = renderAllowTexml(
        parsed.data.destination,
        result.rate,
        result.announcedMinutes,
        result.maxCallSeconds,
      );
      res.set("content-type", "text/xml; charset=utf-8");
      return res.status(200).send(xml);
    }

    const xml = renderDenyTexml(result.reasonCode);
    res.set("content-type", "text/xml; charset=utf-8");
    return res.status(200).send(xml);
  });

  app.post("/webhooks/telnyx/voice", async (req, res) => {
    if (opts.webhookSecrets?.telnyx) {
      const signature = req.header("x-telnyx-signature");
      const rawBody = (req as RawBodyRequest).rawBody;
      if (!rawBody) {
        return res.status(400).json({ error: "missing_raw_body" });
      }
      const expected = crypto
        .createHmac("sha256", opts.webhookSecrets.telnyx)
        .update(rawBody)
        .digest("hex");
      if (!signature || signature !== expected) {
        return res.status(401).json({ error: "invalid_signature" });
      }
    }

    const bodySchema = z.object({
      id: z.string().min(1),
      type: z.string(),
      data: z.object({
        callSessionId: z.string().min(1),
        durationSeconds: z.number().int().nonnegative(),
      }),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload" });
    }
    if (parsed.data.type !== "call.hangup") {
      return res.status(200).json({ accepted: false, reason: "event_ignored" });
    }
    const settled = await state.settleCall(
      parsed.data.id,
      parsed.data.data.callSessionId,
      parsed.data.data.durationSeconds,
      now(),
    );
    return res.status(200).json({
      accepted: true,
      idempotent: settled.idempotent,
      pending: settled.pending,
    });
  });

  app.post("/internal/reconcile", async (_req, res) => {
    const result = await state.reconcilePending(now());
    return res.status(200).json(result);
  });

  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const message = err instanceof Error ? err.message : "unknown_error";
      return res.status(500).json({ error: "internal_error", message });
    },
  );

  return app;
};
