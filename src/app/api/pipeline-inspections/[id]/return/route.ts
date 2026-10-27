// POST /api/pipeline-inspections/[id]/return
// Admin action — return a Submitted-for-Review report for revision.
// Sets status from "Submitted for Review" → "Returned for Revision".
// MANDATORY: reviewComments must be provided (>= 10 chars).

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // PERMISSION: only admins can return reports for revision.
  if (session.dashboardRole !== "ADMIN") {
    return NextResponse.json(
      { error: "Forbidden — administrator role required to return reports" },
      { status: 403 },
    );
  }
  const { id } = await ctx.params;
  const existing = await db.pipelineInspection.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // STATUS CHECK: report must be in "Submitted for Review" or
  // "Changes Pending Review" state (admin can return either).
  const validStatuses = ["Submitted for Review", "Changes Pending Review"];
  if (!validStatuses.includes(existing.status)) {
    return NextResponse.json(
      {
        error:
          `Cannot return a report in "${existing.status}" state. ` +
          "Only Submitted for Review or Changes Pending Review reports can be returned for revision.",
      },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const reviewComments = (body.reviewComments ?? "").toString().trim();
  if (reviewComments.length < 10) {
    return NextResponse.json(
      { error: "Review comments are mandatory when returning a report for revision. Please provide at least 10 characters of feedback." },
      { status: 400 },
    );
  }

  const updated = await db.pipelineInspection.update({
    where: { id },
    data: {
      status: "Returned for Revision",
      reviewComments,
      returnedById: session.id,
      returnedAt: new Date(),
    },
  });

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "RETURN", entity: "PipelineInspection", entityId: updated.id,
    details: `Returned pipeline report ${updated.reportNumber} for revision: ${reviewComments.slice(0, 200)}`,
  });

  return NextResponse.json(updated);
}
