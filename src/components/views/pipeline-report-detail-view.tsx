"use client";

import { useEffect, useState, useCallback, Fragment } from "react";
import {
  ArrowLeft,
  Download,
  Loader2,
  Pencil,
  ShieldAlert,
  AlertTriangle,
  Send,
  CheckCircle2,
  RotateCcw,
  GitBranch,
  FileText,
  X,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppStore } from "@/lib/store";
import { apiFetch } from "@/lib/api-client";
import { AuthImage } from "@/components/auth-image";
import { vutmMinOfSpots, vutmRowsFromReport, type VutmClockRow } from "@/lib/vutm-rows";
import { resolveClientLogo } from "@/lib/client-logo-mapping";
import {
  parseThicknessTablesConfig,
  thicknessSectionHeading,
  thicknessTableHeading,
  DEFAULT_TABLE_ID,
  type ThicknessTableConfig,
} from "@/lib/thickness-tables";
import { fmtMeasurement } from "@/lib/measurement-utils";
import { toast } from "sonner";

interface FullReport {
  id: string;
  reportNumber: string;
  reportType:
    | "PIPELINE_THICKNESS"
    | "PIPELINE_VISUAL"
    | "PIPELINE_CONDITION"
    | "PIPELINE_DPT"
    | "PIPELINE_MPT"
    | "PIPELINE_WELD_SCAN"
    | "VESSEL_DPT"
    | "VESSEL_MPT"
    | "VESSEL_WELD_SCAN"
    | "VESSEL_UTM";
  // Equipment type ("PIPING" | "VESSEL") from the report-creation flow.
  // vesselOrientation is set ONLY for VESSEL_UTM reports (the orientation
  // decides the readings-table structure); null for legacy rows.
  equipmentType?: string | null;
  vesselOrientation?: string | null;
  clientId: string;
  plantId: string;
  inspectionArea: string | null;
  pipelineDescription: string | null;
  pipelineIdentificationNumber: string | null;
  isometricDrawingNumber: string | null;
  materialOfConstruction: string | null;
  applicableStandard: string | null;
  standardEdition: string | null;
  // ─── PIPELINE CONDITION fields ───
  pipelineAgeYears?: number | null;
  serviceFluid?: string | null;
  operatingCondition?: string | null;
  overallConditionRating?: string | null;
  corrosionCondition?: string | null;
  damageAssessment?: string | null;
  previousInspectionRef?: string | null;
  currentInspectionFindings?: string | null;
  riskPriorityLevel?: string | null;
  recommendations?: string | null;
  nextInspectionRecommendation?: string | null;
  // ─── NEW REPORT SECTIONS + SIGN-OFF FIELDS ───
  fromDate?: string | null;
  toDate?: string | null;
  primaryPhotoPath?: string | null;
  siteObservationSummary?: string | null;
  results?: string | null;
  conclusion?: string | null;
  inspectorDesignation?: string | null;
  secondReviewedByName?: string | null;
  secondReviewedByDesignation?: string | null;
  secondReviewedAt?: string | null;
  approvedByDesignation?: string | null;
  // ─── DPT / DPPT FIELDS ───
  dptDateOfExamination?: string | null;
  dptSolventCleaner?: string | null;
  dptPenetrant?: string | null;
  dptDeveloper?: string | null;
  dptCustomColumns?: string | null;
  // ─── MPT (MAGNETIC PARTICLE TESTING) FIELDS ───
  mptDateOfExamination?: string | null;
  mptTestingStandard?: string | null;
  mptAcceptanceCriteria?: string | null;
  mptSurfacePreparation?: string | null;
  mptSurfaceTemperature?: string | null;
  mptInstrumentSerialNo?: string | null;
  mptCalibrationDate?: string | null;
  mptMethod?: string | null;
  mptTypeOfCurrent?: string | null;
  mptAcYokeLiftingCapacity?: string | null;
  mptContrastMedium?: string | null;
  mptMethodOfPreCleaning?: string | null;
  mptMethodOfApplyingWhiteContrast?: string | null;
  mptAcYokePoleSpacing?: string | null;
  mptMagneticMedium?: string | null;
  mptMethodOfApplyingMagneticMedium?: string | null;
  mptDevelopmentTime?: string | null;
  mptInterpretationTime?: string | null;
  mptLightingEquipment?: string | null;
  mptPostCleaning?: string | null;
  mptWhiteContrast?: string | null;
  mptWetParticleIronInk?: string | null;
  mptCustomColumns?: string | null;
  // ─── WELD SCAN FIELDS (JSON row tables + scanning details) ───
  wsScanningCalibrationBlock?: string | null;
  wsScanningReferenceLevel?: string | null;
  wsScanningExtentOfExamination?: string | null;
  wsScanningSurfaceCondition?: string | null;
  wsScanningFlawSizingTechnique?: string | null;
  wsInstrumentRows?: string | null;
  wsProbeRows?: string | null;
  wsTestResultRows?: string | null;
  // ─── DYE PENETRANT PROCEDURE FIELDS (16 typeable fields) ───
  dptTestingStandard?: string | null;
  dptAcceptanceCriteria?: string | null;
  dptSurfacePreparation?: string | null;
  dptSurfaceTemperature?: string | null;
  dptPenetrantType?: string | null;
  dptPenetrantProcess?: string | null;
  dptMethodOfPreCleaning?: string | null;
  dptDryingTimeAfterPreCleaning?: string | null;
  dptMethodOfApplyingPenetrant?: string | null;
  dptPenetratingTime?: string | null;
  dptMethodOfRemovingExcessPenetrant?: string | null;
  dptMethodOfApplyingDeveloper?: string | null;
  dptDevelopmentTime?: string | null;
  dptInterpretationTime?: string | null;
  dptLightingEquipment?: string | null;
  dptPostCleaning?: string | null;
  // ─── VESSEL DPT CONSUMABLE DETAILS ───
  vdptSolventMake?: string | null;
  vdptSolventProduct?: string | null;
  vdptSolventBatchNo?: string | null;
  vdptSolventExpiry?: string | null;
  vdptPenetrantMake?: string | null;
  vdptPenetrantProduct?: string | null;
  vdptPenetrantBatchNo?: string | null;
  vdptPenetrantExpiry?: string | null;
  vdptDeveloperMake?: string | null;
  vdptDeveloperProduct?: string | null;
  vdptDeveloperBatchNo?: string | null;
  vdptDeveloperExpiry?: string | null;
  // ─── VESSEL MPT CONSUMABLE DETAILS + TESTING DETAILS ROWS ───
  vmptWhiteContrastMake?: string | null;
  vmptWhiteContrastProduct?: string | null;
  vmptWhiteContrastLotNo?: string | null;
  vmptWhiteContrastExpiry?: string | null;
  vmptInkMake?: string | null;
  vmptInkProduct?: string | null;
  vmptInkLotNo?: string | null;
  vmptInkExpiry?: string | null;
  vmptRows?: string | null;
  // ─── VESSEL WELD SCAN FIELDS ───
  // Populated when reportType = VESSEL_WELD_SCAN. Completely separate
  // from the Piping Weld Scan ws* fields above.
  vwsDateOfExamination?: string | null;
  vwsTestingStandard?: string | null;
  vwsAcceptanceCriteria?: string | null;
  vwsUtProcedure?: string | null;
  vwsEquipmentMake?: string | null;
  vwsEquipmentModel?: string | null;
  vwsEquipmentSerialNo?: string | null;
  vwsCalibrationDueDate?: string | null;
  vwsCableLength?: string | null;
  vwsCableType?: string | null;
  vwsProbeDetails?: string | null;
  vwsCalibrationBlock?: string | null;
  vwsCalibrationBlockMoc?: string | null;
  vwsReferenceReflector?: string | null;
  vwsReferenceLevel?: string | null;
  vwsFlawSizingTechnique?: string | null;
  vwsSurfaceTemperature?: string | null;
  vwsTestingMethod?: string | null;
  vwsCouplant?: string | null;
  vwsSurfacePreparation?: string | null;
  vwsSurfaceFinish?: string | null;
  vwsExtentOfScanning?: string | null;
  vwsDetailRows?: string | null;
  // ─── VESSEL UT THICKNESS MEASUREMENT FIELDS (VESSEL_UTM) ───
  // Completely separate from the Piping Thickness Measurement
  // (PIPELINE_THICKNESS) and from the Vessel Weld Scan vws* fields.
  vutmDateOfExamination?: string | null;
  vutmTestingStandard?: string | null;
  vutmAcceptanceCriteria?: string | null;
  vutmUtProcedure?: string | null;
  vutmEquipmentMake?: string | null;
  vutmEquipmentModel?: string | null;
  vutmEquipmentSerialNo?: string | null;
  vutmCalibrationDueDate?: string | null;
  vutmCableLengthAndType?: string | null;
  vutmLwProbeRows?: string | null;
  vutmTypeOfCrystal?: string | null;
  vutmCalibrationBlock?: string | null;
  vutmSurfaceTemperature?: string | null;
  vutmMethod?: string | null;
  vutmCouplant?: string | null;
  vutmSurfacePreparation?: string | null;
  vutmSurfaceFinish?: string | null;
  vutmShellRows?: string | null;
  vutmDishRows?: string | null;
  vutmNozzleRows?: string | null;
  // ─── UT (ULTRASONIC TEST) FIELDS ───
  utSubContract?: string | null;
  utProject?: string | null;
  utJobLocation?: string | null;
  utJobDescription?: string | null;
  utMaterial?: string | null;
  utCouplant?: string | null;
  utReferenceDocuments?: string | null;
  utProcedureNo?: string | null;
  utAcceptanceStandard?: string | null;
  utUfdDetails?: string | null;
  utCalibrationBlock?: string | null;
  utExtentOfExamination?: string | null;
  utSurfaceCondition?: string | null;
  utReferenceLevel?: string | null;
  utFlawSizingTechnique?: string | null;
  utInspectionNote?: string | null;
  utEquipmentRows?: string | null;
  utProbeRows?: string | null;
  utTestResultRows?: string | null;
  utCustomColumns?: string | null;
  // ─── Certificates ───
  certificates?: Array<{
    id: string; category: string; title: string; fileName: string;
    fileExtension: string; fileSize: number; mimeType: string; sortOrder: number;
  }>;
  inspectionDate: string;
  status: string;
  revisionNumber: number;
  inspectorId: string;
  inspectorName: string;
  findingsSummary: string | null;
  comments: string | null;
  inspectionDescription?: string | null;
  photos: string | null;
  // JSON array of {id,label,sortOrder} describing every Thickness
  // Pipeline table configured on this report. Null/missing → single
  // default table (legacy behaviour).
  thicknessTablesConfig?: string | null;
  // JSON array of {id,name,unit} — user-defined extra columns for the
  // Thickness measurement table.
  customColumns?: string | null;
  overrideReason: string | null;
  overrideAppliedAt: string | null;
  approvedById: string | null;
  approvedAt: string | null;
  approvalNotes: string | null;
  returnedById: string | null;
  returnedAt: string | null;
  reviewComments: string | null;
  currentApprovedRevisionId: string | null;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  client: { id: string; name: string; logoPath?: string | null };
  plant: { id: string; name: string; location: string | null; address: string | null };
  inspector: { id: string; name: string; email: string };
  approver: { id: string; name: string; email: string } | null;
  returnedBy: { id: string; name: string; email: string } | null;
  // ─── Photos + Drawings (returned by the API but were missing from the
  // interface, causing images to never render during report review) ───
  reportPhotos?: Array<{
    id: string;
    fileName: string;
    filePath: string;
    fileSize: number;
    mimeType: string;
    // "PRIMARY" = the dedicated primary inspection photo (rendered once
    // above); "INSPECTION" = regular gallery photo.
    category: string;
    caption: string | null;
    sortOrder: number;
    uploadedByName: string | null;
    createdAt: string;
  }>;
  drawingLinks?: Array<{
    id: string;
    drawingId: string;
    drawingRevisionId: string | null;
    createdAt: string;
    drawing: {
      id: string;
      title: string;
      drawingNumber: string;
      drawingType: string;
      activeRevisionId?: string | null;
      client?: { id: string; name: string } | null;
      plant?: { id: string; name: string } | null;
      revisions: Array<{
        id: string;
        revisionNumber: string;
        fileName: string;
        filePath: string;
        fileExtension: string;
        mimeType: string;
        fileSize: number;
        isActive: boolean;
      }>;
    };
  }>;
  measurements: Array<{
    id: string;
    pointNo: string;
    sortOrder: number;
    /** Multi-table partition key. Defaults to "default" for rows
     *  created before this feature was added. */
    tableGroup?: string;
    pipeSizeInch: string;
    pipeSchedule: string;
    nominalThicknessMm: number | null;
    componentTypeCode: string;
    componentType?: { code: string; label: string } | null;
    northMm: number | null; northStatus: string;
    eastMm: number | null; eastStatus: string;
    southMm: number | null; southStatus: string;
    westMm: number | null; westStatus: string;
    observedMinimumMm: number | null;
    findingsComments: string | null;
    // JSON object {colId: value} for user-defined extra columns
    customColumnValues?: string | null;
    standard?: {
      standard: string; edition: string; nominalSizeInch: string;
      schedule: string; wallThicknessMm: number; isVerified: boolean;
    } | null;
  }>;
  visualObservations?: Array<{
    id: string;
    pointNo: string;
    sortOrder: number;
    location: string | null;
    pipelineCondition: string | null;
    externalSurfaceCondition: string | null;
    coatingPaintCondition: string | null;
    corrosionObserved: string | null;
    leakageObserved: string | null;
    damageOrDeformation: string | null;
    supportsHangersCondition: string | null;
    weldJointCondition: string | null;
    insulationCondition: string | null;
    findings: string | null;
    recommendations: string | null;
    inspectorComments: string | null;
  }>;
  // DPT observations — only populated for PIPELINE_DPT reports.
  dptObservations?: Array<{
    id: string;
    serialNo: number;
    sortOrder: number;
    description: string | null;
    weldType: string | null;
    indicationSize: string | null;
    result: string;
    remarks: string | null;
    customColumnValues: string | null;
  }>;
  revisions: Array<{
    id: string;
    revisionNumber: number;
    revisionDate: string;
    status: string;
    revisedByName: string | null;
    changeDescription: string | null;
    reviewComments: string | null;
    approvedByName: string | null;
    approvedAt: string | null;
    revisedBy?: { id: string; name: string } | null;
    approvedBy?: { id: string; name: string } | null;
  }>;
}

const STATUS_COLOR: Record<string, string> = {
  Draft: "border-zinc-400 text-zinc-600",
  "Submitted for Review": "border-blue-500 text-blue-700",
  "Returned for Revision": "border-red-500 text-red-700",
  Approved: "border-emerald-500 text-emerald-700",
  "Changes Pending Review": "border-amber-500 text-amber-700",
};

const REVISION_STATUS_COLOR: Record<string, string> = {
  Draft: "border-zinc-400 text-zinc-600",
  "Submitted for Review": "border-blue-500 text-blue-700",
  "Returned for Revision": "border-red-500 text-red-700",
  Approved: "border-emerald-500 text-emerald-700",
  "Changes Pending Review": "border-amber-500 text-amber-700",
  Superseded: "border-zinc-400 text-zinc-500",
};

const REPORT_TYPE_LABEL: Record<string, { label: string; title: string; color: string }> = {
  PIPELINE_THICKNESS: {
    label: "Thickness",
    title: "PIPELINE THICKNESS MEASUREMENT REPORT",
    color: "border-emerald-500 text-emerald-700",
  },
  PIPELINE_VISUAL: {
    label: "Visual",
    title: "PIPELINE VISUAL INSPECTION REPORT",
    color: "border-blue-500 text-blue-700",
  },
  PIPELINE_CONDITION: {
    label: "Condition",
    title: "PIPELINE CONDITION ASSESSMENT REPORT",
    color: "border-amber-500 text-amber-700",
  },
  PIPELINE_DPT: {
    label: "DPT/DPPT",
    title: "DYE PENETRANT TESTING REPORT",
    color: "border-purple-500 text-purple-700",
  },
  VESSEL_DPT: {
    label: "Vessel DPT",
    title: "VESSEL DYE PENETRANT TESTING REPORT",
    color: "border-purple-500 text-purple-700",
  },
  VESSEL_MPT: {
    label: "Vessel MPT",
    title: "VESSEL MAGNETIC PARTICLE TESTING REPORT",
    color: "border-orange-500 text-orange-700",
  },
  VESSEL_WELD_SCAN: {
    label: "Vessel Weld Scan",
    title: "VESSEL WELD SCAN REPORT",
    color: "border-cyan-500 text-cyan-700",
  },
  VESSEL_UTM: {
    label: "Vessel UT Thickness",
    title: "VESSEL UT THICKNESS MEASUREMENT REPORT",
    color: "border-emerald-500 text-emerald-700",
  },
  PIPELINE_MPT: {
    label: "MPT",
    title: "MAGNETIC PARTICLE TESTING REPORT",
    color: "border-orange-500 text-orange-700",
  },
  PIPELINE_WELD_SCAN: {
    label: "Weld Scan",
    title: "WELD SCAN REPORT",
    color: "border-cyan-500 text-cyan-700",
  },
};

export function PipelineReportDetailView() {
  const {
    user,
    selectedPipelineReportId,
    setView,
    openEditPipelineReport,
    refresh,
    refreshKey,
  } = useAppStore();
  const [report, setReport] = useState<FullReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  // Dialog state for workflow actions (submit / approve / return / revise)
  const [dialogMode, setDialogMode] = useState<null | "submit" | "approve" | "return" | "revise">(null);
  const [dialogText, setDialogText] = useState("");
  // Lightbox state — when set, the image at this URL is shown full-screen
  const [lightbox, setLightbox] = useState<{ url: string; caption: string } | null>(null);

  const load = useCallback(() => {
    if (!selectedPipelineReportId) return;
    setLoading(true);
    apiFetch<FullReport>(`/api/pipeline-inspections/${selectedPipelineReportId}`)
      .then((r) => setReport(r))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [selectedPipelineReportId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  // Role-based permissions (derived from session user + current report state)
  const isAdmin = user?.dashboardRole === "ADMIN";
  const isOwner = !!(user && report && report.inspectorId === user.id);
  const status = report?.status;
  // Employee can edit header/measurements only on their own Draft / Returned reports
  const canEditDraft =
    !!user && !!report && (
      isAdmin ||
      (isOwner && (status === "Draft" || status === "Returned for Revision"))
    );
  // Employee can submit (only their own Draft / Returned reports)
  const canSubmit =
    !!user && !!report && !isAdmin && isOwner &&
    (status === "Draft" || status === "Returned for Revision");
  // Employee can revise their own Approved report (creates new revision)
  const canRevise =
    !!user && !!report && !isAdmin && isOwner && status === "Approved";
  // Admin can approve or return when status is Submitted for Review or Changes Pending Review
  const canApproveOrReturn =
    !!user && !!report && isAdmin &&
    (status === "Submitted for Review" || status === "Changes Pending Review");

  function openDialog(mode: "submit" | "approve" | "return" | "revise") {
    setDialogMode(mode);
    setDialogText("");
  }

  async function executeWorkflow() {
    if (!report || !dialogMode) return;
    setActing(true);
    try {
      const body = dialogText.trim()
        ? (dialogMode === "submit"
            ? { submissionNotes: dialogText }
            : dialogMode === "approve"
              ? { approvalNotes: dialogText }
              : dialogMode === "return"
                ? { reviewComments: dialogText }
                : { changeDescription: dialogText })
        : {};
      const endpoint =
        dialogMode === "submit" ? "submit" :
        dialogMode === "approve" ? "approve" :
        dialogMode === "return" ? "return" :
        "revise";
      await apiFetch(`/api/pipeline-inspections/${report.id}/${endpoint}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const labels: Record<string, string> = {
        submit: "Submitted for review",
        approve: "Approved",
        return: "Returned for revision",
        revise: "Revision started",
      };
      toast.success(labels[dialogMode]);
      setDialogMode(null);
      setDialogText("");
      refresh();
      load();
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message ?? "Action failed");
    } finally {
      setActing(false);
    }
  }

  async function downloadPdf(orientation?: "landscape" | "portrait") {
    if (!report) return;
    const orient = orientation ?? "landscape";
    try {
      // Use fetch() instead of window.open() so the Authorization header
      // (from localStorage) is sent along with the cookie. This fixes the
      // download failure caused by popup blockers and missing auth headers.
      const token = typeof window !== "undefined" ? window.localStorage.getItem("ira_session_token") : null;
      const res = await fetch(`/api/pipeline-inspections/${report.id}/pdf?orientation=${orient}`, {
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Download failed (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // Build a descriptive filename
      const filename = `Inspection_Report_${report.reportNumber.replace(/[^a-zA-Z0-9-]/g, "_")}_${orient}.pdf`;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Downloaded ${filename}`);
    } catch (e) {
      const err = e as Error;
      toast.error(`PDF download failed: ${err.message}`);
    }
  }

  if (loading) {
    return (
      <div className="p-8 text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading report...
      </div>
    );
  }
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Failed to load</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!report) return <p className="p-8 text-muted-foreground">No report selected.</p>;

  const allVerified = report.measurements.every(
    (m) => m.standard?.isVerified || m.standard === null,
  );

  const dialogTitle: Record<string, string> = {
    submit: "Submit Report for Review",
    approve: "Approve Report",
    return: "Return Report for Revision",
    revise: "Start New Revision",
  };
  const dialogDesc: Record<string, string> = {
    submit: "Submit this report to the administrator for approval. You won't be able to edit it until it's approved or returned.",
    approve: "Approve this report. The current state will be saved as an approved revision; previous approved revisions will be marked as Superseded but remain available.",
    return: "Return this report to the employee for correction. Mandatory review comments (at least 10 chars) will be visible to them.",
    revise: "Start a new revision of this approved report. The previously-approved version stays available; this new revision will need admin approval before becoming the current approved version.",
  };
  const dialogLabel: Record<string, string> = {
    submit: "Submission notes (optional)",
    approve: "Approval notes (optional)",
    return: "Review comments (REQUIRED, >= 10 chars)",
    revise: "What are you changing? (REQUIRED, >= 5 chars)",
  };
  const dialogActionLabel: Record<string, string> = {
    submit: "Submit for Review",
    approve: "Approve",
    return: "Return for Revision",
    revise: "Start Revision",
  };

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => setView("pipeline-reports")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to list
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => downloadPdf("landscape")}>
            <Download className="mr-2 h-4 w-4" /> PDF (Landscape)
          </Button>
          <Button variant="outline" size="sm" onClick={() => downloadPdf("portrait")}>
            <Download className="mr-2 h-4 w-4" /> PDF (Portrait)
          </Button>
          {canEditDraft && (
            <Button size="sm" onClick={() => openEditPipelineReport(report.id)}>
              <Pencil className="mr-2 h-4 w-4" /> Edit
            </Button>
          )}
          {canSubmit && (
            <Button size="sm" onClick={() => openDialog("submit")}>
              <Send className="mr-2 h-4 w-4" /> Submit for Review
            </Button>
          )}
          {canRevise && (
            <Button size="sm" variant="default" onClick={() => openDialog("revise")}>
              <GitBranch className="mr-2 h-4 w-4" /> Start New Revision
            </Button>
          )}
          {canApproveOrReturn && (
            <>
              <Button size="sm" variant="default" onClick={() => openDialog("approve")}>
                <CheckCircle2 className="mr-2 h-4 w-4" /> Approve
              </Button>
              <Button size="sm" variant="outline" className="text-red-700 border-red-300" onClick={() => openDialog("return")}>
                <RotateCcw className="mr-2 h-4 w-4" /> Return for Revision
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Status banner */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Report type badge — derived from reportType */}
        {(() => {
          const typeInfo = REPORT_TYPE_LABEL[report.reportType] ?? REPORT_TYPE_LABEL.PIPELINE_THICKNESS;
          return (
            <Badge variant="outline" className={`text-[11px] ${typeInfo.color}`}>
              {typeInfo.label}
            </Badge>
          );
        })()}
        <Badge variant="outline" className={STATUS_COLOR[report.status] ?? ""}>
          {report.status}
        </Badge>
        {report.revisionNumber > 1 && (
          <Badge variant="outline" className="text-xs">
            Rev {report.revisionNumber}
          </Badge>
        )}
        {report.isDemo && (
          <Badge variant="outline" className="border-zinc-400 text-zinc-500">DEMO</Badge>
        )}
        {status === "Returned for Revision" && report.reviewComments && (
          <Alert className="flex-1 border-red-300 bg-red-50">
            <RotateCcw className="h-4 w-4 text-red-700" />
            <AlertTitle className="text-red-900">Admin returned this report for revision</AlertTitle>
            <AlertDescription className="text-red-900">
              <em>"{report.reviewComments}"</em>
              {report.returnedBy && (
                <div className="mt-1 text-xs">
                  — {report.returnedBy.name}
                  {report.returnedAt ? ` on ${new Date(report.returnedAt).toLocaleString()}` : ""}
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}
      </div>

      {/* Verification banner */}
      {!allVerified && (
        <Alert className="border-amber-300 bg-amber-50">
          <ShieldAlert className="h-4 w-4 text-amber-700" />
          <AlertTitle className="text-amber-900">Reference data not yet verified</AlertTitle>
          <AlertDescription className="text-amber-900">
            One or more nominal wall thickness values reference unverified ASME
            standard data. An administrator must verify them against the licensed
            ASME standard edition before this report can be used for production
            inspection decisions.
          </AlertDescription>
        </Alert>
      )}

      {/* ---------- PRINTABLE REPORT ---------- */}
      <div className="rounded-md border border-zinc-400 bg-white p-8 print:shadow-none print:border-0" style={{ minHeight: "210mm" }}>
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-center text-lg font-bold tracking-tight">
            {(REPORT_TYPE_LABEL[report.reportType] ?? REPORT_TYPE_LABEL.PIPELINE_THICKNESS).title}
          </h1>
          <p className="text-center text-xs text-zinc-700">
            Report No: <span className="font-mono">{report.reportNumber}</span>
            {"    |    "}Rev: {report.revisionNumber}
            {"    |    "}Date: {report.fromDate ? new Date(report.fromDate).toISOString().slice(0, 10) : new Date(report.inspectionDate).toISOString().slice(0, 10)}{report.toDate && report.toDate !== report.fromDate ? ` – ${new Date(report.toDate).toISOString().slice(0, 10)}` : ""}
            {"    |    "}Status: {report.status}
          </p>
        </div>

        {/* Logo section — Aruntech (left, permanent) + Client (right, dynamic)
            The client logo is resolved via @/lib/client-logo-mapping, which is
            the single source of truth for the client-name → logo-file mapping.
            The map is currently EMPTY (clean slate) — it will be repopulated
            one entry per client after the user uploads the new uniquely-named
            logo images. Until then `resolveClientLogo()` returns null for
            every client and a clean placeholder is shown. No other company's
            logo is ever substituted. Uses AuthImage for cross-origin auth
            support. Logo containers use flexbox with object-fit: contain so
            logos of any aspect ratio (square, wide, tall) are properly scaled
            and centered without distortion. */}
        <div className="mb-4 flex items-center justify-between">
          {/* Left: Aruntech logo (permanent) */}
          <div
            className="flex items-center justify-center border border-zinc-300 overflow-hidden bg-white"
            style={{ width: "140px", height: "70px" }}
          >
            <AuthImage
              src="/api/settings/service-logo"
              alt="Aruntech Logo"
              className="max-w-[92%] max-h-[88%] w-auto h-auto object-contain"
            />
          </div>
          {/* Right: Client logo (dynamic, based on client name) */}
          <div
            className="flex items-center justify-center border border-zinc-300 overflow-hidden bg-white"
            style={{ width: "140px", height: "70px" }}
          >
            {(() => {
              // Resolve the client logo using the SHARED, EXACT-match
              // resolver in @/lib/client-logo-mapping.
              //   Priority:
              //     1. If the client has a static-map entry (currently NONE —
              //        the map is empty pending the user's new logo uploads),
              //        serve the mapped file via /api/client-logo/[slug].
              //     2. Else, if the client has its own uploaded logo
              //        (logoPath), use that — it's their real brand asset.
              //     3. Else, show a text placeholder — NEVER another
              //        company's logo.
              const mappedLogoFile = resolveClientLogo(report.client.name);

              if (mappedLogoFile) {
                // Served by the dedicated client-logo API endpoint.
                return (
                  <AuthImage
                    src={`/api/client-logo/${mappedLogoFile}`}
                    alt={`${report.client.name} Logo`}
                    className="max-w-[92%] max-h-[88%] w-auto h-auto object-contain"
                  />
                );
              } else if (report.client.logoPath) {
                // Fall back to the client's own uploaded logo path.
                return (
                  <AuthImage
                    src={`/api/clients/${report.clientId}/logo`}
                    alt={`${report.client.name} Logo`}
                    className="max-w-[92%] max-h-[88%] w-auto h-auto object-contain"
                  />
                );
              } else {
                return (
                  <span className="text-[10px] text-zinc-500 text-center">
                    {report.client.name.slice(0, 24)}<br />Client Logo
                  </span>
                );
              }
            })()}
          </div>
        </div>

        {/* Header info grid */}
        <div className="mb-4 grid grid-cols-2 gap-0 border border-zinc-500 text-xs">
          {[
            ["Client", report.client.name],
            ["Location", report.plant.location ?? "—"],
            ["Plant Name", report.plant.name],
            ["Inspection Area", report.inspectionArea ?? "—"],
            // All Vessel reports use equipment wording in the header grid.
            // Only VESSEL_UTM reports carry a Vessel Orientation (the UT
            // Thickness Measurement module is the only one that asks for
            // one) — shown as an extra header row for that report type.
            ...(report.reportType === "VESSEL_DPT" || report.reportType === "VESSEL_MPT" || report.reportType === "VESSEL_UTM" || report.reportType === "VESSEL_WELD_SCAN"
              ? [
                  ["Equipment / Vessel Description", report.pipelineDescription ?? "—"],
                  ["Equipment Identification No.", report.pipelineIdentificationNumber ?? "—"],
                  ...(report.reportType === "VESSEL_UTM"
                    ? [["Vessel Orientation",
                        report.vesselOrientation === "VERTICAL" ? "Vertical Vessel"
                        : report.vesselOrientation === "HORIZONTAL" ? "Horizontal Vessel"
                        : "Horizontal Vessel (default)"]] as Array<[string, string]>
                    : []),
                ]
              : [
                    ["Pipeline Description", report.pipelineDescription ?? "—"],
                    ["Pipeline Identification No.", report.pipelineIdentificationNumber ?? "—"],
                  ]),
            ["Isometric Drawing No.", report.isometricDrawingNumber ?? "—"],
            ["Material of Construction (MOC)", report.materialOfConstruction ?? "—"],
            ["Applicable Standard", `${report.applicableStandard ?? "—"} ${report.standardEdition ?? ""}`.trim()],
            ["Inspector", report.inspectorName],
          ].map(([label, value], idx) => (
            <div key={idx} className={`flex border-b border-r border-zinc-300 ${idx % 2 === 1 ? "border-r-0" : ""} ${idx >= 8 ? "border-b-0" : ""}`}>
              <div className="w-1/2 bg-zinc-100 px-2 py-1 font-semibold border-r border-zinc-300">{label}</div>
              <div className="flex-1 px-2 py-1">{value}</div>
            </div>
          ))}
        </div>

        {/* ─── 2. PRIMARY INSPECTION PHOTO ───
            Rendered immediately after the cover / client details, before
            drawings and inspection tables (required report sequence).
            It is rendered ONLY from report.primaryPhotoPath here and is
            excluded from the Inspection Photos gallery below — the photo
            must never appear twice. */}
        {report.primaryPhotoPath && (
          <div className="mt-4">
            <h3 className="text-xs font-bold text-zinc-700 mb-2">Primary Inspection Photo</h3>
            <div className="border border-zinc-300 rounded overflow-hidden" style={{ maxWidth: "400px" }}>
              <AuthImage
                src={`/api/pipeline-inspections/${report.id}/primary-photo`}
                alt="Primary inspection photo"
                className="w-full h-auto max-h-[300px] object-contain"
                onClick={() => setLightbox({
                  url: `/api/pipeline-inspections/${report.id}/primary-photo`,
                  caption: "Primary Inspection Photo",
                })}
              />
            </div>
          </div>
        )}

        {/* ─── 3. REPORT DETAILS / INSPECTION INFORMATION (type-specific) ───
            DPT procedure + consumables, MPT parameters + consumables, and
            Weld Scan instrument/probe/scanning details are the "inspection
            information" part of the report. Each type's results table is
            rendered later, in the Inspection Tables section. */}
        {report.reportType === "PIPELINE_DPT" && (
          <div className="mt-6 space-y-6">
            {/* 3. Dye Penetrant Procedure */}
            <div>
              <h3 className="mb-2 text-xs font-bold uppercase text-purple-700 border-b border-purple-300 pb-1">
                3. Dye Penetrant Procedure
              </h3>
              <table className="w-full border-collapse text-xs">
                <tbody>
                  {([
                    ["Date of Examination", report.dptDateOfExamination ? new Date(report.dptDateOfExamination).toISOString().slice(0, 10) : null],
                    ["Testing Standard", report.dptTestingStandard],
                    ["Acceptance Criteria", report.dptAcceptanceCriteria],
                    ["Surface Preparation", report.dptSurfacePreparation],
                    ["Surface Temperature", report.dptSurfaceTemperature],
                    ["Penetrant Type", report.dptPenetrantType],
                    ["Penetrant Process", report.dptPenetrantProcess],
                    ["Method of Pre-cleaning", report.dptMethodOfPreCleaning],
                    ["Drying Time After Pre-cleaning", report.dptDryingTimeAfterPreCleaning],
                    ["Method of Applying Penetrant", report.dptMethodOfApplyingPenetrant],
                    ["Penetrating Time", report.dptPenetratingTime],
                    ["Method of Removing Excess Penetrant", report.dptMethodOfRemovingExcessPenetrant],
                    ["Method of Applying Developer", report.dptMethodOfApplyingDeveloper],
                    ["Development Time", report.dptDevelopmentTime],
                    ["Interpretation Time", report.dptInterpretationTime],
                    ["Lighting Equipment", report.dptLightingEquipment],
                    ["Post Cleaning", report.dptPostCleaning],
                  ] as Array<[string, string | null | undefined]>).map(([label, value], idx) => (
                    <tr key={idx} className="border-b border-zinc-200">
                      <td className="bg-purple-50 border-r border-zinc-200 px-3 py-1.5 font-medium text-zinc-700 w-1/3">
                        {label}
                      </td>
                      <td className="px-3 py-1.5">
                        {value && value.trim() ? value : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Consumable Details */}
            <div>
              <h3 className="mb-2 text-xs font-bold uppercase text-purple-700 border-b border-purple-300 pb-1">
                Consumable Details
              </h3>
              <table className="w-full border-collapse text-xs">
                <tbody>
                  {([
                    ["Solvent", report.dptSolventCleaner],
                    ["Penetrant", report.dptPenetrant],
                    ["Developer", report.dptDeveloper],
                  ] as Array<[string, string | null | undefined]>).map(([label, value], idx) => (
                    <tr key={idx} className="border-b border-zinc-200">
                      <td className="bg-purple-50 border-r border-zinc-200 px-3 py-1.5 font-medium text-zinc-700 w-1/3">
                        {label}
                      </td>
                      <td className="px-3 py-1.5">
                        {value && value.trim() ? value : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ─── VESSEL DPT: PARAMETERS + CONSUMABLE DETAILS ───
            Shown only for VESSEL_DPT reports. The testing-details rows
            are stored in the shared DptObservation table and rendered in
            the Inspection Tables section below. */}
        {report.reportType === "VESSEL_DPT" && (
          <div className="mt-6 space-y-6">
            {/* Equipment type */}
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="border-purple-400 text-purple-700">
                Equipment: Vessel
              </Badge>
            </div>

            {/* 3. Dye Penetrant Testing Parameters */}
            <div>
              <h3 className="mb-2 text-xs font-bold uppercase text-purple-700 border-b border-purple-300 pb-1">
                3. Dye Penetrant Testing Parameters
              </h3>
              <table className="w-full border-collapse text-xs">
                <tbody>
                  {([
                    ["Date of Examination", report.dptDateOfExamination ? new Date(report.dptDateOfExamination).toISOString().slice(0, 10) : null],
                    ["Testing Standard", report.dptTestingStandard],
                    ["Acceptance Criteria", report.dptAcceptanceCriteria],
                    ["Surface Preparation", report.dptSurfacePreparation],
                    ["Surface Temperature", report.dptSurfaceTemperature],
                    ["Penetrant Type", report.dptPenetrantType],
                    ["Penetrant Process", report.dptPenetrantProcess],
                    ["Method of Pre-cleaning", report.dptMethodOfPreCleaning],
                    ["Drying Time After Pre-cleaning", report.dptDryingTimeAfterPreCleaning],
                    ["Method of Applying Penetrant", report.dptMethodOfApplyingPenetrant],
                    ["Penetrating Time", report.dptPenetratingTime],
                    ["Method of Removing Excess Penetrant", report.dptMethodOfRemovingExcessPenetrant],
                    ["Method of Applying Developer", report.dptMethodOfApplyingDeveloper],
                    ["Development Time", report.dptDevelopmentTime],
                    ["Interpretation Time", report.dptInterpretationTime],
                    ["Lighting Equipment", report.dptLightingEquipment],
                    ["Post Cleaning", report.dptPostCleaning],
                  ] as Array<[string, string | null | undefined]>).map(([label, value], idx) => (
                    <tr key={idx} className="border-b border-zinc-200">
                      <td className="bg-purple-50 border-r border-zinc-200 px-3 py-1.5 font-medium text-zinc-700 w-1/3">
                        {label}
                      </td>
                      <td className="px-3 py-1.5">
                        {value && value.trim() ? value : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Consumable Details — Make / Product / Batch / Expiry per consumable */}
            <div>
              <h3 className="mb-2 text-xs font-bold uppercase text-purple-700 border-b border-purple-300 pb-1">
                Consumable Details
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-purple-800 text-white">
                      <th className="border border-purple-900 px-2 py-2 text-center">Consumable</th>
                      <th className="border border-purple-900 px-2 py-2 text-center">Make</th>
                      <th className="border border-purple-900 px-2 py-2 text-center">Product / Description</th>
                      <th className="border border-purple-900 px-2 py-2 text-center">Batch Number</th>
                      <th className="border border-purple-900 px-2 py-2 text-center">Expiry Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {([
                      ["Solvent", report.vdptSolventMake, report.vdptSolventProduct, report.vdptSolventBatchNo, report.vdptSolventExpiry],
                      ["Penetrant", report.vdptPenetrantMake, report.vdptPenetrantProduct, report.vdptPenetrantBatchNo, report.vdptPenetrantExpiry],
                      ["Developer", report.vdptDeveloperMake, report.vdptDeveloperProduct, report.vdptDeveloperBatchNo, report.vdptDeveloperExpiry],
                    ] as Array<[string, string | null | undefined, string | null | undefined, string | null | undefined, string | null | undefined]>).map(([label, make, product, batchNo, expiry], idx) => (
                      <tr key={idx} className="hover:bg-muted/30">
                        <td className="bg-purple-50 border border-zinc-300 px-3 py-1.5 font-medium text-zinc-700">{label}</td>
                        <td className="border border-zinc-300 px-3 py-1.5">{make && make.trim() ? make : <span className="text-muted-foreground">—</span>}</td>
                        <td className="border border-zinc-300 px-3 py-1.5">{product && product.trim() ? product : <span className="text-muted-foreground">—</span>}</td>
                        <td className="border border-zinc-300 px-3 py-1.5">{batchNo && batchNo.trim() ? batchNo : <span className="text-muted-foreground">—</span>}</td>
                        <td className="border border-zinc-300 px-3 py-1.5">{expiry && expiry.trim() ? expiry : <span className="text-muted-foreground">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ─── VESSEL MPT: PARAMETERS + CONSUMABLE DETAILS ───
            Shown only for VESSEL_MPT reports. The testing-details rows
            are stored in the vmptRows JSON column and rendered in the
            Inspection Tables section below. */}
        {report.reportType === "VESSEL_MPT" && (() => {
          let vmptRows: Array<Record<string, string>> = [];
          try {
            const parsed = JSON.parse(report.vmptRows ?? "[]");
            if (Array.isArray(parsed)) vmptRows = parsed;
          } catch {}
          return (
          <div className="mt-6 space-y-6">
            {/* Equipment type */}
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="border-orange-400 text-orange-700">
                Equipment: Vessel
              </Badge>
            </div>

            {/* 3. Magnetic Particle Testing Parameters */}
            <div>
              <h3 className="mb-2 text-xs font-bold uppercase text-orange-700 border-b border-orange-300 pb-1">
                3. Magnetic Particle Testing Parameters
              </h3>
              <table className="w-full border-collapse text-xs">
                <tbody>
                  {([
                    ["Date of Examination", report.mptDateOfExamination ? new Date(report.mptDateOfExamination).toISOString().slice(0, 10) : null],
                    ["Testing Standard", report.mptTestingStandard],
                    ["Acceptance Criteria", report.mptAcceptanceCriteria],
                    ["Surface Preparation", report.mptSurfacePreparation],
                    ["Surface Temperature", report.mptSurfaceTemperature],
                    ["Type of Instrument / Sl. No.", report.mptInstrumentSerialNo],
                    ["MPT Method", report.mptMethod],
                    ["Type of Current", report.mptTypeOfCurrent],
                    ["AC Yoke Lifting Capacity", report.mptAcYokeLiftingCapacity],
                    ["Contrast Medium", report.mptContrastMedium],
                    ["Method of Pre-cleaning", report.mptMethodOfPreCleaning],
                    ["Method of Applying White Contrast", report.mptMethodOfApplyingWhiteContrast],
                    ["AC Yoke Pole Spacing", report.mptAcYokePoleSpacing],
                    ["Magnetic Medium", report.mptMagneticMedium],
                    ["Method of Applying Magnetic Medium", report.mptMethodOfApplyingMagneticMedium],
                    ["Development Time", report.mptDevelopmentTime],
                    ["Interpretation Time", report.mptInterpretationTime],
                    ["Lighting Equipment", report.mptLightingEquipment],
                    ["Post Cleaning", report.mptPostCleaning],
                  ] as Array<[string, string | null | undefined]>).map(([label, value], idx) => (
                    <tr key={idx} className="border-b border-zinc-200">
                      <td className="bg-orange-50 border-r border-zinc-200 px-3 py-1.5 font-medium text-zinc-700 w-1/3">
                        {label}
                      </td>
                      <td className="px-3 py-1.5">
                        {value && String(value).trim() ? value : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Consumable Details — Make / Product / Lot Number / Expiry per consumable */}
            <div>
              <h3 className="mb-2 text-xs font-bold uppercase text-orange-700 border-b border-orange-300 pb-1">
                Consumable Details
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-orange-800 text-white">
                      <th className="border border-orange-900 px-2 py-2 text-center">Consumable</th>
                      <th className="border border-orange-900 px-2 py-2 text-center">Make</th>
                      <th className="border border-orange-900 px-2 py-2 text-center">Product / Description</th>
                      <th className="border border-orange-900 px-2 py-2 text-center">Lot Number</th>
                      <th className="border border-orange-900 px-2 py-2 text-center">Expiry Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {([
                      ["White Contrast", report.vmptWhiteContrastMake, report.vmptWhiteContrastProduct, report.vmptWhiteContrastLotNo, report.vmptWhiteContrastExpiry],
                      ["Wet Particle Iron Ink", report.vmptInkMake, report.vmptInkProduct, report.vmptInkLotNo, report.vmptInkExpiry],
                    ] as Array<[string, string | null | undefined, string | null | undefined, string | null | undefined, string | null | undefined]>).map(([label, make, product, lotNo, expiry], idx) => (
                      <tr key={idx} className="hover:bg-muted/30">
                        <td className="bg-orange-50 border border-zinc-300 px-3 py-1.5 font-medium text-zinc-700">{label}</td>
                        <td className="border border-zinc-300 px-3 py-1.5">{make && make.trim() ? make : <span className="text-muted-foreground">—</span>}</td>
                        <td className="border border-zinc-300 px-3 py-1.5">{product && product.trim() ? product : <span className="text-muted-foreground">—</span>}</td>
                        <td className="border border-zinc-300 px-3 py-1.5">{lotNo && lotNo.trim() ? lotNo : <span className="text-muted-foreground">—</span>}</td>
                        <td className="border border-zinc-300 px-3 py-1.5">{expiry && expiry.trim() ? expiry : <span className="text-muted-foreground">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Magnetic Particle Testing Details table */}
            {vmptRows.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-bold uppercase text-orange-700 border-b border-orange-300 pb-1">
                  Magnetic Particle Testing Details ({vmptRows.length})
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="bg-orange-800 text-white">
                        <th className="border border-orange-900 px-2 py-2 text-center">Sl. No</th>
                        <th className="border border-orange-900 px-2 py-2 text-center">Part Details</th>
                        <th className="border border-orange-900 px-2 py-2 text-center">ID</th>
                        <th className="border border-orange-900 px-2 py-2 text-center">Weld Dimension</th>
                        <th className="border border-orange-900 px-2 py-2 text-center">Size of Indication Approx. (mm)</th>
                        <th className="border border-orange-900 px-2 py-2 text-center">Observation &amp; Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vmptRows.map((row, idx) => (
                        <tr key={idx} className="hover:bg-muted/30">
                          <td className="border border-zinc-300 px-2 py-1 text-center font-mono">{idx + 1}</td>
                          <td className="border border-zinc-300 px-2 py-1">{row.partDetails ?? "—"}</td>
                          <td className="border border-zinc-300 px-2 py-1">{row.idNo ?? "—"}</td>
                          <td className="border border-zinc-300 px-2 py-1">{row.weldDimension ?? "—"}</td>
                          <td className="border border-zinc-300 px-2 py-1 text-center">{row.indicationSize ?? "—"}</td>
                          <td className="border border-zinc-300 px-2 py-1">{row.observationResult ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
          );
        })()}

        {/* ─── MPT (MAGNETIC PARTICLE TESTING) PROCEDURE + CONSUMABLES ───
            Shown only for MPT reports. The observation rows are stored in
            the shared DptObservation table and are rendered in the
            Inspection Tables section below. */}
        {report.reportType === "PIPELINE_MPT" && (
          <div className="mt-6 space-y-6">
            {/* 3. Magnetic Particle Testing Parameters */}
            <div>
              <h3 className="mb-2 text-xs font-bold uppercase text-orange-700 border-b border-orange-300 pb-1">
                3. Magnetic Particle Testing Parameters
              </h3>
              <table className="w-full border-collapse text-xs">
                <tbody>
                  {([
                    ["Date of Examination", report.mptDateOfExamination ? new Date(report.mptDateOfExamination).toISOString().slice(0, 10) : null],
                    ["Testing Standard", report.mptTestingStandard],
                    ["Acceptance Criteria", report.mptAcceptanceCriteria],
                    ["Surface preparation", report.mptSurfacePreparation],
                    ["Surface temperature", report.mptSurfaceTemperature],
                    ["Type of Instrument / SI.No", report.mptInstrumentSerialNo],
                    ["Instrument / Calibration Date", report.mptCalibrationDate ? new Date(report.mptCalibrationDate).toISOString().slice(0, 10) : null],
                    ["MPT Method", report.mptMethod],
                    ["Type of Current", report.mptTypeOfCurrent],
                    ["AC Yoke Lifting Capacity", report.mptAcYokeLiftingCapacity],
                    ["Contrast Medium", report.mptContrastMedium],
                    ["Method of Pre cleaning", report.mptMethodOfPreCleaning],
                    ["Method of applying White Contrast", report.mptMethodOfApplyingWhiteContrast],
                    ["AC Yoke Pole Spacing", report.mptAcYokePoleSpacing],
                    ["Magnetic Medium", report.mptMagneticMedium],
                    ["Method of applying Magnetic Medium", report.mptMethodOfApplyingMagneticMedium],
                    ["Development time", report.mptDevelopmentTime],
                    ["Interpretation time", report.mptInterpretationTime],
                    ["Lightning Equipment", report.mptLightingEquipment],
                    ["Post cleaning", report.mptPostCleaning],
                  ] as Array<[string, string | null | undefined]>).map(([label, value], idx) => (
                    <tr key={idx} className="border-b border-zinc-200">
                      <td className="bg-orange-50 border-r border-zinc-200 px-3 py-1.5 font-medium text-zinc-700 w-1/3">
                        {label}
                      </td>
                      <td className="px-3 py-1.5">
                        {value && String(value).trim() ? value : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Consumable Details */}
            <div>
              <h3 className="mb-2 text-xs font-bold uppercase text-orange-700 border-b border-orange-300 pb-1">
                Consumable Details
              </h3>
              <table className="w-full border-collapse text-xs">
                <tbody>
                  {([
                    ["White Contrast", report.mptWhiteContrast],
                    ["Wet Particle Iron Ink", report.mptWetParticleIronInk],
                  ] as Array<[string, string | null | undefined]>).map(([label, value], idx) => (
                    <tr key={idx} className="border-b border-zinc-200">
                      <td className="bg-orange-50 border-r border-zinc-200 px-3 py-1.5 font-medium text-zinc-700 w-1/3">
                        {label}
                      </td>
                      <td className="px-3 py-1.5">
                        {value && String(value).trim() ? value : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ─── WELD SCAN: INSTRUMENT + PROBE + SCANNING DETAILS ───
            Shown only for Weld Scan reports. Data lives in JSON columns on
            the report record (wsInstrumentRows / wsProbeRows) and in the
            wsScanning* fields. The Test Results table is rendered in the
            Inspection Tables section below. */}
        {report.reportType === "PIPELINE_WELD_SCAN" && (() => {
          let wsInstrumentRows: Array<Record<string, string>> = [];
          let wsProbeRows: Array<Record<string, string>> = [];
          try {
            const parsed = JSON.parse(report.wsInstrumentRows ?? "[]");
            if (Array.isArray(parsed)) wsInstrumentRows = parsed;
          } catch {}
          try {
            const parsed = JSON.parse(report.wsProbeRows ?? "[]");
            if (Array.isArray(parsed)) wsProbeRows = parsed;
          } catch {}
          const wsScanPairs: Array<[string, string | null | undefined]> = [
            ["Calibration Block", report.wsScanningCalibrationBlock],
            ["Reference Level", report.wsScanningReferenceLevel],
            ["Extent of Examination", report.wsScanningExtentOfExamination],
            ["Surface Condition", report.wsScanningSurfaceCondition],
          ];
          return (
            <div className="mt-6 space-y-6">
              {/* Instrument Details */}
              {wsInstrumentRows.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-bold uppercase text-cyan-700 border-b border-cyan-300 pb-1">
                    Instrument Details
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr className="bg-cyan-700 text-white">
                          <th className="border border-cyan-800 px-2 py-2 text-center">Equipment Type</th>
                          <th className="border border-cyan-800 px-2 py-2 text-center">Machine Make</th>
                          <th className="border border-cyan-800 px-2 py-2 text-center">Model</th>
                          <th className="border border-cyan-800 px-2 py-2 text-center">M/c Sr. No.</th>
                          <th className="border border-cyan-800 px-2 py-2 text-center">Calibration Due Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {wsInstrumentRows.map((row, idx) => (
                          <tr key={idx} className="hover:bg-muted/30">
                            <td className="border border-zinc-300 px-2 py-1">{row.equipmentType || "—"}</td>
                            <td className="border border-zinc-300 px-2 py-1 text-center">{row.machineMake || "—"}</td>
                            <td className="border border-zinc-300 px-2 py-1 text-center">{row.model || "—"}</td>
                            <td className="border border-zinc-300 px-2 py-1 text-center font-mono">{row.mcSrNo || "—"}</td>
                            <td className="border border-zinc-300 px-2 py-1 text-center">{row.calibrationDueDate || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Test Probe Details */}
              {wsProbeRows.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-bold uppercase text-cyan-700 border-b border-cyan-300 pb-1">
                    Test Probe Details
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr className="bg-cyan-700 text-white">
                          <th className="border border-cyan-800 px-2 py-2 text-center">Probe Type</th>
                          <th className="border border-cyan-800 px-2 py-2 text-center">Probe Angle</th>
                          <th className="border border-cyan-800 px-2 py-2 text-center">Frequency</th>
                          <th className="border border-cyan-800 px-2 py-2 text-center">Size</th>
                          <th className="border border-cyan-800 px-2 py-2 text-center">Probe No.</th>
                          <th className="border border-cyan-800 px-2 py-2 text-center">Range</th>
                          <th className="border border-cyan-800 px-2 py-2 text-center">Reference dB</th>
                          <th className="border border-cyan-800 px-2 py-2 text-center">Scanning dB</th>
                        </tr>
                      </thead>
                      <tbody>
                        {wsProbeRows.map((row, idx) => (
                          <tr key={idx} className="hover:bg-muted/30">
                            <td className="border border-zinc-300 px-2 py-1 text-center">{row.probeType || "—"}</td>
                            <td className="border border-zinc-300 px-2 py-1 text-center">{row.probeAngle || "—"}</td>
                            <td className="border border-zinc-300 px-2 py-1 text-center">{row.frequency || "—"}</td>
                            <td className="border border-zinc-300 px-2 py-1 text-center">{row.size || "—"}</td>
                            <td className="border border-zinc-300 px-2 py-1 text-center font-mono">{row.probeNo || "—"}</td>
                            <td className="border border-zinc-300 px-2 py-1 text-center">{row.range || "—"}</td>
                            <td className="border border-zinc-300 px-2 py-1 text-center">{row.referenceDb || "—"}</td>
                            <td className="border border-zinc-300 px-2 py-1 text-center">{row.scanningDb || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Scanning Details */}
              <div>
                <h3 className="mb-2 text-xs font-bold uppercase text-cyan-700 border-b border-cyan-300 pb-1">
                  Scanning Details
                </h3>
                <table className="w-full border-collapse text-xs">
                  <tbody>
                    {wsScanPairs.map(([label, value], idx) => (
                      <tr key={idx} className="border-b border-zinc-200">
                        <td className="bg-cyan-50 border-r border-zinc-200 px-3 py-1.5 font-medium text-zinc-700 w-1/3">
                          {label}
                        </td>
                        <td className="px-3 py-1.5">
                          {value && String(value).trim() ? value : <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}

        {/* ─── VESSEL WELD SCAN: TESTING PARAMETERS + DETAILS ───
            Shown only for VESSEL_WELD_SCAN reports. Renders the grouped
            Weld Scan Testing Parameters (incl. the fixed 4-probe grid) and
            the Vessel Weld Scan Testing Details table. Completely separate
            from the Piping Weld Scan block above. */}
        {report.reportType === "VESSEL_WELD_SCAN" && (() => {
          let vwsProbes: Array<Record<string, string>> = [];
          let vwsRows: Array<Record<string, string>> = [];
          try {
            const parsed = JSON.parse(report.vwsProbeDetails ?? "[]");
            if (Array.isArray(parsed)) vwsProbes = parsed;
          } catch {}
          try {
            const parsed = JSON.parse(report.vwsDetailRows ?? "[]");
            if (Array.isArray(parsed)) vwsRows = parsed;
          } catch {}
          const vwsParamGroups: Array<{ title: string; rows: Array<[string, string | null | undefined, boolean?]> }> = [
            {
              title: "General Information",
              rows: [
                ["Date of Examination", report.vwsDateOfExamination, true],
                ["Testing Standard", report.vwsTestingStandard],
                ["Acceptance Criteria", report.vwsAcceptanceCriteria],
                ["UT Procedure", report.vwsUtProcedure],
              ],
            },
            {
              title: "Equipment Details",
              rows: [
                ["Equipment Make", report.vwsEquipmentMake],
                ["Equipment Model", report.vwsEquipmentModel],
                ["Equipment Serial Number", report.vwsEquipmentSerialNo],
                ["Calibration Due Date", report.vwsCalibrationDueDate, true],
              ],
            },
            {
              title: "Cable Details",
              rows: [
                ["Cable Length", report.vwsCableLength],
                ["Cable Type", report.vwsCableType],
              ],
            },
            {
              title: "Calibration Details",
              rows: [
                ["Calibration Block", report.vwsCalibrationBlock],
                ["Calibration Block Material / MOC", report.vwsCalibrationBlockMoc],
                ["Reference Reflector", report.vwsReferenceReflector],
                ["Reference Level", report.vwsReferenceLevel],
              ],
            },
            {
              title: "Other Testing Parameters",
              rows: [
                ["Flaw Sizing Technique", report.vwsFlawSizingTechnique],
                ["Surface Temperature", report.vwsSurfaceTemperature],
                ["Method", report.vwsTestingMethod],
                ["Couplant", report.vwsCouplant],
                ["Surface Preparation", report.vwsSurfacePreparation],
                ["Surface Finish", report.vwsSurfaceFinish],
                ["Extent of Scanning", report.vwsExtentOfScanning],
              ],
            },
          ];
          return (
            <div className="mt-6 space-y-6">
              {/* Equipment: Vessel badge */}
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="border-cyan-400 text-cyan-700">
                  Equipment: Vessel
                </Badge>
              </div>

              {/* Weld Scan Testing Parameters — grouped two-column table */}
              <div>
                <h3 className="mb-2 text-xs font-bold uppercase text-cyan-700 border-b border-cyan-300 pb-1">
                  Weld Scan Testing Parameters
                </h3>
                <table className="w-full border-collapse text-xs">
                  <tbody>
                    {vwsParamGroups.map((group) => (
                      <Fragment key={group.title}>
                        <tr className="bg-cyan-100">
                          <td colSpan={2} className="border border-zinc-300 px-3 py-1.5 font-semibold text-cyan-800">
                            {group.title}
                          </td>
                        </tr>
                        {group.rows.map(([label, value, isDate], idx) => {
                          let v = value && String(value).trim() ? String(value).trim() : null;
                          if (v && isDate) {
                            try { v = new Date(v).toISOString().slice(0, 10); } catch {}
                          }
                          return (
                            <tr key={`${group.title}-${idx}`} className="border-b border-zinc-200">
                              <td className="bg-cyan-50 border-r border-zinc-200 px-3 py-1.5 font-medium text-zinc-700 w-1/3">
                                {label}
                              </td>
                              <td className="px-3 py-1.5">
                                {v ? v : <span className="text-muted-foreground">—</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Probe Details — fixed 4-probe grid */}
              {vwsProbes.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-bold uppercase text-cyan-700 border-b border-cyan-300 pb-1">
                    Probe Details
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr className="bg-cyan-700 text-white">
                          <th className="border border-cyan-800 px-2 py-2 text-center">Probe</th>
                          <th className="border border-cyan-800 px-2 py-2 text-center">Probe Angle</th>
                          <th className="border border-cyan-800 px-2 py-2 text-center">Frequency</th>
                          <th className="border border-cyan-800 px-2 py-2 text-center">Probe Size</th>
                          <th className="border border-cyan-800 px-2 py-2 text-center">Serial Number</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vwsProbes.map((row, idx) => (
                          <tr key={idx} className="hover:bg-muted/30">
                            <td className="border border-zinc-300 px-2 py-1 font-medium">{row.probeType === "Longitudinal Wave" ? "Longitudinal Wave Probe" : "Shear Wave Probe"}</td>
                            <td className="border border-zinc-300 px-2 py-1 text-center">{row.probeAngle || "—"}</td>
                            <td className="border border-zinc-300 px-2 py-1 text-center">{row.frequency || "—"}</td>
                            <td className="border border-zinc-300 px-2 py-1 text-center">{row.probeSize || "—"}</td>
                            <td className="border border-zinc-300 px-2 py-1 text-center font-mono">{row.serialNo || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Weld Scan Testing Details — Vessel column set */}
              {vwsRows.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-bold uppercase text-cyan-700 border-b border-cyan-300 pb-1">
                    Weld Scan Testing Details ({vwsRows.length})
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr className="bg-cyan-700 text-white">
                          <th className="border border-cyan-800 px-2 py-2 text-center">Sl. No</th>
                          <th className="border border-cyan-800 px-2 py-2 text-center">Component</th>
                          <th className="border border-cyan-800 px-2 py-2 text-center">Plate / Weld ID</th>
                          <th className="border border-cyan-800 px-2 py-2 text-center">Weld Dimension</th>
                          <th className="border border-cyan-800 px-2 py-2 text-center">Probe Angle</th>
                          <th className="border border-cyan-800 px-2 py-2 text-center">Probe Frequency</th>
                          <th className="border border-cyan-800 px-2 py-2 text-center">Observation &amp; Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vwsRows.map((row, idx) => (
                          <tr key={idx} className="hover:bg-muted/30">
                            <td className="border border-zinc-300 px-2 py-1 text-center font-mono">{idx + 1}</td>
                            <td className="border border-zinc-300 px-2 py-1">{row.component || "—"}</td>
                            <td className="border border-zinc-300 px-2 py-1">{row.plateWeldId || "—"}</td>
                            <td className="border border-zinc-300 px-2 py-1">{row.weldDimension || "—"}</td>
                            <td className="border border-zinc-300 px-2 py-1 text-center">{row.probeAngle || "—"}</td>
                            <td className="border border-zinc-300 px-2 py-1 text-center">{row.probeFrequency || "—"}</td>
                            <td className="border border-zinc-300 px-2 py-1">{row.observationResult || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* ─── VESSEL UT THICKNESS MEASUREMENT: PARAMETERS + READINGS ───
            Shown only for VESSEL_UTM reports. Renders the grouped UT
            Thickness Measurement Parameters (incl. the repeatable
            Longitudinal Wave 0° probe grid) and the unified clock-position
            readings table (12 / 3 / 6 / 9 o'clock — every reading the user
            entered, no empty slots). Legacy orientation-based rows
            (horizontal / vertical / dish / nozzle shapes) are converted
            transparently, so existing reports keep all their readings.
            Minimum Measured Thickness is recomputed from the stored
            readings. Completely separate from the Piping Thickness
            Measurement block above. */}
        {report.reportType === "VESSEL_UTM" && (() => {
          let utmProbes: Array<Record<string, string>> = [];
          try {
            const parsed = JSON.parse(report.vutmLwProbeRows ?? "[]");
            if (Array.isArray(parsed) && parsed.length > 0) utmProbes = parsed;
          } catch {}
          // The orientation (VESSEL_UTM only) decides the readings-table
          // structure: VERTICAL → direction rows, otherwise clock rows.
          const utmIsVertical = report.vesselOrientation === "VERTICAL";
          const utmRows = vutmRowsFromReport(
            report.vutmShellRows,
            report.vutmDishRows,
            report.vutmNozzleRows,
            (report.vesselOrientation as "HORIZONTAL" | "VERTICAL" | null) ?? null,
          );
          const utmParamGroups: Array<{ title: string; rows: Array<[string, string | null | undefined, boolean?]> }> = [
            {
              title: "General Information",
              rows: [
                ["Date of Examination", report.vutmDateOfExamination, true],
                ["Testing Standard", report.vutmTestingStandard],
                ["Acceptance Criteria", report.vutmAcceptanceCriteria],
                ["UT Procedure", report.vutmUtProcedure],
              ],
            },
            {
              title: "Equipment Details",
              rows: [
                ["Equipment Make", report.vutmEquipmentMake],
                ["Equipment Model", report.vutmEquipmentModel],
                ["Equipment Serial Number", report.vutmEquipmentSerialNo],
                ["Calibration Due Date", report.vutmCalibrationDueDate, true],
              ],
            },
            {
              title: "Cable & Crystal Details",
              rows: [
                ["Cable Length and Type", report.vutmCableLengthAndType],
                ["Type of Crystal", report.vutmTypeOfCrystal],
              ],
            },
            {
              title: "Calibration Details",
              rows: [
                ["Calibration Block Dimension / MOC", report.vutmCalibrationBlock],
              ],
            },
            {
              title: "Other Testing Parameters",
              rows: [
                ["Surface Temperature", report.vutmSurfaceTemperature],
                ["Method", report.vutmMethod],
                ["Couplant", report.vutmCouplant],
                ["Surface Preparation", report.vutmSurfacePreparation],
                ["Surface Finish", report.vutmSurfaceFinish],
              ],
            },
          ];
          const minCell = (min: unknown) => (min && String(min).trim() ? String(min) : "—");
          return (
            <div className="mt-6 space-y-6">
              {/* Equipment type + Vessel Orientation badges (UTM only) */}
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="border-emerald-400 text-emerald-700">
                  Equipment: Vessel
                </Badge>
                <Badge variant="outline" className="border-emerald-400 text-emerald-700">
                  {utmIsVertical ? "Vertical Vessel" : "Horizontal Vessel"}
                </Badge>
              </div>

              {/* UT Thickness Measurement Parameters — grouped two-column table */}
              <div>
                <h3 className="mb-2 text-xs font-bold uppercase text-emerald-700 border-b border-emerald-300 pb-1">
                  UT Thickness Measurement Parameters
                </h3>
                <table className="w-full border-collapse text-xs">
                  <tbody>
                    {utmParamGroups.map((group) => (
                      <Fragment key={group.title}>
                        <tr className="bg-emerald-100">
                          <td colSpan={2} className="border border-zinc-300 px-3 py-1.5 font-semibold text-emerald-800">
                            {group.title}
                          </td>
                        </tr>
                        {group.rows.map(([label, value, isDate], idx) => {
                          let v = value && String(value).trim() ? String(value).trim() : null;
                          if (v && isDate) {
                            try { v = new Date(v).toISOString().slice(0, 10); } catch {}
                          }
                          return (
                            <tr key={`${group.title}-${idx}`} className="border-b border-zinc-200">
                              <td className="bg-emerald-50 border-r border-zinc-200 px-3 py-1.5 font-medium text-zinc-700 w-1/3">
                                {label}
                              </td>
                              <td className="px-3 py-1.5">
                                {v ? v : <span className="text-muted-foreground">—</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Probe Details — repeatable Longitudinal Wave (0°) grid */}
              {utmProbes.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-bold uppercase text-emerald-700 border-b border-emerald-300 pb-1">
                    Probe Details — Longitudinal Wave (0°)
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr className="bg-emerald-700 text-white">
                          <th className="border border-emerald-800 px-2 py-2 text-center">Probe</th>
                          <th className="border border-emerald-800 px-2 py-2 text-center">Probe Angle</th>
                          <th className="border border-emerald-800 px-2 py-2 text-center">Frequency</th>
                          <th className="border border-emerald-800 px-2 py-2 text-center">Size</th>
                          <th className="border border-emerald-800 px-2 py-2 text-center">S.No.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {utmProbes.map((row, idx) => (
                          <tr key={idx} className="hover:bg-muted/30">
                            <td className="border border-zinc-300 px-2 py-1 font-medium">Longitudinal Wave Probe</td>
                            <td className="border border-zinc-300 px-2 py-1 text-center">0°</td>
                            <td className="border border-zinc-300 px-2 py-1 text-center">{row.frequency || "—"}</td>
                            <td className="border border-zinc-300 px-2 py-1 text-center">{row.probeSize || "—"}</td>
                            <td className="border border-zinc-300 px-2 py-1 text-center font-mono">{row.serialNo || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* UT Thickness Measurement Readings — H/V structure follows
                  the report's orientation (VESSEL_UTM only). */}
              <div>
                <h3 className="mb-2 text-xs font-bold uppercase text-emerald-700 border-b border-emerald-300 pb-1">
                  UT Thickness Measurement Readings — Components{" "}
                  {utmIsVertical ? "(Directions)" : "(Clock Positions)"}
                </h3>
                <div className="overflow-x-auto">
                  {utmIsVertical ? (
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr className="bg-emerald-700 text-white">
                          <th className="border border-emerald-800 px-2 py-2 text-center">MOC</th>
                          <th className="border border-emerald-800 px-2 py-2 text-center">Component Type</th>
                          <th className="border border-emerald-800 px-2 py-2 text-center">Component ID</th>
                          <th className="border border-emerald-800 px-2 py-2 text-center">Nominal Thickness (mm)</th>
                          <th className="border border-emerald-800 px-2 py-2 text-center">Direction</th>
                          <th className="border border-emerald-800 px-2 py-2 text-center">Readings (mm)</th>
                          <th className="border border-emerald-800 px-2 py-2 text-center">Minimum Measured Thickness (mm)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {utmRows.length === 0 && (
                          <tr><td colSpan={7} className="text-center py-4 text-muted-foreground border border-zinc-300">No component measurement rows recorded.</td></tr>
                        )}
                        {utmRows.map((rowV, idx) => {
                          const dirRow = rowV as import("@/lib/vutm-rows").VutmDirectionRow;
                          const readings = (dirRow.readings ?? []).filter((s) => s && String(s).trim());
                          return (
                            <tr key={idx} className="hover:bg-muted/30 align-top">
                              <td className="border border-zinc-300 px-2 py-1">{dirRow.moc || "—"}</td>
                              <td className="border border-zinc-300 px-2 py-1">{dirRow.componentType || "—"}</td>
                              <td className="border border-zinc-300 px-2 py-1">{dirRow.componentId || "—"}</td>
                              <td className="border border-zinc-300 px-2 py-1 text-center">{dirRow.nominalThickness || "—"}</td>
                              <td className="border border-zinc-300 px-2 py-1 text-center">{dirRow.direction || "—"}</td>
                              <td className="border border-zinc-300 px-2 py-1 text-center">
                                {readings.length > 0 ? (
                                  <span className="whitespace-pre-line">{readings.join("\n")}</span>
                                ) : "—"}
                              </td>
                              <td className="border border-zinc-300 px-2 py-1 text-center font-mono font-semibold">
                                {minCell(vutmMinOfSpots(dirRow.readings))}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="bg-emerald-700 text-white">
                        <th className="border border-emerald-800 px-2 py-2 text-center">MOC</th>
                        <th className="border border-emerald-800 px-2 py-2 text-center">Component Type</th>
                        <th className="border border-emerald-800 px-2 py-2 text-center">Component ID</th>
                        <th className="border border-emerald-800 px-2 py-2 text-center">Nominal Thickness (mm)</th>
                        <th className="border border-emerald-800 px-2 py-2 text-center">12 O&apos;clock (mm)</th>
                        <th className="border border-emerald-800 px-2 py-2 text-center">3 O&apos;clock (mm)</th>
                        <th className="border border-emerald-800 px-2 py-2 text-center">6 O&apos;clock (mm)</th>
                        <th className="border border-emerald-800 px-2 py-2 text-center">9 O&apos;clock (mm)</th>
                        <th className="border border-emerald-800 px-2 py-2 text-center">Minimum Measured Thickness (mm)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {utmRows.length === 0 && (
                        <tr><td colSpan={9} className="text-center py-4 text-muted-foreground border border-zinc-300">No component measurement rows recorded.</td></tr>
                      )}
                      {utmRows.map((row, idx) => (
                        <tr key={idx} className="hover:bg-muted/30 align-top">
                          <td className="border border-zinc-300 px-2 py-1">{row.moc || "—"}</td>
                          <td className="border border-zinc-300 px-2 py-1">{row.componentType || "—"}</td>
                          <td className="border border-zinc-300 px-2 py-1">{row.componentId || "—"}</td>
                          <td className="border border-zinc-300 px-2 py-1 text-center">{row.nominalThickness || "—"}</td>
                          {(["c12", "c3", "c6", "c9"] as const).map((k) => (
                            <td key={k} className="border border-zinc-300 px-2 py-1 text-center">
                              {(() => {
                                const readings = (row[k] as string[] | undefined)?.filter((s) => s && String(s).trim()) ?? [];
                                return readings.length > 0 ? (
                                  <span className="whitespace-pre-line">{readings.join("\n")}</span>
                                ) : "—";
                              })()}
                            </td>
                          ))}
                          <td className="border border-zinc-300 px-2 py-1 text-center font-mono font-semibold">
                            {minCell(vutmMinOfSpots(
                              (row as VutmClockRow).c12,
                              (row as VutmClockRow).c3,
                              (row as VutmClockRow).c6,
                              (row as VutmClockRow).c9,
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* ─── 4. ENGINEERING DRAWINGS ───
            Shows the actual uploaded drawing files. Images (PNG/JPG/JPEG/
            WEBP) are served by /api/drawings/[id]/preview directly; PDF
            drawings are rasterized server-side (page 1 → PNG, 150 DPI) by
            the same endpoint so the Review page shows a real visual
            preview of every drawing instead of an empty placeholder.
            Aspect ratio is preserved with object-contain. */}
        {report.drawingLinks && report.drawingLinks.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-2 text-xs font-bold uppercase text-zinc-700 border-b border-zinc-300 pb-1">
              Engineering Drawings ({report.drawingLinks.length})
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {report.drawingLinks.map((link) => {
                const drawing = link.drawing;
                // Prefer the drawing's ACTIVE revision; fall back to the
                // latest revision returned by the API.
                const rev =
                  drawing.revisions?.find((r) => r.id === (drawing as { activeRevisionId?: string | null }).activeRevisionId) ??
                  drawing.revisions?.[0];
                if (!rev) return null;
                const ext = (rev.fileExtension || "").toLowerCase();
                const isImage = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"].includes(ext);
                const isPdf = ext === ".pdf";
                // The preview endpoint serves images directly and PDF
                // drawings as a rasterized page-1 PNG.
                const previewUrl = (isImage || isPdf) && drawing.id
                  ? `/api/drawings/${drawing.id}/preview`
                  : null;
                return (
                  <div key={link.id} className="border border-zinc-300 rounded p-2 text-[10px]">
                    <div className="mb-1 font-semibold truncate" title={drawing.title}>
                      {drawing.title}
                    </div>
                    <div
                      className="relative bg-zinc-50 border border-zinc-200 rounded mb-1 flex items-center justify-center overflow-hidden"
                      style={{ minHeight: "80px" }}
                    >
                      {previewUrl ? (
                        <AuthImage
                          src={previewUrl}
                          alt={drawing.title}
                          className="w-full h-auto max-h-[160px] object-contain cursor-zoom-in"
                          onClick={() => setLightbox({
                            url: previewUrl,
                            caption: `${drawing.title} — ${drawing.drawingNumber}`,
                          })}
                        />
                      ) : (
                        <div className="p-2 text-center text-zinc-500">
                          <FileText className="mx-auto h-8 w-8 mb-1" />
                          <div>{ext.toUpperCase().replace(".", "") || "FILE"} Document</div>
                          <div className="text-[8px]">({rev.fileName})</div>
                        </div>
                      )}
                    </div>
                    <div className="truncate text-zinc-500" title={rev.fileName}>
                      {rev.fileName}{isPdf ? " (page 1 preview)" : ""}
                    </div>
                    <div className="flex items-center justify-between text-[8px] text-zinc-400">
                      <span className="uppercase">{ext.replace(".", "")}</span>
                      <span>{Math.round(rev.fileSize / 1024)} KB</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Measurement tables — ONLY for PIPELINE_THICKNESS reports.
            This must NEVER appear in DPT or other report types. The report
            type is checked explicitly (not just whether measurements exist)
            so that a Thickness report with zero rows still shows the table
            structure, while a DPT report never shows it.

            AUTOMATIC INDEX NUMBERING:
              The section is numbered "7. Thickness Measurement" (parent).
              Each sub-table is numbered dynamically: "7.1 – Label",
              "7.2 – Label", "7.3 – Label", etc. An Index list is shown
              above the tables listing all sub-tables. When tables are
              added/deleted/renamed/reordered, the numbering updates
              automatically because it's derived from the array index. */}
        {report.reportType === "PIPELINE_THICKNESS" && (() => {
          // Parse the table-config JSON (falls back to a single default
          // table when missing/invalid). Memoize at render time.
          const tables: ThicknessTableConfig[] = parseThicknessTablesConfig(
            report.thicknessTablesConfig ?? null,
          );
          // Parse user-defined extra columns for the measurement table.
          // Mirrors the PDF engine: custom columns are appended after the
          // fixed system columns.
          let thicknessCustomCols: Array<{ id: string; name: string; unit: string }> = [];
          try {
            const cc = JSON.parse(report.customColumns ?? "[]");
            if (Array.isArray(cc)) thicknessCustomCols = cc;
          } catch {}
          return (
            <>
              {/* ── Parent section heading: "7. Thickness Measurement" ── */}
              <h3 className="mb-2 text-sm font-bold text-zinc-800 border-b border-zinc-400 pb-1">
                {thicknessSectionHeading()}
              </h3>

              {/* ── Index / Table of Contents for this section ── */}
              <div className="mb-4 ml-4 text-xs text-zinc-600 space-y-0.5">
                {tables.map((t, i) => (
                  <div key={t.id}>{thicknessTableHeading(i + 1, t.label)}</div>
                ))}
              </div>

              {/* ── Render each table with its numbered heading ── */}
              {tables.map((table, tableIdx) => {
                // Partition measurements into this table.
                const tableRows = report.measurements.filter(
                  (m) => (m.tableGroup ?? DEFAULT_TABLE_ID) === table.id,
                );
                return (
                  <div key={table.id} className={tableIdx > 0 ? "mt-6" : ""}>
                    {/* Numbered table heading: "7.N – [Label]" */}
                    <h4 className="mb-2 text-xs font-bold uppercase text-emerald-800 border-b border-emerald-300 pb-1">
                      {thicknessTableHeading(tableIdx + 1, table.label)}
                    </h4>
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-[11px]">
                        <thead>
                          <tr className="bg-emerald-800 text-white">
                            <th className="border border-emerald-900 px-2 py-2 text-center align-middle" style={{ minWidth: 50 }}>Dia mm<br />(inch)</th>
                            <th className="border border-emerald-900 px-2 py-2 text-center align-middle" style={{ minWidth: 55 }}>Pipe<br />Schedule</th>
                            <th className="border border-emerald-900 px-2 py-2 text-center align-middle" style={{ minWidth: 55 }}>Nominal<br />Thickness<br />(mm)</th>
                            <th className="border border-emerald-900 px-2 py-2 text-center align-middle" style={{ minWidth: 60 }}>Component<br />Type</th>
                            <th className="border border-emerald-900 px-2 py-2 text-center align-middle" style={{ minWidth: 45 }}>Point<br />No</th>
                            <th className="border border-emerald-900 px-2 py-2 text-center align-middle" style={{ minWidth: 65 }}>
                              <div className="flex flex-col items-center">
                                <span>12 o'clock</span><span>North</span><span>(mm)</span>
                              </div>
                            </th>
                            <th className="border border-emerald-900 px-2 py-2 text-center align-middle" style={{ minWidth: 65 }}>
                              <div className="flex flex-col items-center">
                                <span>3 o'clock</span><span>East</span><span>(mm)</span>
                              </div>
                            </th>
                            <th className="border border-emerald-900 px-2 py-2 text-center align-middle" style={{ minWidth: 65 }}>
                              <div className="flex flex-col items-center">
                                <span>6 o'clock</span><span>South</span><span>(mm)</span>
                              </div>
                            </th>
                            <th className="border border-emerald-900 px-2 py-2 text-center align-middle" style={{ minWidth: 65 }}>
                              <div className="flex flex-col items-center">
                                <span>9 o'clock</span><span>West</span><span>(mm)</span>
                              </div>
                            </th>
                            <th className="border border-emerald-900 px-2 py-2 text-center align-middle" style={{ minWidth: 70 }}>
                              <div className="flex flex-col items-center">
                                <span>Observed</span><span>Minimum</span><span>Thickness (mm)</span>
                              </div>
                            </th>
                            <th className="border border-emerald-900 px-2 py-2 text-center align-middle" style={{ minWidth: 200 }}>Findings / Comments</th>
                            {thicknessCustomCols.map((cc) => (
                              <th key={cc.id} className="border border-emerald-900 px-2 py-2 text-center align-middle" style={{ minWidth: 60 }}>
                                {cc.name}{cc.unit && <span className="opacity-70"> ({cc.unit})</span>}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {tableRows.length === 0 && (
                            <tr>
                              <td colSpan={11 + thicknessCustomCols.length} className="border border-zinc-400 text-center py-4 text-zinc-500">
                                No measurement rows in this table.
                              </td>
                            </tr>
                          )}
                          {tableRows.map((m) => (
                            <tr key={m.id} className="hover:bg-zinc-50">
                              <td className="border border-zinc-400 px-2 py-1 text-center font-mono">{m.pipeSizeInch}</td>
                              <td className="border border-zinc-400 px-2 py-1 text-center font-mono">{m.pipeSchedule}</td>
                              <td className="border border-zinc-400 px-2 py-1 text-center tabular-nums">
                                {m.nominalThicknessMm !== null ? m.nominalThicknessMm.toFixed(2) : "—"}
                                {m.standard && !m.standard.isVerified && (
                                  <span className="ml-1 text-[9px] text-amber-700" title="Reference data not yet verified">(unv)</span>
                                )}
                              </td>
                              <td className="border border-zinc-400 px-2 py-1 text-center">
                                {m.componentType?.label ?? m.componentTypeCode}
                              </td>
                              <td className="border border-zinc-400 px-2 py-1 text-center font-mono">{m.pointNo}</td>
                              <td className="border border-zinc-400 px-2 py-1 text-center tabular-nums">{fmtMeasurement(m.northMm, m.northStatus)}</td>
                              <td className="border border-zinc-400 px-2 py-1 text-center tabular-nums">{fmtMeasurement(m.eastMm, m.eastStatus)}</td>
                              <td className="border border-zinc-400 px-2 py-1 text-center tabular-nums">{fmtMeasurement(m.southMm, m.southStatus)}</td>
                              <td className="border border-zinc-400 px-2 py-1 text-center tabular-nums">{fmtMeasurement(m.westMm, m.westStatus)}</td>
                              <td className="border border-zinc-400 px-2 py-1 text-center font-semibold tabular-nums bg-emerald-50">
                                {m.observedMinimumMm !== null ? m.observedMinimumMm.toFixed(2) : "—"}
                              </td>
                              <td className="border border-zinc-400 px-2 py-1 text-left whitespace-pre-wrap">{m.findingsComments ?? "—"}</td>
                              {thicknessCustomCols.map((cc) => {
                                let val = "—";
                                try {
                                  const vals = JSON.parse(m.customColumnValues ?? "{}");
                                  val = vals[cc.id] ?? "—";
                                } catch {}
                                return <td key={cc.id} className="border border-zinc-400 px-2 py-1 text-center">{val}</td>;
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </>
          );
        })()} {/* end measurement tables — Thickness only */}

        {/* ─── 5. INSPECTION TABLES (type-specific results) ─── */}

        {/* Visual Inspection Observations — shown only for PIPELINE_VISUAL
            reports. Renders every saved observation row with all its
            user-entered values. */}
        {report.reportType === "PIPELINE_VISUAL" && report.visualObservations && report.visualObservations.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-2 text-xs font-bold uppercase text-blue-700 border-b border-blue-300 pb-1">
              Visual Inspection Observations ({report.visualObservations.length})
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="bg-blue-800 text-white">
                    {[
                      "Point No", "Location", "Pipeline Condition", "External Surface Condition",
                      "Coating / Paint Condition", "Corrosion Observed", "Leakage Observed",
                      "Damage / Deformation", "Supports / Hangers", "Weld Joint Condition",
                      "Insulation Condition", "Findings", "Recommendations", "Inspector Comments",
                    ].map((h) => (
                      <th key={h} className="border border-blue-900 px-2 py-2 text-center align-middle">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.visualObservations.map((obs) => (
                    <tr key={obs.id} className="hover:bg-muted/30">
                      <td className="border border-zinc-300 px-2 py-1 text-center font-mono">{obs.pointNo}</td>
                      <td className="border border-zinc-300 px-2 py-1">{obs.location ?? "—"}</td>
                      <td className="border border-zinc-300 px-2 py-1">{obs.pipelineCondition ?? "—"}</td>
                      <td className="border border-zinc-300 px-2 py-1">{obs.externalSurfaceCondition ?? "—"}</td>
                      <td className="border border-zinc-300 px-2 py-1">{obs.coatingPaintCondition ?? "—"}</td>
                      <td className="border border-zinc-300 px-2 py-1">{obs.corrosionObserved ?? "—"}</td>
                      <td className="border border-zinc-300 px-2 py-1">{obs.leakageObserved ?? "—"}</td>
                      <td className="border border-zinc-300 px-2 py-1">{obs.damageOrDeformation ?? "—"}</td>
                      <td className="border border-zinc-300 px-2 py-1">{obs.supportsHangersCondition ?? "—"}</td>
                      <td className="border border-zinc-300 px-2 py-1">{obs.weldJointCondition ?? "—"}</td>
                      <td className="border border-zinc-300 px-2 py-1">{obs.insulationCondition ?? "—"}</td>
                      <td className="border border-zinc-300 px-2 py-1">{obs.findings ?? "—"}</td>
                      <td className="border border-zinc-300 px-2 py-1">{obs.recommendations ?? "—"}</td>
                      <td className="border border-zinc-300 px-2 py-1">{obs.inspectorComments ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* DPT Inspection Results — shown only for PIPELINE_DPT reports.
            Renders the saved observation rows including the Indication
            Size column and every user-defined custom column. */}
        {report.reportType === "PIPELINE_DPT" && report.dptObservations && report.dptObservations.length > 0 && (() => {
          let dptCustomCols: Array<{ id: string; name: string; unit: string }> = [];
          try {
            const cc = JSON.parse(report.dptCustomColumns ?? "[]");
            if (Array.isArray(cc)) dptCustomCols = cc;
          } catch {}
          return (
            <div className="mt-6">
              <h3 className="mb-2 text-xs font-bold uppercase text-purple-700 border-b border-purple-300 pb-1">
                DPT Inspection Results ({report.dptObservations.length})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-purple-800 text-white">
                      <th className="border border-purple-900 px-2 py-2 text-center">Sl. No</th>
                      <th className="border border-purple-900 px-2 py-2 text-center">Description</th>
                      <th className="border border-purple-900 px-2 py-2 text-center">Weld Type</th>
                      <th className="border border-purple-900 px-2 py-2 text-center">Indication<br />Size (mm)</th>
                      <th className="border border-purple-900 px-2 py-2 text-center">Result</th>
                      {dptCustomCols.map((cc) => (
                        <th key={cc.id} className="border border-purple-900 px-2 py-2 text-center">
                          {cc.name}{cc.unit && <span className="opacity-70"> ({cc.unit})</span>}
                        </th>
                      ))}
                      <th className="border border-purple-900 px-2 py-2 text-center">Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.dptObservations.map((obs) => (
                      <tr key={obs.id} className="hover:bg-muted/30">
                        <td className="border border-zinc-300 px-2 py-1 text-center font-mono">{obs.serialNo}</td>
                        <td className="border border-zinc-300 px-2 py-1">{obs.description ?? "—"}</td>
                        <td className="border border-zinc-300 px-2 py-1 text-center">{obs.weldType ?? "—"}</td>
                        <td className="border border-zinc-300 px-2 py-1 text-center">{obs.indicationSize ?? "—"}</td>
                        <td className={`border border-zinc-300 px-2 py-1 text-center font-bold ${obs.result === "Reject" ? "text-red-700 bg-red-50" : "text-emerald-700 bg-emerald-50"}`}>
                          {obs.result}
                        </td>
                        {dptCustomCols.map((cc) => {
                          let val = "—";
                          try {
                            const vals = JSON.parse(obs.customColumnValues ?? "{}");
                            val = vals[cc.id] ?? "—";
                          } catch {}
                          return <td key={cc.id} className="border border-zinc-300 px-2 py-1 text-center">{val}</td>;
                        })}
                        <td className="border border-zinc-300 px-2 py-1">{obs.remarks ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}

        {/* Vessel DPT Testing Details — shown only for VESSEL_DPT reports.
            Renders the saved observation rows with the vessel report
            columns: Part Details | Type of Weld | Size of Indication
            Approx. (mm) | Observation & Result. */}
        {report.reportType === "VESSEL_DPT" && report.dptObservations && report.dptObservations.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-2 text-xs font-bold uppercase text-purple-700 border-b border-purple-300 pb-1">
              Dye Penetrant Testing Details ({report.dptObservations.length})
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-purple-800 text-white">
                    <th className="border border-purple-900 px-2 py-2 text-center">Sl. No</th>
                    <th className="border border-purple-900 px-2 py-2 text-center">Part Details</th>
                    <th className="border border-purple-900 px-2 py-2 text-center">Type of Weld</th>
                    <th className="border border-purple-900 px-2 py-2 text-center">Size of Indication Approx. (mm)</th>
                    <th className="border border-purple-900 px-2 py-2 text-center">Observation &amp; Result</th>
                  </tr>
                </thead>
                <tbody>
                  {report.dptObservations.map((obs) => (
                    <tr key={obs.id} className="hover:bg-muted/30">
                      <td className="border border-zinc-300 px-2 py-1 text-center font-mono">{obs.serialNo}</td>
                      <td className="border border-zinc-300 px-2 py-1">{obs.description ?? "—"}</td>
                      <td className="border border-zinc-300 px-2 py-1 text-center">{obs.weldType ?? "—"}</td>
                      <td className="border border-zinc-300 px-2 py-1 text-center">{obs.indicationSize ?? "—"}</td>
                      <td className="border border-zinc-300 px-2 py-1">{obs.remarks ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* MPT Inspection Results — shown only for PIPELINE_MPT reports.
            MPT rows are stored in the shared DptObservation table (the
            form reuses the DPT observation infrastructure), so the data
            comes from report.dptObservations with MPT custom columns. */}
        {report.reportType === "PIPELINE_MPT" && report.dptObservations && report.dptObservations.length > 0 && (() => {
          let mptCustomCols: Array<{ id: string; name: string; unit: string }> = [];
          try {
            const cc = JSON.parse(report.mptCustomColumns ?? "[]");
            if (Array.isArray(cc)) mptCustomCols = cc;
          } catch {}
          return (
            <div className="mt-6">
              <h3 className="mb-2 text-xs font-bold uppercase text-orange-700 border-b border-orange-300 pb-1">
                MPT Inspection Results ({report.dptObservations.length})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-orange-700 text-white">
                      <th className="border border-orange-800 px-2 py-2 text-center">Sl. No</th>
                      <th className="border border-orange-800 px-2 py-2 text-center">Description</th>
                      <th className="border border-orange-800 px-2 py-2 text-center">Weld Type</th>
                      <th className="border border-orange-800 px-2 py-2 text-center">Indication<br />Size (mm)</th>
                      <th className="border border-orange-800 px-2 py-2 text-center">Result</th>
                      {mptCustomCols.map((cc) => (
                        <th key={cc.id} className="border border-orange-800 px-2 py-2 text-center">
                          {cc.name}{cc.unit && <span className="opacity-70"> ({cc.unit})</span>}
                        </th>
                      ))}
                      <th className="border border-orange-800 px-2 py-2 text-center">Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.dptObservations.map((obs) => (
                      <tr key={obs.id} className="hover:bg-muted/30">
                        <td className="border border-zinc-300 px-2 py-1 text-center font-mono">{obs.serialNo}</td>
                        <td className="border border-zinc-300 px-2 py-1">{obs.description ?? "—"}</td>
                        <td className="border border-zinc-300 px-2 py-1 text-center">{obs.weldType ?? "—"}</td>
                        <td className="border border-zinc-300 px-2 py-1 text-center">{obs.indicationSize ?? "—"}</td>
                        <td className={`border border-zinc-300 px-2 py-1 text-center font-bold ${obs.result === "Reject" ? "text-red-700 bg-red-50" : "text-emerald-700 bg-emerald-50"}`}>
                          {obs.result}
                        </td>
                        {mptCustomCols.map((cc) => {
                          let val = "—";
                          try {
                            const vals = JSON.parse(obs.customColumnValues ?? "{}");
                            val = vals[cc.id] ?? "—";
                          } catch {}
                          return <td key={cc.id} className="border border-zinc-300 px-2 py-1 text-center">{val}</td>;
                        })}
                        <td className="border border-zinc-300 px-2 py-1">{obs.remarks ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}

        {/* Weld Scan Test Results — shown only for PIPELINE_WELD_SCAN
            reports. Rows live in the wsTestResultRows JSON column on the
            report record; every dynamically added row appears here. */}
        {report.reportType === "PIPELINE_WELD_SCAN" && (() => {
          let wsTestRows: Array<Record<string, string>> = [];
          try {
            const parsed = JSON.parse(report.wsTestResultRows ?? "[]");
            if (Array.isArray(parsed)) wsTestRows = parsed;
          } catch {}
          if (wsTestRows.length === 0) return null;
          return (
            <div className="mt-6">
              <h3 className="mb-2 text-xs font-bold uppercase text-cyan-700 border-b border-cyan-300 pb-1">
                Weld Scan Test Results ({wsTestRows.length})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr className="bg-cyan-700 text-white">
                      {[
                        "Sl. No", "Description", "Identification No.", "Weld Type", "Probe",
                        "BP", "SD", "Depth", "Echo Height", "Length", "Observation", "Result",
                      ].map((h) => (
                        <th key={h} className="border border-cyan-800 px-2 py-2 text-center">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {wsTestRows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-muted/30">
                        <td className="border border-zinc-300 px-2 py-1 text-center font-mono">{idx + 1}</td>
                        <td className="border border-zinc-300 px-2 py-1">{row.description || "—"}</td>
                        <td className="border border-zinc-300 px-2 py-1 text-center">{row.identificationNo || "—"}</td>
                        <td className="border border-zinc-300 px-2 py-1 text-center">{row.weldType || "—"}</td>
                        <td className="border border-zinc-300 px-2 py-1 text-center">{row.probe || "—"}</td>
                        <td className="border border-zinc-300 px-2 py-1 text-center">{row.bp || "—"}</td>
                        <td className="border border-zinc-300 px-2 py-1 text-center">{row.sd || "—"}</td>
                        <td className="border border-zinc-300 px-2 py-1 text-center">{row.depth || "—"}</td>
                        <td className="border border-zinc-300 px-2 py-1 text-center">{row.echoHeight || "—"}</td>
                        <td className="border border-zinc-300 px-2 py-1 text-center">{row.length || "—"}</td>
                        <td className="border border-zinc-300 px-2 py-1">{row.observation || "—"}</td>
                        <td className={`border border-zinc-300 px-2 py-1 text-center font-bold ${row.result === "Reject" ? "text-red-700 bg-red-50" : row.result === "Accept" ? "text-emerald-700 bg-emerald-50" : ""}`}>
                          {row.result || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}

        {/* ─── 6. INSPECTION PHOTOS ───
            Shows ONLY the regular inspection photos uploaded for this
            report. The primary inspection photo is tagged category=PRIMARY
            and is rendered once, in its dedicated position above — it must
            never be duplicated into this gallery. */}
        {report.reportPhotos && report.reportPhotos.filter(p => p.category !== "PRIMARY").length > 0 && (() => {
          const galleryPhotos = report.reportPhotos.filter(p => p.category !== "PRIMARY");
          return (
            <div className="mt-6">
              <h3 className="mb-2 text-xs font-bold uppercase text-zinc-700 border-b border-zinc-300 pb-1">
                {report.reportType === "VESSEL_UTM"
                  ? "Photographs – During UT Thickness Measurement"
                  : "Inspection Photos"} ({galleryPhotos.length})
              </h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {galleryPhotos.map((photo) => {
                  const rawUrl = `/api/pipeline-inspections/${report.id}/photos/${photo.id}/raw`;
                  return (
                    <div key={photo.id} className="border border-zinc-300 rounded overflow-hidden">
                      <div
                        className="relative bg-zinc-50 cursor-zoom-in flex items-center justify-center"
                        style={{ minHeight: "100px" }}
                        onClick={() => setLightbox({
                          url: rawUrl,
                          caption: photo.caption || photo.fileName,
                        })}
                      >
                        <AuthImage
                          src={rawUrl}
                          alt={photo.caption || photo.fileName}
                          className="w-full h-auto max-h-[140px] object-contain"
                        />
                      </div>
                      <div className="p-1.5">
                        <div className="text-[10px] font-medium truncate" title={photo.caption ?? ""}>
                          {photo.caption || "(no caption)"}
                        </div>
                        <div className="flex items-center justify-between text-[8px] text-zinc-400 mt-0.5">
                          <span className="truncate" title={photo.fileName}>{photo.fileName}</span>
                          <span>{Math.round(photo.fileSize / 1024)}KB</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Instrument Calibration */}
        {report.certificates && report.certificates.filter(c => c.category === "EQUIPMENT").length > 0 && (
          <div className="mt-6">
            <h3 className="text-xs font-bold text-zinc-700 mb-2 border-b border-zinc-300 pb-1">
              Instrument Calibration ({report.certificates.filter(c => c.category === "EQUIPMENT").length})
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {report.certificates.filter(c => c.category === "EQUIPMENT").map((cert) => {
                const ext = (cert.fileExtension || "").toLowerCase();
                const isImage = [".png", ".jpg", ".jpeg"].includes(ext);
                const rawUrl = `/api/pipeline-inspections/${report.id}/certificates/${cert.id}/raw`;
                return (
                  <div key={cert.id} className="border border-zinc-300 rounded overflow-hidden">
                    <div className="bg-zinc-50 flex items-center justify-center cursor-zoom-in" style={{ minHeight: "80px" }}
                      onClick={() => isImage && setLightbox({ url: rawUrl, caption: cert.title })}>
                      {isImage ? (
                        <AuthImage src={rawUrl} alt={cert.title} className="w-full h-auto max-h-[120px] object-contain" />
                      ) : (
                        <div className="flex flex-col items-center text-muted-foreground p-2">
                          <FileText className="h-8 w-8" />
                          <span className="text-xs mt-1">PDF Document</span>
                        </div>
                      )}
                    </div>
                    <div className="p-2">
                      <div className="text-xs font-medium truncate">{cert.title}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{cert.fileName}</div>
                      <div className="flex items-center justify-between text-[8px] text-zinc-400 mt-0.5">
                        <span className="uppercase">{ext.replace(".", "")}</span>
                        <span>{Math.round(cert.fileSize / 1024)}KB</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Inspector Certificates — NDT Level 3 (optional) first, then NDT Level 2 */}
        {report.certificates && report.certificates.filter(c => c.category === "PERSONNEL").length > 0 && (() => {
          const personnel = report.certificates!.filter(c => c.category === "PERSONNEL");
          const ndtLevel3 = personnel.filter(c => (c.title || "").includes("NDT Level 3"));
          const ndtLevel2 = personnel.filter(c => (c.title || "").includes("NDT Level 2"));
          const others = personnel.filter(c => !ndtLevel3.includes(c) && !ndtLevel2.includes(c));
          const ordered = [...ndtLevel3, ...ndtLevel2, ...others];
          return (
          <div className="mt-6">
            <h3 className="text-xs font-bold text-zinc-700 mb-2 border-b border-zinc-300 pb-1">
              Inspector Certificates ({ordered.length})
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {ordered.map((cert) => {
                const ext = (cert.fileExtension || "").toLowerCase();
                const isImage = [".png", ".jpg", ".jpeg"].includes(ext);
                const rawUrl = `/api/pipeline-inspections/${report.id}/certificates/${cert.id}/raw`;
                return (
                  <div key={cert.id} className="border border-zinc-300 rounded overflow-hidden">
                    <div className="bg-zinc-50 flex items-center justify-center cursor-zoom-in" style={{ minHeight: "80px" }}
                      onClick={() => isImage && setLightbox({ url: rawUrl, caption: cert.title })}>
                      {isImage ? (
                        <AuthImage src={rawUrl} alt={cert.title} className="w-full h-auto max-h-[120px] object-contain" />
                      ) : (
                        <div className="flex flex-col items-center text-muted-foreground p-2">
                          <FileText className="h-8 w-8" />
                          <span className="text-xs mt-1">PDF Document</span>
                        </div>
                      )}
                    </div>
                    <div className="p-2">
                      <div className="text-xs font-medium truncate">{cert.title}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{cert.fileName}</div>
                      <div className="flex items-center justify-between text-[8px] text-zinc-400 mt-0.5">
                        <span className="uppercase">{ext.replace(".", "")}</span>
                        <span>{Math.round(cert.fileSize / 1024)}KB</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          );
        })()}

        {/* Summary Of Site Observations */}
        {report.siteObservationSummary && (
          <div className="mt-4">
            <h3 className="text-xs font-bold text-zinc-700">Summary Of Site Observations</h3>
            <p className="mt-1 text-xs whitespace-pre-wrap">{report.siteObservationSummary}</p>
          </div>
        )}

        {/* Results */}
        {report.results && (
          <div className="mt-3">
            <h3 className="text-xs font-bold text-zinc-700">Results</h3>
            <p className="mt-1 text-xs whitespace-pre-wrap">{report.results}</p>
          </div>
        )}

        {/* Conclusion */}
        {report.conclusion && (
          <div className="mt-3">
            <h3 className="text-xs font-bold text-zinc-700">Conclusion</h3>
            <p className="mt-1 text-xs whitespace-pre-wrap">{report.conclusion}</p>
          </div>
        )}

        {/* Sign-off */}
        <div className="mt-6 grid grid-cols-3 gap-2">
          {[
            { label: "Inspected by", name: report.inspectorName, date: new Date(report.inspectionDate).toISOString().slice(0, 10) },
            { label: "Reviewed / Approved by", name: report.approver?.name ?? "—", date: report.approvedAt?.slice(0, 10) ?? "—" },
            { label: "Revision", name: `Rev ${report.revisionNumber}`, date: report.status },
          ].map((b, i) => (
            <div key={i} className="border border-zinc-400 p-2 text-xs">
              <div className="text-[10px] text-zinc-500">{b.label}</div>
              <div className="mt-2 font-bold">{b.name}</div>
              <div className="mt-3 text-[10px] text-zinc-500">Date / Status: {b.date}</div>
            </div>
          ))}
        </div>

        {/* Override note */}
        {report.overrideReason && (
          <div className="mt-4 rounded-md border border-red-400 bg-red-50 p-2 text-xs text-red-900">
            <strong>Override applied (recorded):</strong> {report.overrideReason}
            <div className="mt-1 text-[10px]">
              Applied at {report.overrideAppliedAt ? new Date(report.overrideAppliedAt).toLocaleString() : "—"} by an authorized administrator.
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-6 border-t border-zinc-300 pt-2 text-center text-[10px] text-zinc-500">
          Page 1 | Generated {new Date().toISOString().slice(0, 19).replace("T", " ")} | Inspection Report Automation System
        </div>
      </div>

      {/* ---------- WORKFLOW DIALOG ---------- */}
      <Dialog open={dialogMode !== null} onOpenChange={(o) => { if (!o) setDialogMode(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogMode && dialogTitle[dialogMode]}</DialogTitle>
            <DialogDescription>{dialogMode && dialogDesc[dialogMode]}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>{dialogMode && dialogLabel[dialogMode]}</Label>
            <Textarea
              rows={4}
              value={dialogText}
              onChange={(e) => setDialogText(e.target.value)}
              placeholder={
                dialogMode === "return"
                  ? "Please describe what needs to be corrected..."
                  : dialogMode === "revise"
                    ? "Briefly describe what's being changed in this revision..."
                    : "Optional notes..."
              }
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogMode(null)}>Cancel</Button>
            <Button onClick={executeWorkflow} disabled={acting}>
              {acting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {dialogMode && dialogActionLabel[dialogMode]}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- REVISION HISTORY ---------- */}
      {report.revisions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <GitBranch className="h-4 w-4" /> Revision History ({report.revisions.length})
            </CardTitle>
            <CardDescription>
              Each approved version is preserved as a separate revision. The currently-approved revision is highlighted.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {report.revisions.map((r) => (
                <div key={r.id} className={`py-3 text-xs ${r.id === report.currentApprovedRevisionId ? "bg-emerald-50/50 -mx-3 px-3 rounded" : ""}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="font-mono">Rev {r.revisionNumber}</Badge>
                    <Badge variant="outline" className={REVISION_STATUS_COLOR[r.status] ?? ""}>
                      {r.status}
                    </Badge>
                    {r.id === report.currentApprovedRevisionId && (
                      <Badge variant="outline" className="border-emerald-500 text-emerald-700">
                        Current Approved
                      </Badge>
                    )}
                    <span className="text-muted-foreground">
                      {new Date(r.revisionDate).toLocaleString()}
                    </span>
                    {r.revisedByName && (
                      <span className="text-muted-foreground">· by {r.revisedByName}</span>
                    )}
                  </div>
                  {r.changeDescription && (
                    <p className="mt-1">{r.changeDescription}</p>
                  )}
                  {r.reviewComments && (
                    <p className="mt-1 text-red-700 italic">Admin comments: "{r.reviewComments}"</p>
                  )}
                  {r.approvedByName && (
                    <p className="mt-1 text-emerald-700 text-[11px]">
                      Approved by {r.approvedByName}
                      {r.approvedAt ? ` on ${new Date(r.approvedAt).toLocaleString()}` : ""}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="bg-muted/30">
        <CardContent className="flex items-start gap-3 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="text-xs text-muted-foreground">
            <strong className="text-foreground">Workflow summary:</strong>{" "}
            Status <code className="rounded bg-muted px-1">{report.status}</code> ·{" "}
            {status === "Draft" && "Employee is editing. Can submit for review when ready."}
            {status === "Submitted for Review" && "Awaiting admin approval. Employee can't edit until admin acts."}
            {status === "Returned for Revision" && "Admin returned with comments. Employee should fix and resubmit."}
            {status === "Approved" && "Report is approved. Employee can start a new revision; admin can still edit directly."}
            {status === "Changes Pending Review" && "Employee is editing a new revision of an approved report. Will need admin approval."}
          </div>
        </CardContent>
      </Card>

      {/* ─── Lightbox: full-screen image preview when a thumbnail is clicked ─── */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/80 hover:text-white"
            onClick={() => setLightbox(null)}
          >
            <X className="h-8 w-8" />
          </button>
          <div className="max-h-full max-w-full" onClick={(e) => e.stopPropagation()}>
            <AuthImage
              src={lightbox.url}
              alt={lightbox.caption}
              className="max-h-[85vh] max-w-[90vw] object-contain rounded-lg shadow-2xl"
            />
            <p className="mt-2 text-center text-sm text-white/80">{lightbox.caption}</p>
          </div>
        </div>
      )}
    </div>
  );
}
