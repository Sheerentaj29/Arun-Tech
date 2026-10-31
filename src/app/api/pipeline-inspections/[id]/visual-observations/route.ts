// GET  /api/pipeline-inspections/[id]/visual-observations - list observations
// POST /api/pipeline-inspections/[id]/visual-observations - create new observation row
//
// These endpoints are used ONLY by reports where reportType = PIPELINE_VISUAL.
// For PIPELINE_THICKNESS reports, use /measurements; for PIPELINE_CONDITION,
// the data is stored directly on the PipelineInspection row (no child rows).

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const report = await db.pipelineInspection.findUnique({ where: { id } });
  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  const isAdmin = session.dashboardRole === "ADMIN";
  if (!isAdmin && report.inspectorId !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const items = await db.visualInspectionObservation.findMany({
    where: { pipelineInspectionId: id },
    orderBy: { sortOrder: "asc" },
  });
  return NextResponse.json({ items });
}

// Allowed dropdown values for several visual-inspection fields.
const PIPELINE_CONDITIONS = ["Good", "Fair", "Poor", "Critical", "N/A"];
const CORROSION_LEVELS = ["None", "Light", "Moderate", "Severe", "N/A"];
const LEAKAGE_OPTIONS = ["No", "Yes", "Suspected", "N/A"];
const SURFACE_CONDITIONS = ["Good", "Minor Rust", "Heavy Rust", "Pitted", "N/A"];

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const report = await db.pipelineInspection.findUnique({ where: { id } });
  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

  const isAdmin = session.dashboardRole === "ADMIN";
  if (!isAdmin) {
    if (report.inspectorId !== session.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const editableStatuses = ["Draft", "Returned for Revision", "Changes Pending Review"];
    if (!editableStatuses.includes(report.status)) {
      return NextResponse.json(
        { error: `Cannot add observations to a report in "${report.status}" state.` },
        { status: 403 },
      );
    }
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const maxSortOrder = await db.visualInspectionObservation.findFirst({
    where: { pipelineInspectionId: id },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const sortOrder = body.sortOrder !== undefined
    ? Number(body.sortOrder)
    : (maxSortOrder?.sortOrder ?? -1) + 1;

  const created = await db.visualInspectionObservation.create({
    data: {
      pipelineInspectionId: id,
      pointNo: body.pointNo?.trim() || `V-${sortOrder + 1}`,
      sortOrder,
      location: body.location?.trim() || null,
      pipelineCondition: body.pipelineCondition?.trim() || null,
      externalSurfaceCondition: body.externalSurfaceCondition?.trim() || null,
      coatingPaintCondition: body.coatingPaintCondition?.trim() || null,
      corrosionObserved: body.corrosionObserved?.trim() || null,
      leakageObserved: body.leakageObserved?.trim() || null,
      damageOrDeformation: body.damageOrDeformation?.trim() || null,
      supportsHangersCondition: body.supportsHangersCondition?.trim() || null,
      weldJointCondition: body.weldJointCondition?.trim() || null,
      insulationCondition: body.insulationCondition?.trim() || null,
      findings: body.findings?.trim() || null,
      recommendations: body.recommendations?.trim() || null,
      inspectorComments: body.inspectorComments?.trim() || null,
    },
  });

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "CREATE", entity: "VisualInspectionObservation", entityId: created.id,
    details: `Added visual observation ${created.pointNo} to report ${report.reportNumber}`,
  });

  return NextResponse.json(created, { status: 201 });
}
