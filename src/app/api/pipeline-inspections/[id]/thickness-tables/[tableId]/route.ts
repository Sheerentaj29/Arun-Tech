// DELETE /api/pipeline-inspections/[id]/thickness-tables/[tableId]
//
// Deletes an entire additional Thickness Pipeline table:
//   - Hard-deletes every ThicknessMeasurement row whose `tableGroup`
//     matches `tableId`.
//   - The "default" table CANNOT be deleted through this endpoint —
//     it is the always-present primary table. Attempting to delete it
//     returns 400.
//   - Caller is expected to also remove the matching entry from
//     PipelineInspection.thicknessTablesConfig via a separate PUT to
//     /api/pipeline-inspections/[id]. This endpoint only removes the
//     rows; the config JSON is the caller's responsibility so that the
//     UI can update both atomically from its own state.
//
// Authentication: valid session required. Same permission rules as the
// per-row DELETE — employees can only delete rows on their own reports
// in an editable state (Draft / Returned for Revision / Changes Pending
// Review). Admins bypass.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; tableId: string }> },
) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id, tableId } = await ctx.params;

  // The "default" table is the always-present primary table and cannot
  // be deleted through this endpoint. Use the per-row DELETE route to
  // empty it row-by-row if needed.
  if (tableId === "default") {
    return NextResponse.json(
      {
        error:
          "The primary Thickness Pipeline Table (id='default') cannot be deleted. " +
          "Only additional tables added via '+ Add Another Thickness Table' can be removed.",
      },
      { status: 400 },
    );
  }

  const report = await db.pipelineInspection.findUnique({ where: { id } });
  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

  // PERMISSION: same gate as per-row DELETE.
  const isAdmin = session.dashboardRole === "ADMIN";
  if (!isAdmin) {
    if (report.inspectorId !== session.id) {
      return NextResponse.json(
        { error: "Forbidden — you can only edit your own reports" },
        { status: 403 },
      );
    }
    const editableStatuses = ["Draft", "Returned for Revision", "Changes Pending Review"];
    if (!editableStatuses.includes(report.status)) {
      return NextResponse.json(
        {
          error:
            `Cannot delete a thickness table on a report in "${report.status}" state. ` +
            "Only Draft, Returned for Revision, or Changes Pending Review reports can be edited.",
        },
        { status: 403 },
      );
    }
  }

  // Count rows in this tableGroup before deletion (for audit + response).
  const rowCount = await db.thicknessMeasurement.count({
    where: { pipelineInspectionId: id, tableGroup: tableId },
  });

  if (rowCount === 0) {
    // Nothing to delete — still return ok so the caller can proceed to
    // remove the entry from thicknessTablesConfig.
    return NextResponse.json({ ok: true, deletedCount: 0 });
  }

  // Hard-delete every row in this tableGroup.
  const result = await db.thicknessMeasurement.deleteMany({
    where: { pipelineInspectionId: id, tableGroup: tableId },
  });

  await recordAudit({
    userId: session.id,
    userName: session.name,
    action: "DELETE",
    entity: "ThicknessMeasurement",
    entityId: `${id}/${tableId}`,
    details: `Deleted thickness table '${tableId}' from report ${report.reportNumber} — ${result.count} row(s) removed.`,
  });

  return NextResponse.json({ ok: true, deletedCount: result.count });
}
