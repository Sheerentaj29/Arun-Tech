/**
 * SQLite backup + integrity verification script.
 *
 * Creates a timestamped, integrity-verified backup of the SQLite database
 * WITHOUT touching the original file. Computes a SHA-256 hash for the
 * backup so tampering or partial copies can be detected later.
 *
 * Run with: bun run scripts/backup-sqlite.ts
 *
 * The original custom.db file is NEVER modified or deleted by this script.
 * Backups land in /home/z/my-project/db/backups/.
 */

import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";
import { copyFileSync, mkdirSync, existsSync, appendFileSync, writeFileSync, statSync, readFileSync, unlinkSync, symlinkSync, readdirSync } from "fs";
import { join } from "path";

const SOURCE_DB = "/home/z/my-project/db/custom.db";
const BACKUP_DIR = "/home/z/my-project/db/backups";

const EXPECTED_TABLES = [
  "User", "Client", "Plant", "Equipment", "Inspection", "AuditLog",
  "PipeStandard", "ComponentType", "PipelineInspection",
  "ThicknessMeasurement", "ReportRevision",
];

interface CheckResult {
  passed: boolean;
  details: string;
}

async function runIntegrityCheck(db: PrismaClient): Promise<CheckResult> {
  // PRAGMA integrity_check returns "ok" on success or a list of error messages.
  const r: any = await db.$queryRaw`PRAGMA integrity_check;`;
  const lines = r.map((row: any) => row.integrity_check).filter(Boolean);
  if (lines.length === 1 && lines[0] === "ok") {
    return { passed: true, details: "integrity_check returned 'ok'" };
  }
  return { passed: false, details: lines.join("; ") };
}

async function runForeignKeyCheck(db: PrismaClient): Promise<CheckResult> {
  // PRAGMA foreign_key_check returns 0 rows if all FKs are satisfied.
  // Each violation row is: (table, rowid, parent, fkid)
  const r: any = await db.$queryRaw`PRAGMA foreign_key_check;`;
  if (r.length === 0) {
    return { passed: true, details: "0 FK violations" };
  }
  const sample = r.slice(0, 5).map((v: any) => `${v.table}#${v.rowid}→${v.parent}`).join("; ");
  return { passed: false, details: `${r.length} FK violations: ${sample}` };
}

async function captureRowCounts(db: PrismaClient): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const t of EXPECTED_TABLES) {
    const r: any = await db.$queryRawUnsafe(`SELECT COUNT(*) AS c FROM "${t}";`);
    counts[t] = Number(r[0]?.c ?? 0);
  }
  return counts;
}

function sha256File(path: string): string {
  const buf = readFileSync(path);
  return createHash("sha256").update(buf).digest("hex");
}

async function main() {
  // Sanity checks before doing anything
  if (!existsSync(SOURCE_DB)) {
    console.error(`FATAL: source DB not found at ${SOURCE_DB}`);
    process.exit(1);
  }
  mkdirSync(BACKUP_DIR, { recursive: true });

  // 1. Open the SOURCE DB read-only via Prisma (Prisma opens RW by default
  //    but our queries are all SELECTs/PRAGMAs — no writes happen in this
  //    script). To be extra safe, we'll only run SELECTs and PRAGMAs.
  const db = new PrismaClient({ log: ["error", "warn"] });

  console.log("=== STAGE 1 — SQLite Backup & Integrity Verification ===\n");
  console.log(`Source:  ${SOURCE_DB}`);
  console.log(`Size:    ${statSync(SOURCE_DB).size} bytes`);
  console.log(`Target:  ${BACKUP_DIR}/\n`);

  // 2. Run integrity_check on the SOURCE before backing up
  console.log("Step 1: integrity_check on source DB...");
  const integrity = await runIntegrityCheck(db);
  console.log(`  ${integrity.passed ? "✓ PASS" : "✗ FAIL"} — ${integrity.details}`);
  if (!integrity.passed) {
    console.error("\nFATAL: integrity_check failed on source — refusing to back up.");
    await db.$disconnect();
    process.exit(1);
  }

  // 3. Run foreign_key_check on the SOURCE before backing up
  console.log("\nStep 2: foreign_key_check on source DB...");
  const fk = await runForeignKeyCheck(db);
  console.log(`  ${fk.passed ? "✓ PASS" : "✗ FAIL"} — ${fk.details}`);
  if (!fk.passed) {
    console.error("\nFATAL: foreign_key_check failed on source — refusing to back up.");
    await db.$disconnect();
    process.exit(1);
  }

  // 4. Capture row counts on the SOURCE for later verification
  console.log("\nStep 3: capture source row counts for post-restore verification...");
  const sourceCounts = await captureRowCounts(db);
  for (const [t, n] of Object.entries(sourceCounts)) {
    console.log(`  ${t.padEnd(22)} ${n} rows`);
  }

  // 5. Close the connection to SOURCE before copying the file
  await db.$disconnect();
  console.log("\nStep 4: closed Prisma connection to source before file copy.");

  // 6. Copy the file to the backup directory with a UTC timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -1) + "Z";
  const backupPath = join(BACKUP_DIR, `custom.db.${timestamp}.bak`);
  console.log(`\nStep 5: copy ${SOURCE_DB} → ${backupPath}`);
  copyFileSync(SOURCE_DB, backupPath);
  const backupSize = statSync(backupPath).size;
  console.log(`  Copied ${backupSize} bytes`);

  // 7. Compute SHA-256 of source and backup, store both for verification
  console.log(`\nStep 6: SHA-256 verification`);
  const sourceHash = sha256File(SOURCE_DB);
  const backupHash = sha256File(backupPath);
  console.log(`  Source:  ${sourceHash}`);
  console.log(`  Backup:  ${backupHash}`);
  if (sourceHash !== backupHash) {
    console.error("\nFATAL: backup hash differs from source — file copy was not byte-identical.");
    process.exit(1);
  }
  console.log(`  ✓ Backup is byte-identical to source.`);

  // 8. Write the SHA-256 manifest alongside the backup
  const manifestPath = backupPath + ".sha256";
  const manifestBody =
    `# SQLite backup manifest\n` +
    `# Created: ${new Date().toISOString()}\`n` +
    `# Source: ${SOURCE_DB}\n` +
    `# Backup:  ${backupPath}\n` +
    `# Tables: ${EXPECTED_TABLES.length}\n` +
    `# Total rows: ${Object.values(sourceCounts).reduce((a, b) => a + b, 0)}\n` +
    `#\n` +
    `# Verify with: sha256sum -c ${manifestPath}\n` +
    `\n` +
    `${backupHash}  ${backupPath}\n` +
    `${sourceHash}  ${SOURCE_DB}\n`;
  writeFileSync(manifestPath, manifestBody);
  console.log(`  Manifest written: ${manifestPath}`);

  // 9. Re-open the BACKUP file via Prisma and verify it independently
  console.log(`\nStep 7: independent verification of backup file...`);
  const backupDb = new PrismaClient({
    log: ["error", "warn"],
    datasources: { db: { url: `file:${backupPath}` } },
  });
  const integrity2 = await runIntegrityCheck(backupDb);
  const fk2 = await runForeignKeyCheck(backupDb);
  const backupCounts = await captureRowCounts(backupDb);
  await backupDb.$disconnect();

  console.log(`  integrity_check on backup: ${integrity2.passed ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`  foreign_key_check on backup: ${fk2.passed ? "✓ PASS" : "✗ FAIL"}`);

  // 10. Compare row counts source vs backup
  console.log(`\nStep 8: row-count comparison (source vs backup)...`);
  let allMatch = true;
  for (const t of EXPECTED_TABLES) {
    const s = sourceCounts[t];
    const b = backupCounts[t];
    const match = s === b;
    if (!match) allMatch = false;
    console.log(`  ${t.padEnd(22)} source=${s}  backup=${b}  ${match ? "✓" : "✗ MISMATCH"}`);
  }
  if (!allMatch) {
    console.error("\nFATAL: row-count mismatch — backup is not usable.");
    process.exit(1);
  }

  console.log(`\n=== STAGE 1 COMPLETE ===`);
  console.log(`Backup file:   ${backupPath}`);
  console.log(`Manifest:      ${manifestPath}`);
  console.log(`SHA-256:       ${backupHash.slice(0, 16)}…`);
  console.log(`Tables:        ${EXPECTED_TABLES.length}`);
  console.log(`Total rows:    ${Object.values(sourceCounts).reduce((a, b) => a + b, 0)}`);
  console.log(`\nThe original source DB was NOT modified or deleted.`);

  // 11. Keep a "latest" symlink so the migration script can find the most
  //     recent backup easily
  const latestLink = join(BACKUP_DIR, "latest.bak");
  try {
    // Remove existing symlink if present
    try { unlinkSync(latestLink); } catch {}
    symlinkSync(backupPath, latestLink);
    console.log(`Latest symlink: ${latestLink} → ${backupPath}`);
  } catch (e) {
    // Symlink creation may fail on some filesystems — not fatal
    console.log(`(skipped latest symlink: ${(e as Error).message})`);
  }

  // 12. Rotate — keep only the last 30 daily backups
  const backups = readdirSync(BACKUP_DIR)
    .filter((f: string) => f.startsWith("custom.db.") && f.endsWith(".bak"))
    .map((f: string) => ({ name: f, mtime: statSync(join(BACKUP_DIR, f)).mtime.getTime() }))
    .sort((a: any, b: any) => b.mtime - a.mtime);
  const toDelete = backups.slice(30);
  for (const f of toDelete) {
    const p = join(BACKUP_DIR, f.name);
    unlinkSync(p);
    try { unlinkSync(p + ".sha256"); } catch {}
    console.log(`Rotated old backup: ${f.name}`);
  }
  if (toDelete.length === 0) {
    console.log(`Rotation: ${backups.length} backup(s) present — under the 30-backup limit.`);
  } else {
    console.log(`Rotation: removed ${toDelete.length} old backup(s) — keeping ${backups.length - toDelete.length} most recent.`);
  }

  // 13. Append a line to the backup-history log
  const historyPath = join(BACKUP_DIR, "history.log");
  const historyLine =
    `${new Date().toISOString()}\t${backupPath}\t${backupHash.slice(0, 16)}\t` +
    `${Object.values(sourceCounts).reduce((a, b) => a + b, 0)} rows\t` +
    `${EXPECTED_TABLES.length} tables\n`;
  appendFileSync(historyPath, historyLine);
  console.log(`History log:   ${historyPath}`);
}

main()
  .catch((e) => {
    console.error("\nFATAL:", e);
    process.exit(1);
  });
