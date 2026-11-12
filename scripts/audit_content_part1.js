// audit_content_part1.js — Executive Summary + Sections 1-6
const { h1, h2, h3, body, bullet, caption, table, spacer } = require("./audit_docx_helpers");

// ============ EXECUTIVE SUMMARY (front matter) ============
function execSummary() {
  return [
    h1("Executive Summary"),
    body([{ t: "Scope and objective. ", b: true },
      { t: "This report documents a factual, evidence-based technical audit of the Inspection Report Automation System referred to here as Arun-Tech (repository: Sheerentaj29/Arun-Tech). Every statement in this report was verified directly against the project source code, configuration files, Prisma schema, migration files, database contents, storage directories, and the running application. No files were modified during the audit." }]),
    body([{ t: "Overall verdict. ", b: true },
      { t: "The application is a feature-rich development-stage prototype with an unusually complete industrial reporting core. The report lifecycle (create, fill, submit, review, return, approve, revise, PDF export) is fully implemented and was verified working end-to-end, including PDF generation with client logos. However, the application is not production-ready: it runs on a SQLite file database, uses an unsigned session token, hardcodes absolute paths throughout, carries 35 suppressed TypeScript errors, contains substantial demo and test data, and has no functioning automated backup." }]),
    caption("Table A: Overall classification of major application areas"),
    table(
      ["Area", "Classification", "Evidence basis"],
      [
        ["Report lifecycle (7 NDT types)", "Implemented and working", "58 API routes; live end-to-end test (report detail, PDF 2 pages)"],
        ["PDF generation engine", "Implemented and working (with format gaps)", "3,012-line pdfkit engine; live PDF produced"],
        ["Authentication", "Implemented but incomplete (prototype-grade)", "Unsigned cookie/bearer session; bcrypt + legacy SHA-256"],
        ["Authorization", "Implemented and working (per-route)", "Role + ownership checks verified in code"],
        ["Database", "Implemented (SQLite); PostgreSQL migration partially built", "schema.prisma provider=sqlite; staging PGlite cluster committed"],
        ["File storage", "Implemented (local disk only)", "storage/ tree with 5 subdirectories; hardcoded paths"],
        ["Backups", "Implemented but not operating", "scripts/backup-sqlite.ts exists; newest backup 2026-10-27"],
        ["Production readiness", "Not production-ready", "Summary matrix in Section 10"],
      ],
      [30, 32, 38], { zebra: true }
    ),
    body([{ t: "Current status classification: Development (prototype approaching feature completeness). " , b: true },
      { t: "The gap to a production candidate is primarily operational (deployment, database, secrets, data cleanup) rather than functional. The twelve sections that follow provide the detailed evidence." }]),
  ];
}

// ============ SECTION 1: APPLICATION OVERVIEW ============
function section1() {
  return [
    h1("1. Application Overview"),
    h2("1.1 Identity and Technology Stack"),
    caption("Table 1.1: Core technology identification (from package.json, next.config.ts, prisma/schema.prisma)"),
    table(
      ["Aspect", "Value found in the project", "Source"],
      [
        ["Application name", "Package name nextjs_tailwind_shadcn_ts v0.2.1 (scaffold default, never renamed). UI branding: Inspection Report Automation System", "package.json; login screen; sidebar"],
        ["Framework", "Next.js 16.1.3 with App Router, Turbopack dev server, standalone output", "package.json; next.config.ts; dev.log"],
        ["Frontend", "React 19 single-page application (one page.tsx), Zustand state store with 17 view keys, Tailwind CSS 4, shadcn/ui (48 components in src/components/ui)", "src/app/page.tsx; src/lib/store.ts"],
        ["Backend", "Next.js API routes (Node runtime): 58 route files with about 90 HTTP method handlers", "src/app/api/**/route.ts"],
        ["ORM", "Prisma 6.11.1 (prisma-client-js generator)", "prisma/schema.prisma; package.json"],
        ["Database currently used", "SQLite file: db/custom.db (753 KB, 18 tables)", ".env; prisma/schema.prisma provider = sqlite"],
        ["Authentication", "Custom session: HTTP-only cookie ira_session_v2 holding the raw user id, plus Authorization: Bearer <userId> fallback; bcryptjs cost 12 with legacy SHA-256 upgrade path", "src/lib/auth.ts; src/lib/password.ts"],
        ["File/image storage", "Local filesystem under /home/z/my-project/storage/ (logos, photos, drawings, certificates, pdfs); metadata rows in SQLite", "storage/ tree; upload routes"],
        ["PDF generation", "pdfkit 0.20.2 server-side engine (3,012 lines) with Geist fonts; poppler pdftoppm used to rasterize uploaded PDF drawings and certificates", "src/lib/pdf/pipeline-report.ts"],
      ],
      [22, 48, 30], { zebra: true }
    ),
    h2("1.2 Main Purpose and Major Features"),
    body("The application automates non-destructive testing (NDT) inspection reporting for piping and static equipment, targeted at industrial clients such as Coromandel International Limited. The following feature set was verified in code and, where noted, in the running application."),
    bullet([{ t: "Equipment Master: ", b: true }, { t: "client/plant/equipment CRUD with a typed equipment catalog (8 categories), dimension rules per category, and CSV import/export with row-level validation (preview and commit routes)." }]),
    bullet([{ t: "Pipeline inspection reports: ", b: true }, { t: "seven report types (thickness, visual, condition, DPT, MPT, weld scan, UT) sharing one report header model, an approval workflow, revision snapshots, and a common PDF engine." }]),
    bullet([{ t: "Thickness measurement: ", b: true }, { t: "11-column measurement table (pipe size, schedule, nominal thickness from ASME B36.10M/B36.19M lookup, component type, point number, four clock positions, observed minimum, findings) with multi-table grouping and admin overrides." }]),
    bullet([{ t: "Approval workflow: ", b: true }, { t: "Draft, Submitted for Review, Returned for Revision, Approved, Changes Pending Review, with mandatory review comments on return and immutable approved revision snapshots (ReportRevision)." }]),
    bullet([{ t: "Engineering drawings: ", b: true }, { t: "upload (DWG/DXF/DWT/DWS/PDF/PNG/JPG/TIFF up to 50 MB), revisions, and linking drawings to reports (DrawingInspectionLink)." }]),
    bullet([{ t: "Inspection photos and certificates: ", b: true }, { t: "photo upload with primary-photo selection; equipment and personnel certificates; both embedded into generated PDFs." }]),
    bullet([{ t: "Client logos: ", b: true }, { t: "56 logo files under storage/logos/clients, resolved through an explicit name-to-file mapping (client-logo-mapping.ts) and served through an authenticated /api/client-logo/[slug] endpoint; Aruntech service logo on the left of every report header." }]),
    bullet([{ t: "Reference data: ", b: true }, { t: "80 ASME pipe standard rows (all flagged unverified) and 6 component types, admin-manageable with verification workflow." }]),
    bullet([{ t: "Dashboards and audit: ", b: true }, { t: "admin and employee dashboards; audit log (752 recorded events) covering logins, CRUD, approvals, overrides, exports and imports." }]),
  ];
}

// ============ SECTION 2: DATABASE ============
function section2() {
  return [
    h1("2. Database"),
    h2("2.1 Current Database Provider"),
    body([{ t: "Current provider: SQLite (file database). ", b: true },
      { t: "This is unambiguous in three independent places: the Prisma datasource declares provider = \"sqlite\" (prisma/schema.prisma, line 9); the environment file contains exactly one variable, DATABASE_URL=file:/home/z/my-project/db/custom.db (50-byte .env); and the live database file db/custom.db (753,664 bytes) contains all 18 application tables." }]),
    h2("2.2 Database Files and Locations"),
    caption("Table 2.1: Database-related files inspected"),
    table(
      ["File / directory", "Contents", "Tracked in git?"],
      [
        ["db/custom.db", "Live SQLite database, 753 KB, 18 tables, 4 users, 57 clients, 60 pipeline reports", "Yes (committed)"],
        ["db/custom.db.before_reportType.bak", "Pre-migration snapshot of an older schema state", "Yes"],
        ["db/backups/ (3 .bak files + 2 .sha256)", "Integrity-verified backups; newest dated 2026-10-27", "Yes"],
        ["db/staging-pg/", "PostgreSQL 18 data directory produced by PGlite (WASM Postgres), 32 MB, 1,043 files", "Yes (committed)"],
        ["prisma/migrations/0001_initial_schema.sql", "Full DDL in PostgreSQL dialect (CREATE SCHEMA \"public\")", "Yes"],
        ["prisma/migrations/0002_immutable_approved_revisions.sql", "Immutability triggers for approved revisions (PostgreSQL dialect)", "Yes"],
      ],
      [34, 46, 20], { zebra: true }
    ),
    h2("2.3 Models and Relationships"),
    body("The Prisma schema defines 18 models. PipelineInspection is the central entity with 146 fields covering all seven report types plus workflow state. Verified relationships:"),
    bullet("Client 1-n Plant 1-n Equipment 1-n Inspection (legacy equipment inspection module)."),
    bullet("PipelineInspection belongs to Client, Plant, and User (inspector, approver, returned-by) and has child tables ThicknessMeasurement, VisualInspectionObservation, DptObservation, ReportPhoto, DrawingInspectionLink, InspectionCertificate, ReportRevision."),
    bullet("EngineeringDrawing 1-n DrawingRevision; DrawingInspectionLink n-n joins drawings to pipeline reports."),
    bullet("Uniqueness constraints include [clientId, reportNumber] on PipelineInspection and [clientId, equipmentId] on Equipment."),
    h2("2.4 Migration Practice"),
    body([{ t: "The live SQLite database was never migrated with prisma migrate. ", b: true },
      { t: "Evidence: the database contains no _prisma_migrations bookkeeping table, and package.json provides db:push = prisma db push --accept-data-loss, which is the schema-sync mechanism actually used (the development worklog also states schema changes were pushed via db:push). The two SQL migration files exist in PostgreSQL dialect (a CREATE SCHEMA statement is not valid SQLite), indicating they were written for the PostgreSQL staging effort, not for the SQLite database. prisma migrate dev and prisma migrate reset scripts are defined but the migration history was never applied to the working database." }]),
    h2("2.5 Is This Suitable for Production?"),
    body("As currently configured, no. The database is a single SQLite file on the same host as the application, in default journal mode (delete, not WAL), inside the project directory, and committed to git together with its backups. SQLite itself can serve small single-server deployments, but this setup has no operational isolation, no backup automation currently running (newest backup is over two weeks old), and no migration history. Section 10 summarizes the readiness verdict."),
    h2("2.6 PostgreSQL Migration Check"),
    body([{ t: "Verdict: partially completed, staging only, then rolled back to SQLite. ", b: true },
      { t: "The migration infrastructure genuinely exists and was partially executed, but it was never adopted as the running database and its data-copy script is now outdated relative to the schema. Evidence:" }]),
    bullet([{ t: "Provisioning: ", b: true }, { t: "scripts/staging-provision-postgres.ts provisions a real PostgreSQL 18 instance in-process via PGlite (the @electric-sql/pglite dependency, described in the script as real Postgres in WASM), persisted to db/staging-pg, and applies both migration SQL files. The staging data directory exists on disk (32 MB) proving the script was run." }]),
    bullet([{ t: "Wire bridge: ", b: true }, { t: "mini-services/pglite-bridge/index.ts (331 lines) implements the PostgreSQL wire protocol, including the extended query protocol that Prisma requires, serving the staging database on port 5433. It is not currently running." }]),
    bullet([{ t: "Data copy: ", b: true }, { t: "scripts/migrate-sqlite-to-postgres.ts (319 lines) copies data with row counts and SHA-256 content verification, but its TABLES_IN_ORDER list contains only 11 tables. The schema has since grown to 18 models; EngineeringDrawing, DrawingRevision, DrawingInspectionLink, VisualInspectionObservation, InspectionCertificate, DptObservation and ReportPhoto are not covered, so the script can no longer produce a complete migration." }]),
    bullet([{ t: "Rollback documented: ", b: true }, { t: "docs/restore-procedure.md Scenario A is titled Restore SQLite from backup (rollback from Postgres migration) and instructs flipping schema.prisma back to provider = \"sqlite\", confirming the application was at least run against PostgreSQL staging and then reverted." }]),
    bullet([{ t: "Current state: ", b: true }, { t: ".env points to the SQLite file and the datasource provider is sqlite, so PostgreSQL is not in the active path. Helper scripts (backup-sqlite.ts, staging-provision-postgres.ts) still expect 11 tables, confirming they have not been maintained alongside schema growth." }]),
  ];
}

// ============ SECTION 3: DATA AND STORAGE ============
function section3() {
  return [
    h1("3. Data and Storage"),
    body("All uploaded and generated files are stored on the local filesystem in fixed absolute paths under /home/z/my-project/storage/. Database rows hold the metadata (path, MIME type, size, captions) while bytes live on disk. There is no cloud or object-storage integration anywhere in the codebase. The table below consolidates the per-type inspection results."),
    caption("Table 3.1: Storage inventory and assessment"),
    table(
      ["Asset", "Storage type", "Current location", "Database metadata", "Limits and checks", "Production suitable"],
      [
        ["Client logos (56 files, 5.3 MB)", "Local disk", "/home/z/my-project/storage/logos/clients (runtime copy; repo copy under Arun-Tech/storage/logos/clients)", "No rows; resolved via explicit name-to-file map in src/lib/client-logo-mapping.ts; Client.logoPath exists but is null for all 57 clients", "Served through authenticated /api/client-logo/[slug]; slug filter allows letters, digits, dots, spaces, dashes, ampersands and parentheses; no upload of client logos through this endpoint", "No (hardcoded path; mapping divergence between repo copy and runtime copy)"],
        ["Service company logo (Aruntech)", "Local disk", "storage/logos/service-company.png (2,130 x 2,189 px)", "None (fixed path scanned by extension)", "Admin-only upload via /api/settings/service-logo; 5 MB limit; PNG/JPEG/WEBP/GIF allow-list", "No (single fixed path; no CDN)"],
        ["Inspection photos (62 files, 38 MB)", "Local disk", "storage/photos/{reportNumber}_{timestamp}_{rand}.{ext}", "ReportPhoto rows (49) plus legacy JSON array on PipelineInspection.photos", "10 MB limit; JPEG/PNG/WEBP/GIF allow-list on declared MIME type", "No (uncompressed uploads; no image processing; single host)"],
        ["Engineering drawings (38 files, 1.4 MB)", "Local disk", "storage/drawings/{name}_{rand}.{ext}", "EngineeringDrawing (28) + DrawingRevision (29)", "50 MB limit; extension allow-list DWG/DXF/DWT/DWS/PDF/PNG/JPG/JPEG/TIFF/TIF", "No (DWG/DXF cannot be embedded in PDF; placeholder rendered)"],
        ["Certificates (18 files, 8.6 MB)", "Local disk", "storage/certificates/{report}-{kind}-{ts}.{ext}", "InspectionCertificate (18)", "50 MB limit; extension allow-list (PDF/PNG/JPG and similar)", "No (same single-host constraints)"],
        ["Generated PDFs (2 files)", "Local disk", "storage/pdfs/{reportNumber}_rev{n}_{timestamp}.pdf", "PipelineInspection.pdfPath; per-revision ReportRevision.pdfPath", "Written only at approval time; on-demand PDF downloads are streamed and not persisted", "Partially (persistence only happens on approval)"],
      ],
      [16, 10, 22, 20, 20, 12], { zebra: true }
    ),
    body([{ t: "Path handling. ", b: true },
      { t: "Storage directories are hardcoded string constants inside individual route files and the PDF library (for example PHOTO_STORAGE_DIR = \"/home/z/my-project/storage/photos\"). There is no centralized storage configuration, no volume indirection, and no environment override. Any deployment on a different host or user breaks every upload, download and PDF-related feature. The PDF engine additionally reads fonts from /home/z/my-project/node_modules/geist, tying runtime behavior to the exact node_modules layout." }]),
    body([{ t: "Verification performed. ", b: true },
      { t: "All 56 client logo files were requested through the live API with an authenticated session: 54 of the 54 mapped logos returned HTTP 200 with correct image types (PNG, JPEG, WEBP, AVIF, SVG). Two unmapped items exist on disk: Arun Tech.jpg (the service company itself) and Thirumalai Chemicals.png (a duplicate of Thirumalai Chemicals Ltd.png)." }]),
  ];
}

// ============ SECTION 4: AUTHENTICATION AND USER MANAGEMENT ============
function section4() {
  return [
    h1("4. Authentication and User Management"),
    h2("4.1 Mechanism"),
    body("Authentication is a custom implementation; no third-party auth library is used. The session library file states explicitly in its first line: Mock session helper for demo. In production, replace with NextAuth. Login (POST /api/auth) verifies the password, then sets an HTTP-only cookie named ira_session_v2 whose value is the raw user id (a cuid string, 20-30 characters). No signature, HMAC or JWT is involved: possession of a valid user id is sufficient to authenticate."),
    caption("Table 4.1: Session and password characteristics (all verified in src/lib/auth.ts, password.ts, api/auth/route.ts)"),
    table(
      ["Characteristic", "Actual implementation", "Assessment"],
      [
        ["Session token", "Raw user id (cuid) in cookie; same id accepted as Authorization: Bearer header fallback for browsers that block cookies; Bearer token persisted in browser localStorage", "Weak: unsigned token; localStorage copy outlives the 8-hour cookie"],
        ["Cookie flags", "httpOnly: true, sameSite: lax, path: /, maxAge: 8 hours; no secure flag", "Would be downgraded over plain HTTP; needs secure in production"],
        ["Session validation", "Every request re-looks-up the user by id; deleted or deactivated users are immediately unauthenticated; cuid shape validated before query", "Good design property"],
        ["Password hashing", "bcrypt cost 12 for new and updated passwords; legacy unsalted SHA-256 (64-char hex) still accepted and transparently re-hashed to bcrypt on next successful login", "Sound migration path; 2 of 4 users still on SHA-256"],
        ["Login rate limiting", "In-memory: 5 attempts per email per 5-minute window; resets on process restart; per-process only", "Adequate for demo; not multi-instance safe"],
        ["User management", "Admin-only /api/users; role allow-list; minimum password length 6; protection against demoting or deactivating the last active ADMIN", "Reasonable guards"],
      ],
      [20, 48, 32], { zebra: true }
    ),
    h2("4.2 Roles and Permissions"),
    body("Four roles exist in the schema: ADMIN, EMPLOYEE, INSPECTOR and APPROVER. Internally they collapse to two dashboard roles: APPROVER is treated as ADMIN (labeled legacy in code) and INSPECTOR as EMPLOYEE. Admin-only surfaces verified in code: Employees, Clients and Plants, Pipe Standards, CSV Import/Export, Audit Log views; user management endpoints; settings logo upload; report return and approve actions; report deletion; pipe standard and component type management. Employees can create and edit their own reports and submit them; ownership checks (session.id vs inspectorId) are enforced server-side on report update, submit and delete paths, with status-based editability rules (only Draft and Returned for Revision are editable, with a separate path that opens Approved reports into Changes Pending Review)."),
    h2("4.3 Authorization Coverage on API Routes"),
    body("An automated scan of all 58 route files shows 55 files call getSession/requireSession/requireAdmin. Three endpoints have no session check: the page route (/), /api/equipment/catalog (static catalog metadata) and /api/import-export/template (CSV template download). The first is the public page; the latter two expose only static reference data, but they are still unauthenticated information leaks worth closing. Role checks exist on 25 routes and audit logging on 44."),
    h2("4.4 Security Concerns Observed"),
    bullet("Unsigned session token: any party that obtains a user id (for example from logs, browser storage via XSS, or shared machines) can impersonate that user via cookie or Bearer header until the id is invalidated. There is no expiry on the Bearer path at all."),
    bullet("No secure cookie flag; no CSRF tokens (sameSite=lax mitigates the common cases)."),
    bullet("Demo credentials are printed on the login screen (admin@inspections.demo / admin123 and three more accounts), and the seed scripts contain the same passwords."),
    bullet("Rate limiting is in-memory and per-process; a restart clears it and multiple instances would each keep separate counters."),
    bullet("Passwords have a 6-character minimum with no complexity requirement; there is no 2FA, no password reset flow, and no session rotation on privilege change."),
    bullet("Two routes (plants/[id] DELETE and pipe-standards/[id] at line 77) declare the request parameter as _req but call getSession(req), so the Bearer fallback silently never applies on those endpoints; they still work with cookies. This is a latent bug masked by next.config.ts setting typescript.ignoreBuildErrors to true."),
  ];
}

// ============ SECTION 5: REPORT WORKFLOW ============
function section5() {
  return [
    h1("5. Report Workflow"),
    body("The full lifecycle requested for audit was traced through the API routes and the two main view components (pipeline-report-form-view.tsx, 5,899 lines; pipeline-report-detail-view.tsx, 1,521 lines). Each step below was verified in code, and the create-through-PDF path was additionally exercised live against the running application during this audit."),
    caption("Table 5.1: Workflow step implementation status"),
    table(
      ["Step", "Status", "Implementation evidence"],
      [
        ["Create report", "Fully implemented", "Type selector (5 types offered in UI); POST /api/pipeline-inspections creates Draft with unique [clientId, reportNumber] (409 on duplicate); header auto-fills the Coromandel/Ennore defaults"],
        ["Fill inspection details", "Fully implemented", "PUT /api/pipeline-inspections/[id] updates header fields with ownership + status gates; per-type field sets (DPT, MPT, UT, weld scan, condition) all present in schema and form"],
        ["Add tables/data", "Fully implemented (one routing caveat)", "Thickness rows: POST /api/.../measurements with ASME auto-lookup and 422 on unsupported combinations; multi-table grouping via thicknessTablesConfig; custom columns JSON. PUT/DELETE of individual rows works (verified live) despite the folder being misnamed id] (see Section 9). Visual and DPT observation rows have their own CRUD routes; weld scan and UT rows are JSON columns"],
        ["Upload drawings", "Fully implemented", "/api/drawings upload with 50 MB and extension allow-list; revisions; POST/DELETE /api/.../drawings links reports to drawings; $transaction used on link writes"],
        ["Add inspection photos", "Fully implemented", "POST /api/.../photos (multipart, 10 MB, MIME allow-list); ReportPhoto rows; primary photo endpoint with GET/POST/DELETE"],
        ["Add certificates", "Fully implemented", "POST/GET /api/.../certificates (50 MB); delete per certificate; embedded into the PDF as rasterized pages or fitted images"],
        ["Submit", "Fully implemented", "POST /api/.../submit: Draft or Returned for Revision -> Submitted for Review; owner or admin only"],
        ["Review", "Fully implemented", "Admin dashboards list submitted reports; detail view shows review actions; POST /api/.../return sets Returned for Revision and mandates review comments of at least 10 characters"],
        ["Approve", "Fully implemented", "POST /api/.../approve: ADMIN-only, wrapped in db.$transaction; generates the PDF once and persists it, marks prior approved revision Superseded, creates the new Approved ReportRevision with snapshotData, updates currentApprovedRevisionId"],
        ["Revision", "Fully implemented", "POST /api/.../revise: Approved -> Changes Pending Review under a new revision; the previously approved revision stays immutable and downloadable; revision history with per-revision status and PDF links"],
        ["Generate PDF", "Fully implemented", "GET /api/.../pdf?orientation=landscape|portrait streams on demand; per-revision PDF endpoint exists; approval persists to storage/pdfs"],
      ],
      [17, 16, 67], { zebra: true }
    ),
    h3("Workflow gaps worth knowing about"),
    bullet("No concurrent-edit protection: two users editing the same report follow last-save-wins (documented in the project worklog and consistent with the code)."),
    bullet("No notifications: submit/return/approve are not communicated by email or any channel; users must watch the dashboard queues."),
    bullet("PDF persistence is asymmetric: only approval writes a PDF artifact; on-demand downloads are never stored, so storage/pdfs holds just 2 files despite 60 reports."),
  ];
}

// ============ SECTION 6: INSPECTION TYPES ============
function section6() {
  return [
    h1("6. Inspection Types"),
    body("Seven report types are defined in the schema and PDF engine (REPORT_TYPE_TITLE map). The type-selector UI currently exposes five of them; Visual and Condition reports exist in the database and are fully supported by the backend and PDF engine, but no creation card is offered in the current selector, so those two can be considered implemented but not surfaced for new creation."),
    caption("Table 6.1: Report types and their data model (counts from live DB)"),
    table(
      ["Type", "Report-specific data storage", "Child rows in DB", "Form UI", "PDF engine support"],
      [
        ["PIPELINE_THICKNESS", "ThicknessMeasurement table: 11 system columns (size, schedule, nominal via ASME lookup, component type, point no, 4 clock positions with Measured/NotMeasured/NotApplicable, observed minimum, findings) + custom columns JSON + table groups", "45 rows", "Yes (editable grid with auto nominal lookup, UNSUPPORTED badge, admin override)", "Full (green header table, repeats across pages)"],
        ["PIPELINE_VISUAL", "VisualInspectionObservation rows + custom columns", "3 rows", "Present in form logic; no selector card", "Full"],
        ["PIPELINE_CONDITION", "Scalar fields on PipelineInspection (age, service fluid, operating condition, ratings, corrosion, damage, risk priority, recommendations, next-inspection advice)", "n/a (single-instance)", "Present in form logic; no selector card", "Full (dedicated condition section)"],
        ["PIPELINE_DPT", "DptObservation rows + 21 procedure/consumable fields (solvent, penetrant, developer, times, lighting, post-cleaning)", "16 rows", "Yes", "Full (procedure two-column block + observation table)"],
        ["PIPELINE_MPT", "Reuses DptObservation child table + 24 MPT-specific fields (yoke, current, contrast medium, calibration date, consumables) + custom columns", "shares 16 rows", "Yes", "Full"],
        ["PIPELINE_WELD_SCAN", "JSON row sets on the report: instrument rows, probe rows, test results (description, ID, weld type, probe, BP/SD, depth, echo, length, observation, result) + scanning fields", "JSON columns", "Yes", "Full"],
        ["PIPELINE_UT", "JSON row sets: equipment, probes, test results + 14 single-instance UT fields (couplant, procedure no, calibration block, flaw sizing, reference level)", "JSON columns", "Yes", "Full"],
      ],
      [15, 38, 11, 17, 19], { zebra: true }
    ),
    body([{ t: "Distribution in the live database: ", b: true },
      { t: "37 thickness, 10 weld scan, 7 DPT, 3 MPT, 2 visual, 1 condition reports (60 total, 1 flagged isDemo). This confirms all seven engines have been exercised at least once, though most of the corpus is functional test data (report numbers such as E2E-FULL-REVIEW, UT-BUGFIX-001, LAYOUT-FIX-001)." }]),
  ];
}

module.exports = { execSummary, section1, section2, section3, section4, section5, section6 };
