// GET /api/client-logo/[slug]
// Serves a client logo image file from /storage/logos/clients/{slug}.
// The slug is the exact filename (e.g., "lt.png", "jetyre.png") returned
// by `resolveClientLogo()` in @/lib/client-logo-mapping.ts — the single
// source of truth for the client-name → logo-file mapping.
//
// The frontend calls this endpoint with the slug returned by the resolver
// to render the right-hand client logo via AuthImage, without needing
// logoPath to be set on the Client row in the database.
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
