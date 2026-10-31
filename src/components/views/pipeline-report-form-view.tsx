"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Save,
  Loader2,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  ShieldAlert,
  AlertCircle,
  Download,
  Camera,
  Columns3,
  X,
  PenTool,
  FileText,
  Image as ImageIcon,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAppStore, type PipelineReportType } from "@/lib/store";
import { apiFetch } from "@/lib/api-client";
import { toast } from "sonner";

// ---------- REPORT TYPE METADATA ----------

const REPORT_TYPE_INFO: Record<PipelineReportType, {
  title: string;            // PDF title
  shortLabel: string;       // sidebar / list badge
  formHeading: string;      // shown at top of form
  formDescription: string;
  step2Label: string;       // middle step name
  accent: string;           // badge color class
}> = {
  PIPELINE_THICKNESS: {
    title: "PIPELINE THICKNESS MEASUREMENT REPORT",
    shortLabel: "Thickness",
    formHeading: "New Pipeline Thickness Report",
    formDescription: "UT thickness measurement at clock positions (12/3/6/9 o'clock).",
    step2Label: "Measurements",
    accent: "border-emerald-500 text-emerald-700",
  },
  PIPELINE_VISUAL: {
    title: "PIPELINE VISUAL INSPECTION REPORT",
    shortLabel: "Visual",
    formHeading: "New Pipeline Visual Inspection Report",
    formDescription: "External surface, coating, corrosion, leakage observations at multiple points.",
    step2Label: "Observations",
    accent: "border-blue-500 text-blue-700",
  },
  PIPELINE_CONDITION: {
    title: "PIPELINE CONDITION ASSESSMENT REPORT",
    shortLabel: "Condition",
    formHeading: "New Pipeline Condition Assessment Report",
    formDescription: "Overall condition rating, risk priority, recommendations, next inspection.",
    step2Label: "Assessment",
    accent: "border-amber-500 text-amber-700",
  },
};

// ---------- TYPES ----------

interface ClientItem {
  id: string;
  name: string;
  plants: Array<{ id: string; name: string; location: string | null }>;
}

interface ComponentTypeItem {
  id: string;
  code: string;
  label: string;
}

interface PipeStandardItem {
  id: string;
  standard: string;
  edition: string;
  nominalSizeInch: string;
  schedule: string;
  wallThicknessMm: number;
  isVerified: boolean;
}

interface MeasurementRow {
  id?: string;
  pointNo: string;
  sortOrder: number;
  pipeSizeInch: string;
  pipeSchedule: string;
  nominalThicknessMm: number | null;
  standardId: string | null;
  componentTypeCode: string;
  componentTypeId: string | null;
  northMm: string;
  northStatus: "Measured" | "NotMeasured" | "NotApplicable";
  eastMm: string;
  eastStatus: "Measured" | "NotMeasured" | "NotApplicable";
  southMm: string;
  southStatus: "Measured" | "NotMeasured" | "NotApplicable";
  westMm: string;
  westStatus: "Measured" | "NotMeasured" | "NotApplicable";
  observedMinimumMm: number | null;
  findingsComments: string;
  customColumnValues: string; // JSON: {colId: value}
  _isNew?: boolean;
}

interface ReportHeader {
  reportNumber: string;
  // reportType is fixed at creation time. For new reports it's set from
  // `pendingPipelineReportType` in the store. For existing reports it's
  // loaded from the API. It's included in the header object so saveHeader
  // sends it on POST (the API uses it on create; ignored on PUT).
  reportType: PipelineReportType;
  clientId: string;
  plantId: string;
  inspectionArea: string;
  pipelineDescription: string;
  pipelineIdentificationNumber: string;
  isometricDrawingNumber: string;
  materialOfConstruction: string;
  applicableStandard: string;
  standardEdition: string;
  inspectionDate: string;
  findingsSummary: string;
  comments: string;
  inspectionDescription: string;
  customColumns: string; // JSON array of {id, name, unit}
  // ─── PIPELINE CONDITION fields (only used when reportType = PIPELINE_CONDITION;
  // ignored otherwise) ───
  pipelineAgeYears: string;       // free-text input → parsed to number on save
  serviceFluid: string;
  operatingCondition: string;
  overallConditionRating: string;
  corrosionCondition: string;
  damageAssessment: string;
  previousInspectionRef: string;
  currentInspectionFindings: string;
  riskPriorityLevel: string;
  recommendations: string;
  nextInspectionRecommendation: string;
}

const EMPTY_HEADER: ReportHeader = {
  reportNumber: "",
  reportType: "PIPELINE_THICKNESS", // overwritten from store on first render
  clientId: "",
  plantId: "",
  inspectionArea: "",
  pipelineDescription: "",
  pipelineIdentificationNumber: "",
  isometricDrawingNumber: "",
  materialOfConstruction: "Carbon Steel",
  applicableStandard: "ASME B36.10M",
  standardEdition: "2018",
  inspectionDate: new Date().toISOString().slice(0, 10),
  findingsSummary: "",
  comments: "",
  inspectionDescription: "",
  customColumns: "[]",
  // Condition fields default empty
  pipelineAgeYears: "",
  serviceFluid: "",
  operatingCondition: "",
  overallConditionRating: "",
  corrosionCondition: "",
  damageAssessment: "",
  previousInspectionRef: "",
  currentInspectionFindings: "",
  riskPriorityLevel: "",
  recommendations: "",
  nextInspectionRecommendation: "",
};

// Custom column definition (user-added beyond the 11 system columns)
interface CustomColumn {
  id: string;      // stable unique identifier
  name: string;   // display name
  unit: string;   // e.g. "mm", "—" 
}

// Photo item for Step 3
interface PhotoItem {
  id?: string;
  fileName: string;
  filePath?: string;
  caption: string;
  previewUrl?: string;  // object URL for browser preview
  fileSize?: number;
  mimeType?: string;
  _isNew?: boolean;
}

// Drawing attachment (PNG/JPG/JPEG/WEBP/PDF) — attached at Step 1,
// embedded as full-page images in the final PDF before the measurement
// table. Each image becomes one PDF page; each PDF drawing is
// rasterized page-by-page (one output page per source page).
interface DrawingAttachment {
  id?: string;             // drawingId once persisted
  linkId?: string;         // DrawingInspectionLink id
  title: string;           // drawing title
  drawingNumber: string;   // drawing number
  drawingType: string;
  fileName: string;
  fileExtension: string;
  mimeType: string;
  fileSize?: number;
  // For image attachments, a previewable URL on the same origin
  previewUrl?: string;
  // Upload state: "uploading" | "uploaded" | "error"
  uploadStatus: "uploading" | "uploaded" | "error";
  errorMessage?: string;
}

// ─── VISUAL INSPECTION OBSERVATION ROW ───
// One row per inspection point. Used only when reportType = PIPELINE_VISUAL.
interface VisualObservationRow {
  id?: string;
  pointNo: string;
  sortOrder: number;
  location: string;
  pipelineCondition: string;
  externalSurfaceCondition: string;
  coatingPaintCondition: string;
  corrosionObserved: string;
  leakageObserved: string;
  damageOrDeformation: string;
  supportsHangersCondition: string;
  weldJointCondition: string;
  insulationCondition: string;
  findings: string;
  recommendations: string;
  inspectorComments: string;
  _isNew?: boolean;
}

const EMPTY_VISUAL_OBSERVATION: Omit<VisualObservationRow, "pointNo" | "sortOrder"> = {
  location: "",
  pipelineCondition: "",
  externalSurfaceCondition: "",
  coatingPaintCondition: "",
  corrosionObserved: "",
  leakageObserved: "",
  damageOrDeformation: "",
  supportsHangersCondition: "",
  weldJointCondition: "",
  insulationCondition: "",
  findings: "",
  recommendations: "",
  inspectorComments: "",
};

// Dropdown options for visual inspection fields
const YES_NO_NA = ["Yes", "No", "Suspected", "N/A"];
const CORROSION_LEVELS = ["None", "Light", "Moderate", "Severe", "N/A"];
const CONDITION_RATINGS = ["Good", "Fair", "Poor", "Critical", "N/A"];
const RISK_LEVELS = ["Low", "Medium", "High", "Critical"];

// System columns that cannot be deleted
const SYSTEM_COLUMN_KEYS = [
  "diaInch", "schedule", "nominal", "component", "pointNo",
  "north", "east", "south", "west", "obsMin", "findings",
] as const;

const MOC_OPTIONS = [
  "Carbon Steel",
  "Carbon Steel (LTCS)",
  "Stainless Steel SS304",
  "Stainless Steel SS304L",
  "Stainless Steel SS316",
  "Stainless Steel SS316L",
  "Duplex SS",
  "Alloy Steel",
  "Galvanised Steel",
  "Other",
];

const STANDARDS = ["ASME B36.10M", "ASME B36.19M"];
const EDITIONS = ["2018", "2021", "2024"];

const STATUS_OPTIONS: Array<{ value: "Measured" | "NotMeasured" | "NotApplicable"; label: string }> = [
  { value: "Measured", label: "Measured" },
  { value: "NotMeasured", label: "Not measured" },
  { value: "NotApplicable", label: "Not applicable" },
];

export function PipelineReportFormView() {
  const {
    user,
    editingPipelineReportId,
    setEditingPipelineReportId,
    setView,
    openPipelineReport,
    refresh,
    pendingPipelineReportType,
  } = useAppStore();
  const isEdit = !!editingPipelineReportId;
  // Any authenticated user can create reports — they become the inspector.
  // The detail-page permission check enforces role-based editing on existing reports.
  const canEdit = !!user;

  const [header, setHeader] = useState<ReportHeader>(() => ({
    ...EMPTY_HEADER,
    // For new reports: use the type the user picked in the selector screen.
    // For existing reports: overwritten by the API response in the edit-load effect.
    reportType: pendingPipelineReportType ?? "PIPELINE_THICKNESS",
  }));
  const [rows, setRows] = useState<MeasurementRow[]>([]);
  const [visualObservations, setVisualObservations] = useState<VisualObservationRow[]>([]);
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [componentTypes, setComponentTypes] = useState<ComponentTypeItem[]>([]);
  const [standards, setStandards] = useState<PipeStandardItem[]>([]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportStatus, setReportStatus] = useState<string>("Draft");

  // ─── Step navigation state ───
  const [step, setStep] = useState<1 | 2 | 3>(1);
  // Custom columns parsed from header.customColumns JSON
  const [customColumns, setCustomColumns] = useState<CustomColumn[]>([]);
  // Row selection for bulk delete
  const [selectedRowIdxs, setSelectedRowIdxs] = useState<Set<number>>(new Set());
  // Photos for Step 3
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  // Drawing attachments for Step 1 (embedded as full pages in PDF)
  const [drawings, setDrawings] = useState<DrawingAttachment[]>([]);
  // Validation errors per step
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({});

  // ---------- INITIAL LOADS ----------
  useEffect(() => {
    apiFetch<{ items: ClientItem[] }>("/api/clients")
      .then((r) => {
        setClients(r.items);
        // Default to Coromandel + Ennore when creating new report
        if (!isEdit) {
          const coromandel = r.items.find((c) => c.name.includes("COROMANDEL"));
          if (coromandel) {
            const ennore = coromandel.plants.find((p) => p.name.includes("Ennore"));
            setHeader((h) => ({
              ...h,
              clientId: coromandel.id,
              plantId: ennore?.id ?? "",
              pipelineDescription: "2-inch water pipeline, top pipe rack, west side",
              materialOfConstruction: "Carbon Steel",
              applicableStandard: "ASME B36.10M",
              standardEdition: "2018",
            }));
          }
        }
      })
      .catch(() => toast.error("Failed to load clients"));
    apiFetch<{ items: ComponentTypeItem[] }>("/api/component-types")
      .then((r) => setComponentTypes(r.items))
      .catch(() => toast.error("Failed to load component types"));
    apiFetch<{ items: PipeStandardItem[] }>("/api/pipe-standards")
      .then((r) => setStandards(r.items))
      .catch(() => toast.error("Failed to load pipe standards"));
  }, [isEdit]);

  // ---------- EDIT LOAD ----------
  useEffect(() => {
    if (!editingPipelineReportId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    apiFetch<any>(`/api/pipeline-inspections/${editingPipelineReportId}`)
      .then((r) => {
        setHeader({
          reportNumber: r.reportNumber,
          // reportType is fixed at creation time. Read it from the API
          // response (defaults to PIPELINE_THICKNESS for legacy rows).
          reportType: (r.reportType as PipelineReportType) ?? "PIPELINE_THICKNESS",
          clientId: r.clientId,
          plantId: r.plantId,
          inspectionArea: r.inspectionArea ?? "",
          pipelineDescription: r.pipelineDescription ?? "",
          pipelineIdentificationNumber: r.pipelineIdentificationNumber ?? "",
          isometricDrawingNumber: r.isometricDrawingNumber ?? "",
          materialOfConstruction: r.materialOfConstruction ?? "Carbon Steel",
          applicableStandard: r.applicableStandard ?? "ASME B36.10M",
          standardEdition: r.standardEdition ?? "2018",
          inspectionDate: r.inspectionDate.slice(0, 10),
          findingsSummary: r.findingsSummary ?? "",
          comments: r.comments ?? "",
          inspectionDescription: r.inspectionDescription ?? "",
          customColumns: r.customColumns ?? "[]",
          // Condition fields (only populated for PIPELINE_CONDITION reports)
          pipelineAgeYears: r.pipelineAgeYears != null ? String(r.pipelineAgeYears) : "",
          serviceFluid: r.serviceFluid ?? "",
          operatingCondition: r.operatingCondition ?? "",
          overallConditionRating: r.overallConditionRating ?? "",
          corrosionCondition: r.corrosionCondition ?? "",
          damageAssessment: r.damageAssessment ?? "",
          previousInspectionRef: r.previousInspectionRef ?? "",
          currentInspectionFindings: r.currentInspectionFindings ?? "",
          riskPriorityLevel: r.riskPriorityLevel ?? "",
          recommendations: r.recommendations ?? "",
          nextInspectionRecommendation: r.nextInspectionRecommendation ?? "",
        });
        setReportStatus(r.status);
        // Load drawing attachments from the linked drawings on the report
        if (r.drawingLinks && Array.isArray(r.drawingLinks)) {
          setDrawings(r.drawingLinks.map((l: any) => {
            const drawing = l.drawing ?? {};
            const rev = drawing.revisions?.[0] ?? {};
            const isImage = [".png", ".jpg", ".jpeg", ".webp"].includes((rev.fileExtension || "").toLowerCase());
            return {
              id: drawing.id,
              linkId: l.id,
              title: drawing.title ?? rev.fileName ?? "Drawing",
              drawingNumber: drawing.drawingNumber ?? "",
              drawingType: drawing.drawingType ?? "Other",
              fileName: rev.fileName ?? "",
              fileExtension: rev.fileExtension ?? "",
              mimeType: rev.mimeType ?? "",
              fileSize: rev.fileSize,
              // For image attachments, build a same-origin preview URL via
              // the drawings preview endpoint. PDFs are not previewable
              // inline; the UI shows a file icon instead.
              previewUrl: isImage && drawing.id
                ? `/api/drawings/${drawing.id}/preview`
                : undefined,
              uploadStatus: "uploaded" as const,
            };
          }));
        } else {
          setDrawings([]);
        }
        // Parse custom columns from the report's JSON field
        try {
          const cc = JSON.parse(r.customColumns ?? "[]");
          if (Array.isArray(cc)) setCustomColumns(cc);
        } catch { setCustomColumns([]); }
        // Load photos for this report
        if (r.reportPhotos) {
          setPhotos(r.reportPhotos.map((p: any) => ({
            id: p.id,
            fileName: p.fileName,
            filePath: p.filePath,
            caption: p.caption ?? "",
            fileSize: p.fileSize,
            mimeType: p.mimeType,
          })));
        } else {
          // Also try loading via the photos API
          apiFetch<{ items: any[] }>(`/api/pipeline-inspections/${editingPipelineReportId}/photos`)
            .then((pr) => {
              setPhotos(pr.items.map((p) => ({
                id: p.id,
                fileName: p.fileName,
                filePath: p.filePath,
                caption: p.caption ?? "",
                fileSize: p.fileSize,
                mimeType: p.mimeType,
              })));
            })
            .catch(() => {});
        }
        setRows(
          r.measurements.map((m: any) => ({
            id: m.id,
            pointNo: m.pointNo,
            sortOrder: m.sortOrder,
            pipeSizeInch: m.pipeSizeInch,
            pipeSchedule: m.pipeSchedule,
            nominalThicknessMm: m.nominalThicknessMm,
            standardId: m.standardId,
            componentTypeCode: m.componentTypeCode,
            componentTypeId: m.componentTypeId,
            northMm: m.northMm?.toString() ?? "",
            northStatus: m.northStatus,
            eastMm: m.eastMm?.toString() ?? "",
            eastStatus: m.eastStatus,
            southMm: m.southMm?.toString() ?? "",
            southStatus: m.southStatus,
            westMm: m.westMm?.toString() ?? "",
            westStatus: m.westStatus,
            observedMinimumMm: m.observedMinimumMm,
            findingsComments: m.findingsComments ?? "",
            customColumnValues: m.customColumnValues ?? "{}",
          })),
        );
        // Load visual inspection observations (only present for PIPELINE_VISUAL reports)
        if (Array.isArray(r.visualObservations)) {
          setVisualObservations(r.visualObservations.map((o: any) => ({
            id: o.id,
            pointNo: o.pointNo,
            sortOrder: o.sortOrder,
            location: o.location ?? "",
            pipelineCondition: o.pipelineCondition ?? "",
            externalSurfaceCondition: o.externalSurfaceCondition ?? "",
            coatingPaintCondition: o.coatingPaintCondition ?? "",
            corrosionObserved: o.corrosionObserved ?? "",
            leakageObserved: o.leakageObserved ?? "",
            damageOrDeformation: o.damageOrDeformation ?? "",
            supportsHangersCondition: o.supportsHangersCondition ?? "",
            weldJointCondition: o.weldJointCondition ?? "",
            insulationCondition: o.insulationCondition ?? "",
            findings: o.findings ?? "",
            recommendations: o.recommendations ?? "",
            inspectorComments: o.inspectorComments ?? "",
          })));
        } else {
          setVisualObservations([]);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [editingPipelineReportId]);

  // ---------- DERIVED DATA ----------
  const plantsForClient = clients.find((c) => c.id === header.clientId)?.plants ?? [];

  // Sizes and schedules available from the standards reference table.
  // Used to populate the dropdowns for the first two fixed columns.
  const sizes = Array.from(new Set(standards.map((s) => s.nominalSizeInch))).sort(naturalCompare);
  const schedulesForSize = Array.from(
    new Set(
      standards
        .filter((s) => s.nominalSizeInch === (header.applicableStandard ? "" : ""))
        .map((s) => s.schedule),
    ),
  ).sort();

  function naturalCompare(a: string, b: string): number {
    const na = a.split(/[\s/]+/).map((x) => parseFloat(x));
    const nb = b.split(/[\s/]+/).map((x) => parseFloat(x));
    for (let i = 0; i < Math.max(na.length, nb.length); i++) {
      const va = na[i] ?? 0;
      const vb = nb[i] ?? 0;
      if (va !== vb) return va - vb;
    }
    return 0;
  }

  function schedulesForRow(sizeInch: string): string[] {
    return Array.from(
      new Set(
        standards
          .filter((s) => s.nominalSizeInch === sizeInch)
          .map((s) => s.schedule),
      ),
    ).sort();
  }

  // ---------- HEADER FIELD UPDATES ----------
  function updateHeader<K extends keyof ReportHeader>(k: K, v: ReportHeader[K]) {
    setHeader((h) => ({ ...h, [k]: v }));
  }

  function onClientChange(clientId: string) {
    const c = clients.find((cl) => cl.id === clientId);
    setHeader((h) => ({
      ...h,
      clientId,
      plantId: c?.plants[0]?.id ?? "",
    }));
  }

  // ---------- ROW OPERATIONS ----------
  function addRow() {
    setRows((r) => [
      ...r,
      {
        pointNo: `P-${r.length + 1}`,
        sortOrder: r.length,
        pipeSizeInch: "2",
        pipeSchedule: "SCH 40",
        nominalThicknessMm: lookupNominal("2", "SCH 40"),
        standardId: lookupStandardId("2", "SCH 40"),
        componentTypeCode: "PIPE",
        componentTypeId: componentTypes.find((c) => c.code === "PIPE")?.id ?? null,
        northMm: "", northStatus: "NotMeasured",
        eastMm: "", eastStatus: "NotMeasured",
        southMm: "", southStatus: "NotMeasured",
        westMm: "", westStatus: "NotMeasured",
        observedMinimumMm: null,
        findingsComments: "",
        customColumnValues: "{}",
        _isNew: true,
      },
    ]);
  }

  function lookupNominal(sizeInch: string, schedule: string): number | null {
    const match = standards.find(
      (s) =>
        s.nominalSizeInch === sizeInch &&
        s.schedule === schedule &&
        (header.applicableStandard ? s.standard === header.applicableStandard : true) &&
        (header.standardEdition ? s.edition === header.standardEdition : true),
    ) ?? standards.find((s) => s.nominalSizeInch === sizeInch && s.schedule === schedule);
    return match?.wallThicknessMm ?? null;
  }

  function lookupStandardId(sizeInch: string, schedule: string): string | null {
    const match = standards.find(
      (s) =>
        s.nominalSizeInch === sizeInch &&
        s.schedule === schedule &&
        (header.applicableStandard ? s.standard === header.applicableStandard : true) &&
        (header.standardEdition ? s.edition === header.standardEdition : true),
    ) ?? standards.find((s) => s.nominalSizeInch === sizeInch && s.schedule === schedule);
    return match?.id ?? null;
  }

  function updateRow(idx: number, patch: Partial<MeasurementRow>) {
    setRows((rs) => {
      const next = [...rs];
      const cur = { ...next[idx], ...patch };

      // If pipeSizeInch or pipeSchedule changed, recompute nominal thickness
      if (patch.pipeSizeInch !== undefined || patch.pipeSchedule !== undefined) {
        cur.nominalThicknessMm = lookupNominal(cur.pipeSizeInch, cur.pipeSchedule);
        cur.standardId = lookupStandardId(cur.pipeSizeInch, cur.pipeSchedule);
      }

      // Recompute observed minimum (excluding NotMeasured, NotApplicable, and missing)
      const meas: number[] = [];
      if (cur.northStatus === "Measured" && cur.northMm) {
        const v = parseFloat(cur.northMm); if (!Number.isNaN(v)) meas.push(v);
      }
      if (cur.eastStatus === "Measured" && cur.eastMm) {
        const v = parseFloat(cur.eastMm); if (!Number.isNaN(v)) meas.push(v);
      }
      if (cur.southStatus === "Measured" && cur.southMm) {
        const v = parseFloat(cur.southMm); if (!Number.isNaN(v)) meas.push(v);
      }
      if (cur.westStatus === "Measured" && cur.westMm) {
        const v = parseFloat(cur.westMm); if (!Number.isNaN(v)) meas.push(v);
      }
      cur.observedMinimumMm = meas.length > 0 ? Math.min(...meas) : null;

      next[idx] = cur;
      return next;
    });
  }

  function deleteRow(idx: number) {
    setRows((rs) => rs.filter((_, i) => i !== idx).map((r, i) => ({ ...r, sortOrder: i })));
  }

  function moveRow(idx: number, dir: -1 | 1) {
    setRows((rs) => {
      const target = idx + dir;
      if (target < 0 || target >= rs.length) return rs;
      const next = [...rs];
      const tmp = next[idx];
      next[idx] = next[target];
      next[target] = tmp;
      // Re-number sortOrder
      return next.map((r, i) => ({ ...r, sortOrder: i }));
    });
  }

  // ---------- SAVE ----------
  async function saveHeader() {
    setError(null);
    if (!header.reportNumber.trim()) {
      setError("Report number is required");
      return;
    }
    if (!header.clientId || !header.plantId) {
      setError("Client and Plant are required");
      return;
    }
    setSaving(true);
    try {
      // Build the payload. For PIPELINE_CONDITION reports, parse the
      // pipelineAgeYears text input into a number (or null if empty /
      // non-numeric). The PUT/POST endpoints expect a number for this
      // field; the rest of the condition fields are strings.
      const payload: Record<string, unknown> = { ...header };
      if (header.reportType === "PIPELINE_CONDITION") {
        const ageNum = parseFloat(header.pipelineAgeYears);
        payload.pipelineAgeYears = !Number.isNaN(ageNum) && ageNum >= 0 ? ageNum : null;
      } else {
        // Don't send condition fields for thickness/visual reports —
        // the API preserves existing values anyway (it uses `?? existing`).
        // But for cleanliness, set them to null so they don't appear on
        // a report that was originally created as the wrong type then
        // re-saved. (This is defensive only — the form never shows these
        // fields for thickness/visual reports.)
        payload.pipelineAgeYears = null;
      }

      if (isEdit && editingPipelineReportId) {
        await apiFetch(`/api/pipeline-inspections/${editingPipelineReportId}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        toast.success("Header saved");
      } else {
        const created = await apiFetch<{ id: string; reportNumber: string }>(
          "/api/pipeline-inspections",
          { method: "POST", body: JSON.stringify(payload) },
        );
        toast.success(`Created ${created.reportNumber}`);
        refresh();
        // Set the editing ID WITHOUT navigating away — keeps the user
        // on the form so they can continue with Step 2.
        setEditingPipelineReportId(created.id);
      }
    } catch (e) {
      const err = e as { message?: string };
      setError(err.message ?? "Save failed");
      toast.error(err.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveRow(idx: number) {
    const row = rows[idx];
    if (!row) return;
    if (!editingPipelineReportId) {
      toast.error("Save the report header first");
      return;
    }
    if (!row.pipeSizeInch || !row.pipeSchedule) {
      toast.error("Pipe size and schedule are required");
      return;
    }
    if (row.nominalThicknessMm === null) {
      toast.error(
        `Unsupported combination: ${row.pipeSizeInch}" ${row.pipeSchedule} not found in standards table. Add it via the Pipe Standards view (admin).`,
      );
      return;
    }
    setSaving(true);
    try {
      if (row._isNew || !row.id) {
        const created = await apiFetch<{ id: string }>(
          `/api/pipeline-inspections/${editingPipelineReportId}/measurements`,
          { method: "POST", body: JSON.stringify(row) },
        );
        setRows((rs) => rs.map((r, i) => i === idx ? { ...r, id: created.id, _isNew: false } : r));
        toast.success(`Saved ${row.pointNo}`);
      } else {
        await apiFetch(
          `/api/pipeline-inspections/${editingPipelineReportId}/measurements/${row.id}`,
          { method: "PUT", body: JSON.stringify(row) },
        );
        toast.success(`Updated ${row.pointNo}`);
      }
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function deleteRowApi(idx: number) {
    const row = rows[idx];
    if (!row) return;
    if (!row.id || row._isNew) {
      deleteRow(idx);
      return;
    }
    if (!editingPipelineReportId) return;
    try {
      await apiFetch(
        `/api/pipeline-inspections/${editingPipelineReportId}/measurements/${row.id}`,
        { method: "DELETE" },
      );
      deleteRow(idx);
      toast.success(`Deleted ${row.pointNo}`);
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message ?? "Delete failed");
    }
  }

  function previewPdf() {
    if (!editingPipelineReportId) {
      toast.error("Save the report first");
      return;
    }
    openPipelineReport(editingPipelineReportId);
  }

  // ─── STEP NAVIGATION ───
  function validateStep1(): boolean {
    const errs: Record<string, string> = {};
    if (!header.reportNumber.trim()) errs.reportNumber = "Report number is required";
    if (!header.clientId) errs.clientId = "Client is required";
    if (!header.plantId) errs.plantId = "Plant is required";
    setStepErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function validateStep2(): boolean {
    // Step 2 doesn't require rows/fields to be filled in to proceed —
    // the user can add them later. But we warn if there are no rows
    // for thickness or visual reports.
    if (header.reportType === "PIPELINE_THICKNESS") {
      if (rows.length === 0) {
        toast.warning("No measurement rows yet. You can proceed, but you'll need to add at least one before submitting.");
      }
    } else if (header.reportType === "PIPELINE_VISUAL") {
      if (visualObservations.length === 0) {
        toast.warning("No visual observations yet. You can proceed, but you'll need to add at least one before submitting.");
      }
    }
    // PIPELINE_CONDITION has no row requirement — fields live on the header.
    return true;
  }

  async function proceedToNext() {
    if (step === 1) {
      if (!validateStep1()) {
        toast.error("Please fill in all required fields before proceeding.");
        return;
      }
      // ALWAYS save the header — for new reports, this creates the
      // report and sets editingPipelineReportId. For existing reports,
      // it updates the header. Must await so the ID is available
      // before the user reaches Step 2 (measurement rows / observations
      // / condition fields need it).
      await saveHeader();
      setStep(2);
    } else if (step === 2) {
      validateStep2();
      // For PIPELINE_THICKNESS reports, persist the custom columns JSON
      // onto the header before saving. Other report types don't use
      // custom columns, but saving the header still picks up any
      // condition field edits the user made on Step 2.
      if (header.reportType === "PIPELINE_THICKNESS") {
        setHeader((h) => ({ ...h, customColumns: JSON.stringify(customColumns) }));
      }
      await saveHeader();
      setStep(3);
    }
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function goPrevious() {
    if (step > 1) {
      // Save current state before going back
      setHeader((h) => ({ ...h, customColumns: JSON.stringify(customColumns) }));
      setStep((step - 1) as 1 | 2);
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    }
  }

  // ─── CUSTOM COLUMN MANAGEMENT ───
  function addCustomColumn() {
    const name = window.prompt("Enter column name (e.g. 'Extra Position', 'Temperature'):");
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    // Prevent duplicates
    if (customColumns.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
      toast.error(`A column named "${trimmed}" already exists.`);
      return;
    }
    const unit = window.prompt("Enter unit (e.g. 'mm', '°C', or leave blank):", "mm") || "";
    const newCol: CustomColumn = {
      id: `col_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: trimmed,
      unit: unit.trim(),
    };
    setCustomColumns((cc) => [...cc, newCol]);
    toast.success(`Added column "${trimmed}"`);
  }

  function deleteCustomColumn(colId: string) {
    const col = customColumns.find((c) => c.id === colId);
    if (!col) return;
    if (!window.confirm(`Delete column "${col.name}"? Values in this column will be lost from all rows.`)) return;
    setCustomColumns((cc) => cc.filter((c) => c.id !== colId));
    toast.success(`Deleted column "${col.name}"`);
  }

  function getCustomColumnValue(row: MeasurementRow, colId: string): string {
    if (!row.customColumnValues) return "";
    try {
      const vals = JSON.parse(row.customColumnValues);
      return vals[colId] ?? "";
    } catch { return ""; }
  }

  function setCustomColumnValue(idx: number, colId: string, value: string) {
    setRows((rs) => {
      const next = [...rs];
      const row = { ...next[idx] };
      let vals: Record<string, string> = {};
      try { vals = JSON.parse(row.customColumnValues || "{}"); } catch {}
      vals[colId] = value;
      row.customColumnValues = JSON.stringify(vals);
      next[idx] = row;
      return next;
    });
  }

  // ─── ROW SELECTION ───
  function toggleRowSelection(idx: number) {
    setSelectedRowIdxs((s) => {
      const next = new Set(s);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  function toggleSelectAllRows() {
    if (selectedRowIdxs.size === rows.length) {
      setSelectedRowIdxs(new Set());
    } else {
      setSelectedRowIdxs(new Set(rows.map((_, i) => i)));
    }
  }

  function deleteSelectedRows() {
    if (selectedRowIdxs.size === 0) {
      toast.error("No rows selected.");
      return;
    }
    if (!window.confirm(`Delete ${selectedRowIdxs.size} selected row(s)? This cannot be undone.`)) return;
    // Delete each selected row via the API (if it has an ID) or locally
    const toDelete = Array.from(selectedRowIdxs).sort((a, b) => b - a); // reverse order so indices stay valid
    for (const idx of toDelete) {
      deleteRowApi(idx);
    }
    setSelectedRowIdxs(new Set());
  }

  // ─── PHOTO UPLOAD ───
  async function handlePhotoUpload(files: FileList | File[]) {
    if (!editingPipelineReportId) {
      toast.error("Save the report header first before uploading photos.");
      return;
    }
    const fileArray = Array.from(files);
    for (const file of fileArray) {
      if (!file.type.startsWith("image/")) {
        toast.error(`"${file.name}" is not an image file.`);
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`"${file.name}" is too large (max 10 MB).`);
        continue;
      }
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("caption", "");
        const res = await fetch(`/api/pipeline-inspections/${editingPipelineReportId}/photos`, {
          method: "POST",
          body: fd,
          credentials: "include",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? "Upload failed");
        }
        const photo = await res.json();
        setPhotos((ps) => [...ps, {
          id: photo.id,
          fileName: photo.fileName,
          filePath: photo.filePath,
          caption: photo.caption ?? "",
          fileSize: photo.fileSize,
          mimeType: photo.mimeType,
        }]);
        toast.success(`Uploaded "${file.name}"`);
      } catch (e) {
        const err = e as Error;
        toast.error(`Failed to upload "${file.name}": ${err.message}`);
      }
    }
  }

  async function removePhoto(photoId: string | undefined, idx: number) {
    if (!photoId) {
      // New photo not yet uploaded — just remove from local state
      setPhotos((ps) => ps.filter((_, i) => i !== idx));
      return;
    }
    try {
      await apiFetch(`/api/pipeline-inspections/${editingPipelineReportId}/photos/${photoId}`, {
        method: "DELETE",
      });
      setPhotos((ps) => ps.filter((_, i) => i !== idx));
      toast.success("Photo removed");
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message ?? "Delete failed");
    }
  }

  function updatePhotoCaption(idx: number, caption: string) {
    setPhotos((ps) => ps.map((p, i) => i === idx ? { ...p, caption } : p));
  }

  async function savePhotoCaption(photoId: string, caption: string) {
    if (!editingPipelineReportId || !photoId) return;
    try {
      await apiFetch(`/api/pipeline-inspections/${editingPipelineReportId}/photos/${photoId}`, {
        method: "PUT",
        body: JSON.stringify({ caption }),
      });
    } catch (e) {
      // Silent fail — caption is saved locally even if API fails
    }
  }

  // ─── DRAWING ATTACHMENT UPLOAD ───
  // Accepts PNG / JPG / JPEG / WEBP / PDF. Multiple files may be selected
  // at once. Each file is uploaded to /api/pipeline-inspections/[id]/drawings
  // (multipart), which creates an EngineeringDrawing + DrawingRevision +
  // DrawingInspectionLink in one atomic operation. The attachment is then
  // embedded as a full-page image in the final PDF.
  async function handleDrawingUpload(files: FileList | File[]) {
    if (!editingPipelineReportId) {
      toast.error("Save the report header first before attaching drawings.");
      return;
    }
    const allowed = [".png", ".jpg", ".jpeg", ".webp", ".pdf"];
    const fileArray = Array.from(files);
    for (const file of fileArray) {
      const ext = "." + (file.name.split(".").pop() ?? "").toLowerCase();
      if (!allowed.includes(ext)) {
        toast.error(`"${file.name}" is not a supported drawing format. Use PNG, JPG, JPEG, WEBP, or PDF.`);
        continue;
      }
      if (file.size > 50 * 1024 * 1024) {
        toast.error(`"${file.name}" is too large (max 50 MB).`);
        continue;
      }
      // Insert a placeholder row immediately so the user sees the upload
      // progress, then replace it once the server responds.
      const isImage = ext !== ".pdf";
      setDrawings((ds) => [
        ...ds,
        {
          title: file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Drawing",
          drawingNumber: "",
          drawingType: "Other",
          fileName: file.name,
          fileExtension: ext,
          mimeType: file.type,
          fileSize: file.size,
          previewUrl: isImage ? URL.createObjectURL(file) : undefined,
          uploadStatus: "uploading",
        },
      ]);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const token = typeof window !== "undefined" ? window.localStorage.getItem("ira_session_token") : null;
        const res = await fetch(
          `/api/pipeline-inspections/${editingPipelineReportId}/drawings`,
          {
            method: "POST",
            body: fd,
            credentials: "include",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? `Upload failed (HTTP ${res.status})`);
        }
        const created = await res.json();
        // Replace the placeholder row with the persisted drawing record
        setDrawings((ds) => ds.map((d) => d.uploadStatus === "uploading" && d.fileName === file.name
          ? {
              ...d,
              id: created.id,
              linkId: created.linkId,
              drawingNumber: created.drawingNumber,
              title: created.title,
              uploadStatus: "uploaded" as const,
              errorMessage: undefined,
            }
          : d));
        toast.success(`Attached "${file.name}"`);
      } catch (e) {
        const err = e as Error;
        setDrawings((ds) => ds.map((d) => d.uploadStatus === "uploading" && d.fileName === file.name
          ? { ...d, uploadStatus: "error" as const, errorMessage: err.message }
          : d));
        toast.error(`Failed to attach "${file.name}": ${err.message}`);
      }
    }
  }

  async function removeDrawing(idx: number) {
    const drawing = drawings[idx];
    if (!drawing) return;
    if (!drawing.id) {
      // Placeholder row (upload failed or never started) — just drop it
      setDrawings((ds) => ds.filter((_, i) => i !== idx));
      return;
    }
    if (!editingPipelineReportId) return;
    try {
      await apiFetch(
        `/api/pipeline-inspections/${editingPipelineReportId}/drawings`,
        {
          method: "DELETE",
          body: JSON.stringify({ drawingId: drawing.id }),
        },
      );
      setDrawings((ds) => ds.filter((_, i) => i !== idx));
      toast.success(`Removed "${drawing.fileName}"`);
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message ?? "Remove failed");
    }
  }

  // ─── VISUAL OBSERVATION ROW OPERATIONS (PIPELINE_VISUAL only) ───
  function addVisualObservation() {
    setVisualObservations((arr) => [
      ...arr,
      {
        ...EMPTY_VISUAL_OBSERVATION,
        pointNo: `V-${arr.length + 1}`,
        sortOrder: arr.length,
        _isNew: true,
      },
    ]);
  }

  function updateVisualObservation(idx: number, patch: Partial<VisualObservationRow>) {
    setVisualObservations((arr) => {
      const next = [...arr];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }

  function deleteVisualObservationLocal(idx: number) {
    setVisualObservations((arr) =>
      arr.filter((_, i) => i !== idx).map((o, i) => ({ ...o, sortOrder: i })),
    );
  }

  async function saveVisualObservation(idx: number) {
    const obs = visualObservations[idx];
    if (!obs) return;
    if (!editingPipelineReportId) {
      toast.error("Save the report header first");
      return;
    }
    setSaving(true);
    try {
      if (obs._isNew || !obs.id) {
        const created = await apiFetch<{ id: string }>(
          `/api/pipeline-inspections/${editingPipelineReportId}/visual-observations`,
          { method: "POST", body: JSON.stringify(obs) },
        );
        setVisualObservations((arr) =>
          arr.map((o, i) => (i === idx ? { ...o, id: created.id, _isNew: false } : o)),
        );
        toast.success(`Saved ${obs.pointNo}`);
      } else {
        await apiFetch(
          `/api/pipeline-inspections/${editingPipelineReportId}/visual-observations/${obs.id}`,
          { method: "PUT", body: JSON.stringify(obs) },
        );
        toast.success(`Updated ${obs.pointNo}`);
      }
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function deleteVisualObservationApi(idx: number) {
    const obs = visualObservations[idx];
    if (!obs) return;
    if (!obs.id || obs._isNew) {
      deleteVisualObservationLocal(idx);
      return;
    }
    if (!editingPipelineReportId) return;
    try {
      await apiFetch(
        `/api/pipeline-inspections/${editingPipelineReportId}/visual-observations/${obs.id}`,
        { method: "DELETE" },
      );
      deleteVisualObservationLocal(idx);
      toast.success(`Deleted ${obs.pointNo}`);
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message ?? "Delete failed");
    }
  }

  // ─── SAVE DRAFT (saves header + custom columns without navigating) ───
  async function saveDraft() {
    if (header.reportType === "PIPELINE_THICKNESS") {
      setHeader((h) => ({ ...h, customColumns: JSON.stringify(customColumns) }));
    }
    if (isEdit) {
      await saveHeader();
    } else {
      // For new reports, save header (creates the report)
      await saveHeader();
    }
    toast.success("Draft saved");
  }

  // ---------- RENDER ----------
  if (loading) {
    return (
      <div className="p-8 text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading report...
      </div>
    );
  }

  // Block editing if the report is in a state that doesn't allow edits.
  // Employees can only edit Draft / Returned for Revision / Changes Pending Review
  // (the latter happens after they click "Start New Revision" on an Approved report).
  // Admins can edit anything.
  if (isEdit && reportStatus) {
    const isAdmin = user?.dashboardRole === "ADMIN";
    const editableStatuses = ["Draft", "Returned for Revision", "Changes Pending Review"];
    if (!isAdmin && !editableStatuses.includes(reportStatus)) {
      return (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Report is in "{reportStatus}" state</AlertTitle>
          <AlertDescription>
            This report is currently in the approval workflow and can't be edited directly.
            {reportStatus === "Submitted for Review" && " Wait for the admin to approve or return it."}
            {reportStatus === "Approved" && " Use the \"Start New Revision\" button on the detail page to create a new revision that needs admin approval."}
          </AlertDescription>
        </Alert>
      );
    }
  }

  // Type-specific labels
  const typeInfo = REPORT_TYPE_INFO[header.reportType];

  return (
    <div className="space-y-4">
      <div>
        <Button variant="ghost" size="sm" onClick={() => setView("pipeline-reports")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to list
        </Button>
        <div className="mt-2 flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">
            {isEdit ? `Edit Report ${header.reportNumber}` : typeInfo.formHeading}
          </h1>
          <Badge variant="outline" className={typeInfo.accent}>
            {typeInfo.shortLabel}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {isEdit
            ? `Editing ${typeInfo.title.toLowerCase()} — ${typeInfo.formDescription}`
            : typeInfo.formDescription}
        </p>
      </div>

      {/* ─── Step indicator ─── */}
      <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                step === s ? "bg-amber-600 text-white" : step > s ? "bg-emerald-600 text-white" : "bg-zinc-200 text-zinc-500"
              }`}
            >
              {step > s ? "✓" : s}
            </div>
            <span className={`text-sm font-medium ${step === s ? "text-amber-700" : "text-muted-foreground"}`}>
              {s === 1 ? "Pipeline Details" : s === 2 ? typeInfo.step2Label : "Findings & Photos"}
            </span>
            {s < 3 && <span className="text-zinc-300">→</span>}
          </div>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          Step {step} of 3 — {step === 1 ? "Pipeline Details" : step === 2 ? typeInfo.step2Label : "Findings & Photos"}
        </span>
      </div>

      {/* Reference-data notice: only relevant for thickness reports */}
      {header.reportType === "PIPELINE_THICKNESS" && (
        <Alert className="border-amber-200 bg-amber-50">
          <ShieldAlert className="h-4 w-4 text-amber-700" />
          <AlertTitle className="text-amber-900">Reference data notice</AlertTitle>
          <AlertDescription className="text-amber-900">
            Nominal thickness values come from publicly published ASME B36.10M / B36.19M
            reference tables. They are marked UNVERIFIED until an administrator
            confirms them against the licensed / official standard edition. The
            nominal thickness is a dimensional reference value, distinct from
            the measured remaining wall thickness, and is not, by itself, an
            inspection pass / fail criterion.
          </AlertDescription>
        </Alert>
      )}

      {/* ═══ STEP 1: HEADER ═══ */}
      {step === 1 && (
      <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Report Header</CardTitle>
          <CardDescription>
            Client, plant, and pipeline identification. All fields editable
            by authorized users.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <Label>Report Number *</Label>
            <Input
              value={header.reportNumber}
              onChange={(e) => updateHeader("reportNumber", e.target.value.toUpperCase())}
              placeholder="e.g. UT-COR-ENN-001"
              className="font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label>Client *</Label>
            <Select value={header.clientId} onValueChange={onClientChange}>
              <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Plant Location *</Label>
            <Select
              value={header.plantId}
              onValueChange={(v) => updateHeader("plantId", v)}
              disabled={!header.clientId}
            >
              <SelectTrigger><SelectValue placeholder="Select plant" /></SelectTrigger>
              <SelectContent>
                {plantsForClient.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} {p.location ? `· ${p.location}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Inspection Area</Label>
            <Input
              value={header.inspectionArea}
              onChange={(e) => updateHeader("inspectionArea", e.target.value)}
              placeholder="e.g. Top Pipe Rack, West Side"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Pipeline Description</Label>
            <Input
              value={header.pipelineDescription}
              onChange={(e) => updateHeader("pipelineDescription", e.target.value)}
              placeholder="e.g. 2-inch water pipeline, top pipe rack, west side"
            />
          </div>
          <div className="space-y-2">
            <Label>Pipeline Identification No.</Label>
            <Input
              value={header.pipelineIdentificationNumber}
              onChange={(e) => updateHeader("pipelineIdentificationNumber", e.target.value)}
              placeholder="PID line number"
              className="font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label>Isometric Drawing No.</Label>
            <Input
              value={header.isometricDrawingNumber}
              onChange={(e) => updateHeader("isometricDrawingNumber", e.target.value)}
              placeholder="ISO number"
              className="font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label>Material of Construction (MOC)</Label>
            <Select
              value={header.materialOfConstruction}
              onValueChange={(v) => updateHeader("materialOfConstruction", v)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MOC_OPTIONS.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Applicable Standard</Label>
            <Select
              value={header.applicableStandard}
              onValueChange={(v) => updateHeader("applicableStandard", v)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STANDARDS.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Standard Edition</Label>
            <Select
              value={header.standardEdition}
              onValueChange={(v) => updateHeader("standardEdition", v)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {EDITIONS.map((e) => (
                  <SelectItem key={e} value={e}>{e}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Inspection Date</Label>
            <Input
              type="date"
              value={header.inspectionDate}
              onChange={(e) => updateHeader("inspectionDate", e.target.value)}
            />
          </div>
          <div className="space-y-2 sm:col-span-3">
            <Label>Findings Summary</Label>
            <Textarea
              rows={2}
              value={header.findingsSummary}
              onChange={(e) => updateHeader("findingsSummary", e.target.value)}
              placeholder="Overall findings to appear in the report footer"
            />
          </div>
          <div className="space-y-2 sm:col-span-3">
            <Label>Comments</Label>
            <Textarea
              rows={2}
              value={header.comments}
              onChange={(e) => updateHeader("comments", e.target.value)}
              placeholder="General comments"
            />
          </div>
        </CardContent>
      </Card>

      {/* ─── Drawing Attachments (optional, embedded as full-page images
           in the final PDF, BEFORE the measurement table) ─── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <PenTool className="h-4 w-4" />
                Drawing Attachments
              </CardTitle>
              <CardDescription>
                Optional. Each drawing appears as one or more full pages in
                the final PDF, before the measurement table. PNG/JPG/JPEG/WEBP
                become one page each; a PDF drawing is rasterized page-by-page
                (one PDF page per output page). Max 50 MB per file.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) handleDrawingUpload(e.target.files);
                    e.target.value = "";
                  }}
                />
                <Button size="sm" asChild disabled={!editingPipelineReportId}>
                  <span>
                    <Plus className="mr-1 h-4 w-4" /> Add Drawing
                  </span>
                </Button>
              </label>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!editingPipelineReportId && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
              Save the report header first (or click <strong>Proceed to Next</strong>) to enable drawing uploads.
            </p>
          )}
          {editingPipelineReportId && drawings.length === 0 && (
            <div
              className="border-2 border-dashed border-zinc-300 rounded-md p-6 text-center cursor-pointer hover:border-amber-400 transition-colors"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files) handleDrawingUpload(e.dataTransfer.files);
              }}
              onClick={() => {
                const input = document.createElement("input");
                input.type = "file";
                input.accept = ".png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf";
                input.multiple = true;
                input.onchange = (e) => {
                  const t = e.target as HTMLInputElement;
                  if (t.files) handleDrawingUpload(t.files);
                };
                input.click();
              }}
            >
              <PenTool className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                Drag and drop drawing files here, or click to select
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                PNG · JPG · JPEG · WEBP · PDF — up to 50 MB each
              </p>
            </div>
          )}
          {drawings.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {drawings.map((drawing, idx) => {
                const ext = (drawing.fileExtension || "").toLowerCase();
                const isImage = [".png", ".jpg", ".jpeg", ".webp"].includes(ext);
                const isPdf = ext === ".pdf";
                return (
                  <div
                    key={idx}
                    className={`border rounded-md overflow-hidden relative ${
                      drawing.uploadStatus === "error"
                        ? "border-red-300 bg-red-50"
                        : drawing.uploadStatus === "uploading"
                          ? "border-amber-300 bg-amber-50"
                          : "border-zinc-200"
                    }`}
                  >
                    <div className="relative aspect-square bg-zinc-100 flex items-center justify-center">
                      {isImage && drawing.previewUrl ? (
                        <img
                          src={drawing.previewUrl}
                          alt={drawing.title}
                          className="w-full h-full object-contain"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      ) : isPdf ? (
                        <div className="flex flex-col items-center text-muted-foreground">
                          <FileText className="h-12 w-12" />
                          <span className="text-xs mt-1">PDF Document</span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center text-muted-foreground">
                          <ImageIcon className="h-12 w-12" />
                          <span className="text-xs mt-1">{ext.toUpperCase().replace(".", "")}</span>
                        </div>
                      )}
                      {drawing.uploadStatus === "uploading" && (
                        <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                          <Loader2 className="h-6 w-6 animate-spin text-amber-600" />
                        </div>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); removeDrawing(idx); }}
                        className="absolute top-1 right-1 bg-red-600 text-white rounded-full p-1 hover:bg-red-700 z-10"
                        title="Remove drawing"
                        disabled={drawing.uploadStatus === "uploading"}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="p-2">
                      <div className="text-xs font-semibold truncate" title={drawing.title}>
                        {drawing.title}
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground truncate">
                        {drawing.fileName}
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[10px]">
                        <span className="uppercase text-muted-foreground">{ext.replace(".", "")}</span>
                        {drawing.fileSize ? (
                          <span className="text-muted-foreground">{Math.round(drawing.fileSize / 1024)} KB</span>
                        ) : null}
                      </div>
                      {drawing.uploadStatus === "error" && (
                        <div className="mt-1 text-[10px] text-red-700" title={drawing.errorMessage}>
                          Upload failed
                        </div>
                      )}
                      {drawing.uploadStatus === "uploaded" && drawing.drawingNumber && (
                        <div className="mt-1 text-[10px] text-emerald-700 font-mono truncate">
                          {drawing.drawingNumber}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {/* Add more tile */}
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) handleDrawingUpload(e.target.files);
                    e.target.value = "";
                  }}
                />
                <div className="border-2 border-dashed border-zinc-300 rounded-md aspect-square flex flex-col items-center justify-center text-muted-foreground hover:border-amber-400 hover:text-amber-700 transition-colors">
                  <Plus className="h-6 w-6" />
                  <span className="text-xs mt-1">Add more</span>
                </div>
              </label>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 1 navigation */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={saveDraft} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save Draft
        </Button>
        <Button onClick={proceedToNext} disabled={saving}>
          Proceed to Next <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
      </>
      )} {/* end step 1 */}

      {/* ═══ STEP 2: MIDDLE STEP — type-specific ═══
          • PIPELINE_THICKNESS → measurement table (11 columns + custom)
          • PIPELINE_VISUAL    → visual inspection observations (rows)
          • PIPELINE_CONDITION → condition assessment form (single-instance fields)
      */}
      {step === 2 && header.reportType === "PIPELINE_THICKNESS" && (
      <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Thickness Measurement Table</CardTitle>
              <CardDescription>
                11 columns in fixed order. The first two columns are
                dropdown-selected; the third is auto-computed from standards;
                the four clock-position measurements are entered manually; the
                observed minimum is calculated excluding any missing values.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button onClick={addRow} size="sm">
                <Plus className="mr-1 h-4 w-4" /> Add Row
              </Button>
              <Button onClick={deleteSelectedRows} size="sm" variant="outline" className="text-red-600"
                disabled={selectedRowIdxs.size === 0}>
                <Trash2 className="mr-1 h-4 w-4" /> Delete Selected ({selectedRowIdxs.size})
              </Button>
              <Button onClick={addCustomColumn} size="sm" variant="outline">
                <Columns3 className="mr-1 h-4 w-4" /> Add Column
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-emerald-800 text-white">
                <tr>
                  <th className="border border-emerald-900 px-2 py-2 text-center" style={{ minWidth: 40 }}>
                    <input type="checkbox" checked={selectedRowIdxs.size === rows.length && rows.length > 0} onChange={toggleSelectAllRows} className="cursor-pointer" />
                  </th>
                  <th className="border border-emerald-900 px-2 py-2 text-center align-middle" style={{ minWidth: 50 }}>Dia mm<br />(inch)</th>
                  <th className="border border-emerald-900 px-2 py-2 text-center align-middle" style={{ minWidth: 60 }}>Pipe<br />Schedule</th>
                  <th className="border border-emerald-900 px-2 py-2 text-center align-middle" style={{ minWidth: 55 }}>Nominal<br />Thickness<br />(mm)</th>
                  <th className="border border-emerald-900 px-2 py-2 text-center align-middle" style={{ minWidth: 70 }}>Component<br />Type</th>
                  <th className="border border-emerald-900 px-2 py-2 text-center align-middle" style={{ minWidth: 50 }}>Point<br />No</th>
                  <th className="border border-emerald-900 px-2 py-2 text-center align-middle" style={{ minWidth: 70 }}>
                    <div className="flex flex-col items-center">
                      <span>12 o'clock</span>
                      <span>North (mm)</span>
                    </div>
                  </th>
                  <th className="border border-emerald-900 px-2 py-2 text-center align-middle" style={{ minWidth: 70 }}>
                    <div className="flex flex-col items-center">
                      <span>3 o'clock</span>
                      <span>East (mm)</span>
                    </div>
                  </th>
                  <th className="border border-emerald-900 px-2 py-2 text-center align-middle" style={{ minWidth: 70 }}>
                    <div className="flex flex-col items-center">
                      <span>6 o'clock</span>
                      <span>South (mm)</span>
                    </div>
                  </th>
                  <th className="border border-emerald-900 px-2 py-2 text-center align-middle" style={{ minWidth: 70 }}>
                    <div className="flex flex-col items-center">
                      <span>9 o'clock</span>
                      <span>West (mm)</span>
                    </div>
                  </th>
                  <th className="border border-emerald-900 px-2 py-2 text-center align-middle" style={{ minWidth: 75 }}>
                    Observed<br />Minimum<br />Thickness<br />(mm)
                  </th>
                  <th className="border border-emerald-900 px-2 py-2 text-center align-middle" style={{ minWidth: 200 }}>Findings / Comments</th>
                  {customColumns.map((cc) => (
                    <th key={cc.id} className="border border-emerald-900 px-2 py-2 text-center align-middle" style={{ minWidth: 80 }}>
                      <div className="flex items-center gap-1">
                        <span>{cc.name}</span>
                        {cc.unit && <span className="text-[9px] opacity-70">({cc.unit})</span>}
                        <button onClick={() => deleteCustomColumn(cc.id)} className="ml-1 text-red-300 hover:text-red-100" title={`Delete "${cc.name}" column`}>
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </th>
                  ))}
                  <th className="border border-emerald-900 px-2 py-2 text-center" style={{ minWidth: 80 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={12} className="text-center py-6 text-muted-foreground border border-zinc-300">
                      No measurement rows yet. Click <strong>Add Row</strong> to begin.
                    </td>
                  </tr>
                )}
                {rows.map((row, idx) => {
                  const nominalMissing = row.nominalThicknessMm === null;
                  return (
                    <tr key={idx} className="hover:bg-muted/30">
                      {/* Row selection checkbox */}
                      <td className="border border-zinc-300 p-1 text-center">
                        <input
                          type="checkbox"
                          checked={selectedRowIdxs.has(idx)}
                          onChange={() => toggleRowSelection(idx)}
                          className="cursor-pointer"
                        />
                      </td>
                      {/* Col 1: Dia mm (inch) — dropdown */}
                      <td className="border border-zinc-300 p-1 text-center">
                        <Select
                          value={row.pipeSizeInch}
                          onValueChange={(v) => updateRow(idx, { pipeSizeInch: v })}
                        >
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {sizes.map((s) => (
                              <SelectItem key={s} value={s}>{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      {/* Col 2: Pipe Schedule — dropdown */}
                      <td className="border border-zinc-300 p-1 text-center">
                        <Select
                          value={row.pipeSchedule}
                          onValueChange={(v) => updateRow(idx, { pipeSchedule: v })}
                        >
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {schedulesForRow(row.pipeSizeInch).map((s) => (
                              <SelectItem key={s} value={s}>{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      {/* Col 3: Nominal Thickness — auto-computed */}
                      <td className="border border-zinc-300 p-1 text-center tabular-nums">
                        {nominalMissing ? (
                          <Badge variant="outline" className="border-red-500 text-red-700 text-[10px]">
                            UNSUPPORTED
                          </Badge>
                        ) : (
                          <span>{row.nominalThicknessMm?.toFixed(2)}</span>
                        )}
                      </td>
                      {/* Col 4: Component Type */}
                      <td className="border border-zinc-300 p-1 text-center">
                        <Select
                          value={row.componentTypeCode}
                          onValueChange={(v) => {
                            const ct = componentTypes.find((c) => c.code === v);
                            updateRow(idx, {
                              componentTypeCode: v,
                              componentTypeId: ct?.id ?? null,
                            });
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {componentTypes.map((c) => (
                              <SelectItem key={c.id} value={c.code}>{c.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      {/* Col 5: Point No */}
                      <td className="border border-zinc-300 p-1 text-center">
                        <Input
                          className="h-8 text-xs text-center font-mono"
                          value={row.pointNo}
                          onChange={(e) => updateRow(idx, { pointNo: e.target.value })}
                        />
                      </td>
                      {/* Col 6-9: clock-position measurements */}
                      {(["north", "east", "south", "west"] as const).map((dir) => {
                        const mmKey = `${dir}Mm` as keyof MeasurementRow;
                        const stKey = `${dir}Status` as keyof MeasurementRow;
                        return (
                          <td key={dir} className="border border-zinc-300 p-1">
                            <div className="flex flex-col gap-1">
                              <Input
                                type="number"
                                step="any"
                                className={`h-8 text-xs text-center ${row[stKey] === "Measured" ? "" : "bg-zinc-100"}`}
                                value={row[mmKey] as string}
                                onChange={(e) => updateRow(idx, { [mmKey]: e.target.value } as Partial<MeasurementRow>)}
                                disabled={row[stKey] !== "Measured"}
                              />
                              <Select
                                value={row[stKey] as string}
                                onValueChange={(v) => updateRow(idx, { [stKey]: v } as Partial<MeasurementRow>)}
                              >
                                <SelectTrigger className="h-6 text-[10px] py-0">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {STATUS_OPTIONS.map((s) => (
                                    <SelectItem key={s.value} value={s.value} className="text-xs">
                                      {s.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </td>
                        );
                      })}
                      {/* Col 10: Observed Minimum */}
                      <td className="border border-zinc-300 p-1 text-center tabular-nums font-semibold bg-emerald-50">
                        {row.observedMinimumMm !== null ? row.observedMinimumMm.toFixed(2) : "—"}
                      </td>
                      {/* Col 11: Findings / Comments */}
                      <td className="border border-zinc-300 p-1">
                        <Textarea
                          rows={1}
                          className="text-xs min-h-[32px] py-1"
                          value={row.findingsComments}
                          onChange={(e) => updateRow(idx, { findingsComments: e.target.value })}
                          placeholder="Observations at this point"
                        />
                      </td>
                      {/* Custom columns */}
                      {customColumns.map((cc) => (
                        <td key={cc.id} className="border border-zinc-300 p-1 text-center">
                          <Input
                            type="text"
                            className="h-8 text-xs text-center"
                            value={getCustomColumnValue(row, cc.id)}
                            onChange={(e) => setCustomColumnValue(idx, cc.id, e.target.value)}
                            placeholder={cc.unit || "—"}
                          />
                        </td>
                      ))}
                      <td className="border border-zinc-300 p-1">
                        <div className="flex flex-col gap-1">
                          <div className="flex gap-0.5">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0"
                              onClick={() => moveRow(idx, -1)}
                              disabled={idx === 0}
                              title="Move up"
                            >
                              <ArrowUp className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0"
                              onClick={() => moveRow(idx, 1)}
                              disabled={idx === rows.length - 1}
                              title="Move down"
                            >
                              <ArrowDown className="h-3 w-3" />
                            </Button>
                          </div>
                          <div className="flex gap-0.5">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-[10px]"
                              onClick={() => saveRow(idx)}
                              disabled={saving}
                              title="Save row"
                            >
                              <Save className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0 text-red-600 hover:text-red-700"
                              onClick={() => deleteRowApi(idx)}
                              title="Delete row"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-zinc-50">
        <CardContent className="p-4 text-xs text-muted-foreground space-y-1">
          <div><strong>Column order:</strong> Dia mm (inch) | Pipe Schedule | Nominal Thickness (mm) | Component Type | Point No | 12 o'clock / North (mm) | 3 o'clock / East (mm) | 6 o'clock / South (mm) | 9 o'clock / West (mm) | Observed Minimum Thickness (mm) | Findings / Comments{customColumns.length > 0 ? " | " + customColumns.map(c => c.name).join(" | ") : ""}</div>
          <div><strong>Nominal Thickness</strong> is auto-populated from ASME B36.10M / B36.19M reference data. Unsupported combinations display an UNSUPPORTED badge.</div>
          <div><strong>Observed Minimum</strong> is computed from valid (Measured) readings only. Missing / NotMeasured / NotApplicable values are excluded and never converted to zero.</div>
          <div><strong>Custom columns</strong> can be added/deleted via the "Add Column" button. System columns (Dia, Schedule, Nominal, etc.) cannot be deleted.</div>
        </CardContent>
      </Card>

      {/* Step 2 navigation (shared across all three report types) */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={goPrevious}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Previous
        </Button>
        <Button variant="ghost" onClick={saveDraft} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save Draft
        </Button>
        <Button onClick={proceedToNext} disabled={saving}>
          Proceed to Next <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
      </>
      )} {/* end step 2 — thickness */}

      {/* ═══ STEP 2 (VISUAL): VISUAL OBSERVATIONS TABLE ═══ */}
      {step === 2 && header.reportType === "PIPELINE_VISUAL" && (
      <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Visual Inspection Observations</CardTitle>
              <CardDescription>
                Add one row per inspection point along the pipeline. Each row
                captures the visual condition at that point. Click <strong>Save</strong>
                on each row to persist it before navigating away.
              </CardDescription>
            </div>
            <Button onClick={addVisualObservation} size="sm">
              <Plus className="mr-1 h-4 w-4" /> Add Observation
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-blue-800 text-white">
                <tr>
                  <th className="border border-blue-900 px-2 py-2 text-center align-middle" style={{ minWidth: 50 }}>Pt No</th>
                  <th className="border border-blue-900 px-2 py-2 text-center align-middle" style={{ minWidth: 110 }}>Location</th>
                  <th className="border border-blue-900 px-2 py-2 text-center align-middle" style={{ minWidth: 90 }}>Pipeline Condition</th>
                  <th className="border border-blue-900 px-2 py-2 text-center align-middle" style={{ minWidth: 90 }}>External Surface</th>
                  <th className="border border-blue-900 px-2 py-2 text-center align-middle" style={{ minWidth: 90 }}>Coating / Paint</th>
                  <th className="border border-blue-900 px-2 py-2 text-center align-middle" style={{ minWidth: 90 }}>Corrosion</th>
                  <th className="border border-blue-900 px-2 py-2 text-center align-middle" style={{ minWidth: 80 }}>Leakage</th>
                  <th className="border border-blue-900 px-2 py-2 text-center align-middle" style={{ minWidth: 100 }}>Damage / Deformation</th>
                  <th className="border border-blue-900 px-2 py-2 text-center align-middle" style={{ minWidth: 90 }}>Supports / Hangers</th>
                  <th className="border border-blue-900 px-2 py-2 text-center align-middle" style={{ minWidth: 90 }}>Weld Joint</th>
                  <th className="border border-blue-900 px-2 py-2 text-center align-middle" style={{ minWidth: 90 }}>Insulation</th>
                  <th className="border border-blue-900 px-2 py-2 text-center align-middle" style={{ minWidth: 160 }}>Findings</th>
                  <th className="border border-blue-900 px-2 py-2 text-center align-middle" style={{ minWidth: 160 }}>Recommendations</th>
                  <th className="border border-blue-900 px-2 py-2 text-center align-middle" style={{ minWidth: 160 }}>Inspector Comments</th>
                  <th className="border border-blue-900 px-2 py-2 text-center align-middle" style={{ minWidth: 80 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visualObservations.length === 0 && (
                  <tr>
                    <td colSpan={15} className="text-center py-6 text-muted-foreground border border-zinc-300">
                      No observations yet. Click <strong>Add Observation</strong> to begin.
                    </td>
                  </tr>
                )}
                {visualObservations.map((obs, idx) => (
                  <tr key={idx} className="hover:bg-muted/30">
                    <td className="border border-zinc-300 p-1">
                      <Input
                        className="h-8 text-xs text-center font-mono"
                        value={obs.pointNo}
                        onChange={(e) => updateVisualObservation(idx, { pointNo: e.target.value })}
                      />
                    </td>
                    <td className="border border-zinc-300 p-1">
                      <Input
                        className="h-8 text-xs"
                        value={obs.location}
                        onChange={(e) => updateVisualObservation(idx, { location: e.target.value })}
                        placeholder="e.g. Top rack, Bay 3"
                      />
                    </td>
                    <td className="border border-zinc-300 p-1">
                      <Select
                        value={obs.pipelineCondition || "N/A"}
                        onValueChange={(v) => updateVisualObservation(idx, { pipelineCondition: v === "N/A" ? "" : v })}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CONDITION_RATINGS.map((c) => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="border border-zinc-300 p-1">
                      <Select
                        value={obs.externalSurfaceCondition || "N/A"}
                        onValueChange={(v) => updateVisualObservation(idx, { externalSurfaceCondition: v === "N/A" ? "" : v })}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CONDITION_RATINGS.map((c) => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="border border-zinc-300 p-1">
                      <Select
                        value={obs.coatingPaintCondition || "N/A"}
                        onValueChange={(v) => updateVisualObservation(idx, { coatingPaintCondition: v === "N/A" ? "" : v })}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CONDITION_RATINGS.map((c) => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="border border-zinc-300 p-1">
                      <Select
                        value={obs.corrosionObserved || "N/A"}
                        onValueChange={(v) => updateVisualObservation(idx, { corrosionObserved: v === "N/A" ? "" : v })}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CORROSION_LEVELS.map((c) => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="border border-zinc-300 p-1">
                      <Select
                        value={obs.leakageObserved || "N/A"}
                        onValueChange={(v) => updateVisualObservation(idx, { leakageObserved: v === "N/A" ? "" : v })}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {YES_NO_NA.map((c) => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="border border-zinc-300 p-1">
                      <Input
                        className="h-8 text-xs"
                        value={obs.damageOrDeformation}
                        onChange={(e) => updateVisualObservation(idx, { damageOrDeformation: e.target.value })}
                        placeholder="e.g. None / Dent at 2m"
                      />
                    </td>
                    <td className="border border-zinc-300 p-1">
                      <Select
                        value={obs.supportsHangersCondition || "N/A"}
                        onValueChange={(v) => updateVisualObservation(idx, { supportsHangersCondition: v === "N/A" ? "" : v })}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CONDITION_RATINGS.map((c) => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="border border-zinc-300 p-1">
                      <Select
                        value={obs.weldJointCondition || "N/A"}
                        onValueChange={(v) => updateVisualObservation(idx, { weldJointCondition: v === "N/A" ? "" : v })}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CONDITION_RATINGS.map((c) => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="border border-zinc-300 p-1">
                      <Select
                        value={obs.insulationCondition || "N/A"}
                        onValueChange={(v) => updateVisualObservation(idx, { insulationCondition: v === "N/A" ? "" : v })}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CONDITION_RATINGS.map((c) => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                          <SelectItem value="Not Applicable">Not Applicable (no insulation)</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="border border-zinc-300 p-1">
                      <Textarea
                        rows={1}
                        className="text-xs min-h-[32px] py-1"
                        value={obs.findings}
                        onChange={(e) => updateVisualObservation(idx, { findings: e.target.value })}
                        placeholder="Observations at this point"
                      />
                    </td>
                    <td className="border border-zinc-300 p-1">
                      <Textarea
                        rows={1}
                        className="text-xs min-h-[32px] py-1"
                        value={obs.recommendations}
                        onChange={(e) => updateVisualObservation(idx, { recommendations: e.target.value })}
                        placeholder="Recommended actions"
                      />
                    </td>
                    <td className="border border-zinc-300 p-1">
                      <Textarea
                        rows={1}
                        className="text-xs min-h-[32px] py-1"
                        value={obs.inspectorComments}
                        onChange={(e) => updateVisualObservation(idx, { inspectorComments: e.target.value })}
                        placeholder="Inspector notes"
                      />
                    </td>
                    <td className="border border-zinc-300 p-1">
                      <div className="flex flex-col gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[10px]"
                          onClick={() => saveVisualObservation(idx)}
                          disabled={saving}
                          title="Save observation"
                        >
                          <Save className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 text-red-600 hover:text-red-700"
                          onClick={() => deleteVisualObservationApi(idx)}
                          title="Delete observation"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-zinc-50">
        <CardContent className="p-4 text-xs text-muted-foreground space-y-1">
          <div><strong>Visual inspection:</strong> each row captures the visual condition at one inspection point along the pipeline.</div>
          <div><strong>Photo attachment:</strong> use Step 3 (Findings &amp; Photos) to upload inspection photographs — they appear in the PDF photo gallery.</div>
          <div><strong>Dropdowns:</strong> condition ratings are Good / Fair / Poor / Critical / N/A; corrosion is None / Light / Moderate / Severe / N/A.</div>
        </CardContent>
      </Card>

      {/* Step 2 navigation */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={goPrevious}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Previous
        </Button>
        <Button variant="ghost" onClick={saveDraft} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save Draft
        </Button>
        <Button onClick={proceedToNext} disabled={saving}>
          Proceed to Next <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
      </>
      )} {/* end step 2 — visual */}

      {/* ═══ STEP 2 (CONDITION): CONDITION ASSESSMENT FORM ═══ */}
      {step === 2 && header.reportType === "PIPELINE_CONDITION" && (
      <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pipeline Condition Assessment</CardTitle>
          <CardDescription>
            Capture the overall condition of the pipeline section, risk / priority
            level, and recommendations. Click <strong>Save Draft</strong> to persist
            changes — these fields are saved to the report header.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <Label>Pipeline Age (years, if available)</Label>
            <Input
              type="number"
              step="any"
              value={header.pipelineAgeYears}
              onChange={(e) => updateHeader("pipelineAgeYears", e.target.value)}
              placeholder="e.g. 12"
            />
          </div>
          <div className="space-y-2">
            <Label>Service / Fluid</Label>
            <Input
              value={header.serviceFluid}
              onChange={(e) => updateHeader("serviceFluid", e.target.value)}
              placeholder="e.g. Cooling Water, Natural Gas, Steam"
            />
          </div>
          <div className="space-y-2">
            <Label>Operating Condition</Label>
            <Select
              value={header.operatingCondition || "—"}
              onValueChange={(v) => updateHeader("operatingCondition", v === "—" ? "" : v)}
            >
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="—">—</SelectItem>
                <SelectItem value="Normal">Normal</SelectItem>
                <SelectItem value="Elevated Temperature">Elevated Temperature</SelectItem>
                <SelectItem value="High Pressure">High Pressure</SelectItem>
                <SelectItem value="Cyclic">Cyclic</SelectItem>
                <SelectItem value="Intermittent">Intermittent</SelectItem>
                <SelectItem value="Decommissioned">Decommissioned</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Overall Condition Rating</Label>
            <Select
              value={header.overallConditionRating || "N/A"}
              onValueChange={(v) => updateHeader("overallConditionRating", v === "N/A" ? "" : v)}
            >
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="N/A">N/A</SelectItem>
                <SelectItem value="Excellent">Excellent</SelectItem>
                <SelectItem value="Good">Good</SelectItem>
                <SelectItem value="Fair">Fair</SelectItem>
                <SelectItem value="Poor">Poor</SelectItem>
                <SelectItem value="Critical">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Risk / Priority Level</Label>
            <Select
              value={header.riskPriorityLevel || "—"}
              onValueChange={(v) => updateHeader("riskPriorityLevel", v === "—" ? "" : v)}
            >
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="—">—</SelectItem>
                <SelectItem value="Low">Low</SelectItem>
                <SelectItem value="Medium">Medium</SelectItem>
                <SelectItem value="High">High</SelectItem>
                <SelectItem value="Critical">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Previous Inspection Reference</Label>
            <Input
              value={header.previousInspectionRef}
              onChange={(e) => updateHeader("previousInspectionRef", e.target.value)}
              placeholder="e.g. UT-COR-ENN-001 (2024)"
              className="font-mono"
            />
          </div>
          <div className="space-y-2 sm:col-span-2 lg:col-span-3">
            <Label>Corrosion Condition</Label>
            <Textarea
              rows={2}
              value={header.corrosionCondition}
              onChange={(e) => updateHeader("corrosionCondition", e.target.value)}
              placeholder="Describe observed corrosion type, extent, location..."
            />
          </div>
          <div className="space-y-2 sm:col-span-2 lg:col-span-3">
            <Label>Damage Assessment</Label>
            <Textarea
              rows={2}
              value={header.damageAssessment}
              onChange={(e) => updateHeader("damageAssessment", e.target.value)}
              placeholder="Describe observed damage (mechanical, weld, support, etc.)..."
            />
          </div>
          <div className="space-y-2 sm:col-span-2 lg:col-span-3">
            <Label>Current Inspection Findings</Label>
            <Textarea
              rows={4}
              value={header.currentInspectionFindings}
              onChange={(e) => updateHeader("currentInspectionFindings", e.target.value)}
              placeholder="Detailed findings from the current inspection..."
            />
          </div>
          <div className="space-y-2 sm:col-span-2 lg:col-span-3">
            <Label>Recommendations</Label>
            <Textarea
              rows={4}
              value={header.recommendations}
              onChange={(e) => updateHeader("recommendations", e.target.value)}
              placeholder="Recommended actions, repairs, replacement, monitoring..."
            />
          </div>
          <div className="space-y-2 sm:col-span-2 lg:col-span-3">
            <Label>Next Inspection Recommendation</Label>
            <Textarea
              rows={2}
              value={header.nextInspectionRecommendation}
              onChange={(e) => updateHeader("nextInspectionRecommendation", e.target.value)}
              placeholder="e.g. Re-inspect in 12 months with UT thickness survey"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-zinc-50">
        <CardContent className="p-4 text-xs text-muted-foreground space-y-1">
          <div><strong>Condition assessment:</strong> single-instance fields describing the overall pipeline condition.</div>
          <div><strong>Photos &amp; drawings:</strong> attach supporting evidence via Step 1 (drawings) and Step 3 (photos).</div>
          <div><strong>Save:</strong> click <strong>Save Draft</strong> to persist changes. The fields are saved to the report header.</div>
        </CardContent>
      </Card>

      {/* Step 2 navigation */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={goPrevious}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Previous
        </Button>
        <Button variant="ghost" onClick={saveDraft} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save Draft
        </Button>
        <Button onClick={proceedToNext} disabled={saving}>
          Proceed to Next <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
      </>
      )} {/* end step 2 — condition */}

      {/* ═══ STEP 3: FINDINGS & PHOTOS ═══ */}
      {step === 3 && (
      <>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Inspection Findings and Evidence</CardTitle>
            <CardDescription>
              Describe the inspection performed, visible conditions, observations,
              and upload supporting photographs.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* A. Inspection Description */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Inspection Description</Label>
              <Textarea
                rows={6}
                value={header.inspectionDescription}
                onChange={(e) => updateHeader("inspectionDescription", e.target.value)}
                placeholder="Describe the inspection performed, visible condition of the component, observations and abnormalities, inspection limitations, and additional technical notes..."
                className="text-sm"
              />
              <p className="text-xs text-muted-foreground">
                This description will be included in the generated PDF report.
              </p>
            </div>

            {/* B. Findings Summary */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Findings Summary</Label>
              <Textarea
                rows={3}
                value={header.findingsSummary}
                onChange={(e) => updateHeader("findingsSummary", e.target.value)}
                placeholder="Brief overall summary of findings..."
                className="text-sm"
              />
            </div>

            {/* C. Comments */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold">General Comments</Label>
              <Textarea
                rows={2}
                value={header.comments}
                onChange={(e) => updateHeader("comments", e.target.value)}
                placeholder="Any additional comments..."
                className="text-sm"
              />
            </div>

            {/* D. Photo Upload */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">Photographs</Label>
                <div className="flex gap-2">
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files) handlePhotoUpload(e.target.files);
                        e.target.value = "";
                      }}
                    />
                    <Button size="sm" asChild>
                      <span>
                        <Camera className="mr-2 h-4 w-4" /> Upload Photos
                      </span>
                    </Button>
                  </label>
                </div>
              </div>

              {/* Drag-and-drop zone */}
              {(
                <div
                  className="border-2 border-dashed border-zinc-300 rounded-md p-6 text-center cursor-pointer hover:border-amber-400 transition-colors"
                  onDragOver={(e) => { e.preventDefault(); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer.files) handlePhotoUpload(e.dataTransfer.files);
                  }}
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = "image/jpeg,image/png,image/webp,image/gif";
                    input.multiple = true;
                    input.onchange = (e) => {
                      const target = e.target as HTMLInputElement;
                      if (target.files) handlePhotoUpload(target.files);
                    };
                    input.click();
                  }}
                >
                  <Camera className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">
                    Drag and drop photos here, or click to select files
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    JPEG, PNG, WebP, GIF — max 10 MB each
                  </p>
                </div>
              )}

              {/* Photo previews */}
              {photos.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {photos.map((photo, idx) => (
                    <div key={idx} className="border rounded-md overflow-hidden">
                      <div className="relative aspect-video bg-zinc-100">
                        {photo.filePath ? (
                          <img
                            src={`/api/pipeline-inspections/${editingPipelineReportId}/photos/${photo.id}/raw`}
                            alt={photo.caption || photo.fileName}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = "none";
                            }}
                          />
                        ) : (
                          <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
                            {photo.fileName}
                          </div>
                        )}
                        <button
                          onClick={() => removePhoto(photo.id, idx)}
                          className="absolute top-1 right-1 bg-red-600 text-white rounded-full p-1 hover:bg-red-700"
                          title="Remove photo"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                      <div className="p-2">
                        <Input
                          type="text"
                          className="text-xs h-7"
                          value={photo.caption}
                          onChange={(e) => updatePhotoCaption(idx, e.target.value)}
                          onBlur={() => photo.id && savePhotoCaption(photo.id, photo.caption)}
                          placeholder="Caption (e.g. Corrosion observed)"
                        />
                        <div className="mt-1 text-[10px] text-muted-foreground truncate">
                          {photo.fileName}{photo.fileSize ? ` · ${Math.round(photo.fileSize / 1024)} KB` : ""}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Step 3 navigation */}
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={goPrevious}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Previous
          </Button>
          <Button variant="ghost" onClick={saveDraft} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Draft
          </Button>
          <Button
            onClick={() => {
              saveDraft().then(() => {
                if (editingPipelineReportId) openPipelineReport(editingPipelineReportId);
              });
            }}
            disabled={saving || !editingPipelineReportId}
          >
            Review Report <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </>
      )}
    </div>
  );
}
