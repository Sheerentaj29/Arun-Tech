// DELETE /api/pipeline-inspections/[id]/photos/[photoId]
// Delete a photo (file from disk + DB record).

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { unlinkSync, existsSync } from "fs";

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string; photoId: string }> }) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, photoId } = await ctx.params;

  const report = await db.pipelineInspection.findUnique({ where: { id } });
  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

  // Permission: only the owner or admin can delete
  const isAdmin = session.dashboardRole === "ADMIN";
  if (!isAdmin && report.inspectorId !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const photo = await db.reportPhoto.findUnique({ where: { id: photoId } });
  if (!photo || photo.pipelineInspectionId !== id) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  // Delete the file from disk
  if (existsSync(photo.filePath)) {
    try {
      unlinkSync(photo.filePath);
    } catch (e) {
      console.warn(`Failed to delete photo file ${photo.filePath}:`, e);
    }
  }

  // Delete the DB record
  await db.reportPhoto.delete({ where: { id: photoId } });

  await recordAudit({
    userId: session.id,
    userName: session.name,
    action: "DELETE",
    entity: "ReportPhoto",
    entityId: photoId,
    details: `Deleted photo "${photo.fileName}" from ${report.reportNumber}`,
  });

  return NextResponse.json({ ok: true });
}

// PUT /api/pipeline-inspections/[id]/photos/[photoId]
// Update photo caption or sort order.

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string; photoId: string }> }) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, photoId } = await ctx.params;

  const report = await db.pipelineInspection.findUnique({ where: { id } });
  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

  const isAdmin = session.dashboardRole === "ADMIN";
  if (!isAdmin && report.inspectorId !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const photo = await db.reportPhoto.findUnique({ where: { id: photoId } });
  if (!photo || photo.pipelineInspectionId !== id) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const updated = await db.reportPhoto.update({
    where: { id: photoId },
    data: {
      caption: body.caption !== undefined ? body.caption : photo.caption,
      sortOrder: body.sortOrder !== undefined ? Number(body.sortOrder) : photo.sortOrder,
    },
  });

  return NextResponse.json(updated);
}
