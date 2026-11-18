// GET /api/auth/google/callback — Google OAuth 2.0 callback.
//
// Full sequence (all server-side):
//   1. Validate the state cookie against the state query param (CSRF).
//   2. Exchange the one-time authorization code for tokens — server-to-server
//      call to Google carrying the client secret + PKCE verifier.
//   3. Validate the ID token claims (issuer/audience/expiry/email_verified)
//      and cross-check against Google's userinfo endpoint.
//   4. Resolve the account, safely:
//        a. googleId match  → sign in.
//        b. verified email match, not yet linked → link googleId to the
//           existing account (password stays valid; audit-logged). Safe
//           because Google has verified the person owns that email.
//        c. unknown email   → NEW account: role EMPLOYEE, accountStatus
//           PENDING, no usable password. NEVER admin. Access begins only
//           after an administrator approves the account.
//        d. email already linked to a DIFFERENT Google account → refused.
//   5. Issue the standard app session cookie (same one email/password login
//      uses) and redirect to the dashboard — or, for pending users, to the
//      login screen with a "pending approval" notice and NO session.

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { setSessionCookieOnResponse } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { hashPassword } from "@/lib/password";
import {
  baseUrlFromRequest,
  redirectUriFromRequest,
  exchangeCodeForTokens,
  validateGoogleIdentity,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  safeEqual,
  clearOAuthCookies,
} from "@/lib/google-oauth";

export async function GET(req: NextRequest) {
  const base = baseUrlFromRequest(req);
  const url = new URL(req.url);

  // Every exit path clears the handshake cookies.
  const finish = (dest: string, sessionUserId?: string) => {
    const res = NextResponse.redirect(dest);
    clearOAuthCookies(res);
    if (sessionUserId) setSessionCookieOnResponse(res, sessionUserId);
    return res;
  };
  const fail = (code: string) => finish(`${base}/?authError=${encodeURIComponent(code)}`);

  // ── 0. Google-side error (e.g. user cancelled consent) ──
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    console.warn(`[google-oauth] consent error from Google: ${oauthError}`);
    return fail(oauthError === "access_denied" ? "access_denied" : "google_consent_error");
  }

  // ── 1. CSRF: state cookie must match the state Google echoed back ──
  const queryState = url.searchParams.get("state");
  const cookieState = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const verifier = req.cookies.get(OAUTH_VERIFIER_COOKIE)?.value;
  if (!queryState || !cookieState || !verifier || !safeEqual(cookieState, queryState)) {
    return fail("state_mismatch");
  }

  const code = url.searchParams.get("code");
  if (!code) return fail("missing_code");

  // ── 2. Exchange the code (server-to-server, secret + PKCE) ──
  const tokens = await exchangeCodeForTokens(code, verifier, redirectUriFromRequest(req));
  if (!tokens.ok) return fail("google_exchange_failed");

  // ── 3. Validate the Google identity (ID token claims + userinfo) ──
  const identity = await validateGoogleIdentity(tokens.idToken, tokens.accessToken);
  if (!identity.ok || !identity.profile) {
    console.error(`[google-oauth] identity validation failed: ${identity.reason}`);
    return fail(identity.reason === "email_not_verified" ? "email_not_verified" : "identity_unverified");
  }
  const { sub, email, name } = identity.profile;

  // ── 4. Resolve / create the local account ──
  let user = await db.user.findUnique({ where: { googleId: sub } });
  let newlyCreated = false;

  if (!user) {
    const byEmail = await db.user.findUnique({ where: { email } });
    if (byEmail) {
      // Prevent unsafe linking: the email is already owned by another
      // Google identity (or a stale link) — refuse and let a human sort it.
      if (byEmail.googleId && byEmail.googleId !== sub) {
        console.warn(`[google-oauth] email ${email} is linked to a different Google sub`);
        return fail("email_conflict");
      }
      // Safe link: Google verified the person owns this email. The local
      // password remains valid; both sign-in methods keep working.
      user = await db.user.update({ where: { id: byEmail.id }, data: { googleId: sub } });
      await recordAudit({
        userId: user.id,
        userName: user.name,
        action: "UPDATE",
        entity: "User",
        entityId: user.id,
        details: `Linked Google account (sub ${sub}) to existing account ${email} via verified Google email`,
      });
    } else {
      // First-time registration. Role is ALWAYS EMPLOYEE and the account is
      // PENDING until an administrator approves it — Google sign-in can
      // never elevate itself. The random password hash makes password
      // sign-in impossible for this account (nobody knows the secret).
      const unusablePassword = await hashPassword(randomBytes(32).toString("hex"));
      user = await db.user.create({
        data: {
          email,
          name: name ?? email.split("@")[0],
          role: "EMPLOYEE",
          active: true,
          accountStatus: "PENDING",
          googleId: sub,
          passwordHash: unusablePassword,
        },
      });
      newlyCreated = true;
      await recordAudit({
        userId: user.id,
        userName: user.name,
        action: "CREATE",
        entity: "User",
        entityId: user.id,
        details: `Registered ${email} via Google sign-up (role EMPLOYEE, status PENDING — awaiting admin approval)`,
      });
    }
  }

  // Disabled accounts never sign in, regardless of method.
  if (!user.active) return fail("account_disabled");

  // ── 5a. Pending approval → no session, just an explanation ──
  if (user.accountStatus !== "ACTIVE") {
    return finish(
      `${base}/?authPending=1&pendingEmail=${encodeURIComponent(user.email)}`,
    );
  }

  // ── 5b. Approved user → standard app session (8 h, HttpOnly cookie) ──
  await recordAudit({
    userId: user.id,
    userName: user.name,
    action: "LOGIN",
    entity: "User",
    entityId: user.id,
    details: `User ${user.email} signed in with Google${newlyCreated ? " (first sign-in)" : ""}`,
  });
  return finish(`${base}/`, user.id);
}
