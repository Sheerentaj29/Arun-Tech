// GET  /api/pipeline-inspections - list with filters/pagination
// POST /api/pipeline-inspections - create new pipeline inspection report
//
// Role-based filtering:
//   - ADMIN sees ALL reports
//   - EMPLOYEE (or legacy INSPECTOR/APPROVER) sees ONLY their own reports
//
// Query params:
//   q          - search across reportNumber, pipelineDescription, pipelineIdentificationNumber, isometricDrawingNumber
//   clientId   - filter by client
//   plantId    - filter by plant
//   status     - filter by status (Draft, Submitted for Review, Returned for Revision, Approved, Changes Pending Review)
//   mine       - "true" forces filtering to current user's reports even for admins
//   page       - default 1
//   pageSize   - default 10

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { normalizeVutmRows } from "@/lib/vutm-rows";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const clientId = url.searchParams.get("clientId") ?? undefined;
  const plantId = url.searchParams.get("plantId") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  const mine = url.searchParams.get("mine") === "true";
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") ?? "10", 10) || 10));

  const where: Record<string, unknown> = {};

  // ROLE-BASED FILTERING: employees see only their own reports.
  // Admins see all reports unless they explicitly pass ?mine=true.
  const isAdmin = session.dashboardRole === "ADMIN";
  if (!isAdmin || mine) {
    where.inspectorId = session.id;
  }

  if (q) {
    where.OR = [
      { reportNumber: { contains: q } },
      { pipelineDescription: { contains: q } },
      { pipelineIdentificationNumber: { contains: q } },
      { isometricDrawingNumber: { contains: q } },
      { inspectionArea: { contains: q } },
    ];
  }
  if (clientId) where.clientId = clientId;
  if (plantId) where.plantId = plantId;
  if (status) where.status = status;

  const [items, total] = await Promise.all([
    db.pipelineInspection.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        client: { select: { id: true, name: true } },
        plant: { select: { id: true, name: true, location: true } },
        inspector: { select: { id: true, name: true } },
        approver: { select: { id: true, name: true } },
        returnedBy: { select: { id: true, name: true } },
        _count: {
          select: {
            measurements: true,
            revisions: true,
            visualObservations: true,
            dptObservations: true,
          },
        },
      },
    }),
    db.pipelineInspection.count({ where }),
  ]);

  return NextResponse.json({
    items, total, page, pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Both ADMIN and EMPLOYEE can create reports — admins can file reports
  // just like employees can. The session.inspectorId is set to the current
  // user so the ownership check works correctly downstream.
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const required = ["reportNumber", "clientId", "plantId"];
  for (const k of required) {
    if (!body[k] || typeof body[k] !== "string") {
      return NextResponse.json({ error: `Field '${k}' is required` }, { status: 400 });
    }
  }

  // Verify plant belongs to client
  const plant = await db.plant.findUnique({
    where: { id: body.plantId },
    include: { client: true },
  });
  if (!plant) return NextResponse.json({ error: "Plant not found" }, { status: 400 });
  if (plant.clientId !== body.clientId) {
    return NextResponse.json(
      { error: "Plant does not belong to the selected client" },
      { status: 400 },
    );
  }

  // Duplicate reportNumber within client
  const existing = await db.pipelineInspection.findUnique({
    where: { clientId_reportNumber: { clientId: body.clientId, reportNumber: body.reportNumber } },
  });
  if (existing) {
    return NextResponse.json(
      { error: `Report number '${body.reportNumber}' already exists for this client` },
      { status: 409 },
    );
  }

  const created = await db.pipelineInspection.create({
    data: {
      reportNumber: body.reportNumber.trim(),
      // Accept reportType from the form. Default to PIPELINE_THICKNESS for
      // backward compat (so existing API callers that don't send it still
      // create thickness reports as before). Accept the four active piping
      // types (PIPELINE_THICKNESS, PIPELINE_DPT, PIPELINE_MPT,
      // PIPELINE_WELD_SCAN), the vessel types (VESSEL_DPT, VESSEL_MPT),
      // and the two legacy types (PIPELINE_VISUAL, PIPELINE_CONDITION) so
      // existing reports of those types can still be created if needed.
      // NOTE: PIPELINE_UT (UT / Ultrasonic Test Report) was intentionally
      // removed and is NOT accepted — do not re-add it.
      reportType: [
        "PIPELINE_THICKNESS",
        "PIPELINE_DPT",
        "PIPELINE_MPT",
        "PIPELINE_WELD_SCAN",
        "VESSEL_DPT",
        "VESSEL_MPT",
        "VESSEL_WELD_SCAN",
        "VESSEL_UTM",
        "PIPELINE_VISUAL",
        "PIPELINE_CONDITION",
      ].includes(body.reportType)
        ? body.reportType
        : "PIPELINE_THICKNESS",
      // ─── EQUIPMENT TYPE ───
      // equipmentType: PIPING | VESSEL (from the selector flow).
      // vesselOrientation was removed from the application — new reports
      // never carry one (the column stays nullable for legacy rows).
      equipmentType: body.equipmentType === "PIPING" || body.equipmentType === "VESSEL"
        ? body.equipmentType
        : null,
      vesselOrientation: null,
      clientId: body.clientId,
      plantId: body.plantId,
      inspectionArea: body.inspectionArea?.trim() || null,
      pipelineDescription: body.pipelineDescription?.trim() || null,
      pipelineIdentificationNumber: body.pipelineIdentificationNumber?.trim() || null,
      isometricDrawingNumber: body.isometricDrawingNumber?.trim() || null,
      materialOfConstruction: body.materialOfConstruction?.trim() || null,
      applicableStandard: body.applicableStandard || null,
      standardEdition: body.standardEdition || null,
      inspectionDate: body.inspectionDate ? new Date(body.inspectionDate) : new Date(),
      fromDate: body.fromDate ? new Date(body.fromDate) : (body.inspectionDate ? new Date(body.inspectionDate) : new Date()),
      toDate: body.toDate ? new Date(body.toDate) : (body.inspectionDate ? new Date(body.inspectionDate) : new Date()),
      primaryPhotoPath: body.primaryPhotoPath ?? null,
      status: "Draft",
      inspectorId: session.id,
      findingsSummary: body.findingsSummary ?? null,
      comments: body.comments ?? null,
      inspectionDescription: body.inspectionDescription ?? null,
      customColumns: body.customColumns ?? "[]",
      photos: body.photos ?? null,
      // ─── MULTI-THICKNESS-TABLE CONFIG ───
      // The form always sends this on create (serialized list of
      // {id,label,sortOrder}). Without persisting it here, any extra
      // Thickness tables the user configured while creating the report
      // were silently dropped — the rows survived in their tableGroup,
      // but the table list itself was lost, so those tables (and their
      // rows) never appeared in the form or the Review page again.
      thicknessTablesConfig:
        typeof body.thicknessTablesConfig === "string"
          ? body.thicknessTablesConfig
          : null,
      // ─── PIPELINE CONDITION fields (only set when reportType = PIPELINE_CONDITION;
      // ignored for thickness/visual reports) ───
      pipelineAgeYears: typeof body.pipelineAgeYears === "number" ? body.pipelineAgeYears : null,
      serviceFluid: body.serviceFluid?.trim() || null,
      operatingCondition: body.operatingCondition?.trim() || null,
      overallConditionRating: body.overallConditionRating?.trim() || null,
      corrosionCondition: body.corrosionCondition?.trim() || null,
      damageAssessment: body.damageAssessment?.trim() || null,
      previousInspectionRef: body.previousInspectionRef?.trim() || null,
      currentInspectionFindings: body.currentInspectionFindings?.trim() || null,
      riskPriorityLevel: body.riskPriorityLevel?.trim() || null,
      recommendations: body.recommendations?.trim() || null,
      nextInspectionRecommendation: body.nextInspectionRecommendation?.trim() || null,
      // ─── NEW REPORT SECTIONS (all report types) ───
      siteObservationSummary: body.siteObservationSummary?.trim() || null,
      results: body.results?.trim() || null,
      conclusion: body.conclusion?.trim() || null,
      // ─── SIGN-OFF FIELDS ───
      inspectorName: body.inspectorName?.trim() || session.name,
      approvedByName: body.approvedByName?.trim() || null,
      inspectorDesignation: body.inspectorDesignation?.trim() || null,
      secondReviewedByName: body.secondReviewedByName?.trim() || null,
      secondReviewedByDesignation: body.secondReviewedByDesignation?.trim() || null,
      approvedByDesignation: body.approvedByDesignation?.trim() || null,
      // ─── DPT / DPPT FIELDS ───
      dptDateOfExamination: body.dptDateOfExamination ? new Date(body.dptDateOfExamination) : null,
      dptSolventCleaner: body.dptSolventCleaner?.trim() || null,
      dptPenetrant: body.dptPenetrant?.trim() || null,
      dptDeveloper: body.dptDeveloper?.trim() || null,
      dptCustomColumns: body.dptCustomColumns ?? "[]",
      // ─── DYE PENETRANT PROCEDURE FIELDS (16 typeable fields) ───
      dptTestingStandard: body.dptTestingStandard?.trim() || null,
      dptAcceptanceCriteria: body.dptAcceptanceCriteria?.trim() || null,
      dptSurfacePreparation: body.dptSurfacePreparation?.trim() || null,
      dptSurfaceTemperature: body.dptSurfaceTemperature?.trim() || null,
      dptPenetrantType: body.dptPenetrantType?.trim() || null,
      dptPenetrantProcess: body.dptPenetrantProcess?.trim() || null,
      dptMethodOfPreCleaning: body.dptMethodOfPreCleaning?.trim() || null,
      dptDryingTimeAfterPreCleaning: body.dptDryingTimeAfterPreCleaning?.trim() || null,
      dptMethodOfApplyingPenetrant: body.dptMethodOfApplyingPenetrant?.trim() || null,
      dptPenetratingTime: body.dptPenetratingTime?.trim() || null,
      dptMethodOfRemovingExcessPenetrant: body.dptMethodOfRemovingExcessPenetrant?.trim() || null,
      dptMethodOfApplyingDeveloper: body.dptMethodOfApplyingDeveloper?.trim() || null,
      dptDevelopmentTime: body.dptDevelopmentTime?.trim() || null,
      dptInterpretationTime: body.dptInterpretationTime?.trim() || null,
      dptLightingEquipment: body.dptLightingEquipment?.trim() || null,
      dptPostCleaning: body.dptPostCleaning?.trim() || null,
      // ─── MPT (MAGNETIC PARTICLE TESTING) FIELDS ───
      mptDateOfExamination: body.mptDateOfExamination ? new Date(body.mptDateOfExamination) : null,
      mptTestingStandard: body.mptTestingStandard?.trim() || null,
      mptAcceptanceCriteria: body.mptAcceptanceCriteria?.trim() || null,
      mptSurfacePreparation: body.mptSurfacePreparation?.trim() || null,
      mptSurfaceTemperature: body.mptSurfaceTemperature?.trim() || null,
      mptInstrumentSerialNo: body.mptInstrumentSerialNo?.trim() || null,
      mptCalibrationDate: body.mptCalibrationDate ? new Date(body.mptCalibrationDate) : null,
      mptMethod: body.mptMethod?.trim() || null,
      mptTypeOfCurrent: body.mptTypeOfCurrent?.trim() || null,
      mptAcYokeLiftingCapacity: body.mptAcYokeLiftingCapacity?.trim() || null,
      mptContrastMedium: body.mptContrastMedium?.trim() || null,
      mptMethodOfPreCleaning: body.mptMethodOfPreCleaning?.trim() || null,
      mptMethodOfApplyingWhiteContrast: body.mptMethodOfApplyingWhiteContrast?.trim() || null,
      mptAcYokePoleSpacing: body.mptAcYokePoleSpacing?.trim() || null,
      mptMagneticMedium: body.mptMagneticMedium?.trim() || null,
      mptMethodOfApplyingMagneticMedium: body.mptMethodOfApplyingMagneticMedium?.trim() || null,
      mptDevelopmentTime: body.mptDevelopmentTime?.trim() || null,
      mptInterpretationTime: body.mptInterpretationTime?.trim() || null,
      mptLightingEquipment: body.mptLightingEquipment?.trim() || null,
      mptPostCleaning: body.mptPostCleaning?.trim() || null,
      mptWhiteContrast: body.mptWhiteContrast?.trim() || null,
      mptWetParticleIronInk: body.mptWetParticleIronInk?.trim() || null,
      mptCustomColumns: body.mptCustomColumns ?? "[]",
      // ─── UT (ULTRASONIC TEST) FIELDS ───
      utSubContract: body.utSubContract?.trim() || null,
      utProject: body.utProject?.trim() || null,
      utJobLocation: body.utJobLocation?.trim() || null,
      utJobDescription: body.utJobDescription?.trim() || null,
      utMaterial: body.utMaterial?.trim() || null,
      utCouplant: body.utCouplant?.trim() || null,
      utReferenceDocuments: body.utReferenceDocuments?.trim() || null,
      utProcedureNo: body.utProcedureNo?.trim() || null,
      utAcceptanceStandard: body.utAcceptanceStandard?.trim() || null,
      utUfdDetails: body.utUfdDetails ?? null,
      utCalibrationBlock: body.utCalibrationBlock?.trim() || null,
      utExtentOfExamination: body.utExtentOfExamination?.trim() || null,
      utSurfaceCondition: body.utSurfaceCondition?.trim() || null,
      utReferenceLevel: body.utReferenceLevel?.trim() || null,
      utFlawSizingTechnique: body.utFlawSizingTechnique?.trim() || null,
      utInspectionNote: body.utInspectionNote ?? null,
      utEquipmentRows: body.utEquipmentRows ?? "[]",
      utProbeRows: body.utProbeRows ?? "[]",
      utTestResultRows: body.utTestResultRows ?? "[]",
      utCustomColumns: body.utCustomColumns ?? "[]",
      // ─── WELD SCAN FIELDS ───
      wsScanningCalibrationBlock: body.wsScanningCalibrationBlock?.trim() || null,
      wsScanningReferenceLevel: body.wsScanningReferenceLevel?.trim() || null,
      wsScanningExtentOfExamination: body.wsScanningExtentOfExamination?.trim() || null,
      wsScanningSurfaceCondition: body.wsScanningSurfaceCondition?.trim() || null,
      wsScanningFlawSizingTechnique: body.wsScanningFlawSizingTechnique?.trim() || null,
      wsInstrumentRows: body.wsInstrumentRows ?? "[]",
      wsProbeRows: body.wsProbeRows ?? "[]",
      wsTestResultRows: body.wsTestResultRows ?? "[]",
      // ─── VESSEL DPT CONSUMABLE DETAILS (Make / Product / Batch / Expiry) ───
      vdptSolventMake: body.vdptSolventMake?.trim() || null,
      vdptSolventProduct: body.vdptSolventProduct?.trim() || null,
      vdptSolventBatchNo: body.vdptSolventBatchNo?.trim() || null,
      vdptSolventExpiry: body.vdptSolventExpiry?.trim() || null,
      vdptPenetrantMake: body.vdptPenetrantMake?.trim() || null,
      vdptPenetrantProduct: body.vdptPenetrantProduct?.trim() || null,
      vdptPenetrantBatchNo: body.vdptPenetrantBatchNo?.trim() || null,
      vdptPenetrantExpiry: body.vdptPenetrantExpiry?.trim() || null,
      vdptDeveloperMake: body.vdptDeveloperMake?.trim() || null,
      vdptDeveloperProduct: body.vdptDeveloperProduct?.trim() || null,
      vdptDeveloperBatchNo: body.vdptDeveloperBatchNo?.trim() || null,
      vdptDeveloperExpiry: body.vdptDeveloperExpiry?.trim() || null,
      // ─── VESSEL MPT CONSUMABLE DETAILS + TESTING DETAILS ROWS ───
      vmptWhiteContrastMake: body.vmptWhiteContrastMake?.trim() || null,
      vmptWhiteContrastProduct: body.vmptWhiteContrastProduct?.trim() || null,
      vmptWhiteContrastLotNo: body.vmptWhiteContrastLotNo?.trim() || null,
      vmptWhiteContrastExpiry: body.vmptWhiteContrastExpiry?.trim() || null,
      vmptInkMake: body.vmptInkMake?.trim() || null,
      vmptInkProduct: body.vmptInkProduct?.trim() || null,
      vmptInkLotNo: body.vmptInkLotNo?.trim() || null,
      vmptInkExpiry: body.vmptInkExpiry?.trim() || null,
      vmptRows: typeof body.vmptRows === "string" ? body.vmptRows : null,
      // ─── VESSEL WELD SCAN FIELDS (reportType = VESSEL_WELD_SCAN) ───
      // Completely separate from the Piping Weld Scan ws* fields above —
      // the piping Weld Scan keeps its original storage and layout.
      vwsDateOfExamination: body.vwsDateOfExamination ? new Date(body.vwsDateOfExamination) : null,
      vwsTestingStandard: body.vwsTestingStandard?.trim() || null,
      vwsAcceptanceCriteria: body.vwsAcceptanceCriteria?.trim() || null,
      vwsUtProcedure: body.vwsUtProcedure?.trim() || null,
      vwsEquipmentMake: body.vwsEquipmentMake?.trim() || null,
      vwsEquipmentModel: body.vwsEquipmentModel?.trim() || null,
      vwsEquipmentSerialNo: body.vwsEquipmentSerialNo?.trim() || null,
      vwsCalibrationDueDate: body.vwsCalibrationDueDate ? new Date(body.vwsCalibrationDueDate) : null,
      vwsCableLength: body.vwsCableLength?.trim() || null,
      vwsCableType: body.vwsCableType?.trim() || null,
      vwsProbeDetails: typeof body.vwsProbeDetails === "string" ? body.vwsProbeDetails : null,
      vwsCalibrationBlock: body.vwsCalibrationBlock?.trim() || null,
      vwsCalibrationBlockMoc: body.vwsCalibrationBlockMoc?.trim() || null,
      vwsReferenceReflector: body.vwsReferenceReflector?.trim() || null,
      vwsReferenceLevel: body.vwsReferenceLevel?.trim() || null,
      vwsFlawSizingTechnique: body.vwsFlawSizingTechnique?.trim() || null,
      vwsSurfaceTemperature: body.vwsSurfaceTemperature?.trim() || null,
      vwsTestingMethod: body.vwsTestingMethod?.trim() || null,
      vwsCouplant: body.vwsCouplant?.trim() || null,
      vwsSurfacePreparation: body.vwsSurfacePreparation?.trim() || null,
      vwsSurfaceFinish: body.vwsSurfaceFinish?.trim() || null,
      vwsExtentOfScanning: body.vwsExtentOfScanning?.trim() || null,
      vwsDetailRows: typeof body.vwsDetailRows === "string" ? body.vwsDetailRows : null,
      // ─── VESSEL UT THICKNESS MEASUREMENT FIELDS (reportType = VESSEL_UTM) ───
      // Completely separate from the Piping Thickness Measurement
      // (PIPELINE_THICKNESS / ThicknessMeasurement table) and from the
      // Vessel Weld Scan vws* fields above. Minimum Measured Thickness is
      // recomputed server-side from the spot readings, never trusted from
      // the payload.
      vutmDateOfExamination: body.vutmDateOfExamination ? new Date(body.vutmDateOfExamination) : null,
      vutmTestingStandard: body.vutmTestingStandard?.trim() || null,
      vutmAcceptanceCriteria: body.vutmAcceptanceCriteria?.trim() || null,
      vutmUtProcedure: body.vutmUtProcedure?.trim() || null,
      vutmEquipmentMake: body.vutmEquipmentMake?.trim() || null,
      vutmEquipmentModel: body.vutmEquipmentModel?.trim() || null,
      vutmEquipmentSerialNo: body.vutmEquipmentSerialNo?.trim() || null,
      vutmCalibrationDueDate: body.vutmCalibrationDueDate ? new Date(body.vutmCalibrationDueDate) : null,
      vutmCableLengthAndType: body.vutmCableLengthAndType?.trim() || null,
      vutmLwProbeRows: typeof body.vutmLwProbeRows === "string" ? body.vutmLwProbeRows : null,
      vutmTypeOfCrystal: body.vutmTypeOfCrystal?.trim() || null,
      vutmCalibrationBlock: body.vutmCalibrationBlock?.trim() || null,
      vutmSurfaceTemperature: body.vutmSurfaceTemperature?.trim() || null,
      vutmMethod: body.vutmMethod?.trim() || null,
      vutmCouplant: body.vutmCouplant?.trim() || null,
      vutmSurfacePreparation: body.vutmSurfacePreparation?.trim() || null,
      vutmSurfaceFinish: body.vutmSurfaceFinish?.trim() || null,
      vutmShellRows: normalizeVutmRows(body.vutmShellRows),
      vutmDishRows: normalizeVutmRows(body.vutmDishRows),
      vutmNozzleRows: normalizeVutmRows(body.vutmNozzleRows),
      isDemo: false,
    },
    include: {
      client: { select: { id: true, name: true } },
      plant: { select: { id: true, name: true, location: true } },
    },
  });

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "CREATE", entity: "PipelineInspection", entityId: created.id,
    details: `Created pipeline report ${created.reportNumber} (Draft)`,
  });

  return NextResponse.json(created, { status: 201 });
}
