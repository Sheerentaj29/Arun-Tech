// GET /api/pipeline-inspections/[id]/photos/[photoId]/raw
// Serve the raw image file from disk (for <img> tags in the photo preview).

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { readFileSync, existsSync } from "fs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; photoId: string }> }) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, photoId } = await ctx.params;

  const report = await db.pipelineInspection.findUnique({ where: { id } });
  if (!report) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isAdmin = session.dashboardRole === "ADMIN";
  if (!isAdmin && report.inspectorId !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const photo = await db.reportPhoto.findUnique({ where: { id: photoId } });
  if (!photo || photo.pipelineInspectionId !== id) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  if (!photo.filePath || !existsSync(photo.filePath)) {
    return NextResponse.json({ error: "File not found on disk" }, { status: 404 });
  }

  const buf = readFileSync(photo.filePath);
  return new NextResponse(buf, {
    headers: {
      "Content-Type": photo.mimeType,
      "Content-Length": String(buf.length),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
