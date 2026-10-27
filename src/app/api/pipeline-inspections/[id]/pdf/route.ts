// GET  /api/pipeline-inspections/[id]/pdf?orientation=landscape|portrait
//
// Download the PDF for a pipeline inspection report.
// - If the report is Approved AND a persisted PDF exists on disk, serve that
//   file directly (the exact bytes the admin approved — never re-generated).
// - If the report is in Draft/Submitted/Returned state, generate a preview PDF
//   on-the-fly with the requested orientation.
//
// Query params:
//   orientation: "landscape" (default) | "portrait"

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { generatePipelineReportPdf } from "@/lib/pdf/pipeline-report";
import { Writable } from "stream";
import { readFileSync, existsSync } from "fs";

class BufferWritable extends Writable {
  chunks: Buffer[] = [];
  _write(chunk: Buffer, _enc: BufferEncoding, cb: (err?: Error | null) => void) {
    this.chunks.push(chunk);
    cb();
  }
  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

async function generatePdfBuffer(report: any, orientation: "landscape" | "portrait" = "landscape"): Promise<Buffer> {
  const writable = new BufferWritable();
  await new Promise<void>((resolve, reject) => {
    writable.on("finish", () => resolve());
    writable.on("error", reject);
    void generatePipelineReportPdf(
      { report, measurements: report.measurements as never, photos: report.reportPhotos ?? [] },
      writable,
      orientation,
    );
  });
  return writable.toBuffer();
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  // Parse orientation from query string
  const url = new URL(req.url);
  const orientation = (url.searchParams.get("orientation") as "landscape" | "portrait") || "landscape";

  const report = await db.pipelineInspection.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true } },
      plant: { select: { id: true, name: true, location: true, address: true } },
      inspector: { select: { id: true, name: true, email: true } },
      approver: { select: { id: true, name: true, email: true } },
      measurements: {
        orderBy: { sortOrder: "asc" },
        include: {
          componentType: { select: { id: true, code: true, label: true } },
          standard: { select: { id: true, standard: true, edition: true, nominalSizeInch: true, schedule: true, wallThicknessMm: true, isVerified: true } },
        },
      },
      reportPhotos: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (!report) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // PERMISSION: employees can only download their own reports
  const isAdmin = session.dashboardRole === "ADMIN";
  if (!isAdmin && report.inspectorId !== session.id) {
    return NextResponse.json(
      { error: "Forbidden — you can only download your own reports" },
      { status: 403 },
    );
  }

  let buf: Buffer;
  let sourceLabel: string;

  if (
    report.status === "Approved" &&
    report.pdfPath &&
    existsSync(report.pdfPath) &&
    orientation === "landscape" // Only serve persisted PDF for default (landscape)
  ) {
    // ── APPROVED REPORT (landscape): serve the persisted PDF from disk ──
    buf = readFileSync(report.pdfPath);
    sourceLabel = `persisted (${report.pdfPath})`;
  } else {
    // ── DRAFT/SUBMITTED/RETURNED OR PORTRAIT: generate a preview PDF on-the-fly ──
    // This includes ALL saved data: measurements, custom columns, photos, etc.
    buf = await generatePdfBuffer(report, orientation);
    sourceLabel = `generated ${orientation} (${buf.length} bytes)`;
  }

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "EXPORT", entity: "PipelineInspection", entityId: report.id,
    details: `Downloaded PDF (${orientation}) for ${report.reportNumber} (${sourceLabel})`,
  });

  const filename = orientation === "portrait"
    ? `${report.reportNumber}_portrait.pdf`
    : `${report.reportNumber}.pdf`;

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Content-Length": String(buf.length),
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
}
