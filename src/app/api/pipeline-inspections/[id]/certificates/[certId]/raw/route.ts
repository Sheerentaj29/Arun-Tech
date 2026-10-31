// GET /api/pipeline-inspections/[id]/certificates/[certId]/raw - serve certificate file

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { readFileSync, existsSync } from "fs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; certId: string }> }) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, certId } = await ctx.params;
  const report = await db.pipelineInspection.findUnique({ where: { id } });
  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  const isAdmin = session.dashboardRole === "ADMIN";
  if (!isAdmin && report.inspectorId !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const cert = await db.inspectionCertificate.findUnique({ where: { id: certId } });
  if (!cert || cert.pipelineInspectionId !== id) {
    return NextResponse.json({ error: "Certificate not found" }, { status: 404 });
  }

  if (!cert.filePath || !existsSync(cert.filePath)) {
    return NextResponse.json({ error: "File not found on disk" }, { status: 404 });
  }

  const buf = readFileSync(cert.filePath);
  return new NextResponse(buf, {
    headers: {
      "Content-Type": cert.mimeType,
      "Content-Disposition": `inline; filename="${cert.fileName}"`,
      "Content-Length": String(buf.length),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
