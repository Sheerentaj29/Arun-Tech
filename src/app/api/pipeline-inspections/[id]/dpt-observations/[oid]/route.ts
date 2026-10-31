// PUT    /api/pipeline-inspections/[id]/dpt-observations/[oid] - update DPT observation
// DELETE /api/pipeline-inspections/[id]/dpt-observations/[oid] - delete DPT observation + renumber

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
  if (!isAdmin && report.inspectorId !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const editableStatuses = ["Draft", "Returned for Revision", "Changes Pending Review"];
  if (!isAdmin && !editableStatuses.includes(report.status)) {
    return NextResponse.json({ error: `Cannot edit observations on a report in "${report.status}" state.` }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const updated = await db.dptObservation.update({
    where: { id: oid },
    data: {
      description: body.description !== undefined ? (body.description?.trim() || null) : undefined,
      weldType: body.weldType !== undefined ? (body.weldType?.trim() || null) : undefined,
      result: body.result !== undefined ? (body.result === "Reject" ? "Reject" : "Accept") : undefined,
      remarks: body.remarks !== undefined ? (body.remarks?.trim() || null) : undefined,
      sortOrder: body.sortOrder !== undefined ? Number(body.sortOrder) : undefined,
      customColumnValues: body.customColumnValues !== undefined ? body.customColumnValues : undefined,
    },
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
  if (!isAdmin && report.inspectorId !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const editableStatuses = ["Draft", "Returned for Revision", "Changes Pending Review"];
  if (!isAdmin && !editableStatuses.includes(report.status)) {
    return NextResponse.json({ error: `Cannot delete observations from a report in "${report.status}" state.` }, { status: 403 });
  }

  const obs = await db.dptObservation.findUnique({ where: { id: oid } });
  if (!obs || obs.pipelineInspectionId !== id) {
    return NextResponse.json({ error: "Observation not found" }, { status: 404 });
  }

  await db.dptObservation.delete({ where: { id: oid } });

  // Renumber remaining rows: reassign serialNo = 1, 2, 3... and sortOrder = 0, 1, 2...
  const remaining = await db.dptObservation.findMany({
    where: { pipelineInspectionId: id },
    orderBy: { sortOrder: "asc" },
  });
  for (let i = 0; i < remaining.length; i++) {
    await db.dptObservation.update({
      where: { id: remaining[i].id },
      data: { serialNo: i + 1, sortOrder: i },
    });
  }

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "DELETE", entity: "DptObservation", entityId: oid,
    details: `Deleted DPT observation from report ${report.reportNumber}, renumbered ${remaining.length} remaining rows`,
  });

  return NextResponse.json({ ok: true });
}
