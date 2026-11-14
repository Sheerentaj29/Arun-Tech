// GET    /api/pipeline-inspections/[id] - get full inspection with measurements + revisions
// PUT    /api/pipeline-inspections/[id] - update header fields (role-gated)
// DELETE /api/pipeline-inspections/[id] - delete entire report (admin only)

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { normalizeVutmRows } from "@/lib/vutm-rows";

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
      // are preserved otherwise. vesselOrientation is updatable ONLY for
      // VESSEL_UTM reports (the only module with an orientation); other
      // report types keep their existing value untouched.
      equipmentType:
        body.equipmentType !== undefined
          ? (body.equipmentType === "PIPING" ||
             body.equipmentType === "VESSEL" ||
             body.equipmentType === "TANK"
              ? body.equipmentType
              : null)
          : existing.equipmentType,
      vesselOrientation:
        existing.reportType === "VESSEL_UTM" &&
        body.vesselOrientation !== undefined &&
        (body.vesselOrientation === "HORIZONTAL" || body.vesselOrientation === "VERTICAL")
          ? body.vesselOrientation
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
      // ─── VESSEL MPT CONSUMABLE DETAILS + TESTING DETAILS ROWS ───
      vmptWhiteContrastMake: body.vmptWhiteContrastMake !== undefined ? (body.vmptWhiteContrastMake?.trim() || null) : existing.vmptWhiteContrastMake,
      vmptWhiteContrastProduct: body.vmptWhiteContrastProduct !== undefined ? (body.vmptWhiteContrastProduct?.trim() || null) : existing.vmptWhiteContrastProduct,
      vmptWhiteContrastLotNo: body.vmptWhiteContrastLotNo !== undefined ? (body.vmptWhiteContrastLotNo?.trim() || null) : existing.vmptWhiteContrastLotNo,
      vmptWhiteContrastExpiry: body.vmptWhiteContrastExpiry !== undefined ? (body.vmptWhiteContrastExpiry?.trim() || null) : existing.vmptWhiteContrastExpiry,
      vmptInkMake: body.vmptInkMake !== undefined ? (body.vmptInkMake?.trim() || null) : existing.vmptInkMake,
      vmptInkProduct: body.vmptInkProduct !== undefined ? (body.vmptInkProduct?.trim() || null) : existing.vmptInkProduct,
      vmptInkLotNo: body.vmptInkLotNo !== undefined ? (body.vmptInkLotNo?.trim() || null) : existing.vmptInkLotNo,
      vmptInkExpiry: body.vmptInkExpiry !== undefined ? (body.vmptInkExpiry?.trim() || null) : existing.vmptInkExpiry,
      vmptRows: body.vmptRows !== undefined ? (typeof body.vmptRows === "string" ? body.vmptRows : null) : existing.vmptRows,
      // ─── VESSEL WELD SCAN FIELDS (reportType = VESSEL_WELD_SCAN) ───
      // Completely separate from the Piping Weld Scan ws* fields above —
      // the piping Weld Scan keeps its original storage and layout.
      vwsDateOfExamination: body.vwsDateOfExamination !== undefined ? (body.vwsDateOfExamination ? new Date(body.vwsDateOfExamination) : null) : existing.vwsDateOfExamination,
      vwsTestingStandard: body.vwsTestingStandard !== undefined ? (body.vwsTestingStandard?.trim() || null) : existing.vwsTestingStandard,
      vwsAcceptanceCriteria: body.vwsAcceptanceCriteria !== undefined ? (body.vwsAcceptanceCriteria?.trim() || null) : existing.vwsAcceptanceCriteria,
      vwsUtProcedure: body.vwsUtProcedure !== undefined ? (body.vwsUtProcedure?.trim() || null) : existing.vwsUtProcedure,
      vwsEquipmentMake: body.vwsEquipmentMake !== undefined ? (body.vwsEquipmentMake?.trim() || null) : existing.vwsEquipmentMake,
      vwsEquipmentModel: body.vwsEquipmentModel !== undefined ? (body.vwsEquipmentModel?.trim() || null) : existing.vwsEquipmentModel,
      vwsEquipmentSerialNo: body.vwsEquipmentSerialNo !== undefined ? (body.vwsEquipmentSerialNo?.trim() || null) : existing.vwsEquipmentSerialNo,
      vwsCalibrationDueDate: body.vwsCalibrationDueDate !== undefined ? (body.vwsCalibrationDueDate ? new Date(body.vwsCalibrationDueDate) : null) : existing.vwsCalibrationDueDate,
      vwsCableLength: body.vwsCableLength !== undefined ? (body.vwsCableLength?.trim() || null) : existing.vwsCableLength,
      vwsCableType: body.vwsCableType !== undefined ? (body.vwsCableType?.trim() || null) : existing.vwsCableType,
      vwsProbeDetails: body.vwsProbeDetails !== undefined ? (typeof body.vwsProbeDetails === "string" ? body.vwsProbeDetails : null) : existing.vwsProbeDetails,
      vwsCalibrationBlock: body.vwsCalibrationBlock !== undefined ? (body.vwsCalibrationBlock?.trim() || null) : existing.vwsCalibrationBlock,
      vwsCalibrationBlockMoc: body.vwsCalibrationBlockMoc !== undefined ? (body.vwsCalibrationBlockMoc?.trim() || null) : existing.vwsCalibrationBlockMoc,
      vwsReferenceReflector: body.vwsReferenceReflector !== undefined ? (body.vwsReferenceReflector?.trim() || null) : existing.vwsReferenceReflector,
      vwsReferenceLevel: body.vwsReferenceLevel !== undefined ? (body.vwsReferenceLevel?.trim() || null) : existing.vwsReferenceLevel,
      vwsFlawSizingTechnique: body.vwsFlawSizingTechnique !== undefined ? (body.vwsFlawSizingTechnique?.trim() || null) : existing.vwsFlawSizingTechnique,
      vwsSurfaceTemperature: body.vwsSurfaceTemperature !== undefined ? (body.vwsSurfaceTemperature?.trim() || null) : existing.vwsSurfaceTemperature,
      vwsTestingMethod: body.vwsTestingMethod !== undefined ? (body.vwsTestingMethod?.trim() || null) : existing.vwsTestingMethod,
      vwsCouplant: body.vwsCouplant !== undefined ? (body.vwsCouplant?.trim() || null) : existing.vwsCouplant,
      vwsSurfacePreparation: body.vwsSurfacePreparation !== undefined ? (body.vwsSurfacePreparation?.trim() || null) : existing.vwsSurfacePreparation,
      vwsSurfaceFinish: body.vwsSurfaceFinish !== undefined ? (body.vwsSurfaceFinish?.trim() || null) : existing.vwsSurfaceFinish,
      vwsExtentOfScanning: body.vwsExtentOfScanning !== undefined ? (body.vwsExtentOfScanning?.trim() || null) : existing.vwsExtentOfScanning,
      vwsDetailRows: body.vwsDetailRows !== undefined ? (typeof body.vwsDetailRows === "string" ? body.vwsDetailRows : null) : existing.vwsDetailRows,
      // ─── VESSEL UT THICKNESS MEASUREMENT FIELDS (reportType = VESSEL_UTM) ───
      // Completely separate from the Piping Thickness Measurement
      // (PIPELINE_THICKNESS / ThicknessMeasurement table) and from the
      // Vessel Weld Scan vws* fields above. Minimum Measured Thickness is
      // recomputed server-side from the spot readings, never trusted from
      // the payload. The shell-row shape follows the report's orientation
      // (the orientation currently being saved, falling back to the
      // stored one).
      vutmDateOfExamination: body.vutmDateOfExamination !== undefined ? (body.vutmDateOfExamination ? new Date(body.vutmDateOfExamination) : null) : existing.vutmDateOfExamination,
      vutmTestingStandard: body.vutmTestingStandard !== undefined ? (body.vutmTestingStandard?.trim() || null) : existing.vutmTestingStandard,
      vutmAcceptanceCriteria: body.vutmAcceptanceCriteria !== undefined ? (body.vutmAcceptanceCriteria?.trim() || null) : existing.vutmAcceptanceCriteria,
      vutmUtProcedure: body.vutmUtProcedure !== undefined ? (body.vutmUtProcedure?.trim() || null) : existing.vutmUtProcedure,
      vutmEquipmentMake: body.vutmEquipmentMake !== undefined ? (body.vutmEquipmentMake?.trim() || null) : existing.vutmEquipmentMake,
      vutmEquipmentModel: body.vutmEquipmentModel !== undefined ? (body.vutmEquipmentModel?.trim() || null) : existing.vutmEquipmentModel,
      vutmEquipmentSerialNo: body.vutmEquipmentSerialNo !== undefined ? (body.vutmEquipmentSerialNo?.trim() || null) : existing.vutmEquipmentSerialNo,
      vutmCalibrationDueDate: body.vutmCalibrationDueDate !== undefined ? (body.vutmCalibrationDueDate ? new Date(body.vutmCalibrationDueDate) : null) : existing.vutmCalibrationDueDate,
      vutmCableLengthAndType: body.vutmCableLengthAndType !== undefined ? (body.vutmCableLengthAndType?.trim() || null) : existing.vutmCableLengthAndType,
      vutmLwProbeRows: body.vutmLwProbeRows !== undefined ? (typeof body.vutmLwProbeRows === "string" ? body.vutmLwProbeRows : null) : existing.vutmLwProbeRows,
      vutmTypeOfCrystal: body.vutmTypeOfCrystal !== undefined ? (body.vutmTypeOfCrystal?.trim() || null) : existing.vutmTypeOfCrystal,
      vutmCalibrationBlock: body.vutmCalibrationBlock !== undefined ? (body.vutmCalibrationBlock?.trim() || null) : existing.vutmCalibrationBlock,
      vutmSurfaceTemperature: body.vutmSurfaceTemperature !== undefined ? (body.vutmSurfaceTemperature?.trim() || null) : existing.vutmSurfaceTemperature,
      vutmMethod: body.vutmMethod !== undefined ? (body.vutmMethod?.trim() || null) : existing.vutmMethod,
      vutmCouplant: body.vutmCouplant !== undefined ? (body.vutmCouplant?.trim() || null) : existing.vutmCouplant,
      vutmSurfacePreparation: body.vutmSurfacePreparation !== undefined ? (body.vutmSurfacePreparation?.trim() || null) : existing.vutmSurfacePreparation,
      vutmSurfaceFinish: body.vutmSurfaceFinish !== undefined ? (body.vutmSurfaceFinish?.trim() || null) : existing.vutmSurfaceFinish,
      // Readings rows are normalized to the report's orientation shape
      // (VESSEL_UTM only): HORIZONTAL → clock rows, VERTICAL → direction
      // rows. The orientation sent by the form matches the stored one;
      // fall back to the stored value. The legacy dish/nozzle columns use
      // the same orientation so their rows convert consistently.
      vutmShellRows:
        body.vutmShellRows !== undefined
          ? normalizeVutmRows(
              body.vutmShellRows,
              (body.vesselOrientation === "VERTICAL" || body.vesselOrientation === "HORIZONTAL"
                ? body.vesselOrientation
                : (existing.vesselOrientation as string | null)) === "VERTICAL"
                ? "VERTICAL"
                : "HORIZONTAL",
            )
          : existing.vutmShellRows,
      vutmDishRows:
        body.vutmDishRows !== undefined
          ? normalizeVutmRows(
              body.vutmDishRows,
              (body.vesselOrientation === "VERTICAL" || body.vesselOrientation === "HORIZONTAL"
                ? body.vesselOrientation
                : (existing.vesselOrientation as string | null)) === "VERTICAL"
                ? "VERTICAL"
                : "HORIZONTAL",
            )
          : existing.vutmDishRows,
      vutmNozzleRows:
        body.vutmNozzleRows !== undefined
          ? normalizeVutmRows(
              body.vutmNozzleRows,
              (body.vesselOrientation === "VERTICAL" || body.vesselOrientation === "HORIZONTAL"
                ? body.vesselOrientation
                : (existing.vesselOrientation as string | null)) === "VERTICAL"
                ? "VERTICAL"
                : "HORIZONTAL",
            )
          : existing.vutmNozzleRows,
      // ─── TANK (STORAGE TANK) FIELDS (reportType = TANK_*) ───
      // Completely separate from the Vessel (vdpt*/vmpt*/vws*/vutm*) and
      // Piping field groups above — storage-tank reports never read or
      // write Vessel/Piping columns. Tank UT course/plate readings reuse
      // the generic clock-row normalizer (HORIZONTAL shape).
      tdptDateOfExamination: body.tdptDateOfExamination !== undefined ? (body.tdptDateOfExamination ? new Date(body.tdptDateOfExamination) : null) : existing.tdptDateOfExamination,
      tdptTestingStandard: body.tdptTestingStandard !== undefined ? (body.tdptTestingStandard?.trim() || null) : existing.tdptTestingStandard,
      tdptAcceptanceCriteria: body.tdptAcceptanceCriteria !== undefined ? (body.tdptAcceptanceCriteria?.trim() || null) : existing.tdptAcceptanceCriteria,
      tdptSurfacePreparation: body.tdptSurfacePreparation !== undefined ? (body.tdptSurfacePreparation?.trim() || null) : existing.tdptSurfacePreparation,
      tdptSurfaceTemperature: body.tdptSurfaceTemperature !== undefined ? (body.tdptSurfaceTemperature?.trim() || null) : existing.tdptSurfaceTemperature,
      tdptPenetrantType: body.tdptPenetrantType !== undefined ? (body.tdptPenetrantType?.trim() || null) : existing.tdptPenetrantType,
      tdptPenetrantProcess: body.tdptPenetrantProcess !== undefined ? (body.tdptPenetrantProcess?.trim() || null) : existing.tdptPenetrantProcess,
      tdptMethodOfPreCleaning: body.tdptMethodOfPreCleaning !== undefined ? (body.tdptMethodOfPreCleaning?.trim() || null) : existing.tdptMethodOfPreCleaning,
      tdptDryingTimeAfterPreCleaning: body.tdptDryingTimeAfterPreCleaning !== undefined ? (body.tdptDryingTimeAfterPreCleaning?.trim() || null) : existing.tdptDryingTimeAfterPreCleaning,
      tdptMethodOfApplyingPenetrant: body.tdptMethodOfApplyingPenetrant !== undefined ? (body.tdptMethodOfApplyingPenetrant?.trim() || null) : existing.tdptMethodOfApplyingPenetrant,
      tdptPenetratingTime: body.tdptPenetratingTime !== undefined ? (body.tdptPenetratingTime?.trim() || null) : existing.tdptPenetratingTime,
      tdptMethodOfRemovingExcessPenetrant: body.tdptMethodOfRemovingExcessPenetrant !== undefined ? (body.tdptMethodOfRemovingExcessPenetrant?.trim() || null) : existing.tdptMethodOfRemovingExcessPenetrant,
      tdptMethodOfApplyingDeveloper: body.tdptMethodOfApplyingDeveloper !== undefined ? (body.tdptMethodOfApplyingDeveloper?.trim() || null) : existing.tdptMethodOfApplyingDeveloper,
      tdptDevelopmentTime: body.tdptDevelopmentTime !== undefined ? (body.tdptDevelopmentTime?.trim() || null) : existing.tdptDevelopmentTime,
      tdptInterpretationTime: body.tdptInterpretationTime !== undefined ? (body.tdptInterpretationTime?.trim() || null) : existing.tdptInterpretationTime,
      tdptLightingEquipment: body.tdptLightingEquipment !== undefined ? (body.tdptLightingEquipment?.trim() || null) : existing.tdptLightingEquipment,
      tdptPostCleaning: body.tdptPostCleaning !== undefined ? (body.tdptPostCleaning?.trim() || null) : existing.tdptPostCleaning,
      tdptSolventMake: body.tdptSolventMake !== undefined ? (body.tdptSolventMake?.trim() || null) : existing.tdptSolventMake,
      tdptSolventProduct: body.tdptSolventProduct !== undefined ? (body.tdptSolventProduct?.trim() || null) : existing.tdptSolventProduct,
      tdptSolventBatchNo: body.tdptSolventBatchNo !== undefined ? (body.tdptSolventBatchNo?.trim() || null) : existing.tdptSolventBatchNo,
      tdptSolventExpiry: body.tdptSolventExpiry !== undefined ? (body.tdptSolventExpiry?.trim() || null) : existing.tdptSolventExpiry,
      tdptPenetrantMake: body.tdptPenetrantMake !== undefined ? (body.tdptPenetrantMake?.trim() || null) : existing.tdptPenetrantMake,
      tdptPenetrantProduct: body.tdptPenetrantProduct !== undefined ? (body.tdptPenetrantProduct?.trim() || null) : existing.tdptPenetrantProduct,
      tdptPenetrantBatchNo: body.tdptPenetrantBatchNo !== undefined ? (body.tdptPenetrantBatchNo?.trim() || null) : existing.tdptPenetrantBatchNo,
      tdptPenetrantExpiry: body.tdptPenetrantExpiry !== undefined ? (body.tdptPenetrantExpiry?.trim() || null) : existing.tdptPenetrantExpiry,
      tdptDeveloperMake: body.tdptDeveloperMake !== undefined ? (body.tdptDeveloperMake?.trim() || null) : existing.tdptDeveloperMake,
      tdptDeveloperProduct: body.tdptDeveloperProduct !== undefined ? (body.tdptDeveloperProduct?.trim() || null) : existing.tdptDeveloperProduct,
      tdptDeveloperBatchNo: body.tdptDeveloperBatchNo !== undefined ? (body.tdptDeveloperBatchNo?.trim() || null) : existing.tdptDeveloperBatchNo,
      tdptDeveloperExpiry: body.tdptDeveloperExpiry !== undefined ? (body.tdptDeveloperExpiry?.trim() || null) : existing.tdptDeveloperExpiry,
      tdptObservationRows: body.tdptObservationRows !== undefined ? (typeof body.tdptObservationRows === "string" ? body.tdptObservationRows : null) : existing.tdptObservationRows,
      tmptDateOfExamination: body.tmptDateOfExamination !== undefined ? (body.tmptDateOfExamination ? new Date(body.tmptDateOfExamination) : null) : existing.tmptDateOfExamination,
      tmptTestingStandard: body.tmptTestingStandard !== undefined ? (body.tmptTestingStandard?.trim() || null) : existing.tmptTestingStandard,
      tmptAcceptanceCriteria: body.tmptAcceptanceCriteria !== undefined ? (body.tmptAcceptanceCriteria?.trim() || null) : existing.tmptAcceptanceCriteria,
      tmptSurfacePreparation: body.tmptSurfacePreparation !== undefined ? (body.tmptSurfacePreparation?.trim() || null) : existing.tmptSurfacePreparation,
      tmptSurfaceTemperature: body.tmptSurfaceTemperature !== undefined ? (body.tmptSurfaceTemperature?.trim() || null) : existing.tmptSurfaceTemperature,
      tmptInstrumentSerialNo: body.tmptInstrumentSerialNo !== undefined ? (body.tmptInstrumentSerialNo?.trim() || null) : existing.tmptInstrumentSerialNo,
      tmptMethod: body.tmptMethod !== undefined ? (body.tmptMethod?.trim() || null) : existing.tmptMethod,
      tmptTypeOfCurrent: body.tmptTypeOfCurrent !== undefined ? (body.tmptTypeOfCurrent?.trim() || null) : existing.tmptTypeOfCurrent,
      tmptAcYokeLiftingCapacity: body.tmptAcYokeLiftingCapacity !== undefined ? (body.tmptAcYokeLiftingCapacity?.trim() || null) : existing.tmptAcYokeLiftingCapacity,
      tmptContrastMedium: body.tmptContrastMedium !== undefined ? (body.tmptContrastMedium?.trim() || null) : existing.tmptContrastMedium,
      tmptMethodOfPreCleaning: body.tmptMethodOfPreCleaning !== undefined ? (body.tmptMethodOfPreCleaning?.trim() || null) : existing.tmptMethodOfPreCleaning,
      tmptMethodOfApplyingWhiteContrast: body.tmptMethodOfApplyingWhiteContrast !== undefined ? (body.tmptMethodOfApplyingWhiteContrast?.trim() || null) : existing.tmptMethodOfApplyingWhiteContrast,
      tmptAcYokePoleSpacing: body.tmptAcYokePoleSpacing !== undefined ? (body.tmptAcYokePoleSpacing?.trim() || null) : existing.tmptAcYokePoleSpacing,
      tmptMagneticMedium: body.tmptMagneticMedium !== undefined ? (body.tmptMagneticMedium?.trim() || null) : existing.tmptMagneticMedium,
      tmptMethodOfApplyingMagneticMedium: body.tmptMethodOfApplyingMagneticMedium !== undefined ? (body.tmptMethodOfApplyingMagneticMedium?.trim() || null) : existing.tmptMethodOfApplyingMagneticMedium,
      tmptDevelopmentTime: body.tmptDevelopmentTime !== undefined ? (body.tmptDevelopmentTime?.trim() || null) : existing.tmptDevelopmentTime,
      tmptInterpretationTime: body.tmptInterpretationTime !== undefined ? (body.tmptInterpretationTime?.trim() || null) : existing.tmptInterpretationTime,
      tmptLightingEquipment: body.tmptLightingEquipment !== undefined ? (body.tmptLightingEquipment?.trim() || null) : existing.tmptLightingEquipment,
      tmptPostCleaning: body.tmptPostCleaning !== undefined ? (body.tmptPostCleaning?.trim() || null) : existing.tmptPostCleaning,
      tmptWhiteContrastMake: body.tmptWhiteContrastMake !== undefined ? (body.tmptWhiteContrastMake?.trim() || null) : existing.tmptWhiteContrastMake,
      tmptWhiteContrastProduct: body.tmptWhiteContrastProduct !== undefined ? (body.tmptWhiteContrastProduct?.trim() || null) : existing.tmptWhiteContrastProduct,
      tmptWhiteContrastLotNo: body.tmptWhiteContrastLotNo !== undefined ? (body.tmptWhiteContrastLotNo?.trim() || null) : existing.tmptWhiteContrastLotNo,
      tmptWhiteContrastExpiry: body.tmptWhiteContrastExpiry !== undefined ? (body.tmptWhiteContrastExpiry?.trim() || null) : existing.tmptWhiteContrastExpiry,
      tmptInkMake: body.tmptInkMake !== undefined ? (body.tmptInkMake?.trim() || null) : existing.tmptInkMake,
      tmptInkProduct: body.tmptInkProduct !== undefined ? (body.tmptInkProduct?.trim() || null) : existing.tmptInkProduct,
      tmptInkLotNo: body.tmptInkLotNo !== undefined ? (body.tmptInkLotNo?.trim() || null) : existing.tmptInkLotNo,
      tmptInkExpiry: body.tmptInkExpiry !== undefined ? (body.tmptInkExpiry?.trim() || null) : existing.tmptInkExpiry,
      tmptRows: body.tmptRows !== undefined ? (typeof body.tmptRows === "string" ? body.tmptRows : null) : existing.tmptRows,
      twsDateOfExamination: body.twsDateOfExamination !== undefined ? (body.twsDateOfExamination ? new Date(body.twsDateOfExamination) : null) : existing.twsDateOfExamination,
      twsTestingStandard: body.twsTestingStandard !== undefined ? (body.twsTestingStandard?.trim() || null) : existing.twsTestingStandard,
      twsAcceptanceCriteria: body.twsAcceptanceCriteria !== undefined ? (body.twsAcceptanceCriteria?.trim() || null) : existing.twsAcceptanceCriteria,
      twsUtProcedure: body.twsUtProcedure !== undefined ? (body.twsUtProcedure?.trim() || null) : existing.twsUtProcedure,
      twsEquipmentMake: body.twsEquipmentMake !== undefined ? (body.twsEquipmentMake?.trim() || null) : existing.twsEquipmentMake,
      twsEquipmentModel: body.twsEquipmentModel !== undefined ? (body.twsEquipmentModel?.trim() || null) : existing.twsEquipmentModel,
      twsEquipmentSerialNo: body.twsEquipmentSerialNo !== undefined ? (body.twsEquipmentSerialNo?.trim() || null) : existing.twsEquipmentSerialNo,
      twsCableLength: body.twsCableLength !== undefined ? (body.twsCableLength?.trim() || null) : existing.twsCableLength,
      twsCableType: body.twsCableType !== undefined ? (body.twsCableType?.trim() || null) : existing.twsCableType,
      twsCalibrationBlock: body.twsCalibrationBlock !== undefined ? (body.twsCalibrationBlock?.trim() || null) : existing.twsCalibrationBlock,
      twsCalibrationBlockMoc: body.twsCalibrationBlockMoc !== undefined ? (body.twsCalibrationBlockMoc?.trim() || null) : existing.twsCalibrationBlockMoc,
      twsReferenceReflector: body.twsReferenceReflector !== undefined ? (body.twsReferenceReflector?.trim() || null) : existing.twsReferenceReflector,
      twsReferenceLevel: body.twsReferenceLevel !== undefined ? (body.twsReferenceLevel?.trim() || null) : existing.twsReferenceLevel,
      twsFlawSizingTechnique: body.twsFlawSizingTechnique !== undefined ? (body.twsFlawSizingTechnique?.trim() || null) : existing.twsFlawSizingTechnique,
      twsSurfaceTemperature: body.twsSurfaceTemperature !== undefined ? (body.twsSurfaceTemperature?.trim() || null) : existing.twsSurfaceTemperature,
      twsTestingMethod: body.twsTestingMethod !== undefined ? (body.twsTestingMethod?.trim() || null) : existing.twsTestingMethod,
      twsCouplant: body.twsCouplant !== undefined ? (body.twsCouplant?.trim() || null) : existing.twsCouplant,
      twsSurfacePreparation: body.twsSurfacePreparation !== undefined ? (body.twsSurfacePreparation?.trim() || null) : existing.twsSurfacePreparation,
      twsSurfaceFinish: body.twsSurfaceFinish !== undefined ? (body.twsSurfaceFinish?.trim() || null) : existing.twsSurfaceFinish,
      twsExtentOfScanning: body.twsExtentOfScanning !== undefined ? (body.twsExtentOfScanning?.trim() || null) : existing.twsExtentOfScanning,
      twsProbeDetails: body.twsProbeDetails !== undefined ? (typeof body.twsProbeDetails === "string" ? body.twsProbeDetails : null) : existing.twsProbeDetails,
      twsDetailRows: body.twsDetailRows !== undefined ? (typeof body.twsDetailRows === "string" ? body.twsDetailRows : null) : existing.twsDetailRows,
      tutmDateOfExamination: body.tutmDateOfExamination !== undefined ? (body.tutmDateOfExamination ? new Date(body.tutmDateOfExamination) : null) : existing.tutmDateOfExamination,
      tutmTestingStandard: body.tutmTestingStandard !== undefined ? (body.tutmTestingStandard?.trim() || null) : existing.tutmTestingStandard,
      tutmAcceptanceCriteria: body.tutmAcceptanceCriteria !== undefined ? (body.tutmAcceptanceCriteria?.trim() || null) : existing.tutmAcceptanceCriteria,
      tutmUtProcedure: body.tutmUtProcedure !== undefined ? (body.tutmUtProcedure?.trim() || null) : existing.tutmUtProcedure,
      tutmEquipmentMake: body.tutmEquipmentMake !== undefined ? (body.tutmEquipmentMake?.trim() || null) : existing.tutmEquipmentMake,
      tutmEquipmentModel: body.tutmEquipmentModel !== undefined ? (body.tutmEquipmentModel?.trim() || null) : existing.tutmEquipmentModel,
      tutmEquipmentSerialNo: body.tutmEquipmentSerialNo !== undefined ? (body.tutmEquipmentSerialNo?.trim() || null) : existing.tutmEquipmentSerialNo,
      tutmCableLengthAndType: body.tutmCableLengthAndType !== undefined ? (body.tutmCableLengthAndType?.trim() || null) : existing.tutmCableLengthAndType,
      tutmTypeOfCrystal: body.tutmTypeOfCrystal !== undefined ? (body.tutmTypeOfCrystal?.trim() || null) : existing.tutmTypeOfCrystal,
      tutmCalibrationBlock: body.tutmCalibrationBlock !== undefined ? (body.tutmCalibrationBlock?.trim() || null) : existing.tutmCalibrationBlock,
      tutmSurfaceTemperature: body.tutmSurfaceTemperature !== undefined ? (body.tutmSurfaceTemperature?.trim() || null) : existing.tutmSurfaceTemperature,
      tutmMethod: body.tutmMethod !== undefined ? (body.tutmMethod?.trim() || null) : existing.tutmMethod,
      tutmCouplant: body.tutmCouplant !== undefined ? (body.tutmCouplant?.trim() || null) : existing.tutmCouplant,
      tutmSurfacePreparation: body.tutmSurfacePreparation !== undefined ? (body.tutmSurfacePreparation?.trim() || null) : existing.tutmSurfacePreparation,
      tutmSurfaceFinish: body.tutmSurfaceFinish !== undefined ? (body.tutmSurfaceFinish?.trim() || null) : existing.tutmSurfaceFinish,
      tutmLwProbeRows: body.tutmLwProbeRows !== undefined ? (typeof body.tutmLwProbeRows === "string" ? body.tutmLwProbeRows : null) : existing.tutmLwProbeRows,
      tutmPlateRows:
        body.tutmPlateRows !== undefined
          ? normalizeVutmRows(body.tutmPlateRows, "HORIZONTAL")
          : existing.tutmPlateRows,
      // ─── TANK WELD SCAN DATES: twsCalibrationDueDate handled with the
      // other date fields below ───
      twsCalibrationDueDate: body.twsCalibrationDueDate !== undefined ? (body.twsCalibrationDueDate ? new Date(body.twsCalibrationDueDate) : null) : existing.twsCalibrationDueDate,
      tutmCalibrationDueDate: body.tutmCalibrationDueDate !== undefined ? (body.tutmCalibrationDueDate ? new Date(body.tutmCalibrationDueDate) : null) : existing.tutmCalibrationDueDate,
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
