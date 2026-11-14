// GET    /api/pipeline-inspections/[id]/vessel-thickness           - list rows
// POST   /api/pipeline-inspections/[id]/vessel-thickness           - create row
// DELETE /api/pipeline-inspections/[id]/vessel-thickness?tableGroup=<id>
//                                                                  - delete all rows in a table
//
// Vessel thickness measurement rows (equipmentType = VESSEL). Rows are
// grouped into named tables via `tableGroup` — the table list itself is
// stored on the parent report's thicknessTablesConfig JSON, shared with
// the piping multi-table machinery.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

const EDITABLE_STATUSES = ["Draft", "Returned for Revision", "Changes Pending Review"];

async function loadEditableReport(req: NextRequest, id: string, write: boolean) {
  const session = await getSession(req);
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const report = await db.pipelineInspection.findUnique({ where: { id } });
  if (!report) return { error: NextResponse.json({ error: "Report not found" }, { status: 404 }) };
  const isAdmin = session.dashboardRole === "ADMIN";
  if (!isAdmin) {
    if (report.inspectorId !== session.id) {
      return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    }
    if (write && !EDITABLE_STATUSES.includes(report.status)) {
      return {
        error: NextResponse.json(
          { error: `Cannot modify a report in "${report.status}" state.` },
          { status: 403 },
        ),
      };
    }
  }
  return { session, report };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const gate = await loadEditableReport(req, id, false);
  if (gate.error) return gate.error;
  const rows = await db.vesselThicknessRow.findMany({
    where: { pipelineInspectionId: id },
    orderBy: [{ tableGroup: "asc" }, { sortOrder: "asc" }],
  });
  return NextResponse.json({ items: rows });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const gate = await loadEditableReport(req, id, true);
  if (gate.error) return gate.error;
  const session = gate.session!;
  const report = gate.report!;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const maxSort = await db.vesselThicknessRow.findFirst({
    where: { pipelineInspectionId: id, tableGroup: body.tableGroup || "default" },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const sortOrder = body.sortOrder !== undefined ? Number(body.sortOrder) : (maxSort?.sortOrder ?? -1) + 1;

  const created = await db.vesselThicknessRow.create({
    data: {
      pipelineInspectionId: id,
      tableGroup: typeof body.tableGroup === "string" && body.tableGroup ? body.tableGroup : "default",
      sortOrder,
      component: body.component?.trim() || null,
      location: body.location?.trim() || null,
      gridPointNo: body.gridPointNo?.trim() || null,
      nominalThicknessMm: body.nominalThicknessMm !== undefined && body.nominalThicknessMm !== null && body.nominalThicknessMm !== ""
        ? Number(body.nominalThicknessMm)
        : null,
      measuredThicknessMm: body.measuredThicknessMm !== undefined && body.measuredThicknessMm !== null && body.measuredThicknessMm !== ""
        ? Number(body.measuredThicknessMm)
        : null,
      result: body.result === "Reject" ? "Reject" : "Accept",
    },
  });

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "CREATE", entity: "VesselThicknessRow", entityId: created.id,
    details: `Added vessel thickness row to report ${report.reportNumber}`,
  });

  return NextResponse.json(created, { status: 201 });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const gate = await loadEditableReport(req, id, true);
  if (gate.error) return gate.error;
  const session = gate.session!;
  const report = gate.report!;

  // Delete all rows in a table group (used by "delete whole table").
  const tableGroup = new URL(req.url).searchParams.get("tableGroup");
  if (!tableGroup) {
    return NextResponse.json({ error: "tableGroup query parameter is required" }, { status: 400 });
  }
  const deleted = await db.vesselThicknessRow.deleteMany({
    where: { pipelineInspectionId: id, tableGroup },
  });

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "DELETE", entity: "VesselThicknessRow", entityId: id,
    details: `Deleted ${deleted.count} vessel thickness row(s) (table ${tableGroup}) from report ${report.reportNumber}`,
  });

  return NextResponse.json({ ok: true, count: deleted.count });
}
