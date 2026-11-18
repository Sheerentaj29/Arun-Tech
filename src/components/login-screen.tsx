"use client";

import { useEffect, useState } from "react";
import { HardHat, Loader2, ShieldAlert, Clock, Hourglass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAppStore } from "@/lib/store";
import { setSessionToken } from "@/lib/api-client";

/** Human-readable explanations for ?authError= codes set by the OAuth callback. */
const GOOGLE_ERROR_MESSAGES: Record<string, string> = {
  google_not_configured:
    "Google sign-in is not configured on the server yet. Ask your administrator to set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
  google_consent_error: "Google sign-in could not start. Please try again.",
  access_denied: "Google sign-in was cancelled. You can sign in with your password instead.",
  state_mismatch:
    "We couldn't verify the sign-in attempt (state mismatch). Please try again — this can happen if the sign-in tab was left open too long.",
  missing_code: "Sign-in could not be completed. Please try again.",
  google_exchange_failed:
    "Google sign-in failed while verifying your account. Please try again in a moment.",
  identity_unverified: "We could not verify your Google identity. Sign-in was refused.",
  email_not_verified:
    "Your Google account's email address is not verified. Verify it with Google, then try again.",
  email_conflict:
    "This email is already linked to a different Google account. Please contact your administrator.",
  account_disabled: "This account is disabled. Please contact your administrator.",
};

function GoogleIcon() {
  return (
    <svg className="mr-2 h-4 w-4" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.5 6.1 29.5 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.7-.4-3.9z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.3 5.3C36.9 39.2 44 34 44 24c0-1.3-.1-2.7-.4-3.9z" />
    </svg>
  );
}

interface LoginScreenProps {
  /** When true, show a "Your session has expired" banner above the form. */
  sessionExpired?: boolean;
  /** Called when the user dismisses the session-expired banner. */
  onDismissExpired?: () => void;
}

export function LoginScreen({ sessionExpired = false, onDismissExpired }: LoginScreenProps = {}) {
  const { setUser, setView } = useAppStore();
  const [email, setEmail] = useState("admin@inspections.demo");
  const [password, setPassword] = useState("admin123");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  // The Google OAuth callback redirects back to "/" with ?authError=<code>
  // or ?authPending=1. Read + clean those here so a refresh doesn't replay
  // the banner.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const errCode = params.get("authError");
    if (errCode) {
      setGoogleError(GOOGLE_ERROR_MESSAGES[errCode] ?? "Google sign-in failed. Please try again.");
      window.history.replaceState(null, "", window.location.pathname);
    } else if (params.get("authPending")) {
      setPendingEmail(
        params.get("pendingEmail") ??
          "Your Google account was registered, but an administrator must approve it before you can sign in.",
      );
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      // credentials:"include" is required so the Set-Cookie response header
      // is honoured by the browser for subsequent same-origin requests.
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Login failed");
      }
      const user = await res.json();
      // Store the user id in localStorage so the apiFetch helper can send
      // it as an Authorization: Bearer header on subsequent requests. This
      // is the fallback path for browsers that aren't accepting/sending
      // the session cookie (e.g. cross-origin on the HTTPS preview URL).
      setSessionToken(user.id);
      // Trust the POST response. The server has already validated the
      // password and set the session cookie. We transition to the
      // dashboard immediately; if the cookie isn't accepted by the
      // browser for some reason, the Authorization header fallback will
      // keep authentication working.
      setUser(user);
      setView("dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  function fill(role: "ADMIN" | "EMPLOYEE" | "APPROVER" | "INSPECTOR") {
    if (role === "ADMIN") {
      setEmail("admin@inspections.demo");
      setPassword("admin123");
    } else if (role === "EMPLOYEE") {
      setEmail("employee@inspections.demo");
      setPassword("employee123");
    } else if (role === "INSPECTOR") {
      setEmail("inspector@inspections.demo");
      setPassword("inspector123");
    } else {
      setEmail("approver@inspections.demo");
      setPassword("approver123");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-100 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-md bg-zinc-900 text-amber-400">
            <HardHat className="h-8 w-8" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
              Inspection Report Automation
            </h1>
            <p className="text-sm text-zinc-500">Inspection Reports — Piping &amp; Vessel</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>Enter your account credentials to continue</CardDescription>
          </CardHeader>
          <CardContent>
            {sessionExpired && (
              <Alert className="mb-4 border-amber-300 bg-amber-50">
                <Clock className="h-4 w-4 text-amber-700" />
                <AlertTitle className="text-amber-900">Your session has expired</AlertTitle>
                <AlertDescription className="text-amber-900">
                  For security, you have been signed out automatically. Please
                  sign in again to continue.
                  {onDismissExpired && (
                    <button
                      type="button"
                      onClick={onDismissExpired}
                      className="ml-2 text-xs underline hover:text-amber-700"
                    >
                      Dismiss
                    </button>
                  )}
                </AlertDescription>
              </Alert>
            )}
            {googleError && (
              <Alert className="mb-4" variant="destructive">
                <ShieldAlert className="h-4 w-4" />
                <AlertTitle>Google sign-in failed</AlertTitle>
                <AlertDescription>{googleError}</AlertDescription>
              </Alert>
            )}
            {pendingEmail && (
              <Alert className="mb-4 border-amber-300 bg-amber-50">
                <Hourglass className="h-4 w-4 text-amber-700" />
                <AlertTitle className="text-amber-900">Account pending approval</AlertTitle>
                <AlertDescription className="text-amber-900">
                  {pendingEmail.startsWith("@") || pendingEmail.includes("@")
                    ? `Your Google account (${pendingEmail}) was registered, but an administrator must approve it before you can sign in.`
                    : pendingEmail}
                </AlertDescription>
              </Alert>
            )}
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {error && (
                <Alert variant="destructive">
                  <ShieldAlert className="h-4 w-4" />
                  <AlertTitle>Authentication failed</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in...
                  </>
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>

            <div className="my-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-zinc-200" />
              <span className="text-xs uppercase tracking-wide text-zinc-400">or</span>
              <div className="h-px flex-1 bg-zinc-200" />
            </div>

            {/* Full OAuth 2.0 redirect flow — the browser is handed to
                Google's consent screen and returns via the callback route. */}
            <a href="/api/auth/google" className="block">
              <Button type="button" variant="outline" className="w-full">
                <GoogleIcon /> Sign in with Google
              </Button>
            </a>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              New Google accounts start as Employee and require administrator
              approval before sign-in.
            </p>

            <div className="mt-5 rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-3 text-xs">
              <div className="mb-1 font-semibold text-zinc-700">Demo accounts</div>
              <button
                type="button"
                onClick={() => fill("ADMIN")}
                className="block w-full text-left hover:text-amber-700"
              >
                <span className="font-mono">admin@inspections.demo</span> / admin123 (Administrator)
              </button>
              <button
                type="button"
                onClick={() => fill("EMPLOYEE")}
                className="block w-full text-left hover:text-amber-700"
              >
                <span className="font-mono">employee@inspections.demo</span> / employee123 (Employee)
              </button>
              <button
                type="button"
                onClick={() => fill("INSPECTOR")}
                className="block w-full text-left hover:text-amber-700"
              >
                <span className="font-mono">inspector@inspections.demo</span> / inspector123 (Inspector → treated as Employee)
              </button>
              <button
                type="button"
                onClick={() => fill("APPROVER")}
                className="block w-full text-left hover:text-amber-700"
              >
                <span className="font-mono">approver@inspections.demo</span> / approver123 (Approver → treated as Admin)
              </button>
            </div>
          </CardContent>
        </Card>
        <p className="mt-4 text-center text-xs text-zinc-500">
          DEMO BUILD · Use for evaluation only. Sample dimensions are illustrative
          and must not be used as engineering design values.
        </p>
      </div>
    </div>
  );
}
