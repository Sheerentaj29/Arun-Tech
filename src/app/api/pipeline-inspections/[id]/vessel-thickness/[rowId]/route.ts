// PUT    /api/pipeline-inspections/[id]/vessel-thickness/[rowId] - update one row
// DELETE /api/pipeline-inspections/[id]/vessel-thickness/[rowId] - delete one row

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

const EDITABLE_STATUSES = ["Draft", "Returned for Revision", "Changes Pending Review"];

async function loadEditableRow(req: NextRequest, rowId: string, write: boolean) {
  const session = await getSession(req);
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const row = await db.vesselThicknessRow.findUnique({
    where: { id: rowId },
    include: { pipelineInspection: { select: { id: true, inspectorId: true, status: true, reportNumber: true } } },
  });
  if (!row) return { error: NextResponse.json({ error: "Row not found" }, { status: 404 }) };
  const isAdmin = session.dashboardRole === "ADMIN";
  if (!isAdmin) {
    if (row.pipelineInspection.inspectorId !== session.id) {
      return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    }
    if (write && !EDITABLE_STATUSES.includes(row.pipelineInspection.status)) {
      return {
        error: NextResponse.json(
          { error: `Cannot modify a report in "${row.pipelineInspection.status}" state.` },
          { status: 403 },
        ),
      };
    }
  }
  return { session, row };
}

function numeric(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ rowId: string }> }) {
  const { rowId } = await ctx.params;
  const gate = await loadEditableRow(req, rowId, true);
  if (gate.error) return gate.error;
  const session = gate.session!;
  const row = gate.row!;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const updated = await db.vesselThicknessRow.update({
    where: { id: rowId },
    data: {
      component: body.component !== undefined ? (body.component?.trim() || null) : row.component,
      location: body.location !== undefined ? (body.location?.trim() || null) : row.location,
      gridPointNo: body.gridPointNo !== undefined ? (body.gridPointNo?.trim() || null) : row.gridPointNo,
      nominalThicknessMm: body.nominalThicknessMm !== undefined ? numeric(body.nominalThicknessMm) : row.nominalThicknessMm,
      measuredThicknessMm: body.measuredThicknessMm !== undefined ? numeric(body.measuredThicknessMm) : row.measuredThicknessMm,
      result: body.result !== undefined ? (body.result === "Reject" ? "Reject" : "Accept") : row.result,
      sortOrder: body.sortOrder !== undefined ? Number(body.sortOrder) : row.sortOrder,
      tableGroup: typeof body.tableGroup === "string" && body.tableGroup ? body.tableGroup : row.tableGroup,
    },
  });

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "UPDATE", entity: "VesselThicknessRow", entityId: updated.id,
    details: `Updated vessel thickness row in report ${row.pipelineInspection.reportNumber}`,
  });

  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ rowId: string }> }) {
  const { rowId } = await ctx.params;
  const gate = await loadEditableRow(req, rowId, true);
  if (gate.error) return gate.error;
  const session = gate.session!;
  const row = gate.row!;

  await db.vesselThicknessRow.delete({ where: { id: rowId } });

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "DELETE", entity: "VesselThicknessRow", entityId: rowId,
    details: `Deleted vessel thickness row from report ${row.pipelineInspection.reportNumber}`,
  });

  return NextResponse.json({ ok: true });
}
