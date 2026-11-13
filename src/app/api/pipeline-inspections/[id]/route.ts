// GET    /api/pipeline-inspections/[id] - get full inspection with measurements + revisions
// PUT    /api/pipeline-inspections/[id] - update header fields (role-gated)
// DELETE /api/pipeline-inspections/[id] - delete entire report (admin only)

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const report = await db.pipelineInspection.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true, logoPath: true } },
      plant: { select: { id: true, name: true, location: true, address: true } },
      inspector: { select: { id: true, name: true, email: true } },
      approver: { select: { id: true, name: true, email: true } },
      returnedBy: { select: { id: true, name: true, email: true } },
      measurements: {
        orderBy: [{ tableGroup: "asc" }, { sortOrder: "asc" }],
        include: {
          componentType: { select: { id: true, code: true, label: true } },
          standard: { select: { id: true, standard: true, edition: true, nominalSizeInch: true, schedule: true, wallThicknessMm: true, isVerified: true } },
        },
      },
      revisions: {
        orderBy: { revisionNumber: "desc" },
        include: {
          revisedBy: { select: { id: true, name: true } },
          approvedBy: { select: { id: true, name: true } },
        },
      },
      reportPhotos: {
        orderBy: { sortOrder: "asc" },
      },
      drawingLinks: {
        orderBy: { createdAt: "asc" },
        include: {
          drawing: {
            include: {
              client: { select: { id: true, name: true } },
              plant: { select: { id: true, name: true } },
              revisions: { orderBy: { createdAt: "desc" }, take: 1 },
            },
          },
        },
      },
      // Visual inspection observations (only populated for PIPELINE_VISUAL reports)
      visualObservations: {
        orderBy: { sortOrder: "asc" },
      },
      // DPT observations (only populated for PIPELINE_DPT reports)
      dptObservations: {
        orderBy: { sortOrder: "asc" },
      },
      // Inspection certificates (equipment + personnel)
      certificates: {
        orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
      },
    },
  });
  if (!report) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // PERMISSION: employees can only view their own reports. Admins see all.
  const isAdmin = session.dashboardRole === "ADMIN";
  if (!isAdmin && report.inspectorId !== session.id) {
    return NextResponse.json(
      { error: "Forbidden — you can only view your own reports" },
      { status: 403 },
    );
  }

  return NextResponse.json(report);
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const existing = await db.pipelineInspection.findUnique({
    where: { id },
    include: { measurements: true, revisions: true, inspector: true, approver: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isAdmin = session.dashboardRole === "ADMIN";
  // PERMISSION: employees can only edit their OWN reports in Draft or
  // Returned for Revision state. Admins can edit any report.
  if (!isAdmin) {
    if (existing.inspectorId !== session.id) {
      return NextResponse.json(
        { error: "Forbidden — you can only edit your own reports" },
        { status: 403 },
      );
    }
    const editableStatuses = ["Draft", "Returned for Revision"];
    if (!editableStatuses.includes(existing.status)) {
      return NextResponse.json(
        {
          error:
            "This report is in an approval workflow state and can't be edited directly. " +
            "If it has been Approved, create a new revision instead. " +
            "If it has been Submitted for Review, wait for the admin to approve or return it.",
        },
        { status: 403 },
      );
    }
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  // If clientId/reportNumber changing, check for duplicates
  const newClientId = body.clientId ?? existing.clientId;
  const newReportNumber = (body.reportNumber ?? existing.reportNumber).trim();
  if (newClientId !== existing.clientId || newReportNumber !== existing.reportNumber) {
    const dupe = await db.pipelineInspection.findUnique({
      where: { clientId_reportNumber: { clientId: newClientId, reportNumber: newReportNumber } },
    });
    if (dupe && dupe.id !== id) {
      return NextResponse.json(
        { error: `Report number '${newReportNumber}' already exists for this client` },
        { status: 409 },
      );
    }
  }

  // Plant must belong to client
  if (body.plantId) {
    const plant = await db.plant.findUnique({ where: { id: body.plantId } });
    if (!plant || plant.clientId !== newClientId) {
      return NextResponse.json(
        { error: "Plant does not belong to the selected client" },
        { status: 400 },
      );
    }
  }

  const updated = await db.pipelineInspection.update({
    where: { id },
    data: {
      reportNumber: newReportNumber,
      // NOTE: reportType is intentionally NOT updatable via PUT.
      // Once a report is created with a specific type, the type is fixed
      // — the form fields, PDF template, and revision history all depend
      // on it. To change the type, the user must delete the report and
      // create a new one of the correct type.
      clientId: newClientId,
      plantId: body.plantId ?? existing.plantId,
      inspectionArea: body.inspectionArea ?? existing.inspectionArea,
      pipelineDescription: body.pipelineDescription ?? existing.pipelineDescription,
      pipelineIdentificationNumber: body.pipelineIdentificationNumber ?? existing.pipelineIdentificationNumber,
      isometricDrawingNumber: body.isometricDrawingNumber ?? existing.isometricDrawingNumber,
      materialOfConstruction: body.materialOfConstruction ?? existing.materialOfConstruction,
      applicableStandard: body.applicableStandard ?? existing.applicableStandard,
      standardEdition: body.standardEdition ?? existing.standardEdition,
      inspectionDate: body.inspectionDate ? new Date(body.inspectionDate) : existing.inspectionDate,
      fromDate: body.fromDate !== undefined ? (body.fromDate ? new Date(body.fromDate) : null) : existing.fromDate,
      toDate: body.toDate !== undefined ? (body.toDate ? new Date(body.toDate) : null) : existing.toDate,
      primaryPhotoPath: body.primaryPhotoPath !== undefined ? (body.primaryPhotoPath || null) : existing.primaryPhotoPath,
      findingsSummary: body.findingsSummary ?? existing.findingsSummary,
      comments: body.comments ?? existing.comments,
      inspectionDescription: body.inspectionDescription ?? existing.inspectionDescription,
      customColumns: body.customColumns ?? existing.customColumns,
      // ─── MULTI-THICKNESS-TABLE CONFIG ───
      // JSON array of {id,label,sortOrder}. Additive & optional — null/empty
      // falls back to a single default table on read.
      thicknessTablesConfig:
        body.thicknessTablesConfig !== undefined
          ? (typeof body.thicknessTablesConfig === "string" ? body.thicknessTablesConfig : null)
          : existing.thicknessTablesConfig,
      photos: body.photos ?? existing.photos,
      // ─── PIPELINE CONDITION fields (updated only when the form sends them;
      // the thickness/visual forms don't send these keys so the existing
      // values are preserved) ───
      pipelineAgeYears:
        typeof body.pipelineAgeYears === "number"
          ? body.pipelineAgeYears
          : body.pipelineAgeYears === null
            ? null
            : existing.pipelineAgeYears,
      serviceFluid: body.serviceFluid !== undefined ? (body.serviceFluid?.trim() || null) : existing.serviceFluid,
      operatingCondition: body.operatingCondition !== undefined ? (body.operatingCondition?.trim() || null) : existing.operatingCondition,
      overallConditionRating: body.overallConditionRating !== undefined ? (body.overallConditionRating?.trim() || null) : existing.overallConditionRating,
      corrosionCondition: body.corrosionCondition !== undefined ? (body.corrosionCondition?.trim() || null) : existing.corrosionCondition,
      damageAssessment: body.damageAssessment !== undefined ? (body.damageAssessment?.trim() || null) : existing.damageAssessment,
      previousInspectionRef: body.previousInspectionRef !== undefined ? (body.previousInspectionRef?.trim() || null) : existing.previousInspectionRef,
      currentInspectionFindings: body.currentInspectionFindings !== undefined ? (body.currentInspectionFindings?.trim() || null) : existing.currentInspectionFindings,
      riskPriorityLevel: body.riskPriorityLevel !== undefined ? (body.riskPriorityLevel?.trim() || null) : existing.riskPriorityLevel,
      recommendations: body.recommendations !== undefined ? (body.recommendations?.trim() || null) : existing.recommendations,
      nextInspectionRecommendation: body.nextInspectionRecommendation !== undefined ? (body.nextInspectionRecommendation?.trim() || null) : existing.nextInspectionRecommendation,
      // ─── NEW REPORT SECTIONS (all report types) ───
      siteObservationSummary: body.siteObservationSummary !== undefined ? (body.siteObservationSummary?.trim() || null) : existing.siteObservationSummary,
      results: body.results !== undefined ? (body.results?.trim() || null) : existing.results,
      conclusion: body.conclusion !== undefined ? (body.conclusion?.trim() || null) : existing.conclusion,
      // ─── SIGN-OFF FIELDS ───
      inspectorName: body.inspectorName !== undefined ? (body.inspectorName?.trim() || null) : existing.inspectorName,
      approvedByName: body.approvedByName !== undefined ? (body.approvedByName?.trim() || null) : existing.approvedByName,
      inspectorDesignation: body.inspectorDesignation !== undefined ? (body.inspectorDesignation?.trim() || null) : existing.inspectorDesignation,
      secondReviewedByName: body.secondReviewedByName !== undefined ? (body.secondReviewedByName?.trim() || null) : existing.secondReviewedByName,
      secondReviewedByDesignation: body.secondReviewedByDesignation !== undefined ? (body.secondReviewedByDesignation?.trim() || null) : existing.secondReviewedByDesignation,
      secondReviewedAt: body.secondReviewedAt !== undefined ? (body.secondReviewedAt ? new Date(body.secondReviewedAt) : null) : existing.secondReviewedAt,
      approvedByDesignation: body.approvedByDesignation !== undefined ? (body.approvedByDesignation?.trim() || null) : existing.approvedByDesignation,
      // ─── DPT / DPPT FIELDS ───
      dptDateOfExamination: body.dptDateOfExamination !== undefined ? (body.dptDateOfExamination ? new Date(body.dptDateOfExamination) : null) : existing.dptDateOfExamination,
      dptSolventCleaner: body.dptSolventCleaner !== undefined ? (body.dptSolventCleaner?.trim() || null) : existing.dptSolventCleaner,
      dptPenetrant: body.dptPenetrant !== undefined ? (body.dptPenetrant?.trim() || null) : existing.dptPenetrant,
      dptDeveloper: body.dptDeveloper !== undefined ? (body.dptDeveloper?.trim() || null) : existing.dptDeveloper,
      dptCustomColumns: body.dptCustomColumns !== undefined ? body.dptCustomColumns : existing.dptCustomColumns,
      // ─── DYE PENETRANT PROCEDURE FIELDS (16 typeable fields) ───
      dptTestingStandard: body.dptTestingStandard !== undefined ? (body.dptTestingStandard?.trim() || null) : existing.dptTestingStandard,
      dptAcceptanceCriteria: body.dptAcceptanceCriteria !== undefined ? (body.dptAcceptanceCriteria?.trim() || null) : existing.dptAcceptanceCriteria,
      dptSurfacePreparation: body.dptSurfacePreparation !== undefined ? (body.dptSurfacePreparation?.trim() || null) : existing.dptSurfacePreparation,
      dptSurfaceTemperature: body.dptSurfaceTemperature !== undefined ? (body.dptSurfaceTemperature?.trim() || null) : existing.dptSurfaceTemperature,
      dptPenetrantType: body.dptPenetrantType !== undefined ? (body.dptPenetrantType?.trim() || null) : existing.dptPenetrantType,
      dptPenetrantProcess: body.dptPenetrantProcess !== undefined ? (body.dptPenetrantProcess?.trim() || null) : existing.dptPenetrantProcess,
      dptMethodOfPreCleaning: body.dptMethodOfPreCleaning !== undefined ? (body.dptMethodOfPreCleaning?.trim() || null) : existing.dptMethodOfPreCleaning,
      dptDryingTimeAfterPreCleaning: body.dptDryingTimeAfterPreCleaning !== undefined ? (body.dptDryingTimeAfterPreCleaning?.trim() || null) : existing.dptDryingTimeAfterPreCleaning,
      dptMethodOfApplyingPenetrant: body.dptMethodOfApplyingPenetrant !== undefined ? (body.dptMethodOfApplyingPenetrant?.trim() || null) : existing.dptMethodOfApplyingPenetrant,
      dptPenetratingTime: body.dptPenetratingTime !== undefined ? (body.dptPenetratingTime?.trim() || null) : existing.dptPenetratingTime,
      dptMethodOfRemovingExcessPenetrant: body.dptMethodOfRemovingExcessPenetrant !== undefined ? (body.dptMethodOfRemovingExcessPenetrant?.trim() || null) : existing.dptMethodOfRemovingExcessPenetrant,
      dptMethodOfApplyingDeveloper: body.dptMethodOfApplyingDeveloper !== undefined ? (body.dptMethodOfApplyingDeveloper?.trim() || null) : existing.dptMethodOfApplyingDeveloper,
      dptDevelopmentTime: body.dptDevelopmentTime !== undefined ? (body.dptDevelopmentTime?.trim() || null) : existing.dptDevelopmentTime,
      dptInterpretationTime: body.dptInterpretationTime !== undefined ? (body.dptInterpretationTime?.trim() || null) : existing.dptInterpretationTime,
      dptLightingEquipment: body.dptLightingEquipment !== undefined ? (body.dptLightingEquipment?.trim() || null) : existing.dptLightingEquipment,
      dptPostCleaning: body.dptPostCleaning !== undefined ? (body.dptPostCleaning?.trim() || null) : existing.dptPostCleaning,
      // ─── MPT (MAGNETIC PARTICLE TESTING) FIELDS ───
      mptDateOfExamination: body.mptDateOfExamination !== undefined ? (body.mptDateOfExamination ? new Date(body.mptDateOfExamination) : null) : existing.mptDateOfExamination,
      mptTestingStandard: body.mptTestingStandard !== undefined ? (body.mptTestingStandard?.trim() || null) : existing.mptTestingStandard,
      mptAcceptanceCriteria: body.mptAcceptanceCriteria !== undefined ? (body.mptAcceptanceCriteria?.trim() || null) : existing.mptAcceptanceCriteria,
      mptSurfacePreparation: body.mptSurfacePreparation !== undefined ? (body.mptSurfacePreparation?.trim() || null) : existing.mptSurfacePreparation,
      mptSurfaceTemperature: body.mptSurfaceTemperature !== undefined ? (body.mptSurfaceTemperature?.trim() || null) : existing.mptSurfaceTemperature,
      mptInstrumentSerialNo: body.mptInstrumentSerialNo !== undefined ? (body.mptInstrumentSerialNo?.trim() || null) : existing.mptInstrumentSerialNo,
      mptCalibrationDate: body.mptCalibrationDate !== undefined ? (body.mptCalibrationDate ? new Date(body.mptCalibrationDate) : null) : existing.mptCalibrationDate,
      mptMethod: body.mptMethod !== undefined ? (body.mptMethod?.trim() || null) : existing.mptMethod,
      mptTypeOfCurrent: body.mptTypeOfCurrent !== undefined ? (body.mptTypeOfCurrent?.trim() || null) : existing.mptTypeOfCurrent,
      mptAcYokeLiftingCapacity: body.mptAcYokeLiftingCapacity !== undefined ? (body.mptAcYokeLiftingCapacity?.trim() || null) : existing.mptAcYokeLiftingCapacity,
      mptContrastMedium: body.mptContrastMedium !== undefined ? (body.mptContrastMedium?.trim() || null) : existing.mptContrastMedium,
      mptMethodOfPreCleaning: body.mptMethodOfPreCleaning !== undefined ? (body.mptMethodOfPreCleaning?.trim() || null) : existing.mptMethodOfPreCleaning,
      mptMethodOfApplyingWhiteContrast: body.mptMethodOfApplyingWhiteContrast !== undefined ? (body.mptMethodOfApplyingWhiteContrast?.trim() || null) : existing.mptMethodOfApplyingWhiteContrast,
      mptAcYokePoleSpacing: body.mptAcYokePoleSpacing !== undefined ? (body.mptAcYokePoleSpacing?.trim() || null) : existing.mptAcYokePoleSpacing,
      mptMagneticMedium: body.mptMagneticMedium !== undefined ? (body.mptMagneticMedium?.trim() || null) : existing.mptMagneticMedium,
      mptMethodOfApplyingMagneticMedium: body.mptMethodOfApplyingMagneticMedium !== undefined ? (body.mptMethodOfApplyingMagneticMedium?.trim() || null) : existing.mptMethodOfApplyingMagneticMedium,
      mptDevelopmentTime: body.mptDevelopmentTime !== undefined ? (body.mptDevelopmentTime?.trim() || null) : existing.mptDevelopmentTime,
      mptInterpretationTime: body.mptInterpretationTime !== undefined ? (body.mptInterpretationTime?.trim() || null) : existing.mptInterpretationTime,
      mptLightingEquipment: body.mptLightingEquipment !== undefined ? (body.mptLightingEquipment?.trim() || null) : existing.mptLightingEquipment,
      mptPostCleaning: body.mptPostCleaning !== undefined ? (body.mptPostCleaning?.trim() || null) : existing.mptPostCleaning,
      mptWhiteContrast: body.mptWhiteContrast !== undefined ? (body.mptWhiteContrast?.trim() || null) : existing.mptWhiteContrast,
      mptWetParticleIronInk: body.mptWetParticleIronInk !== undefined ? (body.mptWetParticleIronInk?.trim() || null) : existing.mptWetParticleIronInk,
      mptCustomColumns: body.mptCustomColumns !== undefined ? body.mptCustomColumns : existing.mptCustomColumns,
      // ─── UT (ULTRASONIC TEST) FIELDS ───
      utSubContract: body.utSubContract !== undefined ? (body.utSubContract?.trim() || null) : existing.utSubContract,
      utProject: body.utProject !== undefined ? (body.utProject?.trim() || null) : existing.utProject,
      utJobLocation: body.utJobLocation !== undefined ? (body.utJobLocation?.trim() || null) : existing.utJobLocation,
      utJobDescription: body.utJobDescription !== undefined ? (body.utJobDescription?.trim() || null) : existing.utJobDescription,
      utMaterial: body.utMaterial !== undefined ? (body.utMaterial?.trim() || null) : existing.utMaterial,
      utCouplant: body.utCouplant !== undefined ? (body.utCouplant?.trim() || null) : existing.utCouplant,
      utReferenceDocuments: body.utReferenceDocuments !== undefined ? (body.utReferenceDocuments?.trim() || null) : existing.utReferenceDocuments,
      utProcedureNo: body.utProcedureNo !== undefined ? (body.utProcedureNo?.trim() || null) : existing.utProcedureNo,
      utAcceptanceStandard: body.utAcceptanceStandard !== undefined ? (body.utAcceptanceStandard?.trim() || null) : existing.utAcceptanceStandard,
      utUfdDetails: body.utUfdDetails !== undefined ? (body.utUfdDetails ?? null) : existing.utUfdDetails,
      utCalibrationBlock: body.utCalibrationBlock !== undefined ? (body.utCalibrationBlock?.trim() || null) : existing.utCalibrationBlock,
      utExtentOfExamination: body.utExtentOfExamination !== undefined ? (body.utExtentOfExamination?.trim() || null) : existing.utExtentOfExamination,
      utSurfaceCondition: body.utSurfaceCondition !== undefined ? (body.utSurfaceCondition?.trim() || null) : existing.utSurfaceCondition,
      utReferenceLevel: body.utReferenceLevel !== undefined ? (body.utReferenceLevel?.trim() || null) : existing.utReferenceLevel,
      utFlawSizingTechnique: body.utFlawSizingTechnique !== undefined ? (body.utFlawSizingTechnique?.trim() || null) : existing.utFlawSizingTechnique,
      utInspectionNote: body.utInspectionNote !== undefined ? (body.utInspectionNote ?? null) : existing.utInspectionNote,
      utEquipmentRows: body.utEquipmentRows !== undefined ? body.utEquipmentRows : existing.utEquipmentRows,
      utProbeRows: body.utProbeRows !== undefined ? body.utProbeRows : existing.utProbeRows,
      utTestResultRows: body.utTestResultRows !== undefined ? body.utTestResultRows : existing.utTestResultRows,
      utCustomColumns: body.utCustomColumns !== undefined ? body.utCustomColumns : existing.utCustomColumns,
      // ─── WELD SCAN FIELDS ───
      wsScanningCalibrationBlock: body.wsScanningCalibrationBlock !== undefined ? (body.wsScanningCalibrationBlock?.trim() || null) : existing.wsScanningCalibrationBlock,
      wsScanningReferenceLevel: body.wsScanningReferenceLevel !== undefined ? (body.wsScanningReferenceLevel?.trim() || null) : existing.wsScanningReferenceLevel,
      wsScanningExtentOfExamination: body.wsScanningExtentOfExamination !== undefined ? (body.wsScanningExtentOfExamination?.trim() || null) : existing.wsScanningExtentOfExamination,
      wsScanningSurfaceCondition: body.wsScanningSurfaceCondition !== undefined ? (body.wsScanningSurfaceCondition?.trim() || null) : existing.wsScanningSurfaceCondition,
      wsScanningFlawSizingTechnique: body.wsScanningFlawSizingTechnique !== undefined ? (body.wsScanningFlawSizingTechnique?.trim() || null) : existing.wsScanningFlawSizingTechnique,
      wsInstrumentRows: body.wsInstrumentRows !== undefined ? body.wsInstrumentRows : existing.wsInstrumentRows,
      wsProbeRows: body.wsProbeRows !== undefined ? body.wsProbeRows : existing.wsProbeRows,
      wsTestResultRows: body.wsTestResultRows !== undefined ? body.wsTestResultRows : existing.wsTestResultRows,
      // ─── EQUIPMENT TYPE + VESSEL ORIENTATION ───
      // Only updated when the form explicitly sends them; existing values
      // are preserved otherwise. vesselOrientation stays constrained to
      // HORIZONTAL | VERTICAL.
      equipmentType:
        body.equipmentType !== undefined
          ? (body.equipmentType === "PIPING" || body.equipmentType === "VESSEL" ? body.equipmentType : null)
          : existing.equipmentType,
      vesselOrientation:
        body.vesselOrientation !== undefined
          ? (body.vesselOrientation === "HORIZONTAL" || body.vesselOrientation === "VERTICAL" ? body.vesselOrientation : null)
          : existing.vesselOrientation,
      // ─── VESSEL DPT CONSUMABLE DETAILS (Make / Product / Batch / Expiry) ───
      vdptSolventMake: body.vdptSolventMake !== undefined ? (body.vdptSolventMake?.trim() || null) : existing.vdptSolventMake,
      vdptSolventProduct: body.vdptSolventProduct !== undefined ? (body.vdptSolventProduct?.trim() || null) : existing.vdptSolventProduct,
      vdptSolventBatchNo: body.vdptSolventBatchNo !== undefined ? (body.vdptSolventBatchNo?.trim() || null) : existing.vdptSolventBatchNo,
      vdptSolventExpiry: body.vdptSolventExpiry !== undefined ? (body.vdptSolventExpiry?.trim() || null) : existing.vdptSolventExpiry,
      vdptPenetrantMake: body.vdptPenetrantMake !== undefined ? (body.vdptPenetrantMake?.trim() || null) : existing.vdptPenetrantMake,
      vdptPenetrantProduct: body.vdptPenetrantProduct !== undefined ? (body.vdptPenetrantProduct?.trim() || null) : existing.vdptPenetrantProduct,
      vdptPenetrantBatchNo: body.vdptPenetrantBatchNo !== undefined ? (body.vdptPenetrantBatchNo?.trim() || null) : existing.vdptPenetrantBatchNo,
      vdptPenetrantExpiry: body.vdptPenetrantExpiry !== undefined ? (body.vdptPenetrantExpiry?.trim() || null) : existing.vdptPenetrantExpiry,
      vdptDeveloperMake: body.vdptDeveloperMake !== undefined ? (body.vdptDeveloperMake?.trim() || null) : existing.vdptDeveloperMake,
      vdptDeveloperProduct: body.vdptDeveloperProduct !== undefined ? (body.vdptDeveloperProduct?.trim() || null) : existing.vdptDeveloperProduct,
      vdptDeveloperBatchNo: body.vdptDeveloperBatchNo !== undefined ? (body.vdptDeveloperBatchNo?.trim() || null) : existing.vdptDeveloperBatchNo,
      vdptDeveloperExpiry: body.vdptDeveloperExpiry !== undefined ? (body.vdptDeveloperExpiry?.trim() || null) : existing.vdptDeveloperExpiry,
    },
  });

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "UPDATE", entity: "PipelineInspection", entityId: updated.id,
    details: `Updated pipeline report header ${updated.reportNumber} (status: ${existing.status})`,
  });

  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const existing = await db.pipelineInspection.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // PERMISSION: only the owner can delete their own Draft reports. Admins
  // can delete any report. Submitted/Approved reports are protected from
  // deletion — they must be archived through the workflow instead.
  const isAdmin = session.dashboardRole === "ADMIN";
  if (!isAdmin) {
    if (existing.inspectorId !== session.id) {
      return NextResponse.json(
        { error: "Forbidden — you can only delete your own reports" },
        { status: 403 },
      );
    }
    if (existing.status !== "Draft" && existing.status !== "Returned for Revision") {
      return NextResponse.json(
        {
          error:
            "Can only delete reports in Draft or Returned for Revision state. " +
            "Submitted or Approved reports must be archived through the workflow.",
        },
        { status: 403 },
      );
    }
  }

  await db.pipelineInspection.delete({ where: { id } });
  await recordAudit({
    userId: session.id, userName: session.name,
    action: "DELETE", entity: "PipelineInspection", entityId: id,
    details: `Deleted pipeline report ${existing.reportNumber}`,
  });
  return NextResponse.json({ ok: true });
}
