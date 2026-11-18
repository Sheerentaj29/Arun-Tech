// Test helper: simulate what /api/auth/google/callback does when a
// first-time Google user signs up — creates a PENDING, EMPLOYEE-role account
// with an unusable (random) password. Used ONLY for local testing; the
// caller deletes the row afterwards.
//
// Usage: node scripts/simulate-google-signup.js

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

const db = new PrismaClient();

async function main() {
  const email = "google.test.user@inspections.demo";
  // Remove any leftover from a previous test run.
  await db.user.deleteMany({ where: { email } });

  // Same shape the OAuth callback creates:
  //   role EMPLOYEE (never ADMIN), accountStatus PENDING, unusable password.
  const unusablePassword = await bcrypt.hash(randomBytes(32).toString("hex"), 12);
  const user = await db.user.create({
    data: {
      email,
      name: "Google Test User",
      role: "EMPLOYEE",
      active: true,
      accountStatus: "PENDING",
      googleId: "test-google-sub-0001",
      passwordHash: unusablePassword,
    },
  });
  console.log("created pending google user:", user.id, user.email, user.accountStatus);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
