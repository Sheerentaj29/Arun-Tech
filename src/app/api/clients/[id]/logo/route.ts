// GET    /api/clients/[id]/logo - serve the client's uploaded logo file
// POST   /api/clients/[id]/logo - upload client logo (admin only)
// DELETE /api/clients/[id]/logo - remove client logo (admin only)
//
// The GET handler exists because the report form (and now the Admin
// Clients & Plants view) render the per-client uploaded logo via
// AuthImage with src="/api/clients/{id}/logo". Without a GET export the
// image request would return 405 and the fallback logo would never load.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { writeFileSync, mkdirSync, unlinkSync, existsSync, readFileSync } from "fs";
import { join } from "path";

const LOGO_STORAGE_DIR = "/home/z/my-project/storage/logos";
const MAX_LOGO_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const client = await db.client.findUnique({ where: { id }, select: { logoPath: true } });
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  if (!client.logoPath || !existsSync(client.logoPath)) {
    return NextResponse.json({ error: "No logo uploaded" }, { status: 404 });
  }

  const buf = readFileSync(client.logoPath);
  const ext = client.logoPath.split(".").pop()?.toLowerCase() || "png";
  const mime = ext === "jpg" || ext === "jpeg"
    ? "image/jpeg"
    : ext === "webp"
      ? "image/webp"
      : ext === "gif"
        ? "image/gif"
        : `image/${ext}`;

  return new NextResponse(buf, {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `inline; filename="client-logo.${ext}"`,
      "Content-Length": String(buf.length),
      "Cache-Control": "private, max-age=60",
    },
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden — administrator role required" }, { status: 403 });
  }
  const { id } = await ctx.params;

  const client = await db.client.findUnique({ where: { id } });
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

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

  mkdirSync(LOGO_STORAGE_DIR, { recursive: true });

  // Generate a safe filename
  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const safeFileName = `client_${id}.${ext}`;
  const filePath = join(LOGO_STORAGE_DIR, safeFileName);

  // Remove old logo if it exists
  if (client.logoPath && existsSync(client.logoPath)) {
    try { unlinkSync(client.logoPath); } catch {}
  }

  writeFileSync(filePath, buffer);

  const updated = await db.client.update({
    where: { id },
    data: { logoPath: filePath },
  });

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "UPDATE", entity: "Client", entityId: id,
    details: `Uploaded logo for client ${client.name}`,
  });

  return NextResponse.json({ ok: true, logoPath: filePath });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden — administrator role required" }, { status: 403 });
  }
  const { id } = await ctx.params;

  const client = await db.client.findUnique({ where: { id } });
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  if (client.logoPath && existsSync(client.logoPath)) {
    try { unlinkSync(client.logoPath); } catch {}
  }

  await db.client.update({
    where: { id },
    data: { logoPath: null },
  });

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "UPDATE", entity: "Client", entityId: id,
    details: `Removed logo for client ${client.name}`,
  });

  return NextResponse.json({ ok: true });
}
