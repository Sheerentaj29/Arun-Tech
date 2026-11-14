// GET  /api/drawings - list drawings with filters
// POST /api/drawings - upload a new drawing (multipart form data)

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";

const DRAWING_STORAGE_DIR = "/home/z/my-project/storage/drawings";
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

const ALLOWED_EXTENSIONS: Record<string, string> = {
  ".dwg":  "application/acad",
  ".dxf":  "application/dxf",
  ".dwt":  "application/autocad-template",
  ".dws":  "application/autocad-standard",
  ".pdf":  "application/pdf",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".tiff": "image/tiff",
  ".tif":  "image/tiff",
};

const DRAWING_TYPES = [
  "Plant Layout",
  "Piping and Instrumentation Diagram (P&ID)",
  "Isometric Drawing",
  "Pipeline Layout",
  "Equipment General Arrangement Drawing",
  "Mechanical Drawing",
  "Structural Drawing",
  "Electrical Drawing",
  "Instrumentation Drawing",
  "Other",
];

function getFileExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  if (idx < 0) return "";
  return filename.slice(idx).toLowerCase();
}

function getMimeType(filename: string, fallback?: string): string {
  return ALLOWED_EXTENSIONS[getFileExtension(filename)] ?? fallback ?? "application/octet-stream";
}

function isPreviewableFormat(ext: string): boolean {
  return [".pdf", ".png", ".jpg", ".jpeg", ".tiff", ".tif"].includes(ext);
}

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const clientId = url.searchParams.get("clientId") ?? undefined;
  const plantId = url.searchParams.get("plantId") ?? undefined;
  const drawingType = url.searchParams.get("drawingType") ?? undefined;

  const where: Record<string, unknown> = {};
  if (q) {
    where.OR = [
      { title: { contains: q } },
      { drawingNumber: { contains: q } },
      { description: { contains: q } },
    ];
  }
  if (clientId) where.clientId = clientId;
  if (plantId) where.plantId = plantId;
  if (drawingType) where.drawingType = drawingType;

  const items = await db.engineeringDrawing.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: {
      client: { select: { id: true, name: true } },
      plant: { select: { id: true, name: true, location: true } },
      revisions: { orderBy: { createdAt: "desc" }, take: 1 },
      _count: { select: { revisions: true, inspectionLinks: true } },
    },
  });

  return NextResponse.json({ items, drawingTypes: DRAWING_TYPES });
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const title = (formData.get("title") as string) ?? "";
  const drawingNumber = (formData.get("drawingNumber") as string) ?? "";
  const drawingType = (formData.get("drawingType") as string) ?? "";
  const clientId = (formData.get("clientId") as string) ?? "";
  const plantId = (formData.get("plantId") as string) || null;
  const revisionNumber = (formData.get("revisionNumber") as string) || "Rev 0";
  const description = (formData.get("description") as string) || null;
  const notes = (formData.get("notes") as string) || null;

  // Validate required fields
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (!title?.trim()) return NextResponse.json({ error: "Drawing title is required" }, { status: 400 });
  if (!drawingNumber?.trim()) return NextResponse.json({ error: "Drawing number is required" }, { status: 400 });
  if (!drawingType) return NextResponse.json({ error: "Drawing type is required" }, { status: 400 });
  if (!clientId) return NextResponse.json({ error: "Client is required" }, { status: 400 });

  // Validate file extension
  const ext = getFileExtension(file.name);
  if (!ALLOWED_EXTENSIONS[ext]) {
    return NextResponse.json(
      { error: `Unsupported file format: ${ext}. Allowed: ${Object.keys(ALLOWED_EXTENSIONS).join(", ")}` },
      { status: 400 },
    );
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `File too large: ${file.size} bytes. Maximum: ${MAX_FILE_SIZE} bytes (50 MB).` },
      { status: 400 },
    );
  }

  // Read file buffer
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Verify client exists
  const client = await db.client.findUnique({ where: { id: clientId } });
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 400 });

  // Generate safe storage filename
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -1) + "Z";
  const randomSuffix = createHash("sha256").update(timestamp + file.name).digest("hex").slice(0, 8);
  const safeFileName = `${drawingNumber.trim().replace(/[^a-zA-Z0-9-_]/g, "_")}_${randomSuffix}${ext}`;
  const filePath = join(DRAWING_STORAGE_DIR, safeFileName);

  mkdirSync(DRAWING_STORAGE_DIR, { recursive: true });
  writeFileSync(filePath, buffer);

  const mimeType = getMimeType(file.name, file.type);
  const isPreviewable = isPreviewableFormat(ext);

  // Check for existing drawing with same number within client
  const existing = await db.engineeringDrawing.findUnique({
    where: { clientId_drawingNumber: { clientId, drawingNumber: drawingNumber.trim() } },
    include: { revisions: true },
  });

  if (existing) {
    // ── NEW REVISION of existing drawing ──
    const newRevision = await db.drawingRevision.create({
      data: {
        drawingId: existing.id,
        revisionNumber,
        fileName: file.name,
        filePath,
        fileSize: file.size,
        mimeType,
        fileExtension: ext,
        previewPath: isPreviewable ? filePath : null,
        uploadedById: session.id,
        uploadedByName: session.name,
        notes,
        isActive: true,
      },
    });

    // Deactivate previous active revision
    await db.drawingRevision.updateMany({
      where: { drawingId: existing.id, id: { not: newRevision.id }, isActive: true },
      data: { isActive: false },
    });

    // Update drawing metadata
    const drawing = await db.engineeringDrawing.update({
      where: { id: existing.id },
      data: {
        title: title.trim(),
        drawingType,
        plantId,
        description,
        activeRevisionId: newRevision.id,
      },
      include: {
        client: { select: { id: true, name: true } },
        plant: { select: { id: true, name: true, location: true } },
        revisions: { orderBy: { createdAt: "desc" } },
      },
    });

    await recordAudit({
      userId: session.id, userName: session.name,
      action: "CREATE", entity: "DrawingRevision", entityId: newRevision.id,
      details: `Uploaded new revision ${revisionNumber} for drawing ${drawingNumber} (${file.name}, ${file.size}B)`,
    });

    return NextResponse.json(drawing, { status: 201 });
  }

  // ── NEW DRAWING (create drawing first, then revision) ──
  const drawing = await db.engineeringDrawing.create({
    data: {
      title: title.trim(),
      drawingNumber: drawingNumber.trim(),
      drawingType,
      description,
      clientId,
      plantId,
    },
  });

  const revision = await db.drawingRevision.create({
    data: {
      drawingId: drawing.id,
      revisionNumber,
      fileName: file.name,
      filePath,
      fileSize: file.size,
      mimeType,
      fileExtension: ext,
      previewPath: isPreviewable ? filePath : null,
      uploadedById: session.id,
      uploadedByName: session.name,
      notes,
      isActive: true,
    },
  });

  // Set active revision
  const result = await db.engineeringDrawing.update({
    where: { id: drawing.id },
    data: { activeRevisionId: revision.id },
    include: {
      client: { select: { id: true, name: true } },
      plant: { select: { id: true, name: true, location: true } },
      revisions: { orderBy: { createdAt: "desc" } },
    },
  });

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "CREATE", entity: "EngineeringDrawing", entityId: drawing.id,
    details: `Uploaded drawing ${drawingNumber} (${title}, ${drawingType}, ${file.name}, ${file.size}B, ${ext})`,
  });

  return NextResponse.json(result, { status: 201 });
}
