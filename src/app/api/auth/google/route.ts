// GET /api/auth/google — start the Google OAuth 2.0 Authorization Code flow.
//
// Generates the anti-CSRF state + PKCE verifier, stores them in short-lived
// HttpOnly cookies, and redirects the browser to Google's consent screen.
// If Google OAuth isn't configured (no client ID/secret in the server
// environment), the user is bounced back to the login screen with a clear
// message instead of an error page.
//
// Nothing here is sensitive: the client ID is public by design, and the
// client secret never leaves the server.

import { NextRequest, NextResponse } from "next/server";
import {
  GOOGLE_AUTH_ENDPOINT,
  googleConfigured,
  baseUrlFromRequest,
  redirectUriFromRequest,
  randomToken,
  pkceChallenge,
  setOAuthCookies,
} from "@/lib/google-oauth";

export async function GET(req: NextRequest) {
  const base = baseUrlFromRequest(req);
  const backWithError = (code: string) =>
    NextResponse.redirect(`${base}/?authError=${encodeURIComponent(code)}`);

  if (!googleConfigured()) {
    return backWithError("google_not_configured");
  }

  // Per-attempt handshake material: state (CSRF) + PKCE verifier (S256).
  const state = randomToken(32);
  const verifier = randomToken(48);
  const redirectUri = redirectUriFromRequest(req);

  const authUrl = new URL(GOOGLE_AUTH_ENDPOINT);
  authUrl.searchParams.set("client_id", String(process.env.GOOGLE_CLIENT_ID));
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", pkceChallenge(verifier));
  authUrl.searchParams.set("code_challenge_method", "S256");
  // Always show the account chooser so a user signed into multiple Google
  // accounts picks the right one; access_type=online → no refresh tokens.
  authUrl.searchParams.set("prompt", "select_account");
  authUrl.searchParams.set("access_type", "online");

  const res = NextResponse.redirect(authUrl.toString());
  setOAuthCookies(res, req, state, verifier);
  return res;
}
