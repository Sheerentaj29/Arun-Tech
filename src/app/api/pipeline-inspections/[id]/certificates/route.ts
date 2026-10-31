// GET  /api/pipeline-inspections/[id]/certificates - list certificates
// POST /api/pipeline-inspections/[id]/certificates - upload a certificate (multipart)

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const CERT_STORAGE_DIR = "/home/z/my-project/storage/certificates";
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

function getFileExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  if (idx < 0) return "";
  return filename.slice(idx).toLowerCase();
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
  const items = await db.inspectionCertificate.findMany({
    where: { pipelineInspectionId: id },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
  });
  return NextResponse.json({ items });
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
  const editableStatuses = ["Draft", "Returned for Revision", "Changes Pending Review"];
  if (!isAdmin && !editableStatuses.includes(report.status)) {
    return NextResponse.json({ error: `Cannot add certificates to a report in "${report.status}" state.` }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const category = (formData.get("category") as string) || "EQUIPMENT";
  const title = (formData.get("title") as string) || "";

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (!["EQUIPMENT", "PERSONNEL"].includes(category)) {
    return NextResponse.json({ error: "Category must be EQUIPMENT or PERSONNEL" }, { status: 400 });
  }
  const ext = getFileExtension(file.name);
  if (!ALLOWED_EXTENSIONS[ext]) {
    return NextResponse.json({ error: `Unsupported format: ${ext}. Allowed: PDF, PNG, JPG, JPEG.` }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: `File too large. Maximum: 50 MB.` }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  mkdirSync(CERT_STORAGE_DIR, { recursive: true });

  const certTitle = title.trim() || file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  const safeFileName = `${report.reportNumber}-${category}-${Date.now()}${ext}`;
  const filePath = join(CERT_STORAGE_DIR, safeFileName);
  writeFileSync(filePath, buffer);

  const maxSort = await db.inspectionCertificate.findFirst({
    where: { pipelineInspectionId: id, category },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const cert = await db.inspectionCertificate.create({
    data: {
      pipelineInspectionId: id,
      category,
      title: certTitle,
      fileName: file.name,
      filePath,
      fileSize: file.size,
      mimeType: ALLOWED_EXTENSIONS[ext],
      fileExtension: ext,
      sortOrder: (maxSort?.sortOrder ?? -1) + 1,
      uploadedById: session.id,
      uploadedByName: session.name,
    },
  });

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "CREATE", entity: "InspectionCertificate", entityId: cert.id,
    details: `Uploaded ${category} certificate "${certTitle}" for ${report.reportNumber}`,
  });

  return NextResponse.json(cert, { status: 201 });
}
