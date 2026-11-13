// audit_content_part2.js — Sections 7-12
const { h1, h2, h3, body, bullet, caption, table, spacer } = require("./audit_docx_helpers");

// ============ SECTION 7: PDF GENERATION ============
function section7() {
  return [
    h1("7. PDF Generation"),
    h2("7.1 Architecture"),
    body("PDF generation is server-side only, implemented in src/lib/pdf/pipeline-report.ts (3,012 lines) on top of pdfkit 0.20.2. The single exported generator, generatePipelineReportPdf, renders all seven report types with shared layout primitives (header grid, table helpers, photo cells, drawing pages, visual/DPT/condition sections and a sign-off block). Geist Sans fonts are registered from /home/z/my-project/node_modules/geist with a Helvetica fallback. A4 landscape and portrait orientations are both supported."),
    h2("7.2 Where PDFs Happen and Where They Go"),
    bullet([{ t: "On-demand download: ", b: true }, { t: "GET /api/pipeline-inspections/[id]/pdf?orientation=... generates the document in memory and streams it (application/pdf, Content-Disposition inline). Nothing is written to disk on this path." }]),
    bullet([{ t: "Approval persistence: ", b: true }, { t: "the approve route generates the PDF once and writes it to storage/pdfs/{reportNumber}_rev{n}_{timestamp}.pdf, recording the path on the report and the approved ReportRevision. This is why only 2 PDF files exist despite 60 reports." }]),
    bullet([{ t: "Per-revision PDF: ", b: true }, { t: "GET /api/.../revisions/[rid]/pdf regenerates from the immutable revision snapshot." }]),
    h2("7.3 Consistency Between Preview and Download"),
    body("The HTML review view (detail view) was built to mirror the PDF layout 1:1 (per the development worklog) and both consume the same database records through the same API. Shared pure helpers in src/lib/measurement-utils.ts guarantee identical observed-minimum computation and display formatting in browser and PDF. During this audit the live PDF (2 pages, valid PDF 1.3) matched the HTML preview for the same report, including the Aruntech logo on the left and the client logo on the right of the header."),
    h2("7.4 Image, Drawing and Certificate Embedding"),
    bullet([{ t: "Logos: ", b: true }, { t: "the Aruntech service logo is located by scanning storage/logos for service-company.{png,jpg,jpeg,webp,gif}; the client logo is resolved through the explicit name mapping, then drawn inside a bordered box fitted to 92% x 88% of the box with aspect ratio preserved. Missing logos render a labeled placeholder; no wrong-company substitution logic exists." }]),
    bullet([{ t: "Photos: ", b: true }, { t: "read from disk and drawn fitted inside cells; the primary photo gets a dedicated block. No resizing, compression or transcoding is applied (sharp is installed but never imported)." }]),
    bullet([{ t: "Drawings: ", b: true }, { t: "uploaded PDF drawings are rasterized page-by-page with the external poppler tool pdftoppm at 150 DPI and embedded as PNG images; PNG/JPG drawings are embedded directly; DWG/DXF/DWT/DWS and other unsupported formats produce a clearly labeled placeholder page (important: a drawing whose bytes are not visible in the PDF is still listed with its metadata)." }]),
    bullet([{ t: "Certificates: ", b: true }, { t: "same strategy as drawings: PDF certificates rasterized per page, images fitted; multi-page certificates handled." }]),
    h2("7.5 Risks and Limitations"),
    bullet("pdfkit natively embeds only PNG and JPEG. WEBP, AVIF and SVG files (which exist among the client logos and are served fine in the browser) fall back to a text placeholder inside generated PDFs. A transcoding step (sharp is already a dependency) would close this gap."),
    bullet("Runtime dependency on the poppler-utils binary (pdftoppm) and on node_modules font paths; both are environment assumptions not enforced by any check."),
    bullet("signedPdfPath exists in the schema but is never populated; there is no digital signature or tamper-evidence on generated PDFs."),
    bullet("The engine is a single 3,012-line file; changes to one report type risk regressions in others (structural risk, not a current defect)."),
    body([{ t: "Production readiness verdict: ", b: true },
      { t: "functionally solid and already used for the core purpose, but the format gaps (WEBP/AVIF/SVG), external tool dependency, absent signature support and hardcoded paths should be addressed before relying on it in a production deployment." }]),
  ];
}

// ============ SECTION 8: API AND BACKEND ============
function section8() {
  return [
    h1("8. API and Backend"),
    h2("8.1 Route Inventory"),
    body("The backend consists of 58 Next.js route files under src/app/api with roughly 90 exported HTTP handlers. The major groups:"),
    caption("Table 8.1: API route groups"),
    table(
      ["Group", "Routes", "Purpose"],
      [
        ["auth", "/api/auth (POST login, GET me, DELETE logout)", "Login with rate limiting; transparent SHA-256 to bcrypt re-hash; audit LOGIN events"],
        ["clients / plants", "/api/clients, /api/clients/[id], logo upload+raw, /api/plants*", "Admin CRUD; logo upload with 5 MB limit; 57 clients, 84 plants"],
        ["equipment + inspections", "/api/equipment*, /api/inspections, /api/equipment/catalog", "Equipment master CRUD with search/filter/pagination; legacy equipment inspections; catalog metadata (unauthenticated)"],
        ["pipeline-inspections", "/api/pipeline-inspections + 16 sub-routes (measurements, visual, dpt, photos, drawings, certificates, submit, return, approve, revise, override, revisions, pdf)", "The core reporting module; all workflow actions; PDF generation"],
        ["drawings", "/api/drawings, /api/drawings/[id] (+preview/download/revisions)", "Drawing upload (50 MB), revision history, preview and download"],
        ["import-export", "/api/import-export/{template,preview,commit,export}", "CSV template (unauthenticated), preview with row-level validation, admin commit, export"],
        ["users", "/api/users, /api/users/[id]", "Admin-only user management with last-admin protection"],
        ["reference data", "/api/pipe-standards*, /api/component-types*", "ASME reference rows with verify workflow; component types"],
        ["misc", "/api/dashboard, /api/admin-summary, /api/employee-summary, /api/audit-logs, /api/settings/service-logo, /api/client-logo/[slug]", "Aggregations, audit trail, branding assets"],
      ],
      [16, 36, 48], { zebra: true }
    ),
    h2("8.2 Cross-Cutting Practices (measured, not assumed)"),
    caption("Table 8.2: Automated scan of all 58 route files"),
    table(
      ["Practice", "Count", "Notes"],
      [
        ["Session check present", "55 / 58 files", "Missing on page route, /api/equipment/catalog, /api/import-export/template (static data only)"],
        ["Role checks", "25 files", "Admin gates on management routes; ownership checks on report mutation routes"],
        ["Zod or schema validation", "0 files", "All input parsing is manual; zod 4.0.2 is a dependency but never imported"],
        ["db.$transaction", "2 files", "approve (full workflow atomicity) and report drawing links; other multi-write endpoints are not transactional"],
        ["recordAudit", "44 files", "Covers CRUD, approval, override, export, import, login; failures are logged to console only"],
        ["File upload handling", "9 files", "multipart formData with declared-MIME or extension allow-lists and size limits (5-50 MB)"],
        ["Size limit checks", "7 files", "upload routes; no global request-body limits configured"],
      ],
      [30, 16, 54], { zebra: true }
    ),
    h2("8.3 Error Handling and Weaknesses"),
    bullet("Handlers return JSON errors with appropriate status codes (401/403/404/409/422 verified in code); there is no global error boundary or app/error.tsx, so unhandled exceptions surface as the framework's default error screen."),
    bullet("PrismaClient is created with log: ['query'] unconditionally (src/lib/db.ts), which logs every SQL statement in production too: noise, slower responses, and potential data leakage into logs."),
    bullet("Two latent bugs of the _req/req mismatch type exist (plants/[id] DELETE, pipe-standards/[id] line 77): the Bearer fallback is skipped; masked by ignoreBuildErrors."),
    bullet("A route folder is misnamed id] instead of [mid] under pipeline-inspections/[id]/measurements; live testing shows PUT/DELETE still route to the handler (Next.js tolerates the trailing bracket), returning the handler's own 404 JSON, so the feature works, but the name is non-standard and fragile."),
    bullet("No request-body size limiting beyond the per-upload checks; no output rate limiting; in-memory rate limiter only on login."),
    bullet("Audit writes are best-effort (failures swallowed with a console error), so the audit trail can silently lose entries under database stress."),
  ];
}

// ============ SECTION 9: CODE QUALITY AND CLEANLINESS ============
function section9() {
  return [
    h1("9. Code Quality and Project Cleanliness"),
    body("Nothing was deleted during the audit. The lists below are observations with removal recommendations for the project owner to decide."),
    h2("9.1 Repository Hygiene (files committed to git that should not be)"),
    caption("Table 9.1: Items committed to the repository that are data or environment artifacts"),
    table(
      ["File / folder", "Why it appears unnecessary in git", "Safe to remove from git?"],
      [
        [".env (tracked)", "Environment file committed to the repository; currently only DATABASE_URL, but the practice will leak real secrets when Postgres credentials are added", "Yes (untrack + ignore; rotate if secrets are ever added)"],
        ["db/staging-pg/ (1,043 files, 32 MB)", "A binary PostgreSQL data directory (WAL files, catalogs) under version control", "Yes (gitignore; it is rebuildable via the provisioning script)"],
        ["db/custom.db + db/*.bak + db/backups/*", "Live database and backup binaries in version control; every commit diffs binary garbage", "Yes (gitignore; keep off-host backups instead)"],
        ["storage/photos/*.png (several > 5 MB each)", "Uploaded inspection photos (mostly test artifacts) committed as repo content", "Yes (gitignore; store on disk/volume, not git)"],
        ["tool-results/ (9 files tracked)", "Agent-session text dumps (bash/read outputs)", "Yes"],
        ["Caddyfile (repo only)", "Sandbox preview reverse-proxy snippet (port 81 to localhost:3000); not a production deployment config", "Needs verification (keep only if the target host uses Caddy)"],
        ["dev.log / server.log patterns", "gitignore already covers *.log; the running copy contains dev.log untracked (correct)", "No action needed (informational)"],
      ],
      [26, 48, 26], { zebra: true }
    ),
    h2("9.2 Code and Dependencies"),
    caption("Table 9.2: Unused or questionable code and dependencies (verified by import scan)"),
    table(
      ["Item", "Evidence", "Safe to remove?"],
      [
        ["sharp (dependency)", "Never imported anywhere in src/, scripts/ or mini-services/", "Yes, unless image transcoding is planned (it would be the natural fix for WEBP logos in PDFs)"],
        ["z-ai-web-dev-sdk (dependency)", "Never imported in the application", "Yes"],
        ["zod (dependency)", "Declared, never imported; all validation is manual", "Either adopt it for input validation or remove"],
        ["pg-gateway (dependency)", "Never imported; the bridge implements the protocol itself", "Yes"],
        ["@electric-sql/pglite (dependency)", "Used only by staging/migration scripts and pglite-bridge (not by the app)", "Keep if the PostgreSQL effort will resume; otherwise remove with those scripts"],
        ["shadcn/ui demo components", "48 UI components present; several are scaffold demos never used by views (for example ui/chart.tsx with recharts, ui/form.tsx with react-hook-form)", "Needs verification per component (low priority)"],
        ["examples/websocket/", "Framework scaffold demo (frontend.tsx + server.ts), unrelated to the app", "Yes"],
        ["tests/ folder", "Contains three shell scripts about runtime builds (database-runtime-build.sh etc.); no actual test suite exists", "Rename or remove; the app has no automated tests"],
        ["scripts/test_*.ts, test_blank_page.cjs", "One-off verification scripts from past fixes (PDF numbering, thickness tables)", "Needs verification (archive or keep as regression scripts)"],
        ["scripts/backup-sqlite.ts + staging-provision-postgres.ts + migrate-sqlite-to-postgres.ts", "Still expect 11 tables; schema has 18; would pass silently with incomplete coverage", "Update before any real use; do not run as-is"],
        ["pipeline-inspections/[id]/measurements/id]/", "Route folder misnamed (missing opening bracket); works today by framework leniency", "Rename to [mid] (needs verification that no client depends on the literal path)"],
        ["client-logo-mapping.ts divergence", "Repo copy has 5 mappings and stale comments; the running copy has 54 (5 original + 49 added for the new logo push)", "Commit the updated file to the repo to remove the divergence"],
        ["worklog.md", "Documents only development Tasks 1-2; later features (drawings, certificates, 5 report types, logos) are undocumented", "Keep as history; extend or move to docs/"],
      ],
      [26, 46, 28], { zebra: true }
    ),
    h2("9.3 Data Cleanliness"),
    bullet("60 pipeline reports in the live database are overwhelmingly functional test artifacts (E2E-*, UT-*, PHOTO-*, LAYOUT-FIX-*, MPT-E2E-*); 1 is flagged isDemo. Real client names (Coromandel, JK Tyre, Atul, BPCL and 52 more) are mixed with 4 demo clients (AcidChem, Greenfield Water, Western Petrochem demo entries)."),
    bullet("752 audit log rows and 62 photo files (38 MB) are test-run residue; storage/photos contains files named after test reports."),
    bullet("The login screen and seed scripts advertise four demo accounts with trivial passwords (admin123, employee123, inspector123, approver123)."),
    bullet("80 ASME pipe-standard reference rows are all flagged unverified by design (the app warns they must be re-verified against the licensed standard before production use)."),
    h2("9.4 Code Quality Signals"),
    bullet("typescript.ignoreBuildErrors: true in next.config.ts; running tsc --noEmit reports 35 errors (10 TS2552, 8 TS2339, 6 TS2307, 4 TS2322, 2 TS2352, 2 TS2304, 2 TS1117, 1 TS2561), including two undefined-variable bugs in authorization code paths."),
    bullet("React strict mode is disabled (reactStrictMode: false)."),
    bullet("Largest source files: pipeline-report-form-view.tsx 5,899 lines; pipeline-report.ts 3,012; pipeline-report-detail-view.tsx 1,521. Monolithic but organized with clear section comments."),
    bullet("There is no test suite (no unit, integration or e2e tests); the tests/ folder contains shell scripts unrelated to testing."),
    bullet("Both bun.lock and package-lock.json are committed (dual package-manager lockfiles)."),
  ];
}

// ============ SECTION 10: PRODUCTION READINESS ============
function section10() {
  return [
    h1("10. Production Readiness Assessment"),
    body("The matrix below gives an honest, evidence-based verdict per area. Production Ready is asserted only where the code and configuration fully support it."),
    caption("Table 10.1: Production readiness matrix"),
    table(
      ["Area", "Current status", "Production ready?", "Key issues"],
      [
        ["Database", "SQLite file in project dir, 18 tables, no migration history, no WAL", "No", "File DB committed to git; default journal mode; single writer; PostgreSQL migration only partial (11/18 tables)"],
        ["Authentication", "Custom cookie + bearer session; bcrypt with legacy SHA-256 upgrade", "No", "Unsigned token (raw user id); no secure flag; demo credentials displayed; no password reset/2FA"],
        ["Authorization", "Per-route role + ownership checks; 55/58 routes gated", "Partially", "3 unauthenticated endpoints; 2 latent _req bugs; no central middleware"],
        ["File storage", "Local disk under project dir; allow-lists + size limits", "No", "Hardcoded absolute paths; photos uncompressed; no volume/cloud strategy; DWG/DXF not embeddable"],
        ["PDF generation", "pdfkit engine, all 7 types, live-verified output", "Partially", "WEBP/AVIF/SVG placeholders; poppler binary dependency; no digital signature"],
        ["Backups", "backup script exists with SHA-256 verification; docs/restore-procedure.md", "No", "No automation running; newest backup 2026-10-27; restore doc's cron/S3 steps are documentation only"],
        ["Security", "Rate-limited login; audited actions; path-traversal-safe slug filter", "No", "Unsigned sessions; secrets in git history risk; no CSRF tokens; in-memory limiter; Prisma query logging on"],
        ["Error handling", "Per-handler JSON errors; no app-level error boundaries", "No", "35 suppressed TypeScript errors; default framework error screens; silent audit failures"],
        ["Deployment", "Standalone build configured; start script uses bun on .next/standalone", "No", "No process manager/service config; Caddyfile is sandbox-specific; absolute paths bind the app to one host layout"],
        ["Logging", "dev.log via tee; Prisma query log; console.error", "No", "No structured logging, levels, rotation, or request ids"],
      ],
      [13, 27, 12, 48], { zebra: true }
    ),
    body("What is genuinely good: the domain model is thorough and carefully commented; the approval workflow enforces immutability where it matters (approved revisions are snapshotted with PDFs); upload handling has real allow-lists and size caps; audit coverage is broad; the UI was verified working end-to-end multiple times during this audit cycle."),
  ];
}

// ============ SECTION 11: CRITICAL ISSUES ============
function section11() {
  return [
    h1("11. Critical Issues (Prioritized)"),
    h2("Critical - must fix before any production exposure"),
    caption("Table 11.1: Critical issues"),
    table(
      ["#", "Problem", "Where", "Why it matters", "Recommended fix"],
      [
        ["C1", "Unsigned session tokens: the cookie and Bearer token are the raw user id; the Bearer copy lives in localStorage indefinitely", "src/lib/auth.ts; src/lib/api-client.ts", "Whoever obtains a user id once can impersonate the user with no expiry; XSS or log leakage becomes account takeover", "Sign sessions (HMAC or JWT with expiry) or adopt NextAuth/Auth.js; rotate on login; remove localStorage persistence"],
        ["C2", "Environment file, live database, database backups, storage photos and a PostgreSQL data directory are committed to git", ".env, db/, storage/ in the repository", "Secret leakage risk; repo bloat (95 MB working tree, 83 MB .git); binary churn in history", "Untrack and gitignore .env, db/, storage/, tool-results/; purge history if real secrets are ever stored; keep backups off-host"],
        ["C3", "Hardcoded absolute paths throughout the backend and PDF engine", "9+ route files; src/lib/pdf/pipeline-report.ts (fonts, storage dirs)", "The application cannot run on any host whose layout differs from /home/z/my-project; breaks containers, other servers, and any non-root user", "Introduce env-configured storage/font roots (one STORAGE_DIR constant) and read paths from configuration"],
        ["C4", "TypeScript errors suppressed at build time", "next.config.ts ignoreBuildErrors: true; 35 current errors", "Real defects ship silently; two are in auth-adjacent code (getSession(req) with undefined req)", "Fix the 35 errors, remove the flag, add type-checking to CI"],
        ["C5", "No operating backup automation", "scripts/backup-sqlite.ts (manual); docs/restore-procedure.md defines a schedule that nothing runs", "Data loss window is unbounded; newest backup is from 2026-10-27", "Schedule the existing script (cron/systemd timer), monitor it, and store copies off-host"],
      ],
      [6, 24, 20, 24, 26], { zebra: true }
    ),
    h2("High priority"),
    caption("Table 11.2: High-priority issues"),
    table(
      ["#", "Problem", "Where", "Why it matters", "Recommended fix"],
      [
        ["H1", "Demo/test data and demo accounts mixed into the live database and shown on the login screen", "DB (60 reports, 4 demo clients, 752 audit rows); login-screen.tsx; seed scripts", "Confuses real usage, pollutes reports, and advertises credentials", "Purge test artifacts, remove demo accounts or move to a seeded staging dataset, strip credentials from the login UI"],
        ["H2", "Unauthenticated endpoints exposing reference data", "/api/equipment/catalog, /api/import-export/template", "Information disclosure and inconsistent auth posture", "Add session checks (both are one-line guards)"],
        ["H3", "No error boundaries and no structured logging", "src/app (no error.tsx/global-error.tsx); db.ts log: ['query']", "Poor failure UX; SQL noise in production logs; harder incident triage", "Add error boundaries, switch Prisma logging off or to error-only, add request-scoped structured logs"],
        ["H4", "SQLite operational limits (default journal, single writer, same-host file)", "db/custom.db", "Write contention and corruption risk under real multi-user load; no point-in-time recovery", "Either complete the PostgreSQL migration or at minimum enable WAL, busy_timeout, and scheduled backups"],
        ["H5", "Photos stored raw, no image pipeline", "photos route (10 MB, MIME allow-list only); 38 MB across 62 files", "Storage growth, slow PDFs, and client-declared MIME can mislabel content", "Transcode/resize with sharp (already installed), sniff real content type, consider object storage"],
      ],
      [6, 24, 20, 24, 26], { zebra: true }
    ),
    h2("Medium priority"),
    bullet([{ t: "M1. No schema validation library: ", b: true }, { t: "adopt Zod (already a dependency) for request bodies to standardize 4xx responses and reduce manual parsing bugs." }]),
    bullet([{ t: "M2. Transactional gaps: ", b: true }, { t: "only 2 of ~90 handlers use transactions; multi-row imports and observation writes could partially apply. Wrap multi-write operations." }]),
    bullet([{ t: "M3. ASME reference data unverified: ", b: true }, { t: "80/80 pipe standards flagged unverified; the app blocks nothing but warns. Verify against the licensed standard before real reports are issued." }]),
    bullet([{ t: "M4. Route folder misnamed id]: ", b: true }, { t: "works today via framework leniency; rename to [mid] and re-test measurement row update/delete." }]),
    bullet([{ t: "M5. Mapping divergence: ", b: true }, { t: "repo client-logo-mapping.ts (5 entries) vs runtime (54); commit the runtime version." }]),
    bullet([{ t: "M6. Visual and Condition report types not creatable: ", b: true }, { t: "backend and PDF fully support them, but the selector offers 5 types; add cards if these reports are wanted." }]),
    bullet([{ t: "M7. No secure cookie flag / HTTPS enforcement: ", b: true }, { t: "set cookie secure in production and terminate TLS at the reverse proxy." }]),
    h2("Improvements"),
    bullet("Add a real test suite (unit for measurement math and workflow state transitions; e2e for the golden path)."),
    bullet("Split pipeline-report.ts into per-type modules; extract shared layout primitives."),
    bullet("Finish or formally drop the PostgreSQL migration (update scripts to 18 models; choose a real PG server instead of PGlite for production)."),
    bullet("Add concurrent-edit protection (optimistic locking via updatedAt) and notifications on submit/return/approve."),
    bullet("Introduce structured logging with levels and rotation; add health and readiness endpoints."),
  ];
}

// ============ SECTION 12: FINAL SUMMARY ============
function section12() {
  return [
    h1("12. Final Summary"),
    caption("Table 12.1: Verdict at a glance"),
    table(
      ["Question", "Answer"],
      [
        ["Current application status", "Development (feature-complete prototype; not a production candidate)"],
        ["Current database", "SQLite file database at /home/z/my-project/db/custom.db (provider = sqlite; 18 tables; db push maintained; no migration history)"],
        ["PostgreSQL migration", "Partially completed in staging (PGlite, 11/18 tables), rolled back to SQLite; infrastructure committed"],
        ["Workflow completeness", "Create -> Fill -> Tables -> Drawings -> Photos -> Certificates -> Submit -> Review -> Approve -> Revise -> PDF: all fully implemented"],
        ["Biggest gap category", "Operations (paths, backups, secrets, deployment) rather than features"],
      ],
      [30, 70], { zebra: true }
    ),
    h2("Biggest Risks (top 5)"),
    bullet([{ t: "1. Session security: ", b: true }, { t: "unsigned, unexpiring bearer tokens equal to user ids; combined with demo credentials on the login screen this is the fastest path to unauthorized access." }]),
    bullet([{ t: "2. Non-portable, hardcoded filesystem contract: ", b: true }, { t: "every storage and font path assumes /home/z/my-project; a host change or containerization breaks uploads, PDFs and logos simultaneously." }]),
    bullet([{ t: "3. Data loss exposure: ", b: true }, { t: "no running backups, SQLite in default journal mode, database and storage inside the project tree (a deploy or clean would wipe live data)." }]),
    bullet([{ t: "4. Silent quality gate: ", b: true }, { t: "ignoreBuildErrors plus zero tests means regressions reach production unnoticed; 35 type errors already include two auth-adjacent bugs." }]),
    bullet([{ t: "5. Unverified engineering reference data: ", b: true }, { t: "all 80 ASME nominal-thickness rows are unverified; reports produced today could carry incorrect nominal values into client-facing PDFs." }]),
    h2("Recommended Next Steps (in order)"),
    bullet([{ t: "Step 1 - Security hardening: ", b: true }, { t: "sign session tokens with expiry (or adopt NextAuth), set cookie secure, remove demo credentials from the login screen, gate the 2 open endpoints, untrack .env/db/storage from git." }]),
    bullet([{ t: "Step 2 - Build hygiene: ", b: true }, { t: "fix the 35 TypeScript errors, delete ignoreBuildErrors, add lint/type-check to CI, rename the id] route folder." }]),
    bullet([{ t: "Step 3 - Config externalization: ", b: true }, { t: "single STORAGE_DIR / FONTS_DIR configuration, env-driven DATABASE_URL handling, move storage outside the project tree." }]),
    bullet([{ t: "Step 4 - Data strategy: ", b: true }, { t: "choose PostgreSQL (complete the migration for all 18 models against a real server) or hardened SQLite (WAL, busy_timeout, foreign_keys); schedule backups with monitoring; purge test data." }]),
    bullet([{ t: "Step 5 - Data integrity for engineering use: ", b: true }, { t: "verify the 80 ASME rows against the licensed standard; enable the verification workflow before issuing client reports." }]),
    bullet([{ t: "Step 6 - Reliability: ", b: true }, { t: "error boundaries, structured logging with rotation, health checks, Prisma query logging off in production." }]),
    bullet([{ t: "Step 7 - Deployment: ", b: true }, { t: "verify next build (standalone) end-to-end, run under a process manager behind TLS, document the environment, smoke-test uploads/PDFs on the target host." }]),
    bullet([{ t: "Step 8 - Acceptance: ", b: true }, { t: "create a minimal regression checklist from the worklog's acceptance tests and run it on the deployed instance before handover." }]),
    body("Bottom line: the application does what it was built to do, and it does it more completely than most prototypes - the reporting workflow, seven NDT report types, approval/revision immutability and PDF output are real and working. What stands between it and a company-ready system is disciplined operations: signed authentication, portable configuration, a real database strategy with backups, clean data, and a build without blind spots. Those are well-scoped, ordered tasks rather than a rewrite."),
  ];
}

module.exports = { section7, section8, section9, section10, section11, section12 };
