// POST /api/pipeline-inspections/[id]/primary-photo/upload
// Upload (or replace) the Primary Inspection Photo in a single request.
//
// Accepts multipart/form-data with:
//   - file: the image file (JPEG, PNG, WebP, GIF — max 10 MB)
//
// This endpoint does TWO things atomically from the UI's perspective:
//   1. Saves the file to disk under /home/z/my-project/storage/photos/
//   2. Updates `primaryPhotoPath` on the PipelineInspection record
//
// It also creates a ReportPhoto row so the photo shows up in the report's
// photo gallery (Step 4). If the report already had a primary photo, the
// old file is left on disk (it may still be referenced by its ReportPhoto
// row) — only the `primaryPhotoPath` pointer is updated.
//
// Response: { id, filePath, fileName, fileSize, mimeType, reportNumber }
//
// GET /api/pipeline-inspections/[id]/primary-photo (defined in route.ts
// in the parent folder) serves the binary image bytes for preview.
// DELETE /api/pipeline-inspections/[id]/primary-photo clears the pointer.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const PHOTO_STORAGE_DIR = "/home/z/my-project/storage/photos";
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const report = await db.pipelineInspection.findUnique({ where: { id } });
  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

  // Permission: only the owner or admin can upload
  const isAdmin = session.dashboardRole === "ADMIN";
  if (!isAdmin && report.inspectorId !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // The report must be in an editable state for non-admins.
  const editableStatuses = ["Draft", "Returned for Revision", "Changes Pending Review"];
  if (!isAdmin && !editableStatuses.includes(report.status)) {
    return NextResponse.json(
      { error: `Cannot upload photos to a report in "${report.status}" state.` },
      { status: 403 },
    );
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  // Validate file type
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return NextResponse.json(
      {
        error: `Unsupported file type: ${file.type || "unknown"}. ` +
          `Allowed: JPEG, PNG, WebP, GIF.`,
      },
      { status: 400 },
    );
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      {
        error: `File too large: ${(file.size / 1024 / 1024).toFixed(2)} MB. ` +
          `Maximum: 10 MB.`,
      },
      { status: 400 },
    );
  }

  // Read file buffer
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Ensure storage directory exists
  mkdirSync(PHOTO_STORAGE_DIR, { recursive: true });

  // Generate a unique filename: {reportNumber}_primary_{timestamp}_{random}.ext
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -1) + "Z";
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  const fileName = `${report.reportNumber}_primary_${timestamp}_${randomSuffix}.${ext}`;
  const filePath = join(PHOTO_STORAGE_DIR, fileName);

  // Write the file to disk
  writeFileSync(filePath, buffer);

  // Get the current max sortOrder for the ReportPhoto row
  const existingPhotos = await db.reportPhoto.findMany({
    where: { pipelineInspectionId: id },
    select: { sortOrder: true },
    orderBy: { sortOrder: "desc" },
    take: 1,
  });
  const nextSortOrder = (existingPhotos[0]?.sortOrder ?? -1) + 1;

  // Create the ReportPhoto row (so it also appears in the photo gallery)
  const photo = await db.reportPhoto.create({
    data: {
      pipelineInspectionId: id,
      fileName: file.name,
      filePath,
      fileSize: file.size,
      mimeType: file.type,
      caption: "Primary inspection photo",
      sortOrder: nextSortOrder,
      uploadedById: session.id,
      uploadedByName: session.name,
    },
  });

  // Update primaryPhotoPath on the report
  await db.pipelineInspection.update({
    where: { id },
    data: { primaryPhotoPath: filePath },
  });

  await recordAudit({
    userId: session.id,
    userName: session.name,
    action: "UPDATE",
    entity: "PipelineInspection",
    entityId: id,
    details: `Set primary inspection photo to "${file.name}" (${file.size} bytes) for ${report.reportNumber}`,
  });

  return NextResponse.json(
    {
      id: photo.id,
      filePath,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      reportNumber: report.reportNumber,
    },
    { status: 201 },
  );
}
