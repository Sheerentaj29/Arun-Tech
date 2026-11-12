// GET /api/client-logo/[slug]
// Serves a client logo image file from /storage/logos/clients/{slug}.
// The slug is the exact logo filename (e.g. "raj-petro.png",
// "raftaar-terminals.png") that the mapping in @/lib/client-logo-mapping.ts
// connects to a specific client name.
//
// The mapping in @/lib/client-logo-mapping.ts is currently EMPTY (clean
// slate) — it will be repopulated one entry per client after the user
// uploads the new uniquely-named logo images. Until then this endpoint
// simply returns 404 for any slug, which is the desired behaviour: no
// client logo is shown for any client, only a clean placeholder.
//
// The frontend uses this endpoint to render the right-hand client logo via
// AuthImage when `resolveClientLogo()` returns a non-null filename, without
// needing logoPath to be set on the Client row in the database.
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

  // Sanitize the slug — allow alphanumeric, dots, dashes, underscores,
  // spaces, ampersands and parentheses (filenames like
  // "JK Tyre & Industries Ltd.png" or "Valspar (India) ....png" contain them).
  // Path separators (/ \) and `..` traversal are still blocked because
  // neither `/` nor `\` is in the allowed character class.
  if (!/^[a-zA-Z0-9._ &()\-]+$/.test(slug)) {
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
    : ext === "svg" ? "image/svg+xml"
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
