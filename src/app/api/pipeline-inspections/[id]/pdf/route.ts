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
//              — image formats are embedded directly
//              — PDF drawings are rasterized page-by-page via pdftoppm
//   Next page: Measurement table
//   Following pages: Inspection description, findings, photos, sign-off

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { generatePipelineReportPdf, type LinkedDrawing } from "@/lib/pdf/pipeline-report";
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

async function generatePdfBuffer(
  report: any,
  linkedDrawings: LinkedDrawing[],
  orientation: "landscape" | "portrait" = "landscape",
): Promise<Buffer> {
  const writable = new BufferWritable();
  await new Promise<void>((resolve, reject) => {
    writable.on("finish", () => resolve());
    writable.on("error", reject);
    void generatePipelineReportPdf(
      {
        report,
        measurements: report.measurements as never,
        photos: report.reportPhotos ?? [],
        linkedDrawings,
      },
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
      client: { select: { id: true, name: true, logoPath: true } },
      plant: { select: { id: true, name: true, location: true, address: true } },
      inspector: { select: { id: true, name: true, email: true } },
      approver: { select: { id: true, name: true, email: true } },
      measurements: {
        orderBy: { sortOrder: "asc" },
        include: {
          componentType: { select: { id: true, code: true, label: true } },
          standard: {
            select: {
              id: true, standard: true, edition: true, nominalSizeInch: true,
              schedule: true, wallThicknessMm: true, isVerified: true,
            },
          },
        },
      },
      reportPhotos: { orderBy: { sortOrder: "asc" } },
      // Visual inspection observations (only populated for PIPELINE_VISUAL reports)
      visualObservations: { orderBy: { sortOrder: "asc" } },
      // Inspection certificates (equipment + personnel)
      certificates: { orderBy: [{ category: "asc" }, { sortOrder: "asc" }] },
      // Linked engineering drawings with their revisions — we resolve the
      // correct revision (the one referenced by the link, else the active
      // revision, else the latest) into a flat LinkedDrawing[] for the
      // PDF generator.
      drawingLinks: {
        include: {
          drawing: {
            include: {
              client: { select: { id: true, name: true } },
              plant: { select: { id: true, name: true } },
              equipment: { select: { id: true, name: true } },
              revisions: { orderBy: { createdAt: "desc" } },
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

  // Resolve linked drawings into a flat array
  const linkedDrawings: LinkedDrawing[] = [];
  for (const link of report.drawingLinks) {
    const drawing = link.drawing;
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

  let buf: Buffer;
  let sourceLabel: string;

  if (
    report.status === "Approved" &&
    report.pdfPath &&
    existsSync(report.pdfPath) &&
    orientation === "landscape"
  ) {
    // Approved report (landscape): serve the persisted PDF from disk.
    // This is the EXACT bytes that were approved — frozen at approval time.
    buf = readFileSync(report.pdfPath);
    sourceLabel = `persisted (${report.pdfPath})`;
  } else {
    // Generate a fresh PDF with the requested orientation
    try {
      buf = await generatePdfBuffer(report, linkedDrawings, orientation);
      sourceLabel =
        `generated ${orientation} (${buf.length} bytes, ${linkedDrawings.length} drawings)`;
    } catch (err) {
      console.error("[PDF] Generation failed:", err);
      return NextResponse.json(
        {
          error:
            `PDF generation failed: ${(err as Error).message}. ` +
            `Check server logs for details.`,
        },
        { status: 500 },
      );
    }
  }

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "EXPORT", entity: "PipelineInspection", entityId: report.id,
    details: `Downloaded PDF (${orientation}) for ${report.reportNumber} (${sourceLabel})`,
  });

  const safeReportNumber = report.reportNumber.replace(/[^a-zA-Z0-9-]/g, "_");
  const filename = `Inspection_Report_${safeReportNumber}_${orientation}.pdf`;

  // Note: Buffer is a valid BodyInit at runtime in the Node.js runtime,
  // but the DOM lib type doesn't include Buffer in BodyInit. Cast to
  // BodyInit to satisfy TypeScript without changing runtime behavior.
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buf.length),
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
}
