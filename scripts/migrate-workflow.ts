/**
 * Migration script — converts existing PipelineInspection.status values
 * from the old approval workflow to the new one.
 *
 * Old → New:
 *   "Submitted"  → "Submitted for Review"
 *   "Rejected"   → "Returned for Revision"
 *   "Superseded" → "Changes Pending Review"
 *   "Draft"      → "Draft" (unchanged)
 *   "Approved"   → "Approved" (unchanged)
 *
 * Also creates matching ReportRevision rows for any Approved reports
 * that don't yet have a revision snapshot, so the historical approved
 * version is preserved when the employee later edits the report.
 *
 * Run with: bun run scripts/migrate-workflow.ts
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  console.log("Migrating PipelineInspection statuses to new workflow values...");

  // 1. Update statuses
  const statusMap: Record<string, string> = {
    Submitted: "Submitted for Review",
    Rejected: "Returned for Revision",
    Superseded: "Changes Pending Review",
  };
  for (const [oldStatus, newStatus] of Object.entries(statusMap)) {
    const result = await db.pipelineInspection.updateMany({
      where: { status: oldStatus },
      data: { status: newStatus },
    });
    if (result.count > 0) {
      console.log(`  "${oldStatus}" → "${newStatus}": ${result.count} reports updated`);
    }
  }

  // 2. Create revision snapshots for Approved reports that have no revisions
  const approvedReports = await db.pipelineInspection.findMany({
    where: { status: "Approved" },
    include: { measurements: true, revisions: true, inspector: true, approver: true },
  });

  let revisionsCreated = 0;
  for (const report of approvedReports) {
    // Skip if there's already at least one revision
    if (report.revisions.length > 0) continue;

    await db.reportRevision.create({
      data: {
        pipelineInspectionId: report.id,
        revisionNumber: 1,
        status: "Approved",
        revisedById: report.inspectorId,
        revisedByName: report.inspectorName,
        changeDescription: "Initial approved revision (migrated from existing Approved state)",
        pdfPath: report.pdfPath,
        snapshotData: JSON.stringify({
          header: {
            reportNumber: report.reportNumber,
            inspectionArea: report.inspectionArea,
            pipelineDescription: report.pipelineDescription,
            pipelineIdentificationNumber: report.pipelineIdentificationNumber,
            isometricDrawingNumber: report.isometricDrawingNumber,
            materialOfConstruction: report.materialOfConstruction,
            applicableStandard: report.applicableStandard,
            standardEdition: report.standardEdition,
            findingsSummary: report.findingsSummary,
            comments: report.comments,
            photos: report.photos,
          },
          measurements: report.measurements.map((m) => ({
            pointNo: m.pointNo,
            pipeSizeInch: m.pipeSizeInch,
            pipeSchedule: m.pipeSchedule,
            nominalThicknessMm: m.nominalThicknessMm,
            componentTypeCode: m.componentTypeCode,
            northMm: m.northMm, northStatus: m.northStatus,
            eastMm: m.eastMm, eastStatus: m.eastStatus,
            southMm: m.southMm, southStatus: m.southStatus,
            westMm: m.westMm, westStatus: m.westStatus,
            observedMinimumMm: m.observedMinimumMm,
            findingsComments: m.findingsComments,
          })),
        }),
        approvedById: report.approvedById,
        approvedAt: report.approvedAt,
        approvedByName: report.approver?.name ?? null,
      },
    });
    // Point the report's currentApprovedRevisionId at this new revision
    const created = await db.reportRevision.findFirst({
      where: { pipelineInspectionId: report.id },
      orderBy: { revisionNumber: "asc" },
    });
    if (created) {
      await db.pipelineInspection.update({
        where: { id: report.id },
        data: { currentApprovedRevisionId: created.id },
      });
    }
    revisionsCreated++;
  }
  if (revisionsCreated > 0) {
    console.log(`  Created ${revisionsCreated} revision snapshots for previously-Approved reports`);
  }

  // 3. Migrate APPROVER users to ADMIN (so they retain approval powers in
  //    the new workflow where only ADMIN can approve). INSPECTOR users stay
  //    as INSPECTOR (treated as Employee for routing).
  const approversMigrated = await db.user.updateMany({
    where: { role: "APPROVER" },
    data: { role: "ADMIN" },
  });
  if (approversMigrated.count > 0) {
    console.log(`  Migrated ${approversMigrated.count} APPROVER user(s) → ADMIN`);
  }

  // 4. Add an EMPLOYEE demo account so users can test the new role
  const existingEmployee = await db.user.findUnique({ where: { email: "employee@inspections.demo" } });
  if (!existingEmployee) {
    const { createHash } = await import("crypto");
    await db.user.create({
      data: {
        email: "employee@inspections.demo",
        name: "Emp Emp",
        passwordHash: createHash("sha256").update("employee123").digest("hex"),
        role: "EMPLOYEE",
      },
    });
    console.log("  Created EMPLOYEE demo account: employee@inspections.demo / employee123");
  }

  // Summary
  const counts = {
    Draft: await db.pipelineInspection.count({ where: { status: "Draft" } }),
    "Submitted for Review": await db.pipelineInspection.count({ where: { status: "Submitted for Review" } }),
    "Returned for Revision": await db.pipelineInspection.count({ where: { status: "Returned for Revision" } }),
    Approved: await db.pipelineInspection.count({ where: { status: "Approved" } }),
    "Changes Pending Review": await db.pipelineInspection.count({ where: { status: "Changes Pending Review" } }),
  };
  console.log("Migration complete. Status distribution:");
  for (const [s, n] of Object.entries(counts)) {
    console.log(`  ${s}: ${n}`);
  }
  const users = await db.user.count();
  const revisions = await db.reportRevision.count();
  console.log(`Users: ${users}, ReportRevisions: ${revisions}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
