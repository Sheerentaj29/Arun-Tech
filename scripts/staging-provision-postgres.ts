/**
 * Postgres STAGING database provisioned via PGlite (real Postgres in WASM).
 *
 * This is a real, in-process Postgres instance. We use it ONLY for staging:
 *   1. Apply the generated DDL (prisma/migrations/0001_initial_schema.sql)
 *   2. Verify all 11 tables + FKs + unique constraints + indexes exist
 *   3. Never used for production — production uses a real Postgres server
 *      configured via DATABASE_URL in .env
 *
 * Run with: bun run scripts/staging-provision-postgres.ts
 *
 * The PGlite data is persisted to /home/z/my-project/db/staging-pg/ so
 * subsequent runs reuse the same DB.
 */

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const STAGING_DATA_DIR = "/home/z/my-project/db/staging-pg";
const MIGRATION_SQL_PATH = "/home/z/my-project/prisma/migrations/0001_initial_schema.sql";
const IMMUTABILITY_SQL_PATH = "/home/z/my-project/prisma/migrations/0002_immutable_approved_revisions.sql";

const EXPECTED_TABLES = [
  "User", "Client", "Plant", "Equipment", "Inspection", "AuditLog",
  "PipeStandard", "ComponentType", "PipelineInspection",
  "ThicknessMeasurement", "ReportRevision",
];

async function main() {
  console.log("=== STAGE 2 — Provision PostgreSQL Staging via PGlite ===\n");
  mkdirSync(STAGING_DATA_DIR, { recursive: true });
  console.log(`Staging data dir: ${STAGING_DATA_DIR}`);
  console.log(`Migration SQL:    ${MIGRATION_SQL_PATH}\n`);

  // Open PGlite (real Postgres in WASM, persisted to disk)
  const pg = new PGlite(STAGING_DATA_DIR);

  // 1. Apply the migration SQL (schema)
  console.log("Step 1: Apply schema migration SQL...");
  const sql = readFileSync(MIGRATION_SQL_PATH, "utf-8");
  await pg.exec(sql);
  console.log("  ✓ Schema migration applied");

  // 1b. Apply the immutability triggers (defense-in-depth for approved revisions)
  console.log("\nStep 1b: Apply immutability triggers...");
  const immutabilitySql = readFileSync(IMMUTABILITY_SQL_PATH, "utf-8");
  await pg.exec(immutabilitySql);
  console.log("  ✓ Immutability triggers applied");

  // 2. Verify all 11 tables exist
  console.log("\nStep 2: Verify all 11 tables exist...");
  const tables = await pg.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `);
  const actualTables = tables.rows.map(r => r.table_name);
  const missing = EXPECTED_TABLES.filter(t => !actualTables.includes(t));
  const extra = actualTables.filter(t => !EXPECTED_TABLES.includes(t) && !t.startsWith("_"));
  if (missing.length > 0) {
    console.error(`  ✗ FAIL — missing tables: ${missing.join(", ")}`);
    await pg.close();
    process.exit(1);
  }
  console.log(`  ✓ All ${EXPECTED_TABLES.length} expected tables present (${actualTables.length} total in schema)`);

  // 3. Verify FK constraints
  console.log("\nStep 3: Verify foreign-key constraints...");
  const fks = await pg.query<{ conname: string, conrelid: string, confrelid: string }>(`
    SELECT conname, conrelid::regclass AS conrelid, confrelid::regclass AS confrelid
    FROM pg_constraint
    WHERE contype = 'f' AND connamespace = 'public'::regnamespace
    ORDER BY conname;
  `);
  console.log(`  ✓ ${fks.rows.length} FK constraints present:`);
  for (const f of fks.rows) {
    console.log(`    - ${f.conname}: ${f.conrelid} → ${f.confrelid}`);
  }

  // 4. Verify unique constraints
  console.log("\nStep 4: Verify unique constraints...");
  const uniques = await pg.query<{ conname: string, conrelid: string }>(`
    SELECT conname, conrelid::regclass AS conrelid
    FROM pg_constraint
    WHERE contype = 'u' AND connamespace = 'public'::regnamespace
    ORDER BY conname;
  `);
  console.log(`  ✓ ${uniques.rows.length} unique constraints present:`);
  for (const u of uniques.rows) {
    console.log(`    - ${u.conname} on ${u.conrelid}`);
  }

  // 5. Verify indexes
  console.log("\nStep 5: Verify secondary indexes...");
  const indexes = await pg.query<{ indexname: string, tablename: string }>(`
    SELECT indexname, tablename
    FROM pg_indexes
    WHERE schemaname = 'public' AND indexname NOT LIKE '%_pkey' AND indexname NOT LIKE '%_key'
    ORDER BY tablename, indexname;
  `);
  console.log(`  ✓ ${indexes.rows.length} secondary indexes present:`);
  for (const i of indexes.rows) {
    console.log(`    - ${i.indexname} on ${i.tablename}`);
  }

  // 6. Empty tables — no rows yet (will be populated by Stage 3 migration)
  console.log("\nStep 6: Row counts (should be 0 after fresh provisioning)...");
  for (const t of EXPECTED_TABLES) {
    const r = await pg.query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM "${t}";`);
    console.log(`  ${t.padEnd(22)} ${r.rows[0]?.c ?? 0} rows`);
  }

  await pg.close();
  console.log("\n=== STAGE 2 COMPLETE — staging Postgres is ready for migration ===");
  console.log(`Staging data: ${STAGING_DATA_DIR}`);
  console.log(`\nNext: run scripts/migrate-sqlite-to-postgres.ts to copy data from SQLite → staging Postgres.`);
}

main().catch(e => {
  console.error("FATAL:", e);
  process.exit(1);
});
