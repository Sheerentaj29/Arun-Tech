// GET    /api/drawings/[id] - get drawing details with all revisions
// DELETE /api/drawings/[id] - delete drawing (admin only)

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { unlinkSync, existsSync } from "fs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const drawing = await db.engineeringDrawing.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true } },
      plant: { select: { id: true, name: true, location: true } },
      revisions: { orderBy: { createdAt: "desc" } },
      inspectionLinks: {
        include: {
          pipelineInspection: { select: { id: true, reportNumber: true, status: true } },
        },
      },
      _count: { select: { inspectionLinks: true } },
    },
  });

  if (!drawing) return NextResponse.json({ error: "Drawing not found" }, { status: 404 });
  return NextResponse.json(drawing);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.dashboardRole !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden — administrator role required" }, { status: 403 });
  }
  const { id } = await ctx.params;

  const drawing = await db.engineeringDrawing.findUnique({
    where: { id },
    include: { revisions: true },
  });
  if (!drawing) return NextResponse.json({ error: "Drawing not found" }, { status: 404 });

  // Delete all revision files from disk
  for (const rev of drawing.revisions) {
    if (rev.filePath && existsSync(rev.filePath)) {
      try { unlinkSync(rev.filePath); } catch {}
    }
    if (rev.previewPath && rev.previewPath !== rev.filePath && existsSync(rev.previewPath)) {
      try { unlinkSync(rev.previewPath); } catch {}
    }
  }

  // Delete from DB (cascades to revisions + inspection links)
  await db.engineeringDrawing.delete({ where: { id } });

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "DELETE", entity: "EngineeringDrawing", entityId: id,
    details: `Deleted drawing ${drawing.drawingNumber} (${drawing.title}) with ${drawing.revisions.length} revision(s)`,
  });

  return NextResponse.json({ ok: true });
}
