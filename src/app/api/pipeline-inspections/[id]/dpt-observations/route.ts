// GET  /api/pipeline-inspections/[id]/dpt-observations - list DPT observations
// POST /api/pipeline-inspections/[id]/dpt-observations - create a new DPT observation row

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
  const items = await db.dptObservation.findMany({
    where: { pipelineInspectionId: id },
    orderBy: { sortOrder: "asc" },
  });
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const report = await db.pipelineInspection.findUnique({ where: { id } });
  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  const isAdmin = session.dashboardRole === "ADMIN";
  if (!isAdmin && report.inspectorId !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const editableStatuses = ["Draft", "Returned for Revision", "Changes Pending Review"];
  if (!isAdmin && !editableStatuses.includes(report.status)) {
    return NextResponse.json({ error: `Cannot add observations to a report in "${report.status}" state.` }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  // Get the next sortOrder and serialNo
  const maxSort = await db.dptObservation.findFirst({
    where: { pipelineInspectionId: id },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true, serialNo: true },
  });
  const nextSort = (maxSort?.sortOrder ?? -1) + 1;
  const nextSerial = (maxSort?.serialNo ?? 0) + 1;

  const created = await db.dptObservation.create({
    data: {
      pipelineInspectionId: id,
      serialNo: nextSerial,
      sortOrder: nextSort,
      description: body.description?.trim() || null,
      weldType: body.weldType?.trim() || null,
      result: body.result === "Reject" ? "Reject" : "Accept",
      remarks: body.remarks?.trim() || null,
      customColumnValues: body.customColumnValues ?? "{}",
    },
  });

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "CREATE", entity: "DptObservation", entityId: created.id,
    details: `Added DPT observation #${created.serialNo} to report ${report.reportNumber}`,
  });

  return NextResponse.json(created, { status: 201 });
}
