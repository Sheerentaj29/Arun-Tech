// Google OAuth 2.0 Authorization Code flow helpers — SERVER-SIDE ONLY.
//
// Security model:
//   - The client secret lives exclusively in process.env and is only ever
//     sent by this server directly to Google's token endpoint over TLS.
//   - The browser never receives or transmits any OAuth token. It only
//     relays the one-time authorization code, which is useless without the
//     client secret and the exact redirect URI.
//   - CSRF is prevented with a state parameter stored in a short-lived
//     HttpOnly cookie and compared (timing-safe) in the callback.
//   - The code verifier (PKCE, S256) is likewise cookie-bound per attempt.
//   - The ID token returned by the token endpoint is decoded and its claims
//     validated (issuer, audience, expiry, email_verified). Because the
//     token is fetched directly from Google's token endpoint by this server
//     over TLS — not supplied by the browser — OIDC Core §3.1.3.7 permits
//     TLS validation in place of a JWT signature check. The identity is
//     additionally cross-checked against Google's userinfo endpoint
//     (sub + email must match the ID token claims).
//
// Configuration (all server-side environment variables):
//   GOOGLE_CLIENT_ID      — required (Google Cloud Console OAuth client)
//   GOOGLE_CLIENT_SECRET  — required
//   GOOGLE_REDIRECT_URI   — optional override; otherwise derived from the
//                           incoming request host/proto.

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import type { NextRequest, NextResponse } from "next/server";

export const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
export const GOOGLE_CALLBACK_PATH = "/api/auth/google/callback";

// Short-lived cookies that carry the OAuth handshake state between the
// redirect to Google and the callback. 10 minutes is plenty for a consent
// screen and limits replay windows.
export const OAUTH_STATE_COOKIE = "g_oauth_state";
export const OAUTH_VERIFIER_COOKIE = "g_oauth_verifier";
export const OAUTH_COOKIE_MAX_AGE = 600; // seconds

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/** Base origin (scheme + host) the request was seen with, honoring proxies. */
export function baseUrlFromRequest(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

/** The redirect URI registered in Google Cloud Console for this deployment. */
export function redirectUriFromRequest(req: NextRequest): string {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  return `${baseUrlFromRequest(req)}${GOOGLE_CALLBACK_PATH}`;
}

/** Cookies must be Secure when the app is served over HTTPS (preview URLs). */
export function cookieSecureForRequest(req: NextRequest): boolean {
  return baseUrlFromRequest(req).startsWith("https://");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** PKCE code_challenge = BASE64URL(SHA256(code_verifier)). */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** Length-safe, timing-safe string comparison (for the state parameter). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Attach the anti-CSRF + PKCE cookies to the outgoing redirect response. */
export function setOAuthCookies(
  res: NextResponse,
  req: NextRequest,
  state: string,
  verifier: string,
) {
  const attrs = {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: OAUTH_COOKIE_MAX_AGE,
    secure: cookieSecureForRequest(req),
  };
  res.cookies.set({ name: OAUTH_STATE_COOKIE, value: state, ...attrs });
  res.cookies.set({ name: OAUTH_VERIFIER_COOKIE, value: verifier, ...attrs });
}

/** Remove the handshake cookies (after use, on success or failure). */
export function clearOAuthCookies(res: NextResponse) {
  try {
    res.cookies.delete(OAUTH_STATE_COOKIE);
    res.cookies.delete(OAUTH_VERIFIER_COOKIE);
  } catch {
    // best-effort
  }
}

/** Decode (not signature-verify — see header comment) the ID token payload. */
export function parseIdTokenClaims(idToken: string): Record<string, unknown> | null {
  try {
    const parts = idToken.split(".");
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], "base64url").toString("utf8");
    const claims = JSON.parse(payload);
    return typeof claims === "object" && claims !== null ? claims : null;
  } catch {
    return null;
  }
}

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

export type TokenExchangeResult =
  | { ok: true; idToken: string; accessToken: string }
  | { ok: false; error: string };

/**
 * Exchange the one-time authorization code for tokens (server-to-server).
 * The code is bound to client_id + redirect_uri + code_verifier; without the
 * client secret the exchange is rejected by Google.
 */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<TokenExchangeResult> {
  try {
    const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: String(process.env.GOOGLE_CLIENT_ID ?? ""),
        client_secret: String(process.env.GOOGLE_CLIENT_SECRET ?? ""),
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: codeVerifier,
      }),
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      console.error(
        `[google-oauth] token exchange failed: status=${res.status} body=${bodyText.slice(0, 500)}`,
      );
      return { ok: false, error: `token_exchange_failed_status_${res.status}` };
    }
    const data = (await res.json()) as {
      id_token?: string;
      access_token?: string;
    };
    if (!data.id_token || !data.access_token) {
      console.error("[google-oauth] token exchange response missing id_token/access_token");
      return { ok: false, error: "token_exchange_incomplete" };
    }
    return { ok: true, idToken: data.id_token, accessToken: data.access_token };
  } catch (e) {
    console.error("[google-oauth] token exchange network error:", e);
    return { ok: false, error: "token_exchange_network_error" };
  }
}

export interface IdentityValidation {
  ok: boolean;
  profile?: GoogleProfile;
  reason?: string;
}

/**
 * Validate the ID token claims and cross-check them against Google's
 * userinfo endpoint. The returned profile is the only identity this app
 * trusts. The access token must have been obtained server-side (above).
 */
export async function validateGoogleIdentity(
  idToken: string,
  accessToken: string,
): Promise<IdentityValidation> {
  const claims = parseIdTokenClaims(idToken);
  if (!claims) return { ok: false, reason: "id_token_unparseable" };

  // 1. Issuer — Google's OIDC discovery lists exactly these two values.
  const iss = String(claims.iss ?? "");
  if (iss !== "https://accounts.google.com" && iss !== "accounts.google.com") {
    return { ok: false, reason: "id_token_bad_issuer" };
  }
  // 2. Audience — the token must have been issued FOR this client.
  const aud = String(claims.aud ?? "");
  if (aud !== String(process.env.GOOGLE_CLIENT_ID ?? "")) {
    return { ok: false, reason: "id_token_bad_audience" };
  }
  // 3. Expiry — clock in seconds.
  const exp = Number(claims.exp ?? 0);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) {
    return { ok: false, reason: "id_token_expired" };
  }
  // 4. The email must be present AND verified by Google — this is what makes
  //    linking a Google identity to an existing local account safe.
  const email = typeof claims.email === "string" ? claims.email.toLowerCase() : "";
  if (!email) return { ok: false, reason: "id_token_missing_email" };
  if (claims.email_verified !== true && claims.email_verified !== "true") {
    return { ok: false, reason: "email_not_verified" };
  }
  const sub = typeof claims.sub === "string" ? claims.sub : "";
  if (!sub) return { ok: false, reason: "id_token_missing_sub" };

  // 5. Cross-check with the userinfo endpoint (authoritative profile bound
  //    to the server-obtained access token). sub + email must both match.
  let info: { sub?: string; email?: string; name?: string } | null = null;
  try {
    const res = await fetch(GOOGLE_USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(`[google-oauth] userinfo failed: status=${res.status}`);
      return { ok: false, reason: "userinfo_request_failed" };
    }
    info = (await res.json()) as typeof info;
  } catch (e) {
    console.error("[google-oauth] userinfo network error:", e);
    return { ok: false, reason: "userinfo_network_error" };
  }
  if (!info || info.sub !== sub) return { ok: false, reason: "userinfo_sub_mismatch" };
  if (!info.email || info.email.toLowerCase() !== email) {
    return { ok: false, reason: "userinfo_email_mismatch" };
  }

  return {
    ok: true,
    profile: {
      sub,
      email,
      emailVerified: true,
      name: typeof info.name === "string" && info.name.trim() ? info.name.trim() : null,
    },
  };
}
