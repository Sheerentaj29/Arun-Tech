// GET /api/drawings/[id]/revisions/[rid]/download - download a SPECIFIC revision's file

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { readFileSync, existsSync } from "fs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; rid: string }> }) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, rid } = await ctx.params;

  const drawing = await db.engineeringDrawing.findUnique({
    where: { id },
    select: { id: true, drawingNumber: true, title: true },
  });
  if (!drawing) return NextResponse.json({ error: "Drawing not found" }, { status: 404 });

  const revision = await db.drawingRevision.findUnique({ where: { id: rid } });
  if (!revision || revision.drawingId !== id) {
    return NextResponse.json({ error: "Revision not found" }, { status: 404 });
  }

  if (!revision.filePath || !existsSync(revision.filePath)) {
    return NextResponse.json(
      { error: `File not found on disk: "${revision.fileName}" may have been moved or deleted.` },
      { status: 404 },
    );
  }

  const buf = readFileSync(revision.filePath);

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "EXPORT", entity: "DrawingRevision", entityId: revision.id,
    details: `Downloaded historical revision ${revision.revisionNumber} of drawing ${drawing.drawingNumber} (${revision.fileName}, ${revision.fileSize}B)`,
  });

  const safeFilename = revision.fileName.replace(/[^\w.-]/g, "_");

  return new NextResponse(buf, {
    headers: {
      "Content-Type": revision.mimeType,
      "Content-Disposition": `attachment; filename="${safeFilename}"`,
      "Content-Length": String(buf.length),
      "Cache-Control": "private, no-cache",
    },
  });
}
