/**
 * PostgreSQL backup script (for production use with a real Postgres instance).
 *
 * Creates a timestamped backup of the PostgreSQL database using pg_dump.
 * Also backs up the persistent file storage (PDFs, photos) directory.
 *
 * Run with: bun run scripts/backup-postgres.ts
 *
 * Prerequisites:
 *   - pg_dump CLI tool installed (comes with PostgreSQL client tools)
 *   - DATABASE_URL (or PG_DATABASE_URL) pointing at the Postgres instance
 *   - The script exports to /home/z/my-project/db/backups/
 *
 * The script does NOT modify the database. It reads via pg_dump (which
 * takes a consistent snapshot using Postgres's MVCC).
 */

import { execSync } from "child_process";
import { mkdirSync, existsSync, appendFileSync, readdirSync, unlinkSync, statSync, readFileSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";

const BACKUP_DIR = "/home/z/my-project/db/backups";
const STORAGE_DIR = "/home/z/my-project/storage";

function getEnv(key: string): string | undefined {
  return process.env[key];
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function main() {
  console.log("=== PostgreSQL Backup ===\n");
  mkdirSync(BACKUP_DIR, { recursive: true });

  const dbUrl = getEnv("PG_DATABASE_URL") ?? getEnv("DATABASE_URL");
  if (!dbUrl) {
    console.error("FATAL: DATABASE_URL (or PG_DATABASE_URL) not set.");
    console.error("Set it in .env to point at your Postgres instance.");
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -1) + "Z";

  // ── 1. Database backup via pg_dump ──
  const dbBackupPath = join(BACKUP_DIR, `pg-${timestamp}.sql`);
  console.log("Step 1: pg_dump database backup...");
  try {
    execSync(
      `pg_dump "${dbUrl}" --no-owner --no-privileges --format=plain --file="${dbBackupPath}"`,
      { stdio: "pipe", timeout: 120000 },
    );
    const size = statSync(dbBackupPath).size;
    const hash = sha256File(dbBackupPath);
    console.log(`  ✓ pg_dump complete: ${size} bytes, SHA-256: ${hash.slice(0, 16)}…`);
    // Write manifest
    appendFileSync(dbBackupPath + ".sha256", `${hash}  ${dbBackupPath}\n`);
  } catch (e: any) {
    console.error(`  ✗ pg_dump failed: ${e.message}`);
    console.error("  (If pg_dump is not installed, install postgresql-client-tools.)");
    process.exit(1);
  }

  // ── 2. File storage backup (PDFs + photos) ──
  console.log("\nStep 2: File storage backup (PDFs + photos)...");
  const storageBackupPath = join(BACKUP_DIR, `storage-${timestamp}.tar.gz`);
  try {
    execSync(
      `tar czf "${storageBackupPath}" -C "${STORAGE_DIR}" .`,
      { stdio: "pipe", timeout: 60000 },
    );
    const size = statSync(storageBackupPath).size;
    console.log(`  ✓ Storage backup: ${size} bytes`);
  } catch (e: any) {
    console.warn(`  ⚠ Storage backup failed (non-fatal): ${e.message}`);
  }

  // ── 3. Rotation — keep last 30 backups ──
  console.log("\nStep 3: Rotation (keep last 30)...");
  const allBackups = readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".sql") || f.endsWith(".tar.gz"))
    .map((f) => ({ name: f, mtime: statSync(join(BACKUP_DIR, f)).mtime.getTime() }))
    .sort((a, b) => b.mtime - a.mtime);
  const toDelete = allBackups.slice(60); // 30 SQL + 30 tar.gz = 60 total
  for (const f of toDelete) {
    const p = join(BACKUP_DIR, f.name);
    try { unlinkSync(p); } catch {}
    console.log(`  Rotated: ${f.name}`);
  }

  // ── 4. History log ──
  const historyPath = join(BACKUP_DIR, "pg-history.log");
  appendFileSync(
    historyPath,
    `${new Date().toISOString()}\t${dbBackupPath}\t${sha256File(dbBackupPath).slice(0, 16)}\n`,
  );

  console.log(`\n=== Backup Complete ===`);
  console.log(`DB backup:      ${dbBackupPath}`);
  console.log(`Storage backup: ${storageBackupPath}`);
  console.log(`History:        ${historyPath}`);
}

main();
