// POST /api/pipeline-inspections/[id]/approve
// Admin action — approve a Submitted-for-Review (or Changes Pending Review) report.
// Workflow:
//   - Snapshot the current report header + measurements into a new ReportRevision
//   - Mark the new revision as Approved
//   - Mark any previously-approved revision as Superseded
//   - Update the report's status to Approved, currentApprovedRevisionId → new revision
//   - Copy approver info onto the report (approvedById, approvedAt, approvalNotes)

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // PERMISSION: only admins can approve reports.
  if (session.dashboardRole !== "ADMIN") {
    return NextResponse.json(
      { error: "Forbidden — administrator role required to approve reports" },
      { status: 403 },
    );
  }
  const { id } = await ctx.params;
  const existing = await db.pipelineInspection.findUnique({
    where: { id },
    include: { measurements: true, revisions: true, inspector: true, approver: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // STATUS CHECK: report must be in "Submitted for Review" or "Changes Pending Review" state.
  const validStatuses = ["Submitted for Review", "Changes Pending Review"];
  if (!validStatuses.includes(existing.status)) {
    return NextResponse.json(
      {
        error:
          `Cannot approve a report in "${existing.status}" state. ` +
          "Only Submitted for Review or Changes Pending Review reports can be approved.",
      },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const approvalNotes: string | null = body.approvalNotes?.trim() || null;

  // Mark any previously-approved revision as Superseded (so the new
  // approval replaces it as the current version). The old revision's
  // snapshot is still preserved for historical retrieval.
  const previouslyApprovedRevisions = existing.revisions.filter(
    (r) => r.status === "Approved",
  );
  if (previouslyApprovedRevisions.length > 0) {
    await db.reportRevision.updateMany({
      where: { id: { in: previouslyApprovedRevisions.map((r) => r.id) } },
      data: { status: "Superseded" },
    });
  }

  // Create a new ReportRevision snapshot representing THIS approval.
  const nextRevisionNumber =
    Math.max(0, ...existing.revisions.map((r) => r.revisionNumber)) + 1;
  const newRevision = await db.reportRevision.create({
    data: {
      pipelineInspectionId: id,
      revisionNumber: nextRevisionNumber,
      status: "Approved",
      revisedById: existing.inspectorId,
      revisedByName: existing.inspectorName,
      changeDescription: body.approvalNotes ?? `Approved revision ${nextRevisionNumber}`,
      pdfPath: existing.pdfPath,
      snapshotData: JSON.stringify({
        header: {
          reportNumber: existing.reportNumber,
          inspectionArea: existing.inspectionArea,
          pipelineDescription: existing.pipelineDescription,
          pipelineIdentificationNumber: existing.pipelineIdentificationNumber,
          isometricDrawingNumber: existing.isometricDrawingNumber,
          materialOfConstruction: existing.materialOfConstruction,
          applicableStandard: existing.applicableStandard,
          standardEdition: existing.standardEdition,
          findingsSummary: existing.findingsSummary,
          comments: existing.comments,
          photos: existing.photos,
        },
        measurements: existing.measurements.map((m) => ({
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
      reviewComments: null,
      approvedById: session.id,
      approvedAt: new Date(),
      approvedByName: session.name,
    },
  });

  // Update the report: status → Approved, point at the new revision
  const updated = await db.pipelineInspection.update({
    where: { id },
    data: {
      status: "Approved",
      revisionNumber: nextRevisionNumber,
      currentApprovedRevisionId: newRevision.id,
      approvedById: session.id,
      approvedAt: new Date(),
      approvalNotes,
      // Clear return-for-revision fields (the report has been approved now)
      reviewComments: null,
      returnedById: null,
      returnedAt: null,
      inspectorName: existing.inspectorName,
    },
  });

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "APPROVE", entity: "PipelineInspection", entityId: updated.id,
    details: `Approved pipeline report ${updated.reportNumber} (revision ${nextRevisionNumber})`,
  });

  return NextResponse.json(updated);
}
