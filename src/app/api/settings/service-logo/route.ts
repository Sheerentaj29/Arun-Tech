// GET  /api/settings/service-logo - serve the service company logo file
// POST /api/settings/service-logo - upload service company logo (admin only)
// DELETE /api/settings/service-logo - remove service company logo (admin only)

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { writeFileSync, mkdirSync, unlinkSync, existsSync, readFileSync } from "fs";
import { join } from "path";

const LOGO_PATH = "/home/z/my-project/storage/logos/service-company.png";
const STORAGE_DIR = "/home/z/my-project/storage/logos";
const MAX_LOGO_SIZE = 5 * 1024 * 1024;
const ALLOWED_MIME = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!existsSync(LOGO_PATH)) {
    return NextResponse.json({ error: "No service company logo uploaded" }, { status: 404 });
  }

  const buf = readFileSync(LOGO_PATH);
  // Determine MIME from file extension
  const ext = LOGO_PATH.split(".").pop()?.toLowerCase() || "png";
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;

  return new NextResponse(buf, {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `inline; filename="service-company.${ext}"`,
      "Content-Length": String(buf.length),
      "Cache-Control": "private, max-age=3600",
    },
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden — administrator role required" }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  if (!ALLOWED_MIME.includes(file.type)) {
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type}. Allowed: PNG, JPEG, WEBP, GIF.` },
      { status: 400 },
    );
  }

  if (file.size > MAX_LOGO_SIZE) {
    return NextResponse.json(
      { error: `File too large (${file.size} bytes). Maximum: 5 MB.` },
      { status: 400 },
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  mkdirSync(STORAGE_DIR, { recursive: true });

  // Determine extension from MIME
  const ext = file.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
  const filePath = join(STORAGE_DIR, `service-company.${ext}`);

  // Remove old logo if it exists (might have a different extension)
  for (const oldExt of ["png", "jpg", "jpeg", "webp", "gif"]) {
    const oldPath = join(STORAGE_DIR, `service-company.${oldExt}`);
    if (oldPath !== filePath && existsSync(oldPath)) {
      try { unlinkSync(oldPath); } catch {}
    }
  }
  if (existsSync(filePath)) {
    try { unlinkSync(filePath); } catch {}
  }

  writeFileSync(filePath, buffer);

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "UPDATE", entity: "Settings",
    details: `Uploaded service company logo`,
  });

  return NextResponse.json({ ok: true, logoPath: filePath });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden — administrator role required" }, { status: 403 });
  }

  for (const ext of ["png", "jpg", "jpeg", "webp", "gif"]) {
    const path = join(STORAGE_DIR, `service-company.${ext}`);
    if (existsSync(path)) {
      try { unlinkSync(path); } catch {}
    }
  }

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "DELETE", entity: "Settings",
    details: `Removed service company logo`,
  });

  return NextResponse.json({ ok: true });
}
