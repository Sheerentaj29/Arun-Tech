"""Read-only row counts of the inspection DB tables (persistence check)."""
import sqlite3

DB = "file:/home/z/my-project/db/custom.db?mode=ro"
TABLES = ("Client", "Plant", "User", "PipelineInspection",
          "ThicknessMeasurement", "ReportRevision", "AuditLog")

con = sqlite3.connect(DB, uri=True)
cur = con.cursor()
print("DB:", DB)
for t in TABLES:
    try:
        n = cur.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
        print(f"  {t}: {n} rows")
    except Exception as e:  # table may not exist in a fresh DB
        print(f"  {t}: ERR {e}")
con.close()
