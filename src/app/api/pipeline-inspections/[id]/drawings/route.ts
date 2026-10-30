// GET  /api/pipeline-inspections/[id]/drawings - list drawings linked to this report
// POST /api/pipeline-inspections/[id]/drawings - link a drawing to this report
//   Body: { drawingId: string }

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

  const links = await db.drawingInspectionLink.findMany({
    where: { pipelineInspectionId: id },
    include: {
      drawing: {
        include: {
          client: { select: { id: true, name: true } },
          plant: { select: { id: true, name: true } },
          revisions: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });

  return NextResponse.json({ items: links });
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

  const body = await req.json().catch(() => null);
  if (!body?.drawingId) {
    return NextResponse.json({ error: "drawingId is required" }, { status: 400 });
  }

  // Check drawing exists
  const drawing = await db.engineeringDrawing.findUnique({ where: { id: body.drawingId } });
  if (!drawing) return NextResponse.json({ error: "Drawing not found" }, { status: 404 });

  // Check for duplicate link
  const existing = await db.drawingInspectionLink.findUnique({
    where: { drawingId_pipelineInspectionId: { drawingId: body.drawingId, pipelineInspectionId: id } },
  });
  if (existing) {
    return NextResponse.json({ error: "Drawing already linked to this report" }, { status: 409 });
  }

  const link = await db.drawingInspectionLink.create({
    data: {
      drawingId: body.drawingId,
      pipelineInspectionId: id,
      attachedById: session.id,
      attachedByName: session.name,
    },
  });

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "CREATE", entity: "DrawingInspectionLink", entityId: link.id,
    details: `Linked drawing ${drawing.drawingNumber} to report ${report.reportNumber}`,
  });

  return NextResponse.json(link, { status: 201 });
}

// DELETE /api/pipeline-inspections/[id]/drawings - unlink a drawing
//   Body: { drawingId: string }
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const body = await req.json().catch(() => null);
  if (!body?.drawingId) {
    return NextResponse.json({ error: "drawingId is required" }, { status: 400 });
  }

  await db.drawingInspectionLink.deleteMany({
    where: { drawingId: body.drawingId, pipelineInspectionId: id },
  });

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "DELETE", entity: "DrawingInspectionLink",
    details: `Unlinked drawing from report`,
  });

  return NextResponse.json({ ok: true });
}
