# How to reopen the Inspection Report Automation System

This project is a **persistent project on disk** — it does not live inside the chat.
Every file, the database and all git history survive between chat sessions.

## What is saved (and where)

| What | Where |
|---|---|
| Application code | `/home/z/my-project/src/` (Next.js 16 + TypeScript) |
| Database (all records) | `/home/z/my-project/db/custom.db` (SQLite, 61 clients / 84 plants / 249 reports) |
| Uploaded files, PDFs, photos | `/home/z/my-project/storage/` |
| Full version history | git repo in `/home/z/my-project` (latest: `bb03e73`) |
| Startup scripts | `/home/z/my-project/.zscripts/dev.sh` + `watchdog.sh` |

## How the preview stays available

1. **At every platform boot** the startup script `/start.sh` restores the
   project from its saved snapshot and automatically runs
   `.zscripts/dev.sh` — measured this boot: server answering **~17 s after
   container start**, no chat needed.
2. **While the machine is running**, `.zscripts/watchdog.sh` checks the app
   every 15 seconds and relaunches the server if the process ever dies.
   Tested: server killed → watchdog revived it in ~5 s → HTTP 200.
3. **Manual restart** (never loses code or data — the DB is never touched):
   ```bash
   cd /home/z/my-project && bash .zscripts/dev.sh
   ```
   It is idempotent: safe to run any time; completes in ~5 s if the app is
   already running.

## Opening the app after a chat has ended

- **New session, same project:** open the project in Z.ai — the boot sequence
  starts the app automatically; the preview panel shows it once booted.
- **If the preview ever shows the Z.ai placeholder:** the machine is up but
  the app process is not (e.g. it was stopped seconds before you looked).
  Send any short message like *"start app"* — one command brings it back in
  ~5 seconds, with every record intact.
- **From inside the sandbox** (terminal): `bash /home/z/my-project/.zscripts/dev.sh`
  then open `http://localhost:3000` (external preview goes through the
  platform proxy on port 81, which forwards to the app).

## Verified before delivery

- Cold start via `dev.sh`: healthy in **4.7 s** (deps already on disk).
- Second run: detected healthy server, started nothing new (1 server tree).
- Kill test: server force-killed → watchdog revived it automatically →
  HTTP 200 → browser shows "Inspection Report Automation System /
  Admin Dashboard".
- Data integrity: row counts of Client / Plant / User / PipelineInspection /
  ThicknessMeasurement / ReportRevision / AuditLog **identical before and
  after every restart** (61 / 84 / 4 / 249 / 48 / 7 / 1491).
- Preview proxy path (Caddy :81 → app :3000): HTTP 200.
