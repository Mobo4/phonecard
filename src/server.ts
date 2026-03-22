import dotenv from "dotenv";
import { createApp } from "./app.js";
import { createSupabaseJwtVerifier } from "./auth/supabase-jwt.js";
import { createStateFromEnv } from "./state/create-state.js";

dotenv.config();

const port = Number(process.env.PORT ?? 3000);
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseJwksUrl =
  process.env.SUPABASE_JWKS_URL ??
  (supabaseUrl ? `${supabaseUrl}/auth/v1/.well-known/jwks.json` : undefined);
const supabaseIssuer =
  process.env.SUPABASE_JWT_ISSUER ??
  (supabaseUrl ? `${supabaseUrl}/auth/v1` : undefined);
const supabaseAudience = process.env.SUPABASE_JWT_AUDIENCE;

const requireUserForCheckout =
  (process.env.REQUIRE_CHECKOUT_AUTH ?? "true").toLowerCase() !== "false";

const verifyBearerToken =
  supabaseJwksUrl && supabaseIssuer
    ? createSupabaseJwtVerifier({
        jwksUrl: supabaseJwksUrl,
        issuer: supabaseIssuer,
        audience: supabaseAudience,
      })
    : undefined;

const state = await createStateFromEnv(process.env);

const app = createApp({
  state,
  auth: {
    requireUserForCheckout,
    verifyBearerToken,
  },
  webhookSecrets: {
    stripe: process.env.STRIPE_WEBHOOK_SECRET,
    telnyx: process.env.TELNYX_WEBHOOK_SECRET ?? process.env.TELNYX_WEBHOOK_PUBLIC_KEY,
  },
});

app.listen(port, () => {
  process.stdout.write(`phonecard-api listening on ${port}\n`);
});
