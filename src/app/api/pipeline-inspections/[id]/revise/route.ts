// POST /api/pipeline-inspections/[id]/revise
// Employee action — start editing a previously-Approved report.
// Creates a NEW revision (does NOT overwrite the previously-approved data).
// Workflow:
//   - The previously-approved revision stays Approved (visible + downloadable)
//   - The report's status changes from "Approved" → "Changes Pending Review"
//   - The employee edits the report (measurements + header) as needed
//   - When they're done, they call /submit → status becomes "Submitted for Review"
//   - Admin approves → new revision becomes the current approved version
//
// The "revise" endpoint just kicks off the process. The actual editing happens
// via the normal PUT /api/pipeline-inspections/[id] and
// PUT /api/pipeline-inspections/[id]/measurements/[mid] routes — but only
// after this endpoint has flipped the status to "Changes Pending Review".

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const existing = await db.pipelineInspection.findUnique({
    where: { id },
    include: { revisions: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // PERMISSION: only the owner can revise their own report. Admins can
  // edit any report directly via PUT, but the revision flow is for
  // employees who own the report.
  const isAdmin = session.dashboardRole === "ADMIN";
  if (!isAdmin && existing.inspectorId !== session.id) {
    return NextResponse.json(
      { error: "Forbidden — you can only revise your own reports" },
      { status: 403 },
    );
  }

  // STATUS CHECK: report must be Approved. Can't revise a Draft or
  // already-pending report.
  if (existing.status !== "Approved") {
    return NextResponse.json(
      {
        error:
          `Cannot revise a report in "${existing.status}" state. ` +
          "Only Approved reports can be revised. " +
          "If the report is in Draft or Returned for Revision, edit it directly. " +
          "If it has been Submitted for Review, wait for the admin to approve or return it.",
      },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const changeDescription: string = (body.changeDescription ?? "").toString().trim();
  if (changeDescription.length < 5) {
    return NextResponse.json(
      { error: "Please provide a brief description (>= 5 chars) of what you're changing in this revision." },
      { status: 400 },
    );
  }

  // The previous approved revision stays Approved (so users can still
  // view/download it). The report's status flips to "Changes Pending Review"
  // to signal that a new revision is in progress.
  // currentApprovedRevisionId continues to point at the previous approved
  // revision (so the "currently-approved version" is still available while
  // the employee works on the new revision).
  const updated = await db.pipelineInspection.update({
    where: { id },
    data: {
      status: "Changes Pending Review",
      // Clear return-for-revision fields (this is a fresh revision process)
      reviewComments: null,
      returnedById: null,
      returnedAt: null,
      // Clear approval fields on the report header (the new revision is
      // not yet approved; the previously-approved revision is preserved
      // in ReportRevision).
      approvedById: null,
      approvedAt: null,
      approvalNotes: null,
    },
  });

  // Audit: record who started the revision and what they're changing
  await recordAudit({
    userId: session.id, userName: session.name,
    action: "REVISE", entity: "PipelineInspection", entityId: updated.id,
    details: `Started revision of approved report ${updated.reportNumber}: ${changeDescription.slice(0, 200)}`,
  });

  return NextResponse.json(updated);
}
