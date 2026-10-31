// GET /api/clients/[id]/logo/raw - serve the client's logo file

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { readFileSync, existsSync } from "fs";

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
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;

  return new NextResponse(buf, {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `inline; filename="client-logo.${ext}"`,
      "Content-Length": String(buf.length),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
