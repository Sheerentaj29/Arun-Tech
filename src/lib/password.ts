// Password hashing utility — supports backward-compatible migration from
// unsalted SHA-256 to salted bcrypt (cost factor 12).
//
// Usage:
//   - `hashPassword(pw)` → always returns a bcrypt hash (for new accounts)
//   - `verifyPassword(pw, storedHash)` → returns true if the password matches
//   - `needsRehash(storedHash)` → returns true if the hash is SHA-256 (needs upgrade)
//
// Migration strategy:
//   - Existing accounts have SHA-256 hashes (64-char hex string).
//   - On the NEXT successful login, the auth route detects the SHA-256 hash
//     and replaces it with a bcrypt hash — no password reset required.
//   - New accounts are created with bcrypt from the start.

import bcrypt from "bcryptjs";
import { createHash } from "crypto";

const BCRYPT_COST = 12;

/** SHA-256 hash (legacy, unsalted — used by the original build). */
function sha256Hash(pw: string): string {
  return createHash("sha256").update(pw).digest("hex");
}

/** Check if a stored hash is a legacy SHA-256 hash (64-char hex string). */
export function isLegacySha256Hash(hash: string): boolean {
  // SHA-256 produces a 64-character hex string.
  // bcrypt hashes start with "$2a$", "$2b$", or "$2y$" and are ~60 chars.
  return /^[a-f0-9]{64}$/i.test(hash);
}

/** Check if a stored hash needs to be upgraded from SHA-256 to bcrypt. */
export function needsRehash(hash: string): boolean {
  return isLegacySha256Hash(hash);
}

/** Hash a password using bcrypt (cost 12). Used for new accounts. */
export async function hashPassword(pw: string): Promise<string> {
  const salt = await bcrypt.genSalt(BCRYPT_COST);
  return bcrypt.hash(pw, salt);
}

/**
 * Verify a password against a stored hash.
 * Supports both legacy SHA-256 and new bcrypt hashes.
 * Returns true if the password matches.
 */
export async function verifyPassword(pw: string, storedHash: string): Promise<boolean> {
  if (isLegacySha256Hash(storedHash)) {
    // Legacy path: compare SHA-256 hashes
    return sha256Hash(pw) === storedHash;
  }
  // New path: bcrypt compare
  try {
    return await bcrypt.compare(pw, storedHash);
  } catch {
    return false;
  }
}
