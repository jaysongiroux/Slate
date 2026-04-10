import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { unauthorized, badRequest } from "../lib/errors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OidcMetadata = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint?: string;
  jwksUri: string;
};

export type OidcTokenResponse = {
  access_token?: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
};

export type OidcMetadataCache = Map<string, { metadata: OidcMetadata; expiresAt: number }>;

export type OidcProviderConfigRecord = {
  id: string;
  providerId: string;
  label: string;
  issuerUrl: string;
  clientId: string;
  clientSecretEncrypted: string;
  scopes: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

// ---------------------------------------------------------------------------
// OIDC metadata & token exchange
// ---------------------------------------------------------------------------

export async function getOidcMetadata(
  issuerUrl: string,
  cache: OidcMetadataCache,
): Promise<OidcMetadata> {
  const cached = cache.get(issuerUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.metadata;

  const wellKnown = `${issuerUrl.replace(/\/$/, "")}/.well-known/openid-configuration`;
  const response = await fetch(wellKnown);
  if (!response.ok) throw unauthorized(`Failed to load OIDC metadata for issuer ${issuerUrl}`);

  const body = (await response.json()) as {
    issuer?: string;
    authorization_endpoint?: string;
    token_endpoint?: string;
    userinfo_endpoint?: string;
    jwks_uri?: string;
  };
  if (!body.issuer || !body.authorization_endpoint || !body.token_endpoint || !body.jwks_uri) {
    throw unauthorized("OIDC metadata is missing required endpoints");
  }
  const metadata: OidcMetadata = {
    issuer: body.issuer,
    authorizationEndpoint: body.authorization_endpoint,
    tokenEndpoint: body.token_endpoint,
    userinfoEndpoint: body.userinfo_endpoint,
    jwksUri: body.jwks_uri,
  };
  cache.set(issuerUrl, { metadata, expiresAt: Date.now() + 10 * 60 * 1000 });
  return metadata;
}

export async function exchangeToken(payload: {
  metadata: OidcMetadata;
  providerClientId: string;
  providerClientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<OidcTokenResponse> {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code: payload.code,
    redirect_uri: payload.redirectUri,
    client_id: payload.providerClientId,
    client_secret: payload.providerClientSecret,
    code_verifier: payload.codeVerifier,
  });
  const response = await fetch(payload.metadata.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
  });
  if (!response.ok) throw unauthorized("OIDC token exchange failed");
  return (await response.json()) as OidcTokenResponse;
}

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

export function normalizeProviderId(providerIdRaw: string) {
  const providerId = providerIdRaw.trim().toLowerCase();
  if (!providerId) throw badRequest("providerId is required");
  if (!/^[a-z0-9][a-z0-9._-]{1,62}$/.test(providerId)) {
    throw badRequest(
      "providerId must be 2-63 chars and contain only lowercase letters, numbers, '.', '-', '_' ",
    );
  }
  return providerId;
}

export function normalizeIssuerUrl(issuerRaw: string) {
  const trimmed = issuerRaw.trim();
  if (!trimmed) throw badRequest("issuerUrl is required");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw badRequest("issuerUrl must be a valid URL");
  }
  if (parsed.protocol !== "https:") throw badRequest("issuerUrl must use https");
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString().replace(/\/$/, "");
}

export function normalizeScopes(scopesRaw?: string) {
  const scopes = (scopesRaw ?? "openid profile email").trim();
  return scopes || "openid profile email";
}

// ---------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------

export function getSecretKey() {
  const raw = process.env.OIDC_SECRET_ENCRYPTION_KEY ?? "local-dev-oidc-secret";
  return createHash("sha256").update(raw).digest();
}

export function encryptSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getSecretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}.${tag.toString("hex")}.${encrypted.toString("hex")}`;
}

export function decryptSecret(encoded: string) {
  const parts = encoded.split(".");
  if (parts.length !== 3) throw unauthorized("Invalid encrypted OIDC secret format");
  const iv = Buffer.from(parts[0], "hex");
  const tag = Buffer.from(parts[1], "hex");
  const encrypted = Buffer.from(parts[2], "hex");
  const decipher = createDecipheriv("aes-256-gcm", getSecretKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function base64Url(bytes: Buffer) {
  return bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

// ---------------------------------------------------------------------------
// JWT verification & userinfo fallback
// ---------------------------------------------------------------------------

export type OidcResolvedClaims = {
  subject: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
};

export async function verifyIdTokenAndResolveClaims(payload: {
  idToken: string;
  accessToken?: string;
  metadata: OidcMetadata;
  providerClientId: string;
  expectedNonce: string;
  logger: { info: (msg: string) => void; warn: (msg: string) => void };
}): Promise<OidcResolvedClaims> {
  const { createRemoteJWKSet, jwtVerify } = await import("jose");
  const jwks = createRemoteJWKSet(new URL(payload.metadata.jwksUri));
  const verified = await jwtVerify(payload.idToken, jwks, {
    issuer: payload.metadata.issuer,
    audience: payload.providerClientId,
  });
  const claims = verified.payload as {
    sub?: string;
    nonce?: string;
    email?: string;
    email_verified?: boolean | string;
    name?: string;
    preferred_username?: string;
  };

  const subject = (claims.sub ?? "").trim();
  if (!subject) throw unauthorized("OIDC token missing subject claim");
  if (claims.nonce !== payload.expectedNonce) throw unauthorized("OIDC nonce mismatch");

  let email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  let emailVerified = claims.email_verified === true || claims.email_verified === "true";

  // Fallback to userinfo endpoint when id_token lacks a verified email
  if ((!email || !emailVerified) && payload.accessToken && payload.metadata.userinfoEndpoint) {
    try {
      const res = await fetch(payload.metadata.userinfoEndpoint, {
        headers: { Authorization: `Bearer ${payload.accessToken}` },
      });
      if (res.ok) {
        const ui = (await res.json()) as { email?: string; email_verified?: boolean | string };
        if (!email && typeof ui.email === "string") email = ui.email.trim().toLowerCase();
        if (!emailVerified)
          emailVerified = ui.email_verified === true || ui.email_verified === "true";
        payload.logger.info(
          `OIDC userinfo fallback: email=${email}, emailVerified=${emailVerified}`,
        );
      }
    } catch (e) {
      payload.logger.warn(`OIDC userinfo fetch failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  payload.logger.info(
    `OIDC claims resolved: sub=${subject}, email=${email}, emailVerified=${emailVerified}, ` +
      `id_token.email_verified=${String(claims.email_verified ?? "absent")}`,
  );

  const displayName =
    (typeof claims.name === "string" && claims.name.trim()) ||
    (typeof claims.preferred_username === "string" && claims.preferred_username.trim()) ||
    (email ? email.split("@")[0] : "User");

  return { subject, email, emailVerified, displayName };
}
