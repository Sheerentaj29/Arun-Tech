#!/usr/bin/env python3
"""Phase 10 DB cleanup:
1. Delete child rows + the single isDemo PipelineInspection (fake demo report).
2. Verify zero demo Inspection records will remain (table dropped via prisma db push).
"""
import sqlite3

con = sqlite3.connect("/home/z/my-project/db/custom.db")
cur = con.cursor()

CHILD_TABLES = [
    "ThicknessMeasurement",
    "VisualInspectionObservation",
    "ReportRevision",
    "ReportPhoto",
    "DptObservation",
    "InspectionCertificate",
    "DrawingInspectionLink",
]

demo_rows = cur.execute(
    "SELECT id, reportNumber FROM PipelineInspection WHERE isDemo=1"
).fetchall()
print(f"Demo pipeline reports found: {len(demo_rows)}")
for rid, rno in demo_rows:
    for t in CHILD_TABLES:
        n = cur.execute(
            f"DELETE FROM {t} WHERE pipelineInspectionId=?", (rid,)
        ).rowcount
        if n:
            print(f"  {t}: deleted {n} child rows of {rno}")
    cur.execute("DELETE FROM PipelineInspection WHERE id=?", (rid,))
    print(f"  deleted demo report {rno}")

con.commit()

# Post-checks
n_demo_pipeline = cur.execute(
    "SELECT COUNT(*) FROM PipelineInspection WHERE isDemo=1"
).fetchone()[0]
print(f"Remaining isDemo pipeline reports: {n_demo_pipeline}")
try:
    n_insp = cur.execute("SELECT COUNT(*) FROM Inspection").fetchone()[0]
    print(f"Inspection rows (will be dropped by db push): {n_insp}")
except sqlite3.OperationalError as e:
    print(f"Inspection table: {e}")
con.close()
print("DB cleanup done.")
