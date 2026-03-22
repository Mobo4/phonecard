import crypto from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createStateFromEnv } from "../src/state/create-state.js";

const stripeSecret = "smoke_stripe_secret";
const telnyxSecret = "smoke_telnyx_secret";

const sign = (body: unknown, secret: string): string =>
  crypto.createHmac("sha256", secret).update(JSON.stringify(body)).digest("hex");

const expect = (condition: boolean, msg: string): void => {
  if (!condition) {
    throw new Error(msg);
  }
};

const run = async (): Promise<void> => {
  const state = await createStateFromEnv(process.env);
  const app = createApp({
    state,
    now: () => Date.now(),
    auth: {
      requireUserForCheckout: true,
      verifyBearerToken: async (token) => {
        if (!token.startsWith("uid:")) {
          return null;
        }
        return { userId: token.slice(4) };
      },
    },
    webhookSecrets: {
      stripe: stripeSecret,
      telnyx: telnyxSecret,
    },
  });

  const bootstrap = await request(app).post("/identity/bootstrap").send({
    googleUserId: `smoke-google-${crypto.randomUUID()}`,
    email: `smoke-${crypto.randomUUID()}@example.com`,
  });
  expect(bootstrap.status === 201, "bootstrap failed");
  const userId = bootstrap.body.userId as string;
  const token = bootstrap.body.token as string;

  const checkoutNoAuth = await request(app).post("/payments/checkout-session").send({
    userId,
    amountUsd: 20,
  });
  expect(checkoutNoAuth.status === 401, "checkout should require auth");

  const checkoutMismatch = await request(app)
    .post("/payments/checkout-session")
    .set("authorization", "Bearer uid:u_wrong")
    .send({
      userId,
      amountUsd: 20,
    });
  expect(checkoutMismatch.status === 403, "checkout mismatch should be denied");

  const checkoutOk = await request(app)
    .post("/payments/checkout-session")
    .set("authorization", `Bearer uid:${userId}`)
    .send({
      userId,
      amountUsd: 20,
    });
  expect(checkoutOk.status === 200, "checkout with auth failed");

  const stripeBody = {
    id: `evt_smoke_${crypto.randomUUID()}`,
    type: "checkout.session.completed",
    data: { userId, amountUsd: 20 },
  };
  const stripeUnsigned = await request(app).post("/webhooks/stripe").send(stripeBody);
  expect(stripeUnsigned.status === 401, "unsigned stripe webhook should fail");
  const stripeSigned = await request(app)
    .post("/webhooks/stripe")
    .set("x-webhook-signature", sign(stripeBody, stripeSecret))
    .send(stripeBody);
  expect(stripeSigned.status === 200, "signed stripe webhook failed");

  const bal = await state.getBalance(userId);
  expect(bal >= 20, "balance not credited");

  const invalidVerify = await request(app).post("/voice/token-verify").send({
    callSessionId: `call-invalid-${crypto.randomUUID()}`,
    ani: "+15559990001",
    token: "00000000",
  });
  expect([401, 423].includes(invalidVerify.status), "invalid token path failed");

  const verify = await request(app).post("/voice/token-verify").send({
    callSessionId: `call-${crypto.randomUUID()}`,
    ani: "+15559990002",
    token,
  });
  expect(verify.status === 200, "valid token verify failed");

  const callSessionId = `call-af-${crypto.randomUUID()}`;
  await request(app).post("/voice/token-verify").send({
    callSessionId,
    ani: "+15559990003",
    token,
  });
  const rate = await request(app).post("/voice/rate-and-authorize").send({
    callSessionId,
    userId,
    destination: "+93700111222",
  });
  expect(rate.status === 200, "afghanistan authorization failed");
  expect(rate.body.allow === true, "afghanistan should be allowed");

  const telnyxBody = {
    id: `telnyx_smoke_${crypto.randomUUID()}`,
    type: "call.hangup",
    data: { callSessionId, durationSeconds: 90 },
  };
  const telnyxUnsigned = await request(app).post("/webhooks/telnyx/voice").send(telnyxBody);
  expect(telnyxUnsigned.status === 401, "unsigned telnyx webhook should fail");

  const telnyxSigned = await request(app)
    .post("/webhooks/telnyx/voice")
    .set("x-telnyx-signature", sign(telnyxBody, telnyxSecret))
    .send(telnyxBody);
  expect(telnyxSigned.status === 200, "signed telnyx webhook failed");
  expect(telnyxSigned.body.pending === false, "known call should settle directly");

  const telnyxDup = await request(app)
    .post("/webhooks/telnyx/voice")
    .set("x-telnyx-signature", sign(telnyxBody, telnyxSecret))
    .send(telnyxBody);
  expect(telnyxDup.body.idempotent === true, "duplicate telnyx event should be idempotent");

  const pendingCall = `call-pending-${crypto.randomUUID()}`;
  const pendingBody = {
    id: `telnyx_pending_${crypto.randomUUID()}`,
    type: "call.hangup",
    data: { callSessionId: pendingCall, durationSeconds: 30 },
  };
  const pendingRes = await request(app)
    .post("/webhooks/telnyx/voice")
    .set("x-telnyx-signature", sign(pendingBody, telnyxSecret))
    .send(pendingBody);
  expect(pendingRes.body.pending === true, "unknown call should go pending");

  await request(app).post("/voice/token-verify").send({
    callSessionId: pendingCall,
    ani: "+15559990004",
    token,
  });
  await request(app).post("/voice/rate-and-authorize").send({
    callSessionId: pendingCall,
    userId,
    destination: "+93700111222",
  });

  const rec = await request(app).post("/internal/reconcile").send({});
  expect(rec.status === 200, "reconcile failed");
  expect(rec.body.resolved >= 1, "reconcile did not resolve pending sessions");

  process.stdout.write("SMOKE_PERSISTENT: PASS\n");
};

run().catch((err: unknown) => {
  process.stderr.write(`SMOKE_PERSISTENT: FAIL ${(err as Error).message}\n`);
  process.exit(1);
});

