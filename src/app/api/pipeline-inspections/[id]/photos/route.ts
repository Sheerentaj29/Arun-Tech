// POST /api/pipeline-inspections/[id]/photos
// Upload one or more photos for a pipeline inspection report.
// Accepts multipart/form-data with:
//   - file: the image file (JPEG, PNG, WebP, max 10MB)
//   - caption: optional caption text
//
// GET /api/pipeline-inspections/[id]/photos
// List all photos for a report.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const PHOTO_STORAGE_DIR = "/home/z/my-project/storage/photos";
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const report = await db.pipelineInspection.findUnique({ where: { id } });
  if (!report) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Permission: employees can only view their own reports' photos
  const isAdmin = session.dashboardRole === "ADMIN";
  if (!isAdmin && report.inspectorId !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Only return INSPECTION-category photos. PRIMARY-category photos
  // (uploaded via /primary-photo) are excluded so they don't appear
  // in the Inspection Photographs gallery — they already appear on
  // the first page of the PDF in their designated position.
  const photos = await db.reportPhoto.findMany({
    where: { pipelineInspectionId: id, category: "INSPECTION" },
    orderBy: { sortOrder: "asc" },
  });

  return NextResponse.json({ items: photos });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const report = await db.pipelineInspection.findUnique({ where: { id } });
  if (!report) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Permission: only the owner or admin can upload
  const isAdmin = session.dashboardRole === "ADMIN";
  if (!isAdmin && report.inspectorId !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Check report is in an editable state
  const editableStatuses = ["Draft", "Returned for Revision", "Changes Pending Review"];
  if (!isAdmin && !editableStatuses.includes(report.status)) {
    return NextResponse.json(
      { error: `Cannot upload photos to a report in "${report.status}" state.` },
      { status: 403 },
    );
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const caption = formData.get("caption") as string | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  // Validate file type
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type}. Allowed: JPEG, PNG, WebP, GIF.` },
      { status: 400 },
    );
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `File too large: ${file.size} bytes. Maximum: ${MAX_FILE_SIZE} bytes (10 MB).` },
      { status: 400 },
    );
  }

  // Read file buffer
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Ensure storage directory exists
  mkdirSync(PHOTO_STORAGE_DIR, { recursive: true });

  // Generate a unique filename: {reportNumber}_{timestamp}_{random}.ext
  const ext = file.name.split(".").pop() || "jpg";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -1) + "Z";
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  const fileName = `${report.reportNumber}_${timestamp}_${randomSuffix}.${ext}`;
  const filePath = join(PHOTO_STORAGE_DIR, fileName);

  // Write the file to disk
  writeFileSync(filePath, buffer);

  // Get the current max sortOrder
  const existingPhotos = await db.reportPhoto.findMany({
    where: { pipelineInspectionId: id },
    select: { sortOrder: true },
    orderBy: { sortOrder: "desc" },
    take: 1,
  });
  const nextSortOrder = (existingPhotos[0]?.sortOrder ?? -1) + 1;

  // Create the database record
  const photo = await db.reportPhoto.create({
    data: {
      pipelineInspectionId: id,
      fileName: file.name,
      filePath,
      fileSize: file.size,
      mimeType: file.type,
      caption: caption?.trim() || null,
      sortOrder: nextSortOrder,
      uploadedById: session.id,
      uploadedByName: session.name,
    },
  });

  await recordAudit({
    userId: session.id,
    userName: session.name,
    action: "CREATE",
    entity: "ReportPhoto",
    entityId: photo.id,
    details: `Uploaded photo "${file.name}" (${file.size} bytes) for ${report.reportNumber}`,
  });

  return NextResponse.json(photo, { status: 201 });
}
