import request from "supertest";
import { describe, expect, it, beforeEach } from "vitest";
import { createApp } from "../src/app.js";
import { InMemoryState } from "../src/state/in-memory-state.js";
import crypto from "node:crypto";

describe("primitive api", () => {
  let state: InMemoryState;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    state = new InMemoryState();
    app = createApp({ state, now: () => 1_700_000_000_000 });
  });

  it("bootstraps user with google identity and token", async () => {
    const res = await request(app)
      .post("/identity/bootstrap")
      .send({ googleUserId: "google-1", email: "user@example.com" });

    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^\d{8}$/);
  });

  it("credits wallet through stripe webhook event", async () => {
    const bootstrap = await request(app)
      .post("/identity/bootstrap")
      .send({ googleUserId: "google-2", email: "u2@example.com" });

    const userId = bootstrap.body.userId as string;
    const res = await request(app).post("/webhooks/stripe").send({
      id: "evt_1",
      type: "checkout.session.completed",
      data: { userId, amountUsd: 10 },
    });

    expect(res.status).toBe(200);
    expect(await state.getBalance(userId)).toBe(10);
  });

  it("locks after 3 invalid token attempts", async () => {
    const bootstrap = await request(app)
      .post("/identity/bootstrap")
      .send({ googleUserId: "google-3", email: "u3@example.com" });

    const callSessionId = "call-1";
    for (let i = 0; i < 3; i += 1) {
      const r = await request(app).post("/voice/token-verify").send({
        callSessionId,
        ani: "+15551230000",
        token: "00000000",
      });
      expect([401, 423]).toContain(r.status);
    }

    const final = await request(app).post("/voice/token-verify").send({
      callSessionId,
      ani: "+15551230000",
      token: bootstrap.body.token,
    });
    expect(final.status).toBe(423);
  });

  it("authorizes afghanistan destination and iran", async () => {
    const bootstrap = await request(app)
      .post("/identity/bootstrap")
      .send({ googleUserId: "google-4", email: "u4@example.com" });
    const userId = bootstrap.body.userId as string;

    await request(app).post("/webhooks/stripe").send({
      id: "evt_2",
      type: "checkout.session.completed",
      data: { userId, amountUsd: 25 },
    });

    const af = await request(app).post("/voice/rate-and-authorize").send({
      callSessionId: "call-af",
      userId,
      destination: "+93700111222",
    });
    expect(af.status).toBe(200);
    expect(af.body.allow).toBe(true);
    expect(af.body.max_call_seconds).toBeGreaterThan(0);

    const ir = await request(app).post("/voice/rate-and-authorize").send({
      callSessionId: "call-ir",
      userId,
      destination: "+989123456789",
    });
    expect(ir.status).toBe(200);
    expect(ir.body.allow).toBe(true);
    expect(ir.body.max_call_seconds).toBeGreaterThan(0);
  });

  it("settles debit idempotently on duplicate telnyx webhook", async () => {
    const bootstrap = await request(app)
      .post("/identity/bootstrap")
      .send({ googleUserId: "google-5", email: "u5@example.com" });
    const userId = bootstrap.body.userId as string;

    await request(app).post("/webhooks/stripe").send({
      id: "evt_3",
      type: "checkout.session.completed",
      data: { userId, amountUsd: 10 },
    });

    await request(app).post("/voice/rate-and-authorize").send({
      callSessionId: "call-5",
      userId,
      destination: "+93700111111",
    });

    const payload = {
      id: "telnyx_evt_1",
      type: "call.hangup",
      data: { callSessionId: "call-5", durationSeconds: 120 },
    };
    const first = await request(app).post("/webhooks/telnyx/voice").send(payload);
    const second = await request(app).post("/webhooks/telnyx/voice").send(payload);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.idempotent).toBe(true);
  });

  it("denies authorization when balance is insufficient", async () => {
    const bootstrap = await request(app)
      .post("/identity/bootstrap")
      .send({ googleUserId: "google-6", email: "u6@example.com" });
    const userId = bootstrap.body.userId as string;

    const res = await request(app).post("/voice/rate-and-authorize").send({
      callSessionId: "call-low",
      userId,
      destination: "+93700111333",
    });

    expect(res.status).toBe(402);
    expect(res.body.reason_code).toBe("INSUFFICIENT_BALANCE");
  });

  it("never drives wallet negative on long duration settle", async () => {
    const bootstrap = await request(app)
      .post("/identity/bootstrap")
      .send({ googleUserId: "google-7", email: "u7@example.com" });
    const userId = bootstrap.body.userId as string;

    await request(app).post("/webhooks/stripe").send({
      id: "evt_7",
      type: "checkout.session.completed",
      data: { userId, amountUsd: 1 },
    });

    await request(app).post("/voice/rate-and-authorize").send({
      callSessionId: "call-7",
      userId,
      destination: "+93700111111",
    });

    await request(app).post("/webhooks/telnyx/voice").send({
      id: "telnyx_evt_7",
      type: "call.hangup",
      data: { callSessionId: "call-7", durationSeconds: 99999 },
    });

    expect(await state.getBalance(userId)).toBeGreaterThanOrEqual(0);
  });

  it("reconciles pending settlement once session exists", async () => {
    const pending = await request(app).post("/webhooks/telnyx/voice").send({
      id: "telnyx_evt_pending",
      type: "call.hangup",
      data: { callSessionId: "call-pending", durationSeconds: 30 },
    });
    expect(pending.body.pending).toBe(true);

    const bootstrap = await request(app)
      .post("/identity/bootstrap")
      .send({ googleUserId: "google-8", email: "u8@example.com" });
    const userId = bootstrap.body.userId as string;

    await request(app).post("/webhooks/stripe").send({
      id: "evt_8",
      type: "checkout.session.completed",
      data: { userId, amountUsd: 10 },
    });

    await request(app).post("/voice/rate-and-authorize").send({
      callSessionId: "call-pending",
      userId,
      destination: "+93700111333",
    });

    const rec = await request(app).post("/internal/reconcile").send({});
    expect(rec.status).toBe(200);
    expect(rec.body.resolved).toBeGreaterThanOrEqual(1);
  });

  it("requires webhook signatures when secrets are configured", async () => {
    const signedApp = createApp({
      state: new InMemoryState(),
      now: () => 1_700_000_000_000,
      webhookSecrets: {
        stripe: "stripe_secret",
        telnyx: "telnyx_secret",
      },
    });

    const stripeBody = {
      id: "evt_signed_1",
      type: "checkout.session.completed",
      data: { userId: "u_missing", amountUsd: 1 },
    };
    const unsignedStripe = await request(signedApp)
      .post("/webhooks/stripe")
      .send(stripeBody);
    expect(unsignedStripe.status).toBe(401);

    const stripeSig = crypto
      .createHmac("sha256", "stripe_secret")
      .update(JSON.stringify(stripeBody))
      .digest("hex");
    const signedStripe = await request(signedApp)
      .post("/webhooks/stripe")
      .set("x-webhook-signature", stripeSig)
      .send(stripeBody);
    expect([200, 400]).toContain(signedStripe.status);

    const telnyxBody = {
      id: "telnyx_signed_1",
      type: "call.hangup",
      data: { callSessionId: "call-x", durationSeconds: 3 },
    };
    const unsignedTelnyx = await request(signedApp)
      .post("/webhooks/telnyx/voice")
      .send(telnyxBody);
    expect(unsignedTelnyx.status).toBe(401);
  });

  it("verifies signatures against raw webhook body bytes", async () => {
    const signedApp = createApp({
      state: new InMemoryState(),
      now: () => 1_700_000_000_000,
      webhookSecrets: {
        stripe: "stripe_secret",
      },
    });

    const rawPayload =
      '{  "id":"evt_raw_1" , "type":"checkout.session.completed", "data": { "userId":"u_missing", "amountUsd":1 } }';
    const rawSig = crypto
      .createHmac("sha256", "stripe_secret")
      .update(rawPayload)
      .digest("hex");

    const res = await request(signedApp)
      .post("/webhooks/stripe")
      .set("content-type", "application/json")
      .set("x-webhook-signature", rawSig)
      .send(rawPayload);

    // Must not fail signature check just because JSON is whitespace-formatted.
    expect(res.status).not.toBe(401);
  });

  it("enforces bearer auth for checkout when enabled", async () => {
    const securedApp = createApp({
      state: new InMemoryState(),
      now: () => 1_700_000_000_000,
      auth: {
        requireUserForCheckout: true,
        verifyBearerToken: async () => null,
      },
    });

    const noAuth = await request(securedApp).post("/payments/checkout-session").send({
      userId: "u_1",
      amountUsd: 10,
    });
    expect(noAuth.status).toBe(401);
  });

  it("rejects checkout if bearer user does not match payload user", async () => {
    const securedApp = createApp({
      state: new InMemoryState(),
      now: () => 1_700_000_000_000,
      auth: {
        requireUserForCheckout: true,
        verifyBearerToken: async () => ({ userId: "u_verified" }),
      },
    });

    const mismatch = await request(securedApp)
      .post("/payments/checkout-session")
      .set("authorization", "Bearer test-token")
      .send({ userId: "u_other", amountUsd: 10 });
    expect(mismatch.status).toBe(403);
  });

  it("denies rate authorization on call-session user mismatch", async () => {
    const bootstrapA = await request(app)
      .post("/identity/bootstrap")
      .send({ googleUserId: "google-9", email: "u9@example.com" });
    const userA = bootstrapA.body.userId as string;
    const tokenA = bootstrapA.body.token as string;

    const bootstrapB = await request(app)
      .post("/identity/bootstrap")
      .send({ googleUserId: "google-10", email: "u10@example.com" });
    const userB = bootstrapB.body.userId as string;

    await request(app).post("/webhooks/stripe").send({
      id: "evt_9",
      type: "checkout.session.completed",
      data: { userId: userA, amountUsd: 30 },
    });

    const callSessionId = "call-user-mismatch";
    await request(app).post("/voice/token-verify").send({
      callSessionId,
      ani: "+15550000009",
      token: tokenA,
    });

    const mismatch = await request(app).post("/voice/rate-and-authorize").send({
      callSessionId,
      userId: userB,
      destination: "+93700111222",
    });

    expect(mismatch.status).toBe(403);
    expect(mismatch.body.reason_code).toBe("USER_MISMATCH");
  });

  it("enforces admin auth for rate upsert", async () => {
    const securedApp = createApp({
      state: new InMemoryState(),
      now: () => 1_700_000_000_000,
      auth: {
        requireUserForCheckout: true,
        verifyBearerToken: async (token) => {
          if (token === "admin-token") {
            return { userId: "u_admin", role: "admin" };
          }
          return { userId: "u_user", role: "user" };
        },
      },
    });

    const noAuth = await request(securedApp).post("/admin/rates").send({
      prefix: "+93700",
      rateUsdPerMin: 0.5,
    });
    expect(noAuth.status).toBe(401);

    const nonAdmin = await request(securedApp)
      .post("/admin/rates")
      .set("authorization", "Bearer user-token")
      .send({
        prefix: "+93700",
        rateUsdPerMin: 0.5,
      });
    expect(nonAdmin.status).toBe(403);
  });

  it("allows admin to upsert rate and records audit entry", async () => {
    const securedApp = createApp({
      state: new InMemoryState(),
      now: () => 1_700_000_000_000,
      auth: {
        requireUserForCheckout: true,
        verifyBearerToken: async (token) => {
          if (token === "admin-token") {
            return { userId: "u_admin", role: "admin" };
          }
          return { userId: "u_user", role: "user" };
        },
      },
    });

    const upsert = await request(securedApp)
      .post("/admin/rates")
      .set("authorization", "Bearer admin-token")
      .send({
        prefix: "+93700",
        rateUsdPerMin: 0.5,
      });
    expect(upsert.status).toBe(200);

    const list = await request(securedApp)
      .get("/admin/rates")
      .set("authorization", "Bearer admin-token");
    expect(list.status).toBe(200);
    expect(
      (list.body.rates as Array<{ prefix: string; rateUsdPerMin: number }>).some(
        (r) => r.prefix === "+93700" && r.rateUsdPerMin === 0.5,
      ),
    ).toBe(true);

    const audit = await request(securedApp)
      .get("/admin/audit")
      .set("authorization", "Bearer admin-token");
    expect(audit.status).toBe(200);
    expect(
      (audit.body.entries as Array<{ action: string }>).some(
        (e) => e.action === "RATE_UPSERT",
      ),
    ).toBe(true);
  });

  it("returns TeXML with minutes announcement and hard timeLimit on allow", async () => {
    const bootstrap = await request(app)
      .post("/identity/bootstrap")
      .send({ googleUserId: "google-11", email: "u11@example.com" });
    const userId = bootstrap.body.userId as string;

    await request(app).post("/webhooks/stripe").send({
      id: "evt_11",
      type: "checkout.session.completed",
      data: { userId, amountUsd: 12 },
    });

    const res = await request(app).post("/voice/texml/connect").send({
      callSessionId: "call-texml-allow",
      userId,
      destination: "+93700111111",
    });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/xml");
    expect(res.text).toContain("<Say>");
    expect(res.text).toContain("You have about");
    expect(res.text).toContain("<Dial timeLimit=");
    expect(res.text).toContain("<Number>+93700111111</Number>");
  });

  it("returns TeXML deny + hangup when balance is insufficient", async () => {
    const bootstrap = await request(app)
      .post("/identity/bootstrap")
      .send({ googleUserId: "google-12", email: "u12@example.com" });
    const userId = bootstrap.body.userId as string;

    const res = await request(app).post("/voice/texml/connect").send({
      callSessionId: "call-texml-deny",
      userId,
      destination: "+93700111111",
    });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/xml");
    expect(res.text).toContain("Insufficient balance");
    expect(res.text).toContain("<Hangup/>");
    expect(res.text).not.toContain("<Dial ");
  });

  it("serves initial TeXML PIN gather for Telnyx form webhook", async () => {
    const res = await request(app)
      .post("/voice/texml/connect")
      .type("form")
      .send({
        CallSid: "call-form-start",
        From: "+19495550111",
        To: "+19496930614",
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/xml");
    expect(res.text).toContain("<Gather");
    expect(res.text).toContain("step=verify_pin");
    expect(res.text).toContain("enter your 8 digit pin");
  });

  it("runs Telnyx form IVR PIN -> destination -> dial flow", async () => {
    const bootstrap = await request(app)
      .post("/identity/bootstrap")
      .send({ googleUserId: "google-13", email: "u13@example.com" });
    const userId = bootstrap.body.userId as string;
    const token = bootstrap.body.token as string;

    await request(app).post("/webhooks/stripe").send({
      id: "evt_13",
      type: "checkout.session.completed",
      data: { userId, amountUsd: 9 },
    });

    const verify = await request(app)
      .post("/voice/texml/connect?step=verify_pin")
      .type("form")
      .send({
        CallSid: "call-form-ivr",
        From: "+19495550113",
        Digits: token,
      });

    expect(verify.status).toBe(200);
    expect(verify.text).toContain("<Gather");
    expect(verify.text).toContain("step=collect_destination");

    const connect = await request(app)
      .post(`/voice/texml/connect?step=collect_destination&userId=${encodeURIComponent(userId)}`)
      .type("form")
      .send({
        CallSid: "call-form-ivr",
        Digits: "0093700111122",
      });

    expect(connect.status).toBe(200);
    expect(connect.headers["content-type"]).toContain("text/xml");
    expect(connect.text).toContain("<Dial action=");
    expect(connect.text).toContain("timeLimit=");
    expect(connect.text).toContain("<Number>+93700111122</Number>");
  });

  it("settles call from TeXML dial-complete callback", async () => {
    const bootstrap = await request(app)
      .post("/identity/bootstrap")
      .send({ googleUserId: "google-14", email: "u14@example.com" });
    const userId = bootstrap.body.userId as string;
    const token = bootstrap.body.token as string;

    await request(app).post("/webhooks/stripe").send({
      id: "evt_14",
      type: "checkout.session.completed",
      data: { userId, amountUsd: 10 },
    });

    await request(app)
      .post("/voice/texml/connect?step=verify_pin")
      .type("form")
      .send({
        CallSid: "call-form-settle",
        From: "+19495550114",
        Digits: token,
      });

    await request(app)
      .post(`/voice/texml/connect?step=collect_destination&userId=${encodeURIComponent(userId)}`)
      .type("form")
      .send({
        CallSid: "call-form-settle",
        Digits: "0093700111133",
      });

    const before = await state.getBalance(userId);
    const settle = await request(app)
      .post("/voice/texml/dial-complete?callSessionId=call-form-settle")
      .type("form")
      .send({
        CallSid: "call-form-settle",
        DialCallSid: "dial-leg-14",
        DialCallDuration: "120",
        SequenceNumber: "3",
      });
    const after = await state.getBalance(userId);

    expect(settle.status).toBe(200);
    expect(settle.headers["content-type"]).toContain("text/xml");
    expect(settle.text).toContain("<Hangup/>");
    expect(after).toBeLessThan(before);
  });
});
