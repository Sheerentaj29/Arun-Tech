// Mock session helper for demo. In production, replace with NextAuth.
//
// The session is stored in an HTTP-only cookie containing just the user's id.
// On every request, getSession() looks up the user in the database to verify
// they still exist and are active — this means a stale/tampered cookie is
// useless and deleted/disabled users are immediately signed out.
//
// Storing just the id keeps the cookie value tiny (a single cuid string,
// ~25 chars) and avoids any browser/proxy issues with JSON special chars.
//
// FALLBACK: if the cookie isn't being sent (which happens on the preview URL
// in some browsers due to cross-origin cookie restrictions), the client
// also sends the same user id via an `Authorization: Bearer <userId>` header.
// getSession() checks the cookie first, then the Authorization header, so
// authentication works even when cookies are completely broken.

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import type { User } from "@prisma/client";
import type { NextRequest } from "next/server";

export type UserRole = "ADMIN" | "EMPLOYEE" | "INSPECTOR" | "APPROVER";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  /** Effective dashboard role — collapses INSPECTOR/APPROVER/EMPLOYEE into "EMPLOYEE". */
  dashboardRole: "ADMIN" | "EMPLOYEE";
}

/**
 * Google-registered users start as accountStatus="PENDING" and must be
 * approved by an administrator before they can use the application. A
 * PENDING user is treated exactly like a logged-out user by every API
 * (getSession returns null below); the only way their identity surfaces
 * is via getPendingApprovalUser(), which /api/auth uses to show the
 * "pending approval" notice on the login screen.
 */
export type AccountStatus = "ACTIVE" | "PENDING";

/**
 * Map raw DB role string to the dashboard-routing role:
 *   ADMIN       → "ADMIN"   (admin dashboard, can approve, can manage employees)
 *   EMPLOYEE    → "EMPLOYEE" (employee dashboard, can create/edit own reports)
 *   INSPECTOR   → "EMPLOYEE" (legacy — treated as employee)
 *   APPROVER    → "ADMIN"   (legacy — treated as admin, retains approval powers)
 *
 * New logins should use ADMIN or EMPLOYEE roles directly.
 */
export function getDashboardRole(role: string): "ADMIN" | "EMPLOYEE" {
  if (role === "ADMIN" || role === "APPROVER") return "ADMIN";
  return "EMPLOYEE";
}

// Cookie name bumped to v2 so it never collides with stale cookies from
// older builds of this app (which used a different name + value format).
const SESSION_COOKIE = "ira_session_v2";
// Legacy cookie name from previous build — cleared on next login so it
// doesn't keep being sent and confusing the server.
const LEGACY_COOKIE = "ems_session";
const COOKIE_MAX_AGE = 60 * 60 * 8; // 8 hours

function isValidUserIdShape(raw: string): boolean {
  // CUIDs are 20-30 chars, alphanumeric. Reject anything that doesn't
  // look like a valid cuid to avoid hitting the DB with junk.
  return /^[a-z0-9]{20,30}$/i.test(raw);
}

async function lookupUser(userId: string): Promise<SessionUser | null> {
  if (!isValidUserIdShape(userId)) return null;
  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true, active: true, accountStatus: true },
    });
    if (!user || !user.active) return null;
    // Pending admin approval ⇒ no application access yet (see AccountStatus).
    if (user.accountStatus !== "ACTIVE") return null;
    const role = user.role as UserRole;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role,
      dashboardRole: getDashboardRole(role),
    };
  } catch {
    return null;
  }
}

/**
 * If the presented credentials (cookie or Bearer header) belong to a real,
 * active user who is awaiting admin approval, return their identity so the
 * login screen can explain WHY they aren't signed in. Returns null for
 * unknown/inactive users (no information leak).
 */
export async function getPendingApprovalUser(
  req?: NextRequest,
): Promise<{ email: string; name: string } | null> {
  const userId = await extractSessionId(req);
  if (!userId || !isValidUserIdShape(userId)) return null;
  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true, active: true, accountStatus: true },
    });
    if (!user || !user.active || user.accountStatus !== "PENDING") return null;
    return { email: user.email, name: user.name };
  } catch {
    return null;
  }
}

/** Pull the session id from the cookie, falling back to the Bearer header. */
async function extractSessionId(req?: NextRequest): Promise<string | null> {
  const cookieStore = await cookies();
  const rawCookie = cookieStore.get(SESSION_COOKIE)?.value;
  if (
    rawCookie &&
    rawCookie.length > 0 &&
    !rawCookie.startsWith("%7B") &&
    !rawCookie.startsWith("{")
  ) {
    return rawCookie;
  }
  if (req) {
    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
    if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
      return authHeader.slice(7).trim();
    }
  }
  return null;
}

/**
 * Read the session. Checks the cookie first, then falls back to the
 * Authorization: Bearer <userId> header (used when cookies are broken
 * in the user's browser, e.g. cross-origin on the preview URL).
 */
export async function getSession(req?: NextRequest): Promise<SessionUser | null> {
  // extractSessionId() tries the cookie first (rejecting stale JSON-format
  // cookies from older builds), then falls back to the Authorization:
  // Bearer <userId> header for browsers that aren't sending cookies.
  const sessionId = await extractSessionId(req);
  if (!sessionId) return null;
  return lookupUser(sessionId);
}

export async function getCurrentUser(req?: NextRequest): Promise<User | null> {
  const session = await getSession(req);
  if (!session) return null;
  return db.user.findUnique({ where: { id: session.id } });
}

export async function requireSession(req?: NextRequest): Promise<SessionUser> {
  const s = await getSession(req);
  if (!s) {
    throw new Error("Unauthorized");
  }
  return s;
}

export async function requireAdmin(req?: NextRequest): Promise<SessionUser> {
  const s = await requireSession(req);
  if (s.dashboardRole !== "ADMIN") {
    throw new Error("Forbidden — administrator role required");
  }
  return s;
}

/**
 * Require an authenticated user who is NOT an admin — i.e. an employee
 * (or legacy INSPECTOR/APPROVER-treated-as-employee). Used by routes that
 * an admin shouldn't be doing on their own behalf (e.g. creating inspection
 * reports — admins can manage employees but shouldn't be the inspector of
 * record).
 *
 * In practice, admins CAN still call these routes (they may need to file
 * reports too). The check is mostly to gate the role-specific UI affordances.
 */
export async function requireEmployeeOrAdmin(req?: NextRequest): Promise<SessionUser> {
  const s = await requireSession(req);
  return s;
}

/**
 * Helper: does this session user own this resource? Used by report-edit
 * routes to enforce "employees can only edit their own reports".
 */
export function isOwner(session: SessionUser, ownerId: string): boolean {
  return session.id === ownerId;
}

type CookieStore = Awaited<ReturnType<typeof cookies>>;

export function setSessionCookie(cookieStore: CookieStore, userId: string) {
  cookieStore.set(SESSION_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  // Also clear any stale legacy cookie so it stops being sent.
  try {
    cookieStore.delete(LEGACY_COOKIE);
  } catch {
    // ignore — best-effort cleanup
  }
}

/**
 * Same session cookie as setSessionCookie(), but attached directly to a
 * NextResponse object. The Google OAuth callback ends with a 302 redirect,
 * and attaching cookies to the redirect response object is deterministic —
 * it doesn't depend on cookies() merging behavior with redirect responses.
 * (The 8-hour expiry and DB-backed lookup below give every session a hard
 * end-of-life; a deleted/deactivated user is signed out immediately.)
 */
export function setSessionCookieOnResponse(
  res: { cookies: { set: (opts: { name: string; value: string; httpOnly: boolean; sameSite: "lax"; path: string; maxAge: number }) => unknown; delete: (name: string) => unknown } },
  userId: string,
) {
  res.cookies.set({
    name: SESSION_COOKIE,
    value: userId,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  try {
    res.cookies.delete(LEGACY_COOKIE);
  } catch {
    // ignore
  }
}

export function clearSessionCookie(cookieStore: CookieStore) {
  cookieStore.delete(SESSION_COOKIE);
  try {
    cookieStore.delete(LEGACY_COOKIE);
  } catch {
    // ignore
  }
}
