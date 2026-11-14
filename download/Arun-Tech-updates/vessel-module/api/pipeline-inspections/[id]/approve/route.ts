// POST /api/pipeline-inspections/[id]/approve
// Admin action — approve a Submitted-for-Review (or Changes Pending Review) report.
//
// Workflow (ALL WRITES ATOMIC via db.$transaction):
//   1. Generate the PDF ONCE and persist it to disk at storage/pdfs/
//   2. Mark any previously-approved revision as Superseded
//   3. Create a new ReportRevision with status=Approved + snapshotData + pdfPath
//   4. Update the report: status → Approved, currentApprovedRevisionId → new revision
//
// The PDF is generated BEFORE the transaction starts, then the path is
// stored in the revision row. This means the approved PDF is permanently
// frozen at the moment of approval — downloading it later always returns
// the exact same bytes, even if the report header is subsequently edited
// in a new revision.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { generatePipelineReportPdf } from "@/lib/pdf/pipeline-report";
import { Writable } from "stream";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const PDF_STORAGE_DIR = "/home/z/my-project/storage/pdfs";

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

async function generateAndPersistPdf(
  report: any,
  linkedDrawings: Array<{
    id: string; title: string; drawingNumber: string; drawingType: string;
    revisionNumber: string; fileName: string; filePath: string;
    fileExtension: string; mimeType: string;
    clientName?: string | null; plantName?: string | null;
  }>,
): Promise<{ path: string; size: number; buffer: Buffer }> {
  // Ensure storage directory exists
  mkdirSync(PDF_STORAGE_DIR, { recursive: true });

  // Generate the PDF in-memory
  const writable = new BufferWritable();
  await new Promise<void>((resolve, reject) => {
    writable.on("finish", () => resolve());
    writable.on("error", reject);
    void generatePipelineReportPdf(
      { report, measurements: report.measurements as never, linkedDrawings },
      writable,
    );
  });
  const buffer = writable.toBuffer();

  // Persist to disk with a deterministic filename:
  //   {reportNumber}_rev{revisionNumber}_{timestamp}.pdf
  // The timestamp ensures uniqueness even if the same revision is re-approved
  // (though that shouldn't happen — the immutability trigger prevents it).
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -1);
  const filename = `${report.reportNumber}_rev${report.revisionNumber ?? 1}_${timestamp}.pdf`;
  const filePath = join(PDF_STORAGE_DIR, filename);
  writeFileSync(filePath, buffer);

  return { path: filePath, size: buffer.length, buffer };
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // PERMISSION: only admins can approve reports.
  if (session.dashboardRole !== "ADMIN") {
    return NextResponse.json(
      { error: "Forbidden — administrator role required to approve reports" },
      { status: 403 },
    );
  }
  const { id } = await ctx.params;
  const existing = await db.pipelineInspection.findUnique({
    where: { id },
    include: {
      measurements: true,
      // Vessel thickness rows (only populated for equipmentType = VESSEL)
      vesselThicknessRows: { orderBy: [{ tableGroup: "asc" }, { sortOrder: "asc" }] },
      visualObservations: { orderBy: { sortOrder: "asc" } },
      // DPT observations
      dptObservations: { orderBy: { sortOrder: "asc" } },
      // Inspection certificates
      certificates: { orderBy: [{ category: "asc" }, { sortOrder: "asc" }] },
      revisions: true,
      inspector: true,
      approver: true,
      client: { select: { id: true, name: true, logoPath: true } },
      plant: { select: { id: true, name: true, location: true, address: true } },
      // Include photos + linked drawings so the approved PDF actually
      // contains them
      reportPhotos: { orderBy: { sortOrder: "asc" } },
      drawingLinks: {
        include: {
          drawing: {
            include: {
              client: { select: { id: true, name: true } },
              plant: { select: { id: true, name: true } },
              revisions: { orderBy: { createdAt: "desc" } },
            },
          },
        },
      },
    },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // STATUS CHECK: report must be in "Submitted for Review" or "Changes Pending Review" state.
  const validStatuses = ["Submitted for Review", "Changes Pending Review"];
  if (!validStatuses.includes(existing.status)) {
    return NextResponse.json(
      {
        error:
          `Cannot approve a report in "${existing.status}" state. ` +
          "Only Submitted for Review or Changes Pending Review reports can be approved.",
      },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const approvalNotes: string | null = body.approvalNotes?.trim() || null;
  const nextRevisionNumber =
    Math.max(0, ...existing.revisions.map((r) => r.revisionNumber)) + 1;

  // ─── STEP 1: Generate and persist the PDF BEFORE the transaction ───
  // The PDF is generated from the CURRENT report data (which is the
  // submitted-for-review state). Once approved, this PDF is frozen —
  // it represents the exact report the admin reviewed and approved.
  const reportForPdf = {
    ...existing,
    // Override the report-level fields that should reflect the APPROVED state
    revisionNumber: nextRevisionNumber,
    status: "Approved",
    approvedAt: new Date(),
    approver: { id: session.id, name: session.name, email: session.email } as any,
  };
  // Resolve the linked drawings into a flat array (same shape as the PDF
  // route uses) so the approved PDF contains the drawings too.
  const linkedDrawingsForPdf: Array<{
    id: string; title: string; drawingNumber: string; drawingType: string;
    revisionNumber: string; fileName: string; filePath: string;
    fileExtension: string; mimeType: string;
    clientName?: string | null; plantName?: string | null;
  }> = [];
  for (const link of existing.drawingLinks) {
    const drawing = link.drawing;
    const activeRev = link.drawingRevisionId
      ? drawing.revisions.find((r) => r.id === link.drawingRevisionId)
      : drawing.revisions.find((r) => r.isActive) ?? drawing.revisions[0];
    if (activeRev) {
      linkedDrawingsForPdf.push({
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
  const pdfResult = await generateAndPersistPdf(reportForPdf, linkedDrawingsForPdf);

  // Build the snapshot JSON (deterministic — computed before the transaction)
  const snapshotData = JSON.stringify({
    reportType: existing.reportType,
    equipmentType: existing.equipmentType,
    header: {
      reportNumber: existing.reportNumber,
      inspectionArea: existing.inspectionArea,
      pipelineDescription: existing.pipelineDescription,
      pipelineIdentificationNumber: existing.pipelineIdentificationNumber,
      isometricDrawingNumber: existing.isometricDrawingNumber,
      materialOfConstruction: existing.materialOfConstruction,
      applicableStandard: existing.applicableStandard,
      standardEdition: existing.standardEdition,
      findingsSummary: existing.findingsSummary,
      comments: existing.comments,
      inspectionDescription: existing.inspectionDescription,
      photos: existing.photos,
      // Condition assessment fields (only populated for PIPELINE_CONDITION reports)
      pipelineAgeYears: existing.pipelineAgeYears,
      serviceFluid: existing.serviceFluid,
      operatingCondition: existing.operatingCondition,
      overallConditionRating: existing.overallConditionRating,
      corrosionCondition: existing.corrosionCondition,
      damageAssessment: existing.damageAssessment,
      previousInspectionRef: existing.previousInspectionRef,
      currentInspectionFindings: existing.currentInspectionFindings,
      riskPriorityLevel: existing.riskPriorityLevel,
      recommendations: existing.recommendations,
      nextInspectionRecommendation: existing.nextInspectionRecommendation,
    },
    measurements: existing.measurements.map((m) => ({
      pointNo: m.pointNo,
      pipeSizeInch: m.pipeSizeInch,
      pipeSchedule: m.pipeSchedule,
      nominalThicknessMm: m.nominalThicknessMm,
      componentTypeCode: m.componentTypeCode,
      northMm: m.northMm, northStatus: m.northStatus,
      eastMm: m.eastMm, eastStatus: m.eastStatus,
      southMm: m.southMm, southStatus: m.southStatus,
      westMm: m.westMm, westStatus: m.westStatus,
      observedMinimumMm: m.observedMinimumMm,
      findingsComments: m.findingsComments,
    })),
    visualObservations: existing.visualObservations.map((o) => ({
      pointNo: o.pointNo,
      location: o.location,
      pipelineCondition: o.pipelineCondition,
      externalSurfaceCondition: o.externalSurfaceCondition,
      coatingPaintCondition: o.coatingPaintCondition,
      corrosionObserved: o.corrosionObserved,
      leakageObserved: o.leakageObserved,
      damageOrDeformation: o.damageOrDeformation,
      supportsHangersCondition: o.supportsHangersCondition,
      weldJointCondition: o.weldJointCondition,
      insulationCondition: o.insulationCondition,
      findings: o.findings,
      recommendations: o.recommendations,
      inspectorComments: o.inspectorComments,
      checkType: (o as any).checkType,
      result: (o as any).result,
    })),
    // Vessel header + thickness rows (only populated for vessel reports)
    vessel: {
      vesselName: existing.vesselName,
      vesselTagNumber: existing.vesselTagNumber,
      vesselEquipmentId: existing.vesselEquipmentId,
      vesselManufacturer: existing.vesselManufacturer,
      vesselYearOfManufacture: existing.vesselYearOfManufacture,
      vesselType: existing.vesselType,
      designPressure: existing.designPressure,
      designTemperature: existing.designTemperature,
      operatingPressure: existing.operatingPressure,
      operatingTemperature: existing.operatingTemperature,
      internalDiameter: existing.internalDiameter,
      shellLength: existing.shellLength,
      overallLength: existing.overallLength,
      shellThickness: existing.shellThickness,
      headThickness: existing.headThickness,
      numberOfShellCourses: existing.numberOfShellCourses,
      headType: existing.headType,
      vesselComponents: existing.vesselComponents,
      overallResult: existing.overallResult,
      inspectorRemarks: existing.inspectorRemarks,
    },
    vesselThicknessRows: existing.vesselThicknessRows.map((v) => ({
      tableGroup: v.tableGroup,
      sortOrder: v.sortOrder,
      component: v.component,
      location: v.location,
      gridPointNo: v.gridPointNo,
      nominalThicknessMm: v.nominalThicknessMm,
      measuredThicknessMm: v.measuredThicknessMm,
      result: v.result,
    })),
    approvedAt: new Date().toISOString(),
    approvedBy: session.name,
    pdfPath: pdfResult.path,
    pdfSize: pdfResult.size,
  });

  // ─── STEP 2: ATOMIC TRANSACTION ───
  // All 3 writes (mark-old-superseded, create-new-revision-with-pdf, update-report)
  // happen inside a single Prisma transaction. If any write fails, the
  // entire transaction rolls back — no partial state. (The persisted PDF
  // file on disk is orphaned but harmless — it can be cleaned up by a
  // background job later.)
  const updated = await db.$transaction(async (tx) => {
    // 1. Mark any previously-approved revision as Superseded
    const previouslyApproved = existing.revisions.filter((r) => r.status === "Approved");
    if (previouslyApproved.length > 0) {
      await tx.reportRevision.updateMany({
        where: { id: { in: previouslyApproved.map((r) => r.id) } },
        data: { status: "Superseded" },
      });
    }

    // 2. Create the new approved revision (with full snapshot + PDF path)
    const newRevision = await tx.reportRevision.create({
      data: {
        pipelineInspectionId: id,
        revisionNumber: nextRevisionNumber,
        status: "Approved",
        revisedById: existing.inspectorId,
        revisedByName: existing.inspectorName,
        changeDescription: body.approvalNotes ?? `Approved revision ${nextRevisionNumber}`,
        pdfPath: pdfResult.path, // ← the persisted PDF path (frozen at approval time)
        snapshotData,
        reviewComments: null,
        approvedById: session.id,
        approvedAt: new Date(),
        approvedByName: session.name,
      },
    });

    // 3. Update the report: status → Approved, point at the new revision
    const updatedReport = await tx.pipelineInspection.update({
      where: { id },
      data: {
        status: "Approved",
        revisionNumber: nextRevisionNumber,
        currentApprovedRevisionId: newRevision.id,
        approvedById: session.id,
        approvedAt: new Date(),
        approvalNotes,
        pdfPath: pdfResult.path, // ← also store on the report for quick access
        reviewComments: null,
        returnedById: null,
        returnedAt: null,
        inspectorName: existing.inspectorName,
      },
    });

    return updatedReport;
  });
  // ─── END TRANSACTION — if we reach here, all writes committed ───

  // Audit log
  await recordAudit({
    userId: session.id, userName: session.name,
    action: "APPROVE", entity: "PipelineInspection", entityId: updated.id,
    details: `Approved pipeline report ${updated.reportNumber} (revision ${nextRevisionNumber}, PDF: ${pdfResult.size} bytes at ${pdfResult.path})`,
  });

  return NextResponse.json(updated);
}
