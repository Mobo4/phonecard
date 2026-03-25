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
const TEXML_SAY_VOICE = process.env.TEXML_SAY_VOICE ?? "Azure.fa-IR-DilaraNeural";
const TEXML_SAY_LANGUAGE = process.env.TEXML_SAY_LANGUAGE ?? "fa-IR";
const TEXML_OUTBOUND_CALLER_ID = process.env.TEXML_OUTBOUND_CALLER_ID ?? "+19496930614";
const INTERNAL_DIAG_KEY = process.env.INTERNAL_DIAG_KEY;
const MIN_RECHARGE_USD = (() => {
  const parsed = Number.parseFloat(process.env.MIN_RECHARGE_USD ?? "10");
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 10;
  }
  return Number(parsed.toFixed(2));
})();
const TEXML_DIAL_TIMEOUT_SECONDS = (() => {
  const value = Number.parseInt(process.env.TEXML_DIAL_TIMEOUT_SECONDS ?? "60", 10);
  if (!Number.isFinite(value)) {
    return 60;
  }
  return Math.min(120, Math.max(5, value));
})();

type RawBodyRequest = express.Request & { rawBody?: Buffer };
type VoiceStatusEvent = {
  timestampMs: number;
  type: "number_status" | "dial_complete";
  callSessionId: string | null;
  callSid: string | null;
  dialCallSid: string | null;
  status: string | null;
  destination: string | null;
  from: string | null;
  hangupCause: string | null;
  sipResponseCode: string | null;
  raw: Record<string, unknown>;
};

type IvrTraceEvent = {
  timestampMs: number;
  step: string;
  callSessionId: string | null;
  from: string | null;
  to: string | null;
  digitsLength: number | null;
  source: "texml_form" | "json_api";
};

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

const renderSay = (text: string): string => {
  const voiceAttr = TEXML_SAY_VOICE ? ` voice="${xmlEscape(TEXML_SAY_VOICE)}"` : "";
  const languageAttr = TEXML_SAY_LANGUAGE
    ? ` language="${xmlEscape(TEXML_SAY_LANGUAGE)}"`
    : "";
  return `<Say${voiceAttr}${languageAttr}>${xmlEscape(text)}</Say>`;
};

const pickString = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }
  return undefined;
};

const normalizeTokenInput = (value: string | undefined): string =>
  (value ?? "").replace(/\D/g, "");

const normalizeDestinationInput = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }
  let normalized = value.trim().replace(/[^\d+]/g, "");
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("011")) {
    normalized = `+${normalized.slice(3)}`;
  } else if (normalized.startsWith("00")) {
    normalized = `+${normalized.slice(2)}`;
  } else if (!normalized.startsWith("+")) {
    normalized = `+${normalized}`;
  }

  const digitsOnly = normalized.slice(1).replace(/\D/g, "");
  const e164 = `+${digitsOnly}`;
  if (!/^\+\d{8,15}$/.test(e164)) {
    return null;
  }
  return e164;
};

const readCallSessionId = (body: Record<string, unknown>): string | null => {
  const candidates = [
    "callSessionId",
    "CallSessionId",
    "CallSid",
    "CallControlId",
    "call_control_id",
    "ParentCallSid",
    "CallLegId",
    "call_leg_id",
  ];
  for (const key of candidates) {
    const value = pickString(body[key]);
    if (value && value.length > 0) {
      return value;
    }
  }
  return null;
};

const absoluteUrl = (req: express.Request, pathWithQuery: string): string => {
  if (/^https?:\/\//i.test(pathWithQuery)) {
    return pathWithQuery;
  }
  const forwardedProto = req.header("x-forwarded-proto");
  const proto = (forwardedProto?.split(",")[0]?.trim() || req.protocol || "https").toLowerCase();
  const host = req.header("x-forwarded-host") ?? req.header("host");
  if (!host) {
    return pathWithQuery;
  }
  return `${proto}://${host}${pathWithQuery}`;
};

const renderAllowTexml = (
  destination: string,
  rateUsdPerMin: number,
  announcedMinutes: number,
  maxCallSeconds: number,
  dialActionUrl?: string,
  numberStatusCallbackUrl?: string,
): string => {
  const country = countryNameFromDestination(destination);
  const announcement = `هزینه تماس به ${country} حدود ${rateUsdPerMin.toFixed(
    2,
  )} دلار در دقیقه است. شما حدود ${announcedMinutes} دقیقه زمان دارید.`;
  const actionAttributes = dialActionUrl
    ? ` action="${xmlEscape(dialActionUrl)}" method="POST"`
    : "";
  const callerIdAttributes = TEXML_OUTBOUND_CALLER_ID
    ? ` callerId="${xmlEscape(TEXML_OUTBOUND_CALLER_ID)}"`
    : "";
  const numberStatusAttributes = numberStatusCallbackUrl
    ? ` statusCallback="${xmlEscape(
        numberStatusCallbackUrl,
      )}" statusCallbackEvent="initiated ringing answered completed" statusCallbackMethod="POST"`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${renderSay(announcement)}
  <Dial timeLimit="${Math.max(1, Math.floor(maxCallSeconds))}" timeout="${TEXML_DIAL_TIMEOUT_SECONDS}"${callerIdAttributes}${actionAttributes}>
    <Number${numberStatusAttributes}>${xmlEscape(destination)}</Number>
  </Dial>
</Response>`;
};

const renderPinGatherTexml = (actionUrl: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="dtmf" numDigits="8" timeout="8" action="${xmlEscape(actionUrl)}" method="POST">
    ${renderSay("لطفا رمز هشت رقمی خود را وارد کنید.")}
  </Gather>
  ${renderSay("رمزی دریافت نشد.")}
  <Hangup/>
</Response>`;

const renderDestinationGatherTexml = (actionUrl: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="dtmf" timeout="20" finishOnKey="#" action="${xmlEscape(actionUrl)}" method="POST">
    ${renderSay(
      "شماره مقصد را با کد کشور وارد کنید. برای مثال صفر صفر نود و هشت سپس شماره، و در پایان مربع.",
    )}
  </Gather>
  ${renderSay("شماره مقصد دریافت نشد.")}
  <Hangup/>
</Response>`;

const renderMessageAndHangupTexml = (message: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${renderSay(message)}
  <Hangup/>
</Response>`;

const renderHangupTexml = (): string => `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Hangup/>
</Response>`;

const renderPinStartTexml = (actionUrl: string): string => renderPinGatherTexml(actionUrl);

const renderDenyTexml = (reasonCode: RateAuthorizeResult["reasonCode"]): string => {
  let message = "در حال حاضر امکان برقراری تماس وجود ندارد.";
  if (reasonCode === "INSUFFICIENT_BALANCE") {
    message = "موجودی کافی نیست. لطفا حساب خود را شارژ کنید.";
  } else if (reasonCode === "COUNTRY_BLOCKED") {
    message = "تماس با این مقصد در دسترس نیست.";
  } else if (reasonCode === "DESTINATION_UNSUPPORTED") {
    message = "این مقصد پشتیبانی نمی‌شود.";
  } else if (reasonCode === "USER_MISMATCH") {
    message = "خطای احراز هویت. لطفا دوباره تلاش کنید.";
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${renderSay(message)}
  <Hangup/>
</Response>`;
};

export const createApp = (opts: CreateAppOptions = {}) => {
  const app = express();
  const state = opts.state ?? new InMemoryState();
  const now = opts.now ?? nowDefault;
  const recentVoiceStatusEvents: VoiceStatusEvent[] = [];
  const recentIvrTraceEvents: IvrTraceEvent[] = [];
  const appendVoiceStatusEvent = (event: VoiceStatusEvent) => {
    recentVoiceStatusEvents.push(event);
    if (recentVoiceStatusEvents.length > 200) {
      recentVoiceStatusEvents.splice(0, recentVoiceStatusEvents.length - 200);
    }
  };
  const appendIvrTraceEvent = (event: IvrTraceEvent) => {
    recentIvrTraceEvents.push(event);
    if (recentIvrTraceEvents.length > 200) {
      recentIvrTraceEvents.splice(0, recentIvrTraceEvents.length - 200);
    }
  };

  const parseBearerToken = (req: express.Request): string | null => {
    const authHeader = req.header("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return null;
    }
    return authHeader.slice("Bearer ".length).trim();
  };

  const authorizeInternalDiagnostics = (
    req: express.Request,
    res: express.Response,
  ): boolean => {
    if (!INTERNAL_DIAG_KEY) {
      return true;
    }
    const key = req.header("x-internal-key");
    if (key !== INTERNAL_DIAG_KEY) {
      res.status(401).json({ error: "invalid_internal_key" });
      return false;
    }
    return true;
  };

  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as RawBodyRequest).rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(
    express.urlencoded({
      extended: false,
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
    if (parsed.data.amountUsd < MIN_RECHARGE_USD) {
      return res.status(400).json({
        error: "minimum_recharge_not_met",
        minRechargeUsd: MIN_RECHARGE_USD,
      });
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

  app.get("/admin/voice-status", async (req, res) => {
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
    const events = recentVoiceStatusEvents.slice(-limit).reverse();
    return res.status(200).json({ events });
  });

  app.get("/internal/voice-status", async (req, res) => {
    if (!authorizeInternalDiagnostics(req, res)) {
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
    const events = recentVoiceStatusEvents.slice(-limit).reverse();
    return res.status(200).json({ events });
  });

  app.get("/internal/ivr-trace", async (req, res) => {
    if (!authorizeInternalDiagnostics(req, res)) {
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
    const events = recentIvrTraceEvents.slice(-limit).reverse();
    return res.status(200).json({ events });
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
    if (parsed.data.data.amountUsd < MIN_RECHARGE_USD) {
      return res.status(400).json({
        error: "minimum_recharge_not_met",
        minRechargeUsd: MIN_RECHARGE_USD,
      });
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
        ? `هزینه این تماس حدود ${result.rate.toFixed(2)} دلار در دقیقه است. شما حدود ${result.announcedMinutes} دقیقه زمان دارید.`
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

  app.get("/voice/texml/connect", async (req, res) => {
    const step = (pickString(req.query.step) ?? "start").toLowerCase();
    if (step !== "start") {
      res.set("content-type", "text/xml; charset=utf-8");
      return res.status(200).send(renderMessageAndHangupTexml("درخواست نامعتبر است."));
    }
    const pinAction = absoluteUrl(req, "/voice/texml/connect?step=verify_pin");
    res.set("content-type", "text/xml; charset=utf-8");
    return res.status(200).send(renderPinStartTexml(pinAction));
  });

  app.post("/voice/texml/connect", async (req, res) => {
    const body =
      typeof req.body === "object" && req.body !== null
        ? (req.body as Record<string, unknown>)
        : {};
    const step = (pickString(req.query.step) ?? "start").toLowerCase();
    const isJsonConnectPayload =
      step === "start" &&
      typeof body.callSessionId === "string" &&
      typeof body.userId === "string" &&
      typeof body.destination === "string";

    if (!isJsonConnectPayload) {
      appendIvrTraceEvent({
        timestampMs: now(),
        step,
        callSessionId: readCallSessionId(body),
        from: pickString(body.From) ?? pickString(body.from) ?? null,
        to: pickString(body.To) ?? pickString(body.to) ?? null,
        digitsLength: (() => {
          const digits = pickString(body.Digits);
          return digits ? digits.length : null;
        })(),
        source: "texml_form",
      });
      const sendXml = (xml: string) => {
        res.set("content-type", "text/xml; charset=utf-8");
        return res.status(200).send(xml);
      };

      if (step === "verify_pin") {
        const callSessionId = readCallSessionId(body);
        const ani = pickString(body.From) ?? pickString(body.from) ?? "unknown";
        const token = normalizeTokenInput(pickString(body.Digits));
        if (!callSessionId || token.length !== 8) {
          return sendXml(
            renderMessageAndHangupTexml(
              "رمز نامعتبر است. لطفا دوباره تماس بگیرید و رمز هشت رقمی را وارد کنید.",
            ),
          );
        }
        const verified = await state.verifyToken(callSessionId, ani, token, now());
        if (!verified.allow || !verified.userId) {
          const message =
            verified.reasonCode === "TOKEN_LOCKED"
              ? "پس از چند تلاش ناموفق، ورود رمز موقتا قفل شده است. لطفا بعدا دوباره تلاش کنید."
              : "رمز وارد شده نامعتبر است. لطفا دوباره تلاش کنید.";
          return sendXml(renderMessageAndHangupTexml(message));
        }
        const destinationAction = absoluteUrl(
          req,
          `/voice/texml/connect?step=collect_destination&userId=${encodeURIComponent(
            verified.userId,
          )}`,
        );
        return sendXml(renderDestinationGatherTexml(destinationAction));
      }

      if (step === "collect_destination") {
        const userId = pickString(req.query.userId);
        const callSessionId = readCallSessionId(body);
        const destination = normalizeDestinationInput(pickString(body.Digits));
        if (!userId || !callSessionId || !destination) {
          return sendXml(
            renderMessageAndHangupTexml(
              "فرمت شماره مقصد نادرست است. لطفا شماره بین المللی کامل را وارد کنید.",
            ),
          );
        }

        const result = await state.rateAuthorize(callSessionId, userId, destination, now());
        if (
          result.allow &&
          typeof result.rate === "number" &&
          typeof result.announcedMinutes === "number" &&
          typeof result.maxCallSeconds === "number"
        ) {
          const dialCompleteAction = absoluteUrl(
            req,
            `/voice/texml/dial-complete?callSessionId=${encodeURIComponent(callSessionId)}`,
          );
          const numberStatusCallback = absoluteUrl(
            req,
            `/webhooks/telnyx/number-status?callSessionId=${encodeURIComponent(callSessionId)}`,
          );
          return sendXml(
            renderAllowTexml(
              destination,
              result.rate,
              result.announcedMinutes,
              result.maxCallSeconds,
              dialCompleteAction,
              numberStatusCallback,
            ),
          );
        }
        return sendXml(renderDenyTexml(result.reasonCode));
      }

      const pinAction = absoluteUrl(req, "/voice/texml/connect?step=verify_pin");
      return sendXml(renderPinStartTexml(pinAction));
    }

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
    appendIvrTraceEvent({
      timestampMs: now(),
      step: "json_connect",
      callSessionId: parsed.data.callSessionId,
      from: null,
      to: parsed.data.destination,
      digitsLength: null,
      source: "json_api",
    });

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

  app.post("/voice/texml/dial-complete", async (req, res) => {
    const body =
      typeof req.body === "object" && req.body !== null
        ? (req.body as Record<string, unknown>)
        : {};
    const callSessionId =
      pickString(req.query.callSessionId) ?? readCallSessionId(body);
    const durationRaw = pickString(body.DialCallDuration) ?? pickString(body.CallDuration);
    const durationSeconds = Number.parseInt(durationRaw ?? "0", 10);
    if (callSessionId && Number.isFinite(durationSeconds) && durationSeconds >= 0) {
      const dialSid = pickString(body.DialCallSid) ?? pickString(body.CallSid) ?? "unknown";
      const sequence =
        pickString(body.SequenceNumber) ??
        pickString(body.Timestamp) ??
        String(durationSeconds);
      const eventId = `texml-dial-complete:${dialSid}:${sequence}`;
      await state.settleCall(eventId, callSessionId, durationSeconds, now());
      appendVoiceStatusEvent({
        timestampMs: now(),
        type: "dial_complete",
        callSessionId,
        callSid: pickString(body.CallSid) ?? null,
        dialCallSid: pickString(body.DialCallSid) ?? null,
        status:
          pickString(body.DialCallStatus) ??
          pickString(body.CallStatus) ??
          pickString(body.CallState) ??
          "completed",
        destination:
          pickString(body.To) ??
          pickString(body.Called) ??
          pickString(body.DialTo) ??
          null,
        from: pickString(body.From) ?? pickString(body.Caller) ?? null,
        hangupCause:
          pickString(body.HangupCause) ??
          pickString(body.DialHangupCause) ??
          pickString(body.HangupCauseCode) ??
          null,
        sipResponseCode: pickString(body.SipResponseCode) ?? null,
        raw: body,
      });
    }
    res.set("content-type", "text/xml; charset=utf-8");
    return res.status(200).send(renderHangupTexml());
  });

  app.post("/webhooks/telnyx/number-status", async (req, res) => {
    const body =
      typeof req.body === "object" && req.body !== null
        ? (req.body as Record<string, unknown>)
        : {};
    const callSessionId = pickString(req.query.callSessionId);
    const status =
      pickString(body.CallStatus) ??
      pickString(body.DialCallStatus) ??
      pickString(body.CallState);
    const destination = pickString(body.To) ?? pickString(body.Called) ?? pickString(body.DialTo);
    appendVoiceStatusEvent({
      timestampMs: now(),
      type: "number_status",
      callSessionId: callSessionId ?? null,
      callSid: pickString(body.CallSid) ?? null,
      dialCallSid: pickString(body.DialCallSid) ?? null,
      status: status ?? null,
      destination: destination ?? null,
      from: pickString(body.From) ?? pickString(body.Caller) ?? null,
      hangupCause:
        pickString(body.HangupCause) ??
        pickString(body.DialHangupCause) ??
        pickString(body.HangupCauseCode) ??
        null,
      sipResponseCode: pickString(body.SipResponseCode) ?? null,
      raw: body,
    });
    return res.status(200).json({
      accepted: true,
      callSessionId: callSessionId ?? null,
      status: status ?? null,
      destination: destination ?? null,
    });
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
      const formBody =
        typeof req.body === "object" && req.body !== null
          ? (req.body as Record<string, unknown>)
          : {};
      const callStatus = (pickString(formBody.CallStatus) ?? "").toLowerCase();
      const callSessionId =
        pickString(formBody.CallSessionId) ??
        pickString(formBody.CallSid) ??
        pickString(formBody.ParentCallSid);
      const durationRaw =
        pickString(formBody.DialCallDuration) ?? pickString(formBody.CallDuration);
      const durationSeconds = Number.parseInt(durationRaw ?? "0", 10);
      if (callStatus) {
        if (callStatus !== "completed") {
          return res.status(200).json({ accepted: false, reason: "event_ignored" });
        }
        if (
          !callSessionId ||
          !Number.isFinite(durationSeconds) ||
          durationSeconds < 0
        ) {
          return res.status(400).json({ error: "invalid_payload" });
        }
        const eventId = `texml-call-completed:${
          pickString(formBody.CallSid) ?? callSessionId
        }:${pickString(formBody.SequenceNumber) ?? pickString(formBody.Timestamp) ?? durationSeconds}`;
        const settled = await state.settleCall(
          eventId,
          callSessionId,
          durationSeconds,
          now(),
        );
        return res.status(200).json({
          accepted: true,
          idempotent: settled.idempotent,
          pending: settled.pending,
        });
      }
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
