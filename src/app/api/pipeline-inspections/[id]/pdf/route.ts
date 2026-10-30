// GET  /api/pipeline-inspections/[id]/pdf?orientation=landscape|portrait
//
// Download the PDF for a pipeline inspection report.
// - If the report is Approved AND a persisted PDF exists on disk, serve that
//   file directly (the exact bytes that were approved — never re-generated).
// - If the report is in Draft/Submitted/Returned state, generate a preview PDF
//   on-the-fly with the requested orientation.
//
// The generated PDF includes:
//   Page 1: Report header details
//   Pages 2-N: Engineering drawings (one per page, if attached)
//   Next page: Measurement table
//   Following pages: Findings, photos, sign-off

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

  const url = new URL(req.url);
  const orientation = (url.searchParams.get("orientation") as "landscape" | "portrait") || "landscape";

  // Load the report with ALL related data: measurements, photos, AND linked drawings
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
      // Load linked engineering drawings with their active revision's file
      drawingLinks: {
        include: {
          drawing: {
            include: {
              client: { select: { id: true, name: true } },
              plant: { select: { id: true, name: true } },
              equipment: { select: { id: true, name: true } },
              revisions: {
                orderBy: { createdAt: "desc" },
                // Get the active revision (or the one specified in the link)
              },
            },
          },
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

  // Build the drawings array for the PDF generator
  // Each linked drawing gets its active revision's file path
  const linkedDrawings: any[] = [];
  for (const link of report.drawingLinks) {
    const drawing = link.drawing;
    // Find the active revision (or the specific linked revision)
    const activeRev = link.drawingRevisionId
      ? drawing.revisions.find((r) => r.id === link.drawingRevisionId)
      : drawing.revisions.find((r) => r.isActive) ?? drawing.revisions[0];

    if (activeRev) {
      linkedDrawings.push({
        id: drawing.id,
        title: drawing.title,
        drawingNumber: drawing.drawingNumber,
        drawingType: drawing.drawingType,
        revisionNumber: activeRev.revisionNumber,
        fileName: activeRev.fileName,
        filePath: activeRev.filePath,
        fileExtension: activeRev.fileExtension,
        mimeType: activeRev.mimeType,
        clientName: drawing.client?.name,
        plantName: drawing.plant?.name,
      });
    }
  }

  // Attach the drawings to the report object for the PDF generator
  const reportForPdf = {
    ...report,
    linkedDrawings,
  };

  let buf: Buffer;
  let sourceLabel: string;

  if (
    report.status === "Approved" &&
    report.pdfPath &&
    existsSync(report.pdfPath) &&
    orientation === "landscape"
  ) {
    // ── APPROVED REPORT (landscape): serve the persisted PDF from disk ──
    buf = readFileSync(report.pdfPath);
    sourceLabel = `persisted (${report.pdfPath})`;
  } else {
    // ── Generate a fresh PDF with the requested orientation ──
    try {
      buf = await generatePdfBuffer(reportForPdf, orientation);
      sourceLabel = `generated ${orientation} (${buf.length} bytes, ${linkedDrawings.length} drawings)`;
    } catch (err) {
      console.error("[PDF] Generation failed:", err);
      return NextResponse.json(
        { error: `PDF generation failed: ${(err as Error).message}. Check server logs for details.` },
        { status: 500 },
      );
    }
  }

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "EXPORT", entity: "PipelineInspection", entityId: report.id,
    details: `Downloaded PDF (${orientation}) for ${report.reportNumber} (${sourceLabel})`,
  });

  // Use "attachment" disposition to force download (not inline display)
  const safeReportNumber = report.reportNumber.replace(/[^a-zA-Z0-9-]/g, "_");
  const filename = `Inspection_Report_${safeReportNumber}_${orientation}.pdf`;

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buf.length),
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
}
