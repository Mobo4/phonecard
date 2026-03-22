import request from "supertest";
import { describe, expect, it, beforeEach } from "vitest";
import { createApp } from "../src/app.js";
import { InMemoryState } from "../src/state/in-memory-state.js";
describe("primitive api", () => {
    let state;
    let app;
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
        const userId = bootstrap.body.userId;
        const res = await request(app).post("/webhooks/stripe").send({
            id: "evt_1",
            type: "checkout.session.completed",
            data: { userId, amountUsd: 10 },
        });
        expect(res.status).toBe(200);
        expect(state.getBalance(userId)).toBe(10);
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
    it("authorizes afghanistan destination and blocks iran", async () => {
        const bootstrap = await request(app)
            .post("/identity/bootstrap")
            .send({ googleUserId: "google-4", email: "u4@example.com" });
        const userId = bootstrap.body.userId;
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
        expect(ir.status).toBe(403);
        expect(ir.body.reason_code).toBe("COUNTRY_BLOCKED");
    });
    it("settles debit idempotently on duplicate telnyx webhook", async () => {
        const bootstrap = await request(app)
            .post("/identity/bootstrap")
            .send({ googleUserId: "google-5", email: "u5@example.com" });
        const userId = bootstrap.body.userId;
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
});
