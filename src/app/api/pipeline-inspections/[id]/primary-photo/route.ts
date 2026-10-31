// GET /api/pipeline-inspections/[id]/primary-photo - serve the primary inspection photo
// DELETE /api/pipeline-inspections/[id]/primary-photo - clear the primaryPhotoPath pointer
//   (does NOT delete the underlying file — it may still be referenced by its
//   ReportPhoto row in the photo gallery).

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { readFileSync, existsSync } from "fs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const report = await db.pipelineInspection.findUnique({
    where: { id },
    select: { primaryPhotoPath: true, inspectorId: true },
  });
  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

  const isAdmin = session.dashboardRole === "ADMIN";
  if (!isAdmin && report.inspectorId !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!report.primaryPhotoPath || !existsSync(report.primaryPhotoPath)) {
    return NextResponse.json({ error: "No primary photo" }, { status: 404 });
  }

  const buf = readFileSync(report.primaryPhotoPath);
  const ext = report.primaryPhotoPath.split(".").pop()?.toLowerCase() || "png";
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;

  return new NextResponse(buf, {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `inline; filename="primary-photo.${ext}"`,
      "Content-Length": String(buf.length),
      "Cache-Control": "private, max-age=3600",
    },
  });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const report = await db.pipelineInspection.findUnique({
    where: { id },
    select: { primaryPhotoPath: true, inspectorId: true, status: true, reportNumber: true },
  });
  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

  const isAdmin = session.dashboardRole === "ADMIN";
  if (!isAdmin && report.inspectorId !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const editableStatuses = ["Draft", "Returned for Revision", "Changes Pending Review"];
  if (!isAdmin && !editableStatuses.includes(report.status)) {
    return NextResponse.json(
      { error: `Cannot remove the primary photo from a report in "${report.status}" state.` },
      { status: 403 },
    );
  }

  await db.pipelineInspection.update({
    where: { id },
    data: { primaryPhotoPath: null },
  });

  await recordAudit({
    userId: session.id,
    userName: session.name,
    action: "UPDATE",
    entity: "PipelineInspection",
    entityId: id,
    details: `Cleared primary inspection photo for ${report.reportNumber}`,
  });

  return NextResponse.json({ ok: true });
}
