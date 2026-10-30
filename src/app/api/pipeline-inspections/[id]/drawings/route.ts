// GET  /api/pipeline-inspections/[id]/drawings
//   List drawings linked to this report (with active revision metadata).
//
// POST /api/pipeline-inspections/[id]/drawings
//   Attach a drawing to this report. Two modes:
//     1. multipart/form-data — uploads a new drawing file (PNG/JPG/JPEG/WEBP/PDF)
//        and creates an EngineeringDrawing + DrawingRevision + DrawingInspectionLink
//        in one atomic operation. The drawing is auto-named from the file.
//     2. application/json with `{ drawingId }` — links an existing drawing
//        (from the standalone Drawings module) to this report.
//
// DELETE /api/pipeline-inspections/[id]/drawings
//   Body: { drawingId } — unlinks a drawing from this report (does NOT delete
//   the drawing itself, only the link).

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";

const DRAWING_STORAGE_DIR = "/home/z/my-project/storage/drawings";
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

// Formats supported as direct attachments inside the report form.
// DWG/DXF are intentionally NOT in this list — they can be uploaded via
// the standalone Drawings module (admins) but not from the report form,
// because they cannot be rendered as image pages in the PDF.
const ALLOWED_EXTENSIONS: Record<string, string> = {
  ".pdf":  "application/pdf",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function getFileExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  if (idx < 0) return "";
  return filename.slice(idx).toLowerCase();
}

function getMimeType(filename: string, fallback?: string): string {
  return ALLOWED_EXTENSIONS[getFileExtension(filename)] ?? fallback ?? "application/octet-stream";
}

function isImageExt(ext: string): boolean {
  return [".png", ".jpg", ".jpeg", ".webp"].includes(ext);
}

function inferDrawingType(ext: string): string {
  if (ext === ".pdf") return "Other";
  return "Other";
}

// Strip extension and clean a file name into a human-readable title.
function fileBaseName(filename: string): string {
  const ext = getFileExtension(filename);
  const base = filename.slice(0, filename.length - ext.length);
  return base.replace(/[_-]+/g, " ").trim() || "Untitled Drawing";
}

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
    orderBy: { createdAt: "asc" },
    include: {
      drawing: {
        include: {
          client: { select: { id: true, name: true } },
          plant: { select: { id: true, name: true } },
          revisions: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
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

  // Only allow attaching drawings when the report is in an editable state
  const editableStatuses = ["Draft", "Returned for Revision", "Changes Pending Review"];
  if (!isAdmin && !editableStatuses.includes(report.status)) {
    return NextResponse.json(
      { error: `Cannot attach drawings to a report in "${report.status}" state.` },
      { status: 403 },
    );
  }

  const contentType = req.headers.get("content-type") ?? "";

  // ─── MODE 1: multipart upload (new drawing file) ───
  if (contentType.includes("multipart/form-data") || contentType.startsWith("multipart/")) {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const ext = getFileExtension(file.name);
    if (!ALLOWED_EXTENSIONS[ext]) {
      return NextResponse.json(
        {
          error:
            `Unsupported file format: ${ext || "(none)"}. ` +
            `Allowed: PNG, JPG, JPEG, WEBP, PDF.`,
        },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large (${file.size} bytes). Maximum: 50 MB.` },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Build drawing metadata from the file name. The drawing title is
    // the cleaned-up base name; the drawing number is derived from the
    // report number + a short suffix to ensure uniqueness within the client.
    const title = fileBaseName(file.name);
    const drawingType = inferDrawingType(ext);

    // Generate a unique drawing number: <reportNumber>-DWG-<shortHash>
    const randomSuffix = createHash("sha256")
      .update(`${report.reportNumber}|${file.name}|${Date.now()}`)
      .digest("hex")
      .slice(0, 8);
    const drawingNumber = `${report.reportNumber}-DWG-${randomSuffix}`;

    // Persist file to disk
    mkdirSync(DRAWING_STORAGE_DIR, { recursive: true });
    const safeFileName = `${drawingNumber.replace(/[^a-zA-Z0-9-_]/g, "_")}${ext}`;
    const filePath = join(DRAWING_STORAGE_DIR, safeFileName);
    writeFileSync(filePath, buffer);

    const mimeType = getMimeType(file.name, file.type);

    // Create the drawing + revision + link in a single transaction
    const result = await db.$transaction(async (tx) => {
      // 1. Create the EngineeringDrawing record (owned by the report's client)
      const drawing = await tx.engineeringDrawing.create({
        data: {
          title,
          drawingNumber,
          drawingType,
          description: `Attached to report ${report.reportNumber}`,
          clientId: report.clientId,
          plantId: report.plantId,
        },
      });

      // 2. Create the active DrawingRevision
      const revision = await tx.drawingRevision.create({
        data: {
          drawingId: drawing.id,
          revisionNumber: "Rev 0",
          fileName: file.name,
          filePath,
          fileSize: file.size,
          mimeType,
          fileExtension: ext,
          previewPath: isImageExt(ext) ? filePath : null,
          uploadedById: session.id,
          uploadedByName: session.name,
          isActive: true,
        },
      });

      // 3. Set the active revision on the drawing
      await tx.engineeringDrawing.update({
        where: { id: drawing.id },
        data: { activeRevisionId: revision.id },
      });

      // 4. Link the drawing to the inspection report
      const link = await tx.drawingInspectionLink.create({
        data: {
          drawingId: drawing.id,
          drawingRevisionId: revision.id,
          pipelineInspectionId: id,
          attachedById: session.id,
          attachedByName: session.name,
        },
      });

      return { drawing, revision, link };
    });

    await recordAudit({
      userId: session.id, userName: session.name,
      action: "CREATE", entity: "EngineeringDrawing", entityId: result.drawing.id,
      details:
        `Attached drawing "${file.name}" to report ${report.reportNumber} ` +
        `(${file.size} bytes, ${ext})`,
    });

    return NextResponse.json(
      {
        id: result.drawing.id,
        linkId: result.link.id,
        title: result.drawing.title,
        drawingNumber: result.drawing.drawingNumber,
        drawingType: result.drawing.drawingType,
        revisionNumber: result.revision.revisionNumber,
        fileName: result.revision.fileName,
        filePath: result.revision.filePath,
        fileExtension: result.revision.fileExtension,
        mimeType: result.revision.mimeType,
        fileSize: result.revision.fileSize,
      },
      { status: 201 },
    );
  }

  // ─── MODE 2: JSON body linking an existing drawing ───
  const body = await req.json().catch(() => null);
  if (!body?.drawingId) {
    return NextResponse.json(
      { error: "drawingId is required (or upload a file via multipart/form-data)" },
      { status: 400 },
    );
  }

  const drawing = await db.engineeringDrawing.findUnique({ where: { id: body.drawingId } });
  if (!drawing) return NextResponse.json({ error: "Drawing not found" }, { status: 404 });

  const existing = await db.drawingInspectionLink.findUnique({
    where: {
      drawingId_pipelineInspectionId: { drawingId: body.drawingId, pipelineInspectionId: id },
    },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Drawing already linked to this report" },
      { status: 409 },
    );
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

// DELETE /api/pipeline-inspections/[id]/drawings
//   Body: { drawingId }  — unlink the drawing from this report.
//   If the drawing was created from the report form (i.e. its only link is
//   this one), the drawing + revision + file are also deleted. Otherwise
//   only the link is removed.
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const body = await req.json().catch(() => null);
  if (!body?.drawingId) {
    return NextResponse.json({ error: "drawingId is required" }, { status: 400 });
  }

  const drawingId: string = body.drawingId;
  const report = await db.pipelineInspection.findUnique({ where: { id } });
  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

  const isAdmin = session.dashboardRole === "ADMIN";
  if (!isAdmin && report.inspectorId !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Remove the link (always — even if other links exist)
  await db.drawingInspectionLink.deleteMany({
    where: { drawingId, pipelineInspectionId: id },
  });

  // If this drawing has no other links and is "demo-derived" (created from
  // the report form with a description starting "Attached to report"),
  // also delete the drawing + revision (cascade). This keeps the drawings
  // table clean of orphaned auto-created entries.
  const drawing = await db.engineeringDrawing.findUnique({
    where: { id: drawingId },
    include: { inspectionLinks: true, revisions: true },
  });
  if (
    drawing &&
    drawing.inspectionLinks.length === 0 &&
    drawing.description?.startsWith("Attached to report")
  ) {
    // Cascade-delete revisions + drawing (file on disk is left as orphan
    // — harmless but a future cleanup job could remove it)
    await db.engineeringDrawing.delete({ where: { id: drawingId } });
  }

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "DELETE", entity: "DrawingInspectionLink",
    details: `Unlinked drawing from report ${report.reportNumber}`,
  });

  return NextResponse.json({ ok: true });
}
