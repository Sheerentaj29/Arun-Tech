# Restore Procedure — Industrial Inspection Report Automation System

## When to use this document
- After a database corruption event
- After an accidental data deletion
- When rolling back from PostgreSQL to SQLite
- When migrating to a new server

## Prerequisites
- Access to the backup files in `/home/z/my-project/db/backups/`
- The `sqlite3` CLI (or `psql` for Postgres)
- The `bun` runtime

---

## Scenario A: Restore SQLite from backup (rollback from Postgres migration)

### Step 1: Stop the application
```bash
pkill -f "next dev"
pkill -f "next-server"
```

### Step 2: Locate the most recent SQLite backup
```bash
ls -t /home/z/my-project/db/backups/custom.db.*.bak | head -3
```

### Step 3: Verify the backup's integrity
```bash
sqlite3 /home/z/my-project/db/backups/latest.bak "PRAGMA integrity_check;"
sqlite3 /home/z/my-project/db/backups/latest.bak "PRAGMA foreign_key_check;"
# Should return "ok" and 0 rows respectively
```

### Step 4: Replace the working DB file
```bash
mv /home/z/my-project/db/custom.db /home/z/my-project/db/custom.db.pre-restore.$(date -u +%Y%m%dT%H%M%SZ)
cp /home/z/my-project/db/backups/latest.bak /home/z/my-project/db/custom.db
sqlite3 /home/z/my-project/db/custom.db "PRAGMA integrity_check;"
```

### Step 5: Restore the application code
```bash
cd /home/z/my-project
sed -i 's|provider = "postgresql"|provider = "sqlite"|' prisma/schema.prisma
echo 'DATABASE_URL=file:/home/z/my-project/db/custom.db' > .env
bunx prisma generate
```

### Step 6: Restart
```bash
bun run dev
```

### Step 7: Verify
- Login as admin@inspections.demo / admin123
- Navigate to Pipeline Reports
- Verify all reports are visible
- Download a PDF
- Check the Audit Log

---

## Scenario B: Restore PostgreSQL from pg_dump backup

### Step 1: Stop the application
### Step 2: Locate the most recent pg_dump backup
### Step 3: Drop and recreate the database
```bash
psql -U postgres -c "DROP DATABASE IF EXISTS inspection_reports;"
psql -U postgres -c "CREATE DATABASE inspection_reports;"
```
### Step 4: Restore from dump
```bash
psql -U postgres -d inspection_reports < /home/z/my-project/db/backups/pg-LATEST.sql
```
### Step 5: Re-apply immutability triggers
```bash
psql -U postgres -d inspection_reports -f prisma/migrations/0002_immutable_approved_revisions.sql
```
### Step 6: Restore file storage (PDFs + photos)
```bash
STORAGE_BACKUP=$(ls -t /home/z/my-project/db/backups/storage-*.tar.gz | head -1)
tar xzf "$STORAGE_BACKUP" -C /home/z/my-project/storage/
```
### Step 7: Restart and verify

---

## Scenario C: Point-in-time recovery of a single deleted report

1. Copy the backup: `cp /home/z/my-project/db/backups/latest.bak /tmp/recovery.db`
2. Query the specific row: `sqlite3 /tmp/recovery.db "SELECT * FROM PipelineInspection WHERE reportNumber = '...';"`
3. Export related rows (ThicknessMeasurement, ReportRevision)
4. Insert into live DB via API or Prisma script (never raw SQL on live DB)
5. Clean up: `rm /tmp/recovery.db`

---

## Backup Schedule

| Frequency | What | Where | Retention |
|---|---|---|---|
| Daily 02:00 UTC | `bun run scripts/backup-sqlite.ts` | Local `/db/backups/` | 30 days |
| Weekly Sun 03:00 | rsync to off-host | S3 / NFS | 12 weeks |
| Monthly 1st 04:00 | Copy to cold storage | Glacier / tape | 7 years |

### Cron entries
```cron
0 2 * * * cd /home/z/my-project && bun run scripts/backup-sqlite.ts >> db/backups/cron.log 2>&1
0 3 * * 0 rsync -az /home/z/my-project/db/backups/ backup@storage:/backups/inspection/
0 4 1 * * aws s3 cp /home/z/my-project/db/backups/latest.bak s3://inspection-archive/$(date +\%Y-\%m).bak
```
