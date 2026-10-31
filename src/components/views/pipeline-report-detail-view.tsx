"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ArrowLeft,
  Download,
  Loader2,
  Pencil,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Calendar,
  User as UserIcon,
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
    | "PIPELINE_WELD_SCAN";
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
  client: { id: string; name: string };
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

function fmtMeasurement(v: number | null, status: string): string {
  if (status === "NotApplicable") return "N/A";
  if (status === "NotMeasured" || v === null || v === undefined) return "—";
  return v.toFixed(2);
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

        {/* Logo placeholders */}
        <div className="mb-4 flex items-start justify-between">
          <div className="flex h-14 w-28 items-center justify-center border border-zinc-400 text-[10px] text-zinc-500">
            SERVICE COMPANY<br />LOGO
          </div>
          <div className="flex h-14 w-28 items-center justify-center border border-zinc-400 text-[10px] text-zinc-500 text-center">
            {report.client.name.slice(0, 24)}<br />CLIENT LOGO
          </div>
        </div>

        {/* Header info grid */}
        <div className="mb-4 grid grid-cols-2 gap-0 border border-zinc-500 text-xs">
          {[
            ["Client", report.client.name],
            ["Location", report.plant.location ?? "—"],
            ["Plant Name", report.plant.name],
            ["Inspection Area", report.inspectionArea ?? "—"],
            ["Pipeline Description", report.pipelineDescription ?? "—"],
            ["Pipeline Identification No.", report.pipelineIdentificationNumber ?? "—"],
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

        {/* DPT-specific sections — shown only for DPT / DPPT reports.
            These appear BEFORE the measurement table block (which only
            applies to thickness reports) so the correct content is shown
            under the correct heading for DPT reports.
        */}
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

            {/* DPT Inspection Results table */}
            {report.dptObservations && report.dptObservations.length > 0 && (() => {
              // Parse custom columns
              let dptCustomCols: Array<{ id: string; name: string; unit: string }> = [];
              try {
                const cc = JSON.parse(report.dptCustomColumns ?? "[]");
                if (Array.isArray(cc)) dptCustomCols = cc;
              } catch {}
              return (
                <div>
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
          </div>
        )}

        {/* Measurement table */}
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
              </tr>
            </thead>
            <tbody>
              {report.measurements.length === 0 && (
                <tr>
                  <td colSpan={11} className="border border-zinc-400 text-center py-4 text-zinc-500">
                    No measurement rows recorded.
                  </td>
                </tr>
              )}
              {report.measurements.map((m) => (
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Engineering Drawings section — shows attached drawings with previews */}
        {report.drawingLinks && report.drawingLinks.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-2 text-xs font-bold uppercase text-zinc-700 border-b border-zinc-300 pb-1">
              Engineering Drawings ({report.drawingLinks.length})
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {report.drawingLinks.map((link) => {
                const drawing = link.drawing;
                const rev = drawing.revisions?.[0];
                if (!rev) return null;
                const ext = (rev.fileExtension || "").toLowerCase();
                const isImage = [".png", ".jpg", ".jpeg", ".webp"].includes(ext);
                const previewUrl = isImage && drawing.id
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
                          className="w-full h-auto max-h-[120px] object-contain cursor-zoom-in"
                          onClick={() => setLightbox({
                            url: previewUrl,
                            caption: `${drawing.title} — ${drawing.drawingNumber}`,
                          })}
                        />
                      ) : ext === ".pdf" ? (
                        <div className="p-2 text-center text-zinc-500">
                          <FileText className="mx-auto h-8 w-8 mb-1" />
                          <div>PDF Document</div>
                          <div className="text-[8px]">({rev.fileName})</div>
                        </div>
                      ) : (
                        <div className="p-2 text-center text-zinc-500">
                          <FileText className="mx-auto h-8 w-8 mb-1" />
                          <div>{ext.toUpperCase().replace(".", "")} File</div>
                        </div>
                      )}
                    </div>
                    <div className="truncate text-zinc-500" title={rev.fileName}>
                      {rev.fileName}
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

        {/* Primary Inspection Photo */}
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

        {/* Equipment / Instrument Certificates */}
        {report.certificates && report.certificates.filter(c => c.category === "EQUIPMENT").length > 0 && (
          <div className="mt-6">
            <h3 className="text-xs font-bold text-zinc-700 mb-2 border-b border-zinc-300 pb-1">
              Equipment / Instrument Certificates ({report.certificates.filter(c => c.category === "EQUIPMENT").length})
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

        {/* Personnel / Inspector Certificates */}
        {report.certificates && report.certificates.filter(c => c.category === "PERSONNEL").length > 0 && (
          <div className="mt-6">
            <h3 className="text-xs font-bold text-zinc-700 mb-2 border-b border-zinc-300 pb-1">
              Personnel / Inspector Certificates ({report.certificates.filter(c => c.category === "PERSONNEL").length})
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {report.certificates.filter(c => c.category === "PERSONNEL").map((cert) => {
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

        {/* Inspection Photos section — shows uploaded photos as thumbnails with captions */}
        {report.reportPhotos && report.reportPhotos.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-2 text-xs font-bold uppercase text-zinc-700 border-b border-zinc-300 pb-1">
              Inspection Photos ({report.reportPhotos.length})
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {report.reportPhotos.map((photo) => {
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
