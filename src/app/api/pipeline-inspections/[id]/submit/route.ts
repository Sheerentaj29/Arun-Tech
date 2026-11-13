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
    include: { measurements: true, visualObservations: true, dptObservations: true },
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

  // Require at least one row of the appropriate type before submitting:
  //   • PIPELINE_THICKNESS → at least one measurement row
  //   • PIPELINE_VISUAL    → at least one visual observation row
  //   • PIPELINE_CONDITION → at least one condition-assessment field set
  //   • PIPELINE_DPT       → at least one DPT observation row
  const reportType = existing.reportType ?? "PIPELINE_THICKNESS";
  if (reportType === "PIPELINE_THICKNESS") {
    if (existing.measurements.length === 0) {
      return NextResponse.json(
        { error: "Cannot submit a thickness report with no measurement rows. Add at least one measurement first." },
        { status: 400 },
      );
    }
  } else if (reportType === "PIPELINE_VISUAL") {
    if (existing.visualObservations.length === 0) {
      return NextResponse.json(
        { error: "Cannot submit a visual inspection report with no observation rows. Add at least one observation first." },
        { status: 400 },
      );
    }
  } else if (reportType === "PIPELINE_DPT" || reportType === "VESSEL_DPT") {
    if (existing.dptObservations.length === 0) {
      return NextResponse.json(
        { error: "Cannot submit a DPT report with no observation rows. Add at least one observation first." },
        { status: 400 },
      );
    }
  } else if (reportType === "VESSEL_MPT") {
    // Vessel MPT testing-details rows live in the vmptRows JSON column.
    let vmptRowCount = 0;
    try {
      const parsed = JSON.parse(existing.vmptRows ?? "[]");
      if (Array.isArray(parsed)) vmptRowCount = parsed.length;
    } catch {}
    if (vmptRowCount === 0) {
      return NextResponse.json(
        { error: "Cannot submit a vessel MPT report with no testing-details rows. Add at least one row first." },
        { status: 400 },
      );
    }
  } else if (reportType === "VESSEL_WELD_SCAN") {
    // Vessel Weld Scan testing-details rows live in the vwsDetailRows JSON
    // column — same rule as Vessel MPT.
    let vwsRowCount = 0;
    try {
      const parsed = JSON.parse(existing.vwsDetailRows ?? "[]");
      if (Array.isArray(parsed)) vwsRowCount = parsed.length;
    } catch {}
    if (vwsRowCount === 0) {
      return NextResponse.json(
        { error: "Cannot submit a vessel weld scan report with no testing-details rows. Add at least one row first." },
        { status: 400 },
      );
    }
  } else if (reportType === "VESSEL_UTM") {
    // Vessel UT Thickness Measurement readings live in the vutmShellRows /
    // vutmDishRows / vutmNozzleRows JSON columns — require at least ONE
    // measurement row across the three tables before submitting.
    const countRows = (raw: string | null): number => {
      try {
        const parsed = JSON.parse(raw ?? "[]");
        return Array.isArray(parsed) ? parsed.length : 0;
      } catch {
        return 0;
      }
    };
    const utmRowCount =
      countRows(existing.vutmShellRows) +
      countRows(existing.vutmDishRows) +
      countRows(existing.vutmNozzleRows);
    if (utmRowCount === 0) {
      return NextResponse.json(
        { error: "Cannot submit a vessel UT thickness measurement report with no measurement rows. Add at least one shell, dish end or nozzle reading first." },
        { status: 400 },
      );
    }
  } else if (reportType === "PIPELINE_CONDITION") {
    // Condition reports don't have child rows — require at least one of the
    // main free-text fields to be filled in.
    const hasAnyContent = [
      existing.corrosionCondition,
      existing.damageAssessment,
      existing.currentInspectionFindings,
      existing.recommendations,
      existing.nextInspectionRecommendation,
    ].some((v) => v && v.trim().length > 0);
    if (!hasAnyContent) {
      return NextResponse.json(
        { error: "Cannot submit a condition assessment report with no findings. Fill in at least one of: corrosion condition, damage assessment, current inspection findings, recommendations, or next inspection recommendation." },
        { status: 400 },
      );
    }
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
