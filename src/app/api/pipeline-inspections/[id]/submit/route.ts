// POST /api/pipeline-inspections/[id]/submit
// Employee action — submit a Draft or Returned-for-Revision report for admin review.
// Sets status from "Draft" or "Returned for Revision" → "Submitted for Review".

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
    include: { measurements: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // PERMISSION: only the owner can submit their own report.
  const isAdmin = session.dashboardRole === "ADMIN";
  if (!isAdmin && existing.inspectorId !== session.id) {
    return NextResponse.json(
      { error: "Forbidden — you can only submit your own reports" },
      { status: 403 },
    );
  }

  // STATUS CHECK: report must be in Draft or Returned for Revision.
  const validStatuses = ["Draft", "Returned for Revision"];
  if (!validStatuses.includes(existing.status)) {
    return NextResponse.json(
      {
        error:
          `Cannot submit a report in "${existing.status}" state. ` +
          "Only Draft or Returned for Revision reports can be submitted.",
      },
      { status: 400 },
    );
  }

  // Require at least one measurement row before submitting
  if (existing.measurements.length === 0) {
    return NextResponse.json(
      { error: "Cannot submit a report with no measurement rows. Add at least one measurement first." },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const submissionNotes: string | null = body.submissionNotes?.trim() || null;

  const updated = await db.pipelineInspection.update({
    where: { id },
    data: {
      status: "Submitted for Review",
      // Clear any prior return-for-revision fields (a fresh submit)
      reviewComments: null,
      returnedById: null,
      returnedAt: null,
    },
  });

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "SUBMIT", entity: "PipelineInspection", entityId: updated.id,
    details: `Submitted pipeline report ${updated.reportNumber} for admin review${submissionNotes ? `: ${submissionNotes}` : ""}`,
  });

  return NextResponse.json(updated);
}
