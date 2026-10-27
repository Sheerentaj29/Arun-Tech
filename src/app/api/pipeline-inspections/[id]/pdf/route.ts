// GET  /api/pipeline-inspections/[id]/pdf - download the CURRENT approved PDF.
//   If the report is Approved, serve the persisted PDF file from disk
//   (the exact bytes that were approved — never re-generated).
//   If the report is in Draft/Submitted/Returned state, generate a
//   preview PDF on-the-fly (this is a working draft, not the approved version).
//
// GET  /api/pipeline-inspections/[id]/revisions/[rid]/pdf - download a
//   SPECIFIC historical revision's PDF. Only serves approved/superseded
//   revisions' persisted PDFs — never re-generates them.

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

async function generatePdfBuffer(report: any): Promise<Buffer> {
  const writable = new BufferWritable();
  await new Promise<void>((resolve, reject) => {
    writable.on("finish", () => resolve());
    writable.on("error", reject);
    void generatePipelineReportPdf(
      { report, measurements: report.measurements as never },
      writable,
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

  if (report.status === "Approved" && report.pdfPath && existsSync(report.pdfPath)) {
    // ── APPROVED REPORT: serve the persisted PDF from disk ──
    // This is the exact PDF the admin approved — never re-generated.
    // Even if the report is later revised, this file doesn't change.
    buf = readFileSync(report.pdfPath);
    sourceLabel = `persisted (${report.pdfPath})`;
  } else {
    // ── DRAFT/SUBMITTED/RETURNED: generate a preview PDF on-the-fly ──
    // This is a working draft — the content may change before approval.
    buf = await generatePdfBuffer(report);
    sourceLabel = `generated on-the-fly (${buf.length} bytes)`;
  }

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "EXPORT", entity: "PipelineInspection", entityId: report.id,
    details: `Downloaded PDF for ${report.reportNumber} (${sourceLabel})`,
  });

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${report.reportNumber}.pdf"`,
      "Content-Length": String(buf.length),
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
}
