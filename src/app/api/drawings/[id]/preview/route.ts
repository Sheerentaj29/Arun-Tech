// GET /api/drawings/[id]/preview - serve a preview of the drawing
// For image formats: serve the file directly (browser can render it)
// For PDF drawings: rasterize the FIRST page to PNG via pdftoppm so the
//   Review/preview UI can show a real visual preview of the drawing
//   (the same technique the PDF report engine uses to embed PDF drawings).
// For DWG/DXF: return JSON with "preview not supported" + file details

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  readFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
} from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { tmpdir } from "os";
import { join } from "path";
import { rmSync } from "fs";

const execFileAsync = promisify(execFile);

// Extension → MIME map used as the source of truth for serving. The
// mimeType stored on the revision may be generic ("application/octet-
// stream") for rows created before strict mime mapping existed.
const EXT_MIME: Record<string, string> = {
  ".pdf":  "application/pdf",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif":  "image/gif",
  ".svg":  "image/svg+xml",
  ".tiff": "image/tiff",
  ".tif":  "image/tiff",
};

/**
 * Rasterize the FIRST page of a PDF file to a PNG buffer using the
 * system `pdftoppm` (poppler-utils) binary — the same tool the PDF
 * report engine uses for embedding PDF drawings. Returns null when
 * rasterization fails so the caller can fall back gracefully.
 */
async function rasterizeFirstPage(pdfPath: string): Promise<Buffer | null> {
  if (!existsSync(pdfPath)) return null;
  const tmpDir = mkdtempSync(join(tmpdir(), "dwg-preview-"));
  const outPrefix = join(tmpDir, "page");
  try {
    // -png : output PNG
    // -r 150 : same DPI the report engine uses (print-quality preview)
    // -f 1 -l 1 : first page only
    await execFileAsync(
      "pdftoppm",
      ["-png", "-r", "150", "-f", "1", "-l", "1", pdfPath, outPrefix],
      { timeout: 60_000, maxBuffer: 20 * 1024 * 1024 },
    );
    const files = readdirSync(tmpDir).filter(
      (f) => f.startsWith("page") && f.endsWith(".png"),
    );
    if (files.length === 0) return null;
    return readFileSync(join(tmpDir, files[0]));
  } catch (err) {
    console.error(
      `[drawings/preview] rasterizeFirstPage failed for ${pdfPath}:`,
      (err as Error).message,
    );
    return null;
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

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
  const isImageExt = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"].includes(ext);
  const isPdf = ext === ".pdf";
  const isPreviewable = isImageExt || isPdf;

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

  if (!activeRev.filePath || !existsSync(activeRev.filePath)) {
    return NextResponse.json({ error: "File not found on disk" }, { status: 404 });
  }

  // ─── PDF drawings: rasterize the first page to PNG ───
  // The report form and the report Review page embed drawings as images.
  // A raw PDF can't be rendered inside <img>, so we convert page 1 to a
  // print-quality PNG (150 DPI) and serve that. The original PDF stays
  // downloadable via /api/drawings/[id]/download.
  if (isPdf) {
    const png = await rasterizeFirstPage(activeRev.filePath);
    if (png) {
      return new NextResponse(new Uint8Array(png), {
        headers: {
          "Content-Type": "image/png",
          "Content-Disposition": `inline; filename="${activeRev.fileName.replace(/[^\w.-]/g, "_")}-page1.png"`,
          "Content-Length": String(png.length),
          "Cache-Control": "private, max-age=3600",
          "X-Pdf-Preview": "rasterized-page-1",
        },
      });
    }
    // Rasterization failed (poppler missing / corrupt PDF) — fall back to
    // serving the original PDF bytes inline so the browser can still try.
  }

  const buf = readFileSync(activeRev.filePath);
  const contentType = EXT_MIME[ext] ?? activeRev.mimeType ?? "application/octet-stream";

  // For PDFs, use inline disposition so the browser can render them
  // For images, use inline too (browser displays them)
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${activeRev.fileName.replace(/[^\w.-]/g, "_")}"`,
      "Content-Length": String(buf.length),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
