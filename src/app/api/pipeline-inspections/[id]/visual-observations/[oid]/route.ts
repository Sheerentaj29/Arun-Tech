// PUT    /api/pipeline-inspections/[id]/visual-observations/[oid] - update observation
// DELETE /api/pipeline-inspections/[id]/visual-observations/[oid] - delete observation

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string; oid: string }> }) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, oid } = await ctx.params;

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
        { error: `Cannot edit observations on a report in "${report.status}" state.` },
        { status: 403 },
      );
    }
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const updated = await db.visualInspectionObservation.update({
    where: { id: oid },
    data: {
      pointNo: body.pointNo !== undefined ? (body.pointNo?.trim() || null) : undefined,
      sortOrder: body.sortOrder !== undefined ? Number(body.sortOrder) : undefined,
      location: body.location !== undefined ? (body.location?.trim() || null) : undefined,
      pipelineCondition: body.pipelineCondition !== undefined ? (body.pipelineCondition?.trim() || null) : undefined,
      externalSurfaceCondition: body.externalSurfaceCondition !== undefined ? (body.externalSurfaceCondition?.trim() || null) : undefined,
      coatingPaintCondition: body.coatingPaintCondition !== undefined ? (body.coatingPaintCondition?.trim() || null) : undefined,
      corrosionObserved: body.corrosionObserved !== undefined ? (body.corrosionObserved?.trim() || null) : undefined,
      leakageObserved: body.leakageObserved !== undefined ? (body.leakageObserved?.trim() || null) : undefined,
      damageOrDeformation: body.damageOrDeformation !== undefined ? (body.damageOrDeformation?.trim() || null) : undefined,
      supportsHangersCondition: body.supportsHangersCondition !== undefined ? (body.supportsHangersCondition?.trim() || null) : undefined,
      weldJointCondition: body.weldJointCondition !== undefined ? (body.weldJointCondition?.trim() || null) : undefined,
      insulationCondition: body.insulationCondition !== undefined ? (body.insulationCondition?.trim() || null) : undefined,
      findings: body.findings !== undefined ? (body.findings?.trim() || null) : undefined,
      recommendations: body.recommendations !== undefined ? (body.recommendations?.trim() || null) : undefined,
      inspectorComments: body.inspectorComments !== undefined ? (body.inspectorComments?.trim() || null) : undefined,
    },
  });

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "UPDATE", entity: "VisualInspectionObservation", entityId: oid,
    details: `Updated visual observation ${updated.pointNo} on report ${report.reportNumber}`,
  });

  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string; oid: string }> }) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, oid } = await ctx.params;

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
        { error: `Cannot delete observations from a report in "${report.status}" state.` },
        { status: 403 },
      );
    }
  }

  const obs = await db.visualInspectionObservation.findUnique({ where: { id: oid } });
  if (!obs || obs.pipelineInspectionId !== id) {
    return NextResponse.json({ error: "Observation not found" }, { status: 404 });
  }

  await db.visualInspectionObservation.delete({ where: { id: oid } });

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "DELETE", entity: "VisualInspectionObservation", entityId: oid,
    details: `Deleted visual observation ${obs.pointNo} from report ${report.reportNumber}`,
  });

  return NextResponse.json({ ok: true });
}
