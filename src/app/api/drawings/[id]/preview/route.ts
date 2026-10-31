// GET /api/drawings/[id]/preview - serve a preview of the drawing
// For image/PDF formats: serve the file directly (browser can render it)
// For DWG/DXF: return JSON with "preview not supported" + file details

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { readFileSync, existsSync } from "fs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const drawing = await db.engineeringDrawing.findUnique({
    where: { id },
    include: { revisions: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!drawing) return NextResponse.json({ error: "Drawing not found" }, { status: 404 });

  const activeRev = drawing.revisions[0];
  if (!activeRev) return NextResponse.json({ error: "No revisions available" }, { status: 404 });

  // Check if the format is previewable
  const ext = activeRev.fileExtension.toLowerCase();
  const isPreviewable = [".pdf", ".png", ".jpg", ".jpeg", ".tiff", ".tif"].includes(ext);

  if (!isPreviewable) {
    // DWG, DXF, DWT, DWS — cannot be previewed in the browser
    return NextResponse.json({
      previewable: false,
      format: ext,
      message: `Preview is not available for ${ext} files. Please download the original file to view it in a CAD application.`,
      fileName: activeRev.fileName,
      fileSize: activeRev.fileSize,
      downloadUrl: `/api/drawings/${id}/download`,
    });
  }

  // For previewable formats, serve the file directly
  if (!activeRev.filePath || !existsSync(activeRev.filePath)) {
    return NextResponse.json({ error: "File not found on disk" }, { status: 404 });
  }

  const buf = readFileSync(activeRev.filePath);

  // For PDFs, use inline disposition so the browser can render them
  // For images, use inline too (browser displays them)
  return new NextResponse(buf, {
    headers: {
      "Content-Type": activeRev.mimeType,
      "Content-Disposition": `inline; filename="${activeRev.fileName.replace(/[^\w.-]/g, "_")}"`,
      "Content-Length": String(buf.length),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
