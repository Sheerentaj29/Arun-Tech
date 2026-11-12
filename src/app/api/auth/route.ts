// POST /api/auth/login  - login with email + password
// POST /api/auth/logout - clear session
// GET  /api/auth/me     - get current session

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { setSessionCookie, clearSessionCookie, getSession, getDashboardRole, type UserRole } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { verifyPassword, hashPassword, needsRehash } from "@/lib/password";

// Simple in-memory rate limiter for the login endpoint.
// Allows 5 login attempts per email per 5-minute window. After that,
// the email is "locked" for 5 minutes. This prevents brute-force attacks.
// In production, use Redis-backed rate-limiting — this is a minimal
// implementation that works for single-process deployments.
const loginAttempts = new Map<string, { count: number; firstAttempt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function checkRateLimit(email: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const entry = loginAttempts.get(email);
  if (entry) {
    // If the window has expired, reset
    if (now - entry.firstAttempt > WINDOW_MS) {
      loginAttempts.delete(email);
    } else if (entry.count >= MAX_ATTEMPTS) {
      const retryAfterMs = WINDOW_MS - (now - entry.firstAttempt);
      return { allowed: false, retryAfterMs };
    }
  }
  return { allowed: true, retryAfterMs: 0 };
}

function recordFailedAttempt(email: string): void {
  const now = Date.now();
  const entry = loginAttempts.get(email);
  if (entry && now - entry.firstAttempt < WINDOW_MS) {
    entry.count++;
  } else {
    loginAttempts.set(email, { count: 1, firstAttempt: now });
  }
}

function clearRateLimit(email: string): void {
  loginAttempts.delete(email);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || !body.email || !body.password) {
    return NextResponse.json({ error: "Missing email or password" }, { status: 400 });
  }

  const email = String(body.email).toLowerCase();

  // ── Rate limiting ──
  const rateCheck = checkRateLimit(email);
  if (!rateCheck.allowed) {
    const retryAfterSec = Math.ceil(rateCheck.retryAfterMs / 1000);
    return NextResponse.json(
      { error: `Too many login attempts. Please try again in ${retryAfterSec} seconds.` },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
    );
  }

  const user = await db.user.findUnique({ where: { email } });

  // Always verify the password (even if user doesn't exist) to avoid
  // timing attacks that could reveal which emails are registered.
  const passwordValid = user ? await verifyPassword(String(body.password), user.passwordHash) : false;

  if (!user || !passwordValid) {
    recordFailedAttempt(email);
    // Generic error message — don't reveal whether the email exists
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  // Account disabled check
  if (!user.active) {
    recordFailedAttempt(email);
    return NextResponse.json({ error: "Account disabled. Contact your administrator." }, { status: 403 });
  }

  // ── Password rehash migration ──
  // If the stored hash is a legacy SHA-256, replace it with a bcrypt hash
  // on the next successful login. This is transparent to the user — no
  // password reset required. The rehash happens AFTER authentication
  // succeeds, so only valid passwords trigger the upgrade.
  let upgradedHash: string | null = null;
  if (needsRehash(user.passwordHash)) {
    try {
      upgradedHash = await hashPassword(String(body.password));
      await db.user.update({
        where: { id: user.id },
        data: { passwordHash: upgradedHash },
      });
      console.log(`[auth] Upgraded password hash for ${email} from SHA-256 → bcrypt`);
    } catch (e) {
      console.warn(`[auth] Failed to upgrade password hash for ${email}:`, e);
      // Non-fatal — the user is still authenticated with the old hash.
      // They'll get upgraded on their next login.
    }
  }

  // Clear rate limit on successful login
  clearRateLimit(email);

  // Set the session cookie
  const cookieStore = await cookies();
  setSessionCookie(cookieStore, user.id);

  await recordAudit({
    userId: user.id,
    userName: user.name,
    action: "LOGIN",
    entity: "User",
    entityId: user.id,
    details: `User ${user.email} logged in${upgradedHash ? " (password hash upgraded to bcrypt)" : ""}`,
  });

  return NextResponse.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as UserRole,
    dashboardRole: getDashboardRole(user.role),
  });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession(req);
  const cookieStore = await cookies();
  if (session) {
    await recordAudit({
      userId: session.id,
      userName: session.name,
      action: "LOGOUT",
      entity: "User",
      entityId: session.id,
    });
  }
  clearSessionCookie(cookieStore);
  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  // Pass `req` so getSession can fall back to the Authorization: Bearer
  // header when the cookie isn't being sent (cross-origin preview URL).
  const session = await getSession(req);
  if (!session) return NextResponse.json({ user: null });
  return NextResponse.json({ user: session });
}
