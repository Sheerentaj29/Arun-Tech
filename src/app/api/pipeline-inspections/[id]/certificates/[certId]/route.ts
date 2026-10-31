// DELETE /api/pipeline-inspections/[id]/certificates/[certId] - delete a certificate

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { unlinkSync, existsSync } from "fs";

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string; certId: string }> }) {
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

  if (cert.filePath && existsSync(cert.filePath)) {
    try { unlinkSync(cert.filePath); } catch {}
  }

  await db.inspectionCertificate.delete({ where: { id: certId } });

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "DELETE", entity: "InspectionCertificate", entityId: certId,
    details: `Deleted ${cert.category} certificate "${cert.title}" from ${report.reportNumber}`,
  });

  return NextResponse.json({ ok: true });
}
