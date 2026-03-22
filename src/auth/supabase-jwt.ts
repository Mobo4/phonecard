import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export type SupabaseJwtVerifierConfig = {
  jwksUrl: string;
  issuer: string;
  audience?: string;
};

export const createSupabaseJwtVerifier = (cfg: SupabaseJwtVerifierConfig) => {
  const jwks = createRemoteJWKSet(new URL(cfg.jwksUrl));

  return async (
    token: string,
  ): Promise<{ userId: string; role?: string } | null> => {
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: cfg.issuer,
        audience: cfg.audience,
      });
      const userId = extractUserId(payload);
      if (!userId) {
        return null;
      }
      return { userId, role: extractRole(payload) };
    } catch {
      return null;
    }
  };
};

const extractUserId = (payload: JWTPayload): string | null => {
  if (typeof payload.sub === "string" && payload.sub.length > 0) {
    return payload.sub;
  }
  return null;
};

const extractRole = (payload: JWTPayload): string | undefined => {
  const role = (payload as Record<string, unknown>).role;
  if (typeof role === "string" && role.length > 0) {
    return role;
  }

  const appMetadata = (payload as Record<string, unknown>).app_metadata;
  if (appMetadata && typeof appMetadata === "object") {
    const metadataRole = (appMetadata as Record<string, unknown>).role;
    if (typeof metadataRole === "string" && metadataRole.length > 0) {
      return metadataRole;
    }
  }
  return undefined;
};
