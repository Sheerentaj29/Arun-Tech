// GET /api/client-logo/[slug]
// Serves a client logo image file from /storage/logos/clients/{slug}
// The slug is the filename (e.g., "lt.png", "jetyre.png") as stored in
// the client_logo_mapping.json file.
//
// This endpoint exists because most clients in the database don't have
// logoPath set (they were seeded without logos). The logo mapping file
// maps client name keywords to logo filenames stored on disk. This
// endpoint serves those files so the frontend can display them via
// AuthImage without needing the logoPath to be set in the database.
//
// Authentication: requires a valid session (cookie or Bearer token).

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const LOGO_DIR = "/home/z/my-project/storage/logos/clients";

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await ctx.params;

  // Sanitize the slug — only allow alphanumeric, dash, underscore, dot
  // This prevents path traversal attacks.
  if (!/^[a-zA-Z0-9._-]+$/.test(slug)) {
    return NextResponse.json({ error: "Invalid slug" }, { status: 400 });
  }

  const filePath = join(LOGO_DIR, slug);

  if (!existsSync(filePath)) {
    return NextResponse.json({ error: "Logo not found" }, { status: 404 });
  }

  const buf = readFileSync(filePath);
  const ext = slug.split(".").pop()?.toLowerCase() || "png";
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg"
    : ext === "gif" ? "image/gif"
    : ext === "webp" ? "image/webp"
    : `image/${ext}`;

  return new NextResponse(buf, {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `inline; filename="${slug}"`,
      "Content-Length": String(buf.length),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
