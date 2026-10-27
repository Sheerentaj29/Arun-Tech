// GET /api/pipeline-inspections/[id]/revisions/[rid]/pdf
//
// Download the persisted PDF of a SPECIFIC historical revision.
//
// Rules:
//   - Only Approved or Superseded revisions have persisted PDFs.
//   - Draft / Submitted / Returned / Changes-Pending revisions don't have
//     a persisted PDF (they haven't been approved yet).
//   - The PDF file is served from disk — NEVER re-generated. This ensures
//     that the exact bytes the admin approved are always returned, even
//     if the report header is later edited in a new revision.
//   - If the PDF file is missing from disk (e.g. migrated from an older
//     build where PDFs weren't persisted), return a 404 with a clear message.
//
// Permissions:
//   - Admin: can download any revision's PDF
//   - Employee: can only download PDFs of their own reports

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { readFileSync, existsSync } from "fs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; rid: string }> }) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id, rid } = await ctx.params;

  // Load the revision
  const revision = await db.reportRevision.findUnique({
    where: { id: rid },
    include: {
      pipelineInspection: {
        select: {
          id: true,
          reportNumber: true,
          inspectorId: true,
          inspectorName: true,
        },
      },
    },
  });
  if (!revision || revision.pipelineInspectionId !== id) {
    return NextResponse.json({ error: "Revision not found" }, { status: 404 });
  }

  // PERMISSION: employees can only download their own reports
  const isAdmin = session.dashboardRole === "ADMIN";
  if (!isAdmin && revision.pipelineInspection.inspectorId !== session.id) {
    return NextResponse.json(
      { error: "Forbidden — you can only download your own reports' PDFs" },
      { status: 403 },
    );
  }

  // Only Approved or Superseded revisions have persisted PDFs
  if (revision.status !== "Approved" && revision.status !== "Superseded") {
    return NextResponse.json(
      {
        error:
          `Revision ${revision.revisionNumber} is in "${revision.status}" state. ` +
          "Only Approved or Superseded revisions have persisted PDFs. " +
          "Submit the report for review and wait for admin approval.",
      },
      { status: 400 },
    );
  }

  // Check if the PDF file exists on disk
  if (!revision.pdfPath || !existsSync(revision.pdfPath)) {
    return NextResponse.json(
      {
        error:
          `The PDF file for revision ${revision.revisionNumber} was not found on disk. ` +
          "This may be because the report was approved before PDF persistence was implemented. " +
          "The revision's snapshotData is still available in the database.",
        revisionId: revision.id,
        revisionNumber: revision.revisionNumber,
        snapshotDataAvailable: !!revision.snapshotData,
      },
      { status: 404 },
    );
  }

  // Serve the persisted PDF from disk — NEVER re-generate
  const buf = readFileSync(revision.pdfPath);

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "EXPORT", entity: "ReportRevision", entityId: revision.id,
    details: `Downloaded historical PDF for ${revision.pipelineInspection.reportNumber} rev ${revision.revisionNumber} (${revision.status})`,
  });

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${revision.pipelineInspection.reportNumber}_rev${revision.revisionNumber}.pdf"`,
      "Content-Length": String(buf.length),
      "Cache-Control": "private, max-age=3600", // cache for 1 hour — the file never changes
    },
  });
}
