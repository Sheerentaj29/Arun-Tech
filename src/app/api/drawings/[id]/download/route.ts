// GET /api/drawings/[id]/download - download the ACTIVE revision's file
// Streams the original uploaded file without modification.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { readFileSync, existsSync, createReadStream } from "fs";
import { stat } from "fs/promises";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const drawing = await db.engineeringDrawing.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true } },
      revisions: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!drawing) return NextResponse.json({ error: "Drawing not found" }, { status: 404 });

  // Find the active revision
  const activeRev = drawing.revisions.find((r) => r.isActive) ?? drawing.revisions[0];
  if (!activeRev) {
    return NextResponse.json({ error: "No revisions available for this drawing" }, { status: 404 });
  }

  // Verify file exists on disk
  if (!activeRev.filePath || !existsSync(activeRev.filePath)) {
    return NextResponse.json(
      { error: `File not found on disk. The file "${activeRev.fileName}" may have been moved or deleted.` },
      { status: 404 },
    );
  }

  // Get file stats for Content-Length
  const fileStat = await stat(activeRev.filePath);

  // Read the file (for smaller files; streaming would be better for very large files)
  const buf = readFileSync(activeRev.filePath);

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "EXPORT", entity: "DrawingRevision", entityId: activeRev.id,
    details: `Downloaded drawing ${drawing.drawingNumber} rev ${activeRev.revisionNumber} (${activeRev.fileName}, ${activeRev.fileSize}B)`,
  });

  // Build a safe filename for the Content-Disposition header
  const safeFilename = activeRev.fileName.replace(/[^\w.-]/g, "_");

  return new NextResponse(buf, {
    headers: {
      "Content-Type": activeRev.mimeType,
      "Content-Disposition": `attachment; filename="${safeFilename}"`,
      "Content-Length": String(buf.length),
      "Cache-Control": "private, no-cache",
    },
  });
}
