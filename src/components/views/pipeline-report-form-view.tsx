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
  Droplet,
  Upload,
  CheckCircle2,
  RefreshCw,
  Magnet,
  Waves,
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
import { AuthImage } from "@/components/auth-image";
import { toast } from "sonner";

// ---------- REPORT TYPE METADATA ----------

const REPORT_TYPE_INFO: Record<PipelineReportType, {
  title: string;            // PDF title
  shortLabel: string;       // sidebar / list badge
  formHeading: string;      // shown at top of form
  formDescription: string;
  step2Label: string;       // middle step name
  accent: string;           // badge color class
  /** When true, the form shows a "Coming soon" notice instead of an
   * inspection table. The user can still fill in the header, save, and
   * submit, but the type-specific inspection data entry is disabled. */
  comingSoon?: boolean;
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
  PIPELINE_DPT: {
    title: "DYE PENETRANT TESTING REPORT",
    shortLabel: "DPT/DPPT",
    formHeading: "New DPT / DPPT Dye Penetrant Testing Report",
    formDescription: "Dye penetrant testing with complete Dye Penetrant Procedure, Consumable Details, observation table, and Accept/Reject results.",
    step2Label: "DPT Observations",
    accent: "border-purple-500 text-purple-700",
  },
  PIPELINE_MPT: {
    title: "MAGNETIC PARTICLE TESTING REPORT",
    shortLabel: "MPT",
    formHeading: "New MPT – Magnetic Particle Testing Report",
    formDescription: "Magnetic particle inspection with MPT parameters, consumable details, observation table, and Accept/Reject results.",
    step2Label: "MPT Observations",
    accent: "border-orange-500 text-orange-700",
  },
  PIPELINE_WELD_SCAN: {
    title: "WELD SCAN REPORT",
    shortLabel: "Weld Scan",
    formHeading: "New Weld Scan Report",
    formDescription: "Weld scan inspection with observation table and Accept/Reject results.",
    step2Label: "Weld Scan Observations",
    accent: "border-cyan-500 text-cyan-700",
  },
  PIPELINE_UT: {
    title: "ULTRASONIC TEST REPORT",
    shortLabel: "UT",
    formHeading: "New Ultrasonic Test Report",
    formDescription: "Ultrasonic test with equipment, probes, scanning details, test results, and sign-off.",
    step2Label: "UT Details",
    accent: "border-blue-500 text-blue-700",
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
  inspectionDate: string; // preserved for backward compat
  fromDate: string;
  toDate: string;
  primaryPhotoPath: string;
  findingsSummary: string;
  comments: string;
  inspectionDescription: string;
  customColumns: string; // JSON array of {id, name, unit}
  // ─── NEW REPORT SECTIONS (all report types) ───
  siteObservationSummary: string;
  results: string;
  conclusion: string;
  // ─── SIGN-OFF FIELDS ───
  inspectorName: string;          // editable — Inspected By name
  inspectorDesignation: string;
  secondReviewedByName: string;
  secondReviewedByDesignation: string;
  approvedByName: string;         // editable — Approved By name
  approvedByDesignation: string;
  // ─── DPT / DPPT FIELDS ───
  dptDateOfExamination: string;
  dptSolventCleaner: string;
  dptPenetrant: string;
  dptDeveloper: string;
  dptCustomColumns: string;
  // ─── DYE PENETRANT PROCEDURE FIELDS ───
  // Two-column "DYE PENETRANT PROCEDURE" section. All editable/typeable.
  dptTestingStandard: string;
  dptAcceptanceCriteria: string;
  dptSurfacePreparation: string;
  dptSurfaceTemperature: string;
  dptPenetrantType: string;
  dptPenetrantProcess: string;
  dptMethodOfPreCleaning: string;
  dptDryingTimeAfterPreCleaning: string;
  dptMethodOfApplyingPenetrant: string;
  dptPenetratingTime: string;
  dptMethodOfRemovingExcessPenetrant: string;
  dptMethodOfApplyingDeveloper: string;
  dptDevelopmentTime: string;
  dptInterpretationTime: string;
  dptLightingEquipment: string;
  dptPostCleaning: string;
  // ─── MPT (MAGNETIC PARTICLE TESTING) FIELDS ───
  mptDateOfExamination: string;
  mptTestingStandard: string;
  mptAcceptanceCriteria: string;
  mptSurfacePreparation: string;
  mptSurfaceTemperature: string;
  mptInstrumentSerialNo: string;
  mptCalibrationDate: string;
  mptMethod: string;
  mptTypeOfCurrent: string;
  mptAcYokeLiftingCapacity: string;
  mptContrastMedium: string;
  mptMethodOfPreCleaning: string;
  mptMethodOfApplyingWhiteContrast: string;
  mptAcYokePoleSpacing: string;
  mptMagneticMedium: string;
  mptMethodOfApplyingMagneticMedium: string;
  mptDevelopmentTime: string;
  mptInterpretationTime: string;
  mptLightingEquipment: string;
  mptPostCleaning: string;
  // MPT Consumable Details
  mptWhiteContrast: string;
  mptWetParticleIronInk: string;
  mptCustomColumns: string;
  // ─── UT (ULTRASONIC TEST) FIELDS ───
  utSubContract: string;
  utProject: string;
  utJobLocation: string;
  utJobDescription: string;
  utMaterial: string;
  utCouplant: string;
  utReferenceDocuments: string;
  utProcedureNo: string;
  utAcceptanceStandard: string;
  utUfdDetails: string;
  utCalibrationBlock: string;
  utExtentOfExamination: string;
  utSurfaceCondition: string;
  utReferenceLevel: string;
  utFlawSizingTechnique: string;
  utInspectionNote: string;
  utEquipmentRows: string;
  utProbeRows: string;
  utTestResultRows: string;
  utCustomColumns: string;
  // Condition fields default empty
  pipelineAgeYears: string;
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
  fromDate: new Date().toISOString().slice(0, 10),
  toDate: new Date().toISOString().slice(0, 10),
  primaryPhotoPath: "",
  findingsSummary: "",
  comments: "",
  inspectionDescription: "",
  customColumns: "[]",
  // New report sections (all types)
  siteObservationSummary: "",
  results: "",
  conclusion: "",
  // Sign-off fields
  inspectorName: "",
  inspectorDesignation: "",
  secondReviewedByName: "",
  secondReviewedByDesignation: "",
  approvedByName: "",
  approvedByDesignation: "",
  // DPT fields default empty
  dptDateOfExamination: new Date().toISOString().slice(0, 10),
  dptSolventCleaner: "",
  dptPenetrant: "",
  dptDeveloper: "",
  dptCustomColumns: "[]",
  // Dye Penetrant Procedure fields default empty
  dptTestingStandard: "",
  dptAcceptanceCriteria: "",
  dptSurfacePreparation: "",
  dptSurfaceTemperature: "",
  dptPenetrantType: "",
  dptPenetrantProcess: "",
  dptMethodOfPreCleaning: "",
  dptDryingTimeAfterPreCleaning: "",
  dptMethodOfApplyingPenetrant: "",
  dptPenetratingTime: "",
  dptMethodOfRemovingExcessPenetrant: "",
  dptMethodOfApplyingDeveloper: "",
  dptDevelopmentTime: "",
  dptInterpretationTime: "",
  dptLightingEquipment: "",
  dptPostCleaning: "",
  // MPT fields default empty
  mptDateOfExamination: new Date().toISOString().slice(0, 10),
  mptTestingStandard: "",
  mptAcceptanceCriteria: "",
  mptSurfacePreparation: "",
  mptSurfaceTemperature: "",
  mptInstrumentSerialNo: "",
  mptCalibrationDate: new Date().toISOString().slice(0, 10),
  mptMethod: "",
  mptTypeOfCurrent: "",
  mptAcYokeLiftingCapacity: "",
  mptContrastMedium: "",
  mptMethodOfPreCleaning: "",
  mptMethodOfApplyingWhiteContrast: "",
  mptAcYokePoleSpacing: "",
  mptMagneticMedium: "",
  mptMethodOfApplyingMagneticMedium: "",
  mptDevelopmentTime: "",
  mptInterpretationTime: "",
  mptLightingEquipment: "",
  mptPostCleaning: "",
  mptWhiteContrast: "",
  mptWetParticleIronInk: "",
  mptCustomColumns: "[]",
  // UT fields default empty
  utSubContract: "",
  utProject: "",
  utJobLocation: "",
  utJobDescription: "",
  utMaterial: "",
  utCouplant: "",
  utReferenceDocuments: "",
  utProcedureNo: "",
  utAcceptanceStandard: "",
  utUfdDetails: "",
  utCalibrationBlock: "",
  utExtentOfExamination: "",
  utSurfaceCondition: "",
  utReferenceLevel: "",
  utFlawSizingTechnique: "",
  utInspectionNote: "",
  utEquipmentRows: "[]",
  utProbeRows: "[]",
  utTestResultRows: "[]",
  utCustomColumns: "[]",
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

// ─── DPT OBSERVATION ROW ───
interface DptObservationRow {
  id?: string;
  serialNo: number;
  sortOrder: number;
  description: string;
  weldType: string;
  result: "Accept" | "Reject";
  remarks: string;
  customColumnValues: string;
  _isNew?: boolean;
}
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
  // DPT observations for Step 3 (PIPELINE_DPT reports)
  const [dptObservations, setDptObservations] = useState<DptObservationRow[]>([]);
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [componentTypes, setComponentTypes] = useState<ComponentTypeItem[]>([]);
  const [standards, setStandards] = useState<PipeStandardItem[]>([]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportStatus, setReportStatus] = useState<string>("Draft");

  // ─── Step navigation state ───
  // 3 steps: Report Details → Inspection Findings → Findings & Photos
  // (Engineering Drawings are part of Step 1 for report types that use them)
  const [step, setStep] = useState<1 | 2 | 3>(1);
  // Custom columns parsed from header.customColumns JSON (thickness reports)
  const [customColumns, setCustomColumns] = useState<CustomColumn[]>([]);
  // DPT custom columns parsed from header.dptCustomColumns JSON (DPT reports)
  const [dptCustomColumns, setDptCustomColumns] = useState<CustomColumn[]>([]);
  // MPT custom columns parsed from header.mptCustomColumns JSON (MPT reports)
  const [mptCustomColumns, setMptCustomColumns] = useState<CustomColumn[]>([]);
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
          fromDate: r.fromDate ? r.fromDate.slice(0, 10) : r.inspectionDate.slice(0, 10),
          toDate: r.toDate ? r.toDate.slice(0, 10) : r.inspectionDate.slice(0, 10),
          primaryPhotoPath: r.primaryPhotoPath ?? "",
          findingsSummary: r.findingsSummary ?? "",
          comments: r.comments ?? "",
          inspectionDescription: r.inspectionDescription ?? "",
          customColumns: r.customColumns ?? "[]",
          // New report sections (all types)
          siteObservationSummary: r.siteObservationSummary ?? "",
          results: r.results ?? "",
          conclusion: r.conclusion ?? "",
          // Sign-off fields
          inspectorName: r.inspectorName ?? "",
          inspectorDesignation: r.inspectorDesignation ?? "",
          secondReviewedByName: r.secondReviewedByName ?? "",
          secondReviewedByDesignation: r.secondReviewedByDesignation ?? "",
          approvedByName: r.approvedByName ?? "",
          approvedByDesignation: r.approvedByDesignation ?? "",
          // DPT fields
          dptDateOfExamination: r.dptDateOfExamination ? r.dptDateOfExamination.slice(0, 10) : new Date().toISOString().slice(0, 10),
          dptSolventCleaner: r.dptSolventCleaner ?? "",
          dptPenetrant: r.dptPenetrant ?? "",
          dptDeveloper: r.dptDeveloper ?? "",
          dptCustomColumns: r.dptCustomColumns ?? "[]",
          // Dye Penetrant Procedure fields
          dptTestingStandard: r.dptTestingStandard ?? "",
          dptAcceptanceCriteria: r.dptAcceptanceCriteria ?? "",
          dptSurfacePreparation: r.dptSurfacePreparation ?? "",
          dptSurfaceTemperature: r.dptSurfaceTemperature ?? "",
          dptPenetrantType: r.dptPenetrantType ?? "",
          dptPenetrantProcess: r.dptPenetrantProcess ?? "",
          dptMethodOfPreCleaning: r.dptMethodOfPreCleaning ?? "",
          dptDryingTimeAfterPreCleaning: r.dptDryingTimeAfterPreCleaning ?? "",
          dptMethodOfApplyingPenetrant: r.dptMethodOfApplyingPenetrant ?? "",
          dptPenetratingTime: r.dptPenetratingTime ?? "",
          dptMethodOfRemovingExcessPenetrant: r.dptMethodOfRemovingExcessPenetrant ?? "",
          dptMethodOfApplyingDeveloper: r.dptMethodOfApplyingDeveloper ?? "",
          dptDevelopmentTime: r.dptDevelopmentTime ?? "",
          dptInterpretationTime: r.dptInterpretationTime ?? "",
          dptLightingEquipment: r.dptLightingEquipment ?? "",
          dptPostCleaning: r.dptPostCleaning ?? "",
          // MPT fields
          mptDateOfExamination: r.mptDateOfExamination ? r.mptDateOfExamination.slice(0, 10) : new Date().toISOString().slice(0, 10),
          mptTestingStandard: r.mptTestingStandard ?? "",
          mptAcceptanceCriteria: r.mptAcceptanceCriteria ?? "",
          mptSurfacePreparation: r.mptSurfacePreparation ?? "",
          mptSurfaceTemperature: r.mptSurfaceTemperature ?? "",
          mptInstrumentSerialNo: r.mptInstrumentSerialNo ?? "",
          mptCalibrationDate: r.mptCalibrationDate ? r.mptCalibrationDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
          mptMethod: r.mptMethod ?? "",
          mptTypeOfCurrent: r.mptTypeOfCurrent ?? "",
          mptAcYokeLiftingCapacity: r.mptAcYokeLiftingCapacity ?? "",
          mptContrastMedium: r.mptContrastMedium ?? "",
          mptMethodOfPreCleaning: r.mptMethodOfPreCleaning ?? "",
          mptMethodOfApplyingWhiteContrast: r.mptMethodOfApplyingWhiteContrast ?? "",
          mptAcYokePoleSpacing: r.mptAcYokePoleSpacing ?? "",
          mptMagneticMedium: r.mptMagneticMedium ?? "",
          mptMethodOfApplyingMagneticMedium: r.mptMethodOfApplyingMagneticMedium ?? "",
          mptDevelopmentTime: r.mptDevelopmentTime ?? "",
          mptInterpretationTime: r.mptInterpretationTime ?? "",
          mptLightingEquipment: r.mptLightingEquipment ?? "",
          mptPostCleaning: r.mptPostCleaning ?? "",
          mptWhiteContrast: r.mptWhiteContrast ?? "",
          mptWetParticleIronInk: r.mptWetParticleIronInk ?? "",
          mptCustomColumns: r.mptCustomColumns ?? "[]",
          // UT fields
          utSubContract: r.utSubContract ?? "",
          utProject: r.utProject ?? "",
          utJobLocation: r.utJobLocation ?? "",
          utJobDescription: r.utJobDescription ?? "",
          utMaterial: r.utMaterial ?? "",
          utCouplant: r.utCouplant ?? "",
          utReferenceDocuments: r.utReferenceDocuments ?? "",
          utProcedureNo: r.utProcedureNo ?? "",
          utAcceptanceStandard: r.utAcceptanceStandard ?? "",
          utUfdDetails: r.utUfdDetails ?? "",
          utCalibrationBlock: r.utCalibrationBlock ?? "",
          utExtentOfExamination: r.utExtentOfExamination ?? "",
          utSurfaceCondition: r.utSurfaceCondition ?? "",
          utReferenceLevel: r.utReferenceLevel ?? "",
          utFlawSizingTechnique: r.utFlawSizingTechnique ?? "",
          utInspectionNote: r.utInspectionNote ?? "",
          utEquipmentRows: r.utEquipmentRows ?? "[]",
          utProbeRows: r.utProbeRows ?? "[]",
          utTestResultRows: r.utTestResultRows ?? "[]",
          utCustomColumns: r.utCustomColumns ?? "[]",
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
        // Parse custom columns from the report's JSON field (thickness reports)
        try {
          const cc = JSON.parse(r.customColumns ?? "[]");
          if (Array.isArray(cc)) setCustomColumns(cc);
        } catch { setCustomColumns([]); }
        // Parse DPT custom columns (DPT reports)
        try {
          const dcc = JSON.parse(r.dptCustomColumns ?? "[]");
          if (Array.isArray(dcc)) setDptCustomColumns(dcc);
        } catch { setDptCustomColumns([]); }
        // Parse MPT custom columns (MPT reports)
        try {
          const mcc = JSON.parse(r.mptCustomColumns ?? "[]");
          if (Array.isArray(mcc)) setMptCustomColumns(mcc);
        } catch { setMptCustomColumns([]); }
        // Load photos for this report — exclude PRIMARY-category photos
        // (those are shown in the Primary Inspection Photo section, not here)
        if (r.reportPhotos) {
          setPhotos(r.reportPhotos
            .filter((p: any) => p.category !== "PRIMARY")
            .map((p: any) => ({
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
        // Load DPT observations (only present for PIPELINE_DPT reports)
        if (Array.isArray(r.dptObservations)) {
          setDptObservations(r.dptObservations.map((o: any) => ({
            id: o.id,
            serialNo: o.serialNo,
            sortOrder: o.sortOrder,
            description: o.description ?? "",
            weldType: o.weldType ?? "",
            result: o.result === "Reject" ? "Reject" : "Accept",
            remarks: o.remarks ?? "",
            customColumnValues: o.customColumnValues ?? "{}",
          })));
        } else {
          setDptObservations([]);
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
      } else if (header.reportType === "PIPELINE_DPT") {
        // DPT custom columns are saved as JSON string
        payload.dptCustomColumns = header.dptCustomColumns;
        // Dye Penetrant Procedure fields are passed through verbatim —
        // they're all editable/typeable text fields.
      } else {
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
    } else if (header.reportType === "PIPELINE_DPT") {
      if (dptObservations.length === 0) {
        toast.warning("No DPT observations yet. You can proceed, but you'll need to add at least one before submitting.");
      }
    }
    // PIPELINE_CONDITION, PIPELINE_MPT, PIPELINE_WELD_SCAN have no row requirement.
    return true;
  }

  // Report types that include Engineering Drawings as part of Step 1.
  // DPT/MPT/Weld Scan do NOT have drawings.
  const INCLUDES_DRAWINGS: boolean =
    header.reportType === "PIPELINE_THICKNESS" ||
    header.reportType === "PIPELINE_VISUAL" ||
    header.reportType === "PIPELINE_CONDITION";

  async function proceedToNext() {
    if (step === 1) {
      if (!validateStep1()) {
        toast.error("Please fill in all required fields before proceeding.");
        return;
      }
      // ALWAYS save the header — for new reports, this creates the
      // report and sets editingPipelineReportId. For existing reports,
      // it updates the header.
      await saveHeader();
      // For Weld Scan, MPT, and UT now have their own Step 2 content.
      // No report type skips Step 2 anymore.
      setStep(2);
    } else if (step === 2) {
      validateStep2();
      // For PIPELINE_THICKNESS reports, persist the custom columns JSON
      // onto the header before saving. For PIPELINE_DPT, persist the DPT
      // custom columns. For PIPELINE_MPT, persist the MPT custom columns.
      if (header.reportType === "PIPELINE_THICKNESS") {
        setHeader((h) => ({ ...h, customColumns: JSON.stringify(customColumns) }));
      } else if (header.reportType === "PIPELINE_DPT") {
        setHeader((h) => ({ ...h, dptCustomColumns: JSON.stringify(dptCustomColumns) }));
      } else if (header.reportType === "PIPELINE_MPT") {
        setHeader((h) => ({ ...h, mptCustomColumns: JSON.stringify(mptCustomColumns) }));
      }
      await saveHeader();
      setStep(3);
    }
    // step === 3 is the final step (Findings & Photos) — no "next" beyond it.
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function goPrevious() {
    if (step > 1) {
      // Save current state before going back
      if (header.reportType === "PIPELINE_THICKNESS") {
        setHeader((h) => ({ ...h, customColumns: JSON.stringify(customColumns) }));
      } else if (header.reportType === "PIPELINE_DPT") {
        setHeader((h) => ({ ...h, dptCustomColumns: JSON.stringify(dptCustomColumns) }));
      } else if (header.reportType === "PIPELINE_MPT") {
        setHeader((h) => ({ ...h, mptCustomColumns: JSON.stringify(mptCustomColumns) }));
      }
      // All report types now go through Step 2, so the normal 3 → 2 → 1 flow applies.
      setStep((step - 1) as 1 | 2 | 3);
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

  // ─── DPT CUSTOM COLUMN MANAGEMENT ───
  // Same as the thickness custom column functions, but operates on the
  // dptCustomColumns array and the per-row DPT customColumnValues JSON.
  function addDptCustomColumn() {
    const name = window.prompt("Enter column name (e.g. 'Weld Length', 'Heat No'):");
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    if (dptCustomColumns.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
      toast.error(`A column named "${trimmed}" already exists.`);
      return;
    }
    const unit = window.prompt("Enter unit (e.g. 'mm', '°C', or leave blank):", "") || "";
    const newCol: CustomColumn = {
      id: `dptcol_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: trimmed,
      unit: unit.trim(),
    };
    setDptCustomColumns((cc) => [...cc, newCol]);
    toast.success(`Added column "${trimmed}"`);
  }

  function deleteDptCustomColumn(colId: string) {
    const col = dptCustomColumns.find((c) => c.id === colId);
    if (!col) return;
    if (!window.confirm(`Delete column "${col.name}"? Values in this column will be lost from all DPT rows.`)) return;
    setDptCustomColumns((cc) => cc.filter((c) => c.id !== colId));
    toast.success(`Deleted column "${col.name}"`);
  }

  function getDptCustomColumnValue(row: DptObservationRow, colId: string): string {
    if (!row.customColumnValues) return "";
    try {
      const vals = JSON.parse(row.customColumnValues);
      return vals[colId] ?? "";
    } catch { return ""; }
  }

  function setDptCustomColumnValue(idx: number, colId: string, value: string) {
    setDptObservations((rs) => {
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

  // ─── MPT CUSTOM COLUMN MANAGEMENT ───
  // Same pattern as DPT custom columns, but uses mptCustomColumns state
  // and stores values in the same customColumnValues JSON on each row.
  function addMptCustomColumn() {
    const name = window.prompt("Enter column name (e.g. 'Weld Length', 'Heat No'):");
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    if (mptCustomColumns.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
      toast.error(`A column named "${trimmed}" already exists.`);
      return;
    }
    const unit = window.prompt("Enter unit (e.g. 'mm', '°C', or leave blank):", "") || "";
    const newCol: CustomColumn = {
      id: `mptcol_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: trimmed,
      unit: unit.trim(),
    };
    setMptCustomColumns((cc) => [...cc, newCol]);
    toast.success(`Added column "${trimmed}"`);
  }

  function deleteMptCustomColumn(colId: string) {
    const col = mptCustomColumns.find((c) => c.id === colId);
    if (!col) return;
    if (!window.confirm(`Delete column "${col.name}"? Values in this column will be lost from all MPT rows.`)) return;
    setMptCustomColumns((cc) => cc.filter((c) => c.id !== colId));
    toast.success(`Deleted column "${col.name}"`);
  }

  function getMptCustomColumnValue(row: DptObservationRow, colId: string): string {
    if (!row.customColumnValues) return "";
    try {
      const vals = JSON.parse(row.customColumnValues);
      return vals[colId] ?? "";
    } catch { return ""; }
  }

  function setMptCustomColumnValue(idx: number, colId: string, value: string) {
    setDptObservations((rs) => {
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
        // IMPORTANT: include the Authorization header from localStorage.
        // The apiFetch helper does this automatically, but raw fetch() does
        // not. On the preview URL (cross-origin), the session cookie may
        // not be sent by the browser — so without this header, the API
        // returns 401 and the upload fails with "Failed to upload".
        const token = typeof window !== "undefined" ? window.localStorage.getItem("ira_session_token") : null;
        const res = await fetch(`/api/pipeline-inspections/${editingPipelineReportId}/photos`, {
          method: "POST",
          body: fd,
          credentials: "include",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
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

  // ─── DPT OBSERVATION ROW OPERATIONS (PIPELINE_DPT only) ───
  function addDptObservation() {
    setDptObservations((arr) => {
      const nextSerial = arr.length > 0 ? Math.max(...arr.map(o => o.serialNo)) + 1 : 1;
      return [
        ...arr,
        {
          serialNo: nextSerial,
          sortOrder: arr.length,
          description: "",
          weldType: "",
          result: "Accept",
          remarks: "",
          customColumnValues: "{}",
          _isNew: true,
        },
      ];
    });
  }

  function updateDptObservation(idx: number, patch: Partial<DptObservationRow>) {
    setDptObservations((arr) => {
      const next = [...arr];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }

  function deleteDptObservationLocal(idx: number) {
    setDptObservations((arr) =>
      arr.filter((_, i) => i !== idx).map((o, i) => ({ ...o, serialNo: i + 1, sortOrder: i })),
    );
  }

  async function saveDptObservation(idx: number) {
    const obs = dptObservations[idx];
    if (!obs) return;
    if (!editingPipelineReportId) { toast.error("Save the report header first"); return; }
    setSaving(true);
    try {
      if (obs._isNew || !obs.id) {
        const created = await apiFetch<{ id: string; serialNo: number }>(
          `/api/pipeline-inspections/${editingPipelineReportId}/dpt-observations`,
          { method: "POST", body: JSON.stringify(obs) },
        );
        setDptObservations((arr) => arr.map((o, i) => i === idx ? { ...o, id: created.id, serialNo: created.serialNo, _isNew: false } : o));
        toast.success(`Saved DPT row #${created.serialNo}`);
      } else {
        await apiFetch(
          `/api/pipeline-inspections/${editingPipelineReportId}/dpt-observations/${obs.id}`,
          { method: "PUT", body: JSON.stringify(obs) },
        );
        toast.success(`Updated DPT row #${obs.serialNo}`);
      }
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function deleteDptObservationApi(idx: number) {
    const obs = dptObservations[idx];
    if (!obs) return;
    if (!obs.id || obs._isNew) { deleteDptObservationLocal(idx); return; }
    if (!editingPipelineReportId) return;
    try {
      await apiFetch(
        `/api/pipeline-inspections/${editingPipelineReportId}/dpt-observations/${obs.id}`,
        { method: "DELETE" },
      );
      deleteDptObservationLocal(idx);
      toast.success(`Deleted DPT row #${obs.serialNo}`);
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message ?? "Delete failed");
    }
  }

  // ─── SAVE DRAFT (saves header + custom columns without navigating) ───
  async function saveDraft() {
    if (header.reportType === "PIPELINE_THICKNESS") {
      setHeader((h) => ({ ...h, customColumns: JSON.stringify(customColumns) }));
    } else if (header.reportType === "PIPELINE_DPT") {
      setHeader((h) => ({ ...h, dptCustomColumns: JSON.stringify(dptCustomColumns) }));
    } else if (header.reportType === "PIPELINE_MPT") {
      setHeader((h) => ({ ...h, mptCustomColumns: JSON.stringify(mptCustomColumns) }));
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

      {/* ─── Step indicator ───
          3 steps: Report Details → Inspection Findings → Findings & Photos
          (Engineering Drawings are part of Step 1 for report types that use them)
      */}
      <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3 flex-wrap">
        {[
          { num: 1, label: "Report Details" },
          { num: 2, label: "Inspection Findings" },
          { num: 3, label: "Findings & Photos" },
        ].map((s) => {
          const isActive = step === s.num;
          const isDone = step > s.num;
          return (
            <div key={s.num} className="flex items-center gap-2">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                  isActive ? "bg-amber-600 text-white" : isDone ? "bg-emerald-600 text-white" : "bg-zinc-200 text-zinc-500"
                }`}
              >
                {isDone ? "✓" : s.num}
              </div>
              <span className={`text-sm font-medium ${isActive ? "text-amber-700" : "text-muted-foreground"}`}>
                {s.label}
              </span>
              {s.num < 3 && <span className="text-zinc-300">→</span>}
            </div>
          );
        })}
        <span className="ml-auto text-xs text-muted-foreground">
          Step {step} of 3 — {step === 1 ? "Report Details" : step === 2 ? "Inspection Findings" : "Findings & Photos"}
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
            <Label>From Date</Label>
            <Input
              type="date"
              value={header.fromDate}
              onChange={(e) => updateHeader("fromDate", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>To Date</Label>
            <Input
              type="date"
              value={header.toDate}
              onChange={(e) => {
                updateHeader("toDate", e.target.value);
                if (header.fromDate && e.target.value < header.fromDate) {
                  toast.error("To Date cannot be earlier than From Date");
                }
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* DPT procedure / consumable details have been moved to Step 3
          (Inspection Findings) — they belong with the inspection data,
          not with the report header. */}

      {/* ─── Primary Inspection Photo ───
          Uses the PrimaryPhotoUploader component which ALWAYS shows the
          upload area (drag-and-drop + click). There is no large warning
          box blocking the upload section.
          
          If the report header hasn't been saved yet when the user picks
          a file, the upload handler auto-saves the header in the
          background and then uploads the photo automatically — so the
          user can fill in the header fields and upload the photo in one
          smooth action.
          
          After a successful upload, the component transitions to the
          preview state showing the image + Replace / Remove buttons.
      */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Camera className="h-4 w-4" />
            Primary Inspection Photo
          </CardTitle>
          <CardDescription>
            Upload one main photo of the pipeline, vessel, or equipment being inspected.
            This photo appears on the first page of the generated PDF, immediately after the Client Details section,
            filling the available space between the client details and the sign-off block.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PrimaryPhotoUploader
            reportId={editingPipelineReportId}
            primaryPhotoPath={header.primaryPhotoPath}
            onPhotoChange={(path) => setHeader((h) => ({ ...h, primaryPhotoPath: path }))}
            onSaveHeader={saveHeader}
            savingHeader={saving}
            headerValid={
              !!header.reportNumber.trim() && !!header.clientId && !!header.plantId
            }
          />
        </CardContent>
      </Card>

      </>
      )} {/* end step 1 — header + primary photo */}

      {/* ═══ ENGINEERING DRAWINGS (part of Step 1 for report types that use them) ═══
          Shown on Step 1 for Thickness / Visual / Condition reports.
          DPT / MPT / Weld Scan do NOT have engineering drawings.
          Each uploaded drawing becomes one or more full pages in the final PDF
          (images = 1 page each, PDFs are rasterized page-by-page), appearing
          between the report header and the measurement table.
      */}
      {step === 1 && INCLUDES_DRAWINGS && (
      <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <PenTool className="h-4 w-4" />
                Engineering Drawings
              </CardTitle>
              <CardDescription>
                Optional. Attach engineering drawings (PNG, JPG, JPEG, WEBP, or PDF).
                Each image becomes one full page in the final PDF; each page of an
                uploaded PDF drawing is rendered as a separate output page.
                Drawings appear after the report header and before the measurement
                table. Max 50 MB per file.
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
              Save the report header first (Step 1) to enable drawing uploads.
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

      <Card className="bg-zinc-50">
        <CardContent className="p-4 text-xs text-muted-foreground">
          <strong>PDF page order:</strong> Report header → Engineering Drawings (one page
          per image / per PDF page) → Measurement table → Findings → Photos → Sign-off.
          No blank pages are inserted between the drawings and the table.
        </CardContent>
      </Card>

      </>
      )} {/* end engineering drawings (part of step 1) */}

      {/* Step 1 navigation (after header + photo + drawings) */}
      {step === 1 && (
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
      )}

      {/* ═══ STEP 2: INSPECTION FINDINGS — type-specific ═══
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

      {/* ═══ STEP 2 (DPT): DPT PROCEDURE + OBSERVATION TABLE ═══ */}
      {step === 2 && header.reportType === "PIPELINE_DPT" && (
      <>
      {/* ═══ 3. DYE PENETRANT PROCEDURE ═══
          Two-column table: left = field name, right = editable value.
          All fields are typeable/editable unless explicitly noted.
          The Date of Examination is an editable date field.
      */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Droplet className="h-4 w-4 text-purple-700" />
            3. Dye Penetrant Procedure
          </CardTitle>
          <CardDescription>
            Record the complete dye penetrant inspection procedure. All fields
            are editable — type the value as it applies to this inspection.
            Leave a field blank if it is not applicable.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <tbody>
                {/* Each row: field name (left) + editable value (right) */}
                {/* Date of Examination — editable date field */}
                <tr className="border-b border-zinc-200">
                  <td className="bg-purple-50 border-r border-zinc-200 px-3 py-2 font-medium text-zinc-700 w-1/3">
                    Date of Examination
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      type="date"
                      className="h-8 text-sm"
                      value={header.dptDateOfExamination}
                      onChange={(e) => updateHeader("dptDateOfExamination", e.target.value)}
                    />
                  </td>
                </tr>
                {/* Typeable text fields */}
                {([
                  ["Testing Standard", "dptTestingStandard", "e.g. ASME Section V Article 6 / ASTM E165"],
                  ["Acceptance Criteria", "dptAcceptanceCriteria", "e.g. ASME Section VIII Div 1 Appendix 8"],
                  ["Surface Preparation", "dptSurfacePreparation", "e.g. Cleaned with solvent, wire brushed"],
                  ["Surface Temperature", "dptSurfaceTemperature", "e.g. 28 °C"],
                  ["Penetrant Type", "dptPenetrantType", "e.g. Colour contrast / Fluorescent"],
                  ["Penetrant Process", "dptPenetrantProcess", "e.g. Solvent removable / Water washable"],
                  ["Method of Pre-cleaning", "dptMethodOfPreCleaning", "e.g. Solvent wiping"],
                  ["Drying Time After Pre-cleaning", "dptDryingTimeAfterPreCleaning", "e.g. 5 minutes"],
                  ["Method of Applying Penetrant", "dptMethodOfApplyingPenetrant", "e.g. Spray / Brush"],
                  ["Penetrating Time", "dptPenetratingTime", "e.g. 10 minutes"],
                  ["Method of Removing Excess Penetrant", "dptMethodOfRemovingExcessPenetrant", "e.g. Solvent wipe"],
                  ["Method of Applying Developer", "dptMethodOfApplyingDeveloper", "e.g. Spray"],
                  ["Development Time", "dptDevelopmentTime", "e.g. 7 minutes"],
                  ["Interpretation Time", "dptInterpretationTime", "e.g. 10 minutes"],
                  ["Lighting Equipment", "dptLightingEquipment", "e.g. LED torch ≥ 1000 lux"],
                  ["Post Cleaning", "dptPostCleaning", "e.g. Solvent wipe / Water wash"],
                ] as const).map(([label, fieldKey, placeholder]) => (
                  <tr key={fieldKey} className="border-b border-zinc-200">
                    <td className="bg-purple-50 border-r border-zinc-200 px-3 py-2 font-medium text-zinc-700">
                      {label}
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        className="h-8 text-sm"
                        value={header[fieldKey]}
                        onChange={(e) => updateHeader(fieldKey, e.target.value)}
                        placeholder={placeholder}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ═══ Consumable Details ═══
          Three fields: Solvent, Penetrant, Developer.
          Each is a dropdown with preset options PLUS an "Other / Custom"
          option that reveals a free-text input for entering a custom
          product / make / material.
      */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Droplet className="h-4 w-4 text-purple-700" />
            Consumable Details
          </CardTitle>
          <CardDescription>
            Select the product / make used for each consumable. If the
            required option is not listed, choose <strong>Other / Custom</strong>
            and type the actual product used.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <tbody>
                {/* Solvent — dropdown + custom input */}
                <tr className="border-b border-zinc-200">
                  <td className="bg-purple-50 border-r border-zinc-200 px-3 py-2 font-medium text-zinc-700 w-1/3">
                    Solvent
                  </td>
                  <td className="px-2 py-1.5">
                    <ConsumableSelector
                      value={header.dptSolventCleaner}
                      onChange={(v) => updateHeader("dptSolventCleaner", v)}
                      options={[
                        { value: "ORION 115PR", label: "ORION 115PR" },
                      ]}
                      placeholder="Select solvent / cleaner"
                      customPrompt="Enter the actual solvent / cleaner used (product / make / model)"
                    />
                  </td>
                </tr>
                {/* Penetrant — dropdown + custom input */}
                <tr className="border-b border-zinc-200">
                  <td className="bg-purple-50 border-r border-zinc-200 px-3 py-2 font-medium text-zinc-700">
                    Penetrant
                  </td>
                  <td className="px-2 py-1.5">
                    <ConsumableSelector
                      value={header.dptPenetrant}
                      onChange={(v) => updateHeader("dptPenetrant", v)}
                      options={[
                        { value: "ORION 115P", label: "ORION 115P" },
                      ]}
                      placeholder="Select penetrant"
                      customPrompt="Enter the actual penetrant used (product / make / model)"
                    />
                  </td>
                </tr>
                {/* Developer — dropdown + custom input */}
                <tr className="border-b border-zinc-200">
                  <td className="bg-purple-50 border-r border-zinc-200 px-3 py-2 font-medium text-zinc-700">
                    Developer
                  </td>
                  <td className="px-2 py-1.5">
                    <ConsumableSelector
                      value={header.dptDeveloper}
                      onChange={(v) => updateHeader("dptDeveloper", v)}
                      options={[
                        { value: "ORION 115D", label: "ORION 115D" },
                      ]}
                      placeholder="Select developer"
                      customPrompt="Enter the actual developer used (product / make / model)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ═══ DPT Inspection Results Table ═══
          Supports add/delete rows, add/delete custom columns, and
          automatic serial numbers (1, 2, 3…). Serial numbers are
          renumbered whenever rows are added or deleted.
      */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">DPT Inspection Results</CardTitle>
              <CardDescription>
                Add one row per inspection point. Serial numbers are auto-generated
                and renumbered whenever rows are added or deleted. Select Accept or
                Reject for each row. Use custom columns for any additional data you
                need to record per inspection point.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button onClick={addDptObservation} size="sm">
                <Plus className="mr-1 h-4 w-4" /> Add Row
              </Button>
              <Button onClick={addDptCustomColumn} size="sm" variant="outline">
                <Columns3 className="mr-1 h-4 w-4" /> Add Column
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-purple-800 text-white">
                <tr>
                  <th className="border border-purple-900 px-2 py-2 text-center" style={{ minWidth: 40 }}>Sl. No</th>
                  <th className="border border-purple-900 px-2 py-2 text-center" style={{ minWidth: 200 }}>Description</th>
                  <th className="border border-purple-900 px-2 py-2 text-center" style={{ minWidth: 100 }}>Weld Type</th>
                  <th className="border border-purple-900 px-2 py-2 text-center" style={{ minWidth: 80 }}>Result</th>
                  {dptCustomColumns.map((cc) => (
                    <th key={cc.id} className="border border-purple-900 px-2 py-2 text-center" style={{ minWidth: 90 }}>
                      <div className="flex items-center justify-center gap-1">
                        <span>{cc.name}</span>
                        {cc.unit && <span className="text-[9px] opacity-70">({cc.unit})</span>}
                        <button
                          onClick={() => deleteDptCustomColumn(cc.id)}
                          className="ml-1 text-purple-300 hover:text-purple-100"
                          title={`Delete column "${cc.name}"`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </th>
                  ))}
                  <th className="border border-purple-900 px-2 py-2 text-center" style={{ minWidth: 200 }}>Remarks</th>
                  <th className="border border-purple-900 px-2 py-2 text-center" style={{ minWidth: 80 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {dptObservations.length === 0 && (
                  <tr>
                    <td colSpan={6 + dptCustomColumns.length} className="text-center py-6 text-muted-foreground border border-zinc-300">
                      No DPT observations yet. Click <strong>Add Row</strong> to begin.
                    </td>
                  </tr>
                )}
                {dptObservations.map((obs, idx) => (
                  <tr key={idx} className="hover:bg-muted/30">
                    <td className="border border-zinc-300 p-1 text-center font-mono tabular-nums">{obs.serialNo}</td>
                    <td className="border border-zinc-300 p-1">
                      <Input
                        className="h-8 text-xs"
                        value={obs.description}
                        onChange={(e) => updateDptObservation(idx, { description: e.target.value })}
                        placeholder="Description of inspected area"
                      />
                    </td>
                    <td className="border border-zinc-300 p-1">
                      <Input
                        className="h-8 text-xs"
                        value={obs.weldType}
                        onChange={(e) => updateDptObservation(idx, { weldType: e.target.value })}
                        placeholder="e.g. Butt Weld"
                      />
                    </td>
                    <td className="border border-zinc-300 p-1">
                      <Select
                        value={obs.result}
                        onValueChange={(v) => updateDptObservation(idx, { result: v as "Accept" | "Reject" })}
                      >
                        <SelectTrigger className={`h-8 text-xs font-bold ${obs.result === "Reject" ? "text-red-700" : "text-emerald-700"}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Accept" className="text-emerald-700">Accept</SelectItem>
                          <SelectItem value="Reject" className="text-red-700">Reject</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    {/* Custom columns */}
                    {dptCustomColumns.map((cc) => (
                      <td key={cc.id} className="border border-zinc-300 p-1 text-center">
                        <Input
                          type="text"
                          className="h-8 text-xs text-center"
                          value={getDptCustomColumnValue(obs, cc.id)}
                          onChange={(e) => setDptCustomColumnValue(idx, cc.id, e.target.value)}
                          placeholder={cc.unit || "—"}
                        />
                      </td>
                    ))}
                    <td className="border border-zinc-300 p-1">
                      <Textarea
                        rows={1}
                        className="text-xs min-h-[32px] py-1"
                        value={obs.remarks}
                        onChange={(e) => updateDptObservation(idx, { remarks: e.target.value })}
                        placeholder="Observations, details..."
                      />
                    </td>
                    <td className="border border-zinc-300 p-1">
                      <div className="flex flex-col gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[10px]"
                          onClick={() => saveDptObservation(idx)}
                          disabled={saving}
                          title="Save row"
                        >
                          <Save className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 text-red-600 hover:text-red-700"
                          onClick={() => deleteDptObservationApi(idx)}
                          title="Delete row"
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
          <div><strong>DPT Inspection:</strong> each row records one inspection point with Accept / Reject result.</div>
          <div><strong>Serial numbers:</strong> auto-generated (1, 2, 3…) and renumbered when rows are added or deleted.</div>
          <div><strong>Custom columns:</strong> click <strong>Add Column</strong> to add a new column. System columns (Sl. No, Description, Weld Type, Result, Remarks) cannot be deleted.</div>
          <div><strong>No drawings:</strong> DPT reports do not include engineering drawing uploads.</div>
          <div><strong>Results:</strong> only Accept / Reject is selectable per row. All other fields are typeable text.</div>
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
      )} {/* end step 2 — DPT */}

      {/* ═══ STEP 2 (MPT): MAGNETIC PARTICLE TESTING PROCEDURE ═══ */}
      {step === 2 && header.reportType === "PIPELINE_MPT" && (
      <>
      {/* 5. MAGNETIC PARTICLE TESTING — Parameters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Magnet className="h-4 w-4 text-orange-700" />
            5.1 Magnetic Particle Testing Parameters
          </CardTitle>
          <CardDescription>
            Record the MPT inspection parameters. All fields are editable.
            Date fields use a calendar picker.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <tbody>
                {/* Date of Examination — calendar picker */}
                <tr className="border-b border-zinc-200">
                  <td className="bg-orange-50 border-r border-zinc-200 px-3 py-2 font-medium text-zinc-700 w-1/3">
                    Date of Examination
                  </td>
                  <td className="px-2 py-1.5">
                    <Input type="date" className="h-8 text-sm"
                      value={header.mptDateOfExamination}
                      onChange={(e) => updateHeader("mptDateOfExamination", e.target.value)}
                    />
                  </td>
                </tr>
                {/* Typeable text fields */}
                {([
                  ["Testing Standard", "mptTestingStandard", "e.g. ASME Section V Article 7"],
                  ["Acceptance Criteria", "mptAcceptanceCriteria", "e.g. ASME Section VIII Div 1 Appendix 6"],
                  ["Surface preparation", "mptSurfacePreparation", "e.g. Cleaned with solvent, wire brushed"],
                  ["Surface temperature", "mptSurfaceTemperature", "e.g. 28 °C"],
                  ["Type of Instrument / SI.No", "mptInstrumentSerialNo", "e.g. SIMS / MPT – AC Yoke / 201501012123"],
                ] as const).map(([label, fieldKey, placeholder]) => (
                  <tr key={fieldKey} className="border-b border-zinc-200">
                    <td className="bg-orange-50 border-r border-zinc-200 px-3 py-2 font-medium text-zinc-700">
                      {label}
                    </td>
                    <td className="px-2 py-1.5">
                      <Input className="h-8 text-sm"
                        value={header[fieldKey]}
                        onChange={(e) => updateHeader(fieldKey, e.target.value)}
                        placeholder={placeholder}
                      />
                    </td>
                  </tr>
                ))}
                {/* Instrument / Calibration Date — calendar picker */}
                <tr className="border-b border-zinc-200">
                  <td className="bg-orange-50 border-r border-zinc-200 px-3 py-2 font-medium text-zinc-700">
                    Instrument / Calibration Date
                  </td>
                  <td className="px-2 py-1.5">
                    <Input type="date" className="h-8 text-sm"
                      value={header.mptCalibrationDate}
                      onChange={(e) => updateHeader("mptCalibrationDate", e.target.value)}
                    />
                  </td>
                </tr>
                {/* More typeable text fields */}
                {([
                  ["MPT Method", "mptMethod", "e.g. Wet Continuous"],
                  ["Type of Current", "mptTypeOfCurrent", "e.g. AC"],
                  ["AC Yoke Lifting Capacity", "mptAcYokeLiftingCapacity", "e.g. 5 kg / 50 N"],
                  ["Contrast Medium", "mptContrastMedium", "e.g. White contrast"],
                  ["Method of Pre cleaning", "mptMethodOfPreCleaning", "e.g. Solvent wiping"],
                  ["Method of applying White Contrast", "mptMethodOfApplyingWhiteContrast", "e.g. Spray"],
                  ["AC Yoke Pole Spacing", "mptAcYokePoleSpacing", "e.g. 150 mm"],
                  ["Magnetic Medium", "mptMagneticMedium", "e.g. Wet particle iron ink"],
                  ["Method of applying Magnetic Medium", "mptMethodOfApplyingMagneticMedium", "e.g. Spray"],
                  ["Development time", "mptDevelopmentTime", "e.g. 5 minutes"],
                  ["Interpretation time", "mptInterpretationTime", "e.g. 10 minutes"],
                  ["Lightning Equipment", "mptLightingEquipment", "e.g. LED torch ≥ 1000 lux"],
                  ["Post cleaning", "mptPostCleaning", "e.g. Solvent wipe"],
                ] as const).map(([label, fieldKey, placeholder]) => (
                  <tr key={fieldKey} className="border-b border-zinc-200">
                    <td className="bg-orange-50 border-r border-zinc-200 px-3 py-2 font-medium text-zinc-700">
                      {label}
                    </td>
                    <td className="px-2 py-1.5">
                      <Input className="h-8 text-sm"
                        value={header[fieldKey]}
                        onChange={(e) => updateHeader(fieldKey, e.target.value)}
                        placeholder={placeholder}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Consumable Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Magnet className="h-4 w-4 text-orange-700" />
            Consumable Details
          </CardTitle>
          <CardDescription>
            Enter the actual make, product name, lot number, expiry date and
            other relevant details. All fields are editable.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <tbody>
                {([
                  ["White Contrast", "mptWhiteContrast", "e.g. Make – ORION WCM-1"],
                  ["Wet Particle Iron Ink", "mptWetParticleIronInk", "e.g. Make – ORION MPI-14"],
                ] as const).map(([label, fieldKey, placeholder]) => (
                  <tr key={fieldKey} className="border-b border-zinc-200">
                    <td className="bg-orange-50 border-r border-zinc-200 px-3 py-2 font-medium text-zinc-700 w-1/3">
                      {label}
                    </td>
                    <td className="px-2 py-1.5">
                      <Input className="h-8 text-sm"
                        value={header[fieldKey]}
                        onChange={(e) => updateHeader(fieldKey, e.target.value)}
                        placeholder={placeholder}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* MPT Observation Table — reuses the DPT observation infrastructure */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">MPT Inspection Results</CardTitle>
              <CardDescription>
                Add one row per inspection point. Serial numbers are auto-generated.
                Select Accept or Reject for each row.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button onClick={addDptObservation} size="sm">
                <Plus className="mr-1 h-4 w-4" /> Add Row
              </Button>
              <Button onClick={addMptCustomColumn} size="sm" variant="outline">
                <Columns3 className="mr-1 h-4 w-4" /> Add Column
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-orange-700 text-white">
                <tr>
                  <th className="border border-orange-800 px-2 py-2 text-center" style={{ minWidth: 40 }}>Sl. No</th>
                  <th className="border border-orange-800 px-2 py-2 text-center" style={{ minWidth: 200 }}>Description</th>
                  <th className="border border-orange-800 px-2 py-2 text-center" style={{ minWidth: 100 }}>Weld Type</th>
                  <th className="border border-orange-800 px-2 py-2 text-center" style={{ minWidth: 80 }}>Result</th>
                  {mptCustomColumns.map((cc) => (
                    <th key={cc.id} className="border border-orange-800 px-2 py-2 text-center" style={{ minWidth: 90 }}>
                      <div className="flex items-center justify-center gap-1">
                        <span>{cc.name}</span>
                        {cc.unit && <span className="text-[9px] opacity-70">({cc.unit})</span>}
                        <button onClick={() => deleteMptCustomColumn(cc.id)} className="ml-1 text-orange-300 hover:text-orange-100" title={`Delete "${cc.name}"`}>
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </th>
                  ))}
                  <th className="border border-orange-800 px-2 py-2 text-center" style={{ minWidth: 200 }}>Remarks</th>
                  <th className="border border-orange-800 px-2 py-2 text-center" style={{ minWidth: 80 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {dptObservations.length === 0 && (
                  <tr>
                    <td colSpan={6 + mptCustomColumns.length} className="text-center py-6 text-muted-foreground border border-zinc-300">
                      No MPT observations yet. Click <strong>Add Row</strong> to begin.
                    </td>
                  </tr>
                )}
                {dptObservations.map((obs, idx) => (
                  <tr key={idx} className="hover:bg-muted/30">
                    <td className="border border-zinc-300 p-1 text-center font-mono tabular-nums">{obs.serialNo}</td>
                    <td className="border border-zinc-300 p-1">
                      <Input className="h-8 text-xs" value={obs.description}
                        onChange={(e) => updateDptObservation(idx, { description: e.target.value })}
                        placeholder="Description of inspected area"
                      />
                    </td>
                    <td className="border border-zinc-300 p-1">
                      <Input className="h-8 text-xs" value={obs.weldType}
                        onChange={(e) => updateDptObservation(idx, { weldType: e.target.value })}
                        placeholder="e.g. Butt Weld"
                      />
                    </td>
                    <td className="border border-zinc-300 p-1">
                      <Select value={obs.result}
                        onValueChange={(v) => updateDptObservation(idx, { result: v as "Accept" | "Reject" })}
                      >
                        <SelectTrigger className={`h-8 text-xs font-bold ${obs.result === "Reject" ? "text-red-700" : "text-emerald-700"}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Accept" className="text-emerald-700">Accept</SelectItem>
                          <SelectItem value="Reject" className="text-red-700">Reject</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    {mptCustomColumns.map((cc) => (
                      <td key={cc.id} className="border border-zinc-300 p-1 text-center">
                        <Input type="text" className="h-8 text-xs text-center"
                          value={getMptCustomColumnValue(obs, cc.id)}
                          onChange={(e) => setMptCustomColumnValue(idx, cc.id, e.target.value)}
                          placeholder={cc.unit || "—"}
                        />
                      </td>
                    ))}
                    <td className="border border-zinc-300 p-1">
                      <Textarea rows={1} className="text-xs min-h-[32px] py-1"
                        value={obs.remarks}
                        onChange={(e) => updateDptObservation(idx, { remarks: e.target.value })}
                        placeholder="Observations, details..."
                      />
                    </td>
                    <td className="border border-zinc-300 p-1">
                      <div className="flex flex-col gap-1">
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]"
                          onClick={() => saveDptObservation(idx)} disabled={saving} title="Save row"
                        >
                          <Save className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="ghost"
                          className="h-6 w-6 p-0 text-red-600 hover:text-red-700"
                          onClick={() => deleteDptObservationApi(idx)} title="Delete row"
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
      )}

      {/* ═══ STEP 2 (UT): ULTRASONIC TEST REPORT ═══ */}
      {step === 2 && header.reportType === "PIPELINE_UT" && (
      <>
      {/* Report Identification Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Waves className="h-4 w-4 text-blue-700" />
            Report Identification Details
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <tbody>
                {([
                  ["Client", "clientId", "select"],
                  ["Test Report No.", "reportNumber", "text"],
                  ["Sub Contract", "utSubContract", "text"],
                  ["Test Date", "fromDate", "date"],
                  ["Project", "utProject", "text"],
                  ["Job Location", "utJobLocation", "text"],
                  ["Material", "utMaterial", "text"],
                  ["Job Description", "utJobDescription", "text"],
                  ["Couplant", "utCouplant", "text"],
                  ["Reference Documents", "utReferenceDocuments", "text"],
                  ["UT Procedure No.", "utProcedureNo", "text"],
                  ["Acceptance Standard", "utAcceptanceStandard", "text"],
                ] as const).map(([label, fieldKey, inputType]) => (
                  <tr key={fieldKey} className="border-b border-zinc-200">
                    <td className="bg-blue-50 border-r border-zinc-200 px-3 py-2 font-medium text-zinc-700 w-1/3">
                      {label}
                    </td>
                    <td className="px-2 py-1.5">
                      {fieldKey === "clientId" ? (
                        <Select value={header.clientId} onValueChange={onClientChange}>
                          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select client" /></SelectTrigger>
                          <SelectContent>
                            {clients.map((c) => (
                              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : inputType === "date" ? (
                        <Input type="date" className="h-8 text-sm"
                          value={header[fieldKey as keyof ReportHeader] as string}
                          onChange={(e) => updateHeader(fieldKey as keyof ReportHeader, e.target.value)}
                        />
                      ) : (
                        <Input className="h-8 text-sm"
                          value={header[fieldKey as keyof ReportHeader] as string}
                          onChange={(e) => updateHeader(fieldKey as keyof ReportHeader, e.target.value)}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* UFD Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">UFD Details</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea rows={3} className="text-sm"
            value={header.utUfdDetails}
            onChange={(e) => updateHeader("utUfdDetails", e.target.value)}
            placeholder="Enter UFD details..."
          />
        </CardContent>
      </Card>

      {/* Equipment Details */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Equipment Details</CardTitle>
              <CardDescription>UFD equipment used for the inspection.</CardDescription>
            </div>
            <Button onClick={() => {
              const rows = JSON.parse(header.utEquipmentRows || "[]");
              rows.push({ equipmentType: "", machineMake: "", model: "", mcSrNo: "", calibrationDueDate: "" });
              setHeader((h) => ({ ...h, utEquipmentRows: JSON.stringify(rows) }));
            }} size="sm">
              <Plus className="mr-1 h-4 w-4" /> Add Row
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-blue-700 text-white">
                <tr>
                  <th className="border border-blue-800 px-2 py-2 text-center">Equipment Type</th>
                  <th className="border border-blue-800 px-2 py-2 text-center">Machine Make</th>
                  <th className="border border-blue-800 px-2 py-2 text-center">Model</th>
                  <th className="border border-blue-800 px-2 py-2 text-center">M/c Sr. No.</th>
                  <th className="border border-blue-800 px-2 py-2 text-center">Calibration Due Date</th>
                  <th className="border border-blue-800 px-2 py-2 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  try {
                    const rows = JSON.parse(header.utEquipmentRows || "[]");
                    if (rows.length === 0) return (
                      <tr><td colSpan={6} className="text-center py-4 text-muted-foreground border border-zinc-300">No equipment rows. Click Add Row.</td></tr>
                    );
                    return rows.map((row: any, idx: number) => (
                      <tr key={idx} className="hover:bg-muted/30">
                        {(["equipmentType", "machineMake", "model", "mcSrNo"] as const).map((field) => (
                          <td key={field} className="border border-zinc-300 p-1">
                            <Input className="h-8 text-xs" value={row[field] ?? ""}
                              onChange={(e) => {
                                const next = [...rows]; next[idx] = { ...row, [field]: e.target.value };
                                setHeader((h) => ({ ...h, utEquipmentRows: JSON.stringify(next) }));
                              }}
                            />
                          </td>
                        ))}
                        <td className="border border-zinc-300 p-1">
                          <Input type="date" className="h-8 text-xs" value={row.calibrationDueDate ?? ""}
                            onChange={(e) => {
                              const next = [...rows]; next[idx] = { ...row, calibrationDueDate: e.target.value };
                              setHeader((h) => ({ ...h, utEquipmentRows: JSON.stringify(next) }));
                            }}
                          />
                        </td>
                        <td className="border border-zinc-300 p-1 text-center">
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-600"
                            onClick={() => {
                              const next = rows.filter((_: any, i: number) => i !== idx);
                              setHeader((h) => ({ ...h, utEquipmentRows: JSON.stringify(next) }));
                            }}
                          ><Trash2 className="h-3 w-3" /></Button>
                        </td>
                      </tr>
                    ));
                  } catch { return null; }
                })()}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Test Probe Details */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Test Probe Details</CardTitle>
            </div>
            <Button onClick={() => {
              const rows = JSON.parse(header.utProbeRows || "[]");
              rows.push({ probeType: "", probeAngle: "", frequency: "", size: "", probeNo: "", range: "", referenceDb: "", scanningDb: "" });
              setHeader((h) => ({ ...h, utProbeRows: JSON.stringify(rows) }));
            }} size="sm">
              <Plus className="mr-1 h-4 w-4" /> Add Row
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-blue-700 text-white">
                <tr>
                  <th className="border border-blue-800 px-2 py-2 text-center">Probe Type</th>
                  <th className="border border-blue-800 px-2 py-2 text-center">Probe Angle</th>
                  <th className="border border-blue-800 px-2 py-2 text-center">Frequency</th>
                  <th className="border border-blue-800 px-2 py-2 text-center">Size</th>
                  <th className="border border-blue-800 px-2 py-2 text-center">Probe No.</th>
                  <th className="border border-blue-800 px-2 py-2 text-center">Range</th>
                  <th className="border border-blue-800 px-2 py-2 text-center">Reference dB</th>
                  <th className="border border-blue-800 px-2 py-2 text-center">Scanning dB</th>
                  <th className="border border-blue-800 px-2 py-2 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  try {
                    const rows = JSON.parse(header.utProbeRows || "[]");
                    if (rows.length === 0) return (
                      <tr><td colSpan={9} className="text-center py-4 text-muted-foreground border border-zinc-300">No probe rows. Click Add Row.</td></tr>
                    );
                    return rows.map((row: any, idx: number) => (
                      <tr key={idx} className="hover:bg-muted/30">
                        {(["probeType", "probeAngle", "frequency", "size", "probeNo", "range", "referenceDb", "scanningDb"] as const).map((field) => (
                          <td key={field} className="border border-zinc-300 p-1">
                            <Input className="h-8 text-xs" value={row[field] ?? ""}
                              onChange={(e) => {
                                const next = [...rows]; next[idx] = { ...row, [field]: e.target.value };
                                setHeader((h) => ({ ...h, utProbeRows: JSON.stringify(next) }));
                              }}
                            />
                          </td>
                        ))}
                        <td className="border border-zinc-300 p-1 text-center">
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-600"
                            onClick={() => {
                              const next = rows.filter((_: any, i: number) => i !== idx);
                              setHeader((h) => ({ ...h, utProbeRows: JSON.stringify(next) }));
                            }}
                          ><Trash2 className="h-3 w-3" /></Button>
                        </td>
                      </tr>
                    ));
                  } catch { return null; }
                })()}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Scanning Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scanning Details</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <tbody>
                {([
                  ["Calibration Block (DAC Block)", "utCalibrationBlock", "Reference Level", "utReferenceLevel"],
                  ["Extent of Examination", "utExtentOfExamination", "Flaw Sizing Technique", "utFlawSizingTechnique"],
                  ["Surface Condition", "utSurfaceCondition", "", ""],
                ] as const).map(([label1, field1, label2, field2]) => (
                  <tr key={label1} className="border-b border-zinc-200">
                    <td className="bg-blue-50 border-r border-zinc-200 px-3 py-2 font-medium text-zinc-700 w-1/4">{label1}</td>
                    <td className="px-2 py-1.5 border-r border-zinc-200">
                      <Input className="h-8 text-sm" value={header[field1 as keyof ReportHeader] as string}
                        onChange={(e) => updateHeader(field1 as keyof ReportHeader, e.target.value)}
                      />
                    </td>
                    {field2 ? (
                      <>
                        <td className="bg-blue-50 border-r border-zinc-200 px-3 py-2 font-medium text-zinc-700 w-1/4">{label2}</td>
                        <td className="px-2 py-1.5">
                          <Input className="h-8 text-sm" value={header[field2 as keyof ReportHeader] as string}
                            onChange={(e) => updateHeader(field2 as keyof ReportHeader, e.target.value)}
                          />
                        </td>
                      </>
                    ) : (
                      <td colSpan={2} className="px-2 py-1.5 bg-zinc-50" />
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Test Results */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Test Results</CardTitle>
            </div>
            <Button onClick={() => {
              const rows = JSON.parse(header.utTestResultRows || "[]");
              rows.push({ description: "", beamId: "", noOfJoints: "", thickness: "", weldType: "", moc: "", totalMeter: "", results: "" });
              setHeader((h) => ({ ...h, utTestResultRows: JSON.stringify(rows) }));
            }} size="sm">
              <Plus className="mr-1 h-4 w-4" /> Add Row
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-blue-700 text-white">
                <tr>
                  <th className="border border-blue-800 px-2 py-2 text-center" style={{ minWidth: 30 }}>Sl. No</th>
                  <th className="border border-blue-800 px-2 py-2 text-center" style={{ minWidth: 180 }}>Description</th>
                  <th className="border border-blue-800 px-2 py-2 text-center" style={{ minWidth: 60 }}>Beam ID</th>
                  <th className="border border-blue-800 px-2 py-2 text-center" style={{ minWidth: 50 }}>No. of Joints</th>
                  <th className="border border-blue-800 px-2 py-2 text-center" style={{ minWidth: 60 }}>Thickness</th>
                  <th className="border border-blue-800 px-2 py-2 text-center" style={{ minWidth: 60 }}>Weld Type</th>
                  <th className="border border-blue-800 px-2 py-2 text-center" style={{ minWidth: 40 }}>MOC</th>
                  <th className="border border-blue-800 px-2 py-2 text-center" style={{ minWidth: 50 }}>Total Meter</th>
                  <th className="border border-blue-800 px-2 py-2 text-center" style={{ minWidth: 70 }}>Results</th>
                  <th className="border border-blue-800 px-2 py-2 text-center" style={{ minWidth: 60 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  try {
                    const rows = JSON.parse(header.utTestResultRows || "[]");
                    if (rows.length === 0) return (
                      <tr><td colSpan={10} className="text-center py-4 text-muted-foreground border border-zinc-300">No test result rows. Click Add Row.</td></tr>
                    );
                    return rows.map((row: any, idx: number) => (
                      <tr key={idx} className="hover:bg-muted/30">
                        <td className="border border-zinc-300 p-1 text-center font-mono">{idx + 1}</td>
                        <td className="border border-zinc-300 p-1">
                          <Textarea rows={1} className="text-xs min-h-[32px] py-1" value={row.description ?? ""}
                            onChange={(e) => {
                              const next = [...rows]; next[idx] = { ...row, description: e.target.value };
                              setHeader((h) => ({ ...h, utTestResultRows: JSON.stringify(next) }));
                            }}
                          />
                        </td>
                        {(["beamId", "noOfJoints", "thickness", "weldType", "moc", "totalMeter", "results"] as const).map((field) => (
                          <td key={field} className="border border-zinc-300 p-1">
                            <Input className="h-8 text-xs" value={row[field] ?? ""}
                              onChange={(e) => {
                                const next = [...rows]; next[idx] = { ...row, [field]: e.target.value };
                                setHeader((h) => ({ ...h, utTestResultRows: JSON.stringify(next) }));
                              }}
                            />
                          </td>
                        ))}
                        <td className="border border-zinc-300 p-1 text-center">
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-600"
                            onClick={() => {
                              const next = rows.filter((_: any, i: number) => i !== idx);
                              setHeader((h) => ({ ...h, utTestResultRows: JSON.stringify(next) }));
                            }}
                          ><Trash2 className="h-3 w-3" /></Button>
                        </td>
                      </tr>
                    ));
                  } catch { return null; }
                })()}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Inspection Note */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Inspection Note</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea rows={2} className="text-sm"
            value={header.utInspectionNote}
            onChange={(e) => updateHeader("utInspectionNote", e.target.value)}
            placeholder="e.g. No Reportable Indications Were Found."
          />
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
      )}

      {/* ═══ STEP 2 (WELD SCAN): WELD SCAN OBSERVATION TABLE ═══ */}
      {step === 2 && header.reportType === "PIPELINE_WELD_SCAN" && (
      <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Weld Scan Inspection Results</CardTitle>
              <CardDescription>
                Add one row per inspection point. Serial numbers are auto-generated.
                Select Accept or Reject for each row.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button onClick={addDptObservation} size="sm">
                <Plus className="mr-1 h-4 w-4" /> Add Row
              </Button>
              <Button onClick={addDptCustomColumn} size="sm" variant="outline">
                <Columns3 className="mr-1 h-4 w-4" /> Add Column
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-cyan-700 text-white">
                <tr>
                  <th className="border border-cyan-800 px-2 py-2 text-center" style={{ minWidth: 40 }}>Sl. No</th>
                  <th className="border border-cyan-800 px-2 py-2 text-center" style={{ minWidth: 200 }}>Description</th>
                  <th className="border border-cyan-800 px-2 py-2 text-center" style={{ minWidth: 100 }}>Weld Type</th>
                  <th className="border border-cyan-800 px-2 py-2 text-center" style={{ minWidth: 80 }}>Result</th>
                  {dptCustomColumns.map((cc) => (
                    <th key={cc.id} className="border border-cyan-800 px-2 py-2 text-center" style={{ minWidth: 90 }}>
                      <div className="flex items-center justify-center gap-1">
                        <span>{cc.name}</span>
                        {cc.unit && <span className="text-[9px] opacity-70">({cc.unit})</span>}
                        <button onClick={() => deleteDptCustomColumn(cc.id)} className="ml-1 text-cyan-300 hover:text-cyan-100" title={`Delete "${cc.name}"`}>
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </th>
                  ))}
                  <th className="border border-cyan-800 px-2 py-2 text-center" style={{ minWidth: 200 }}>Remarks</th>
                  <th className="border border-cyan-800 px-2 py-2 text-center" style={{ minWidth: 80 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {dptObservations.length === 0 && (
                  <tr>
                    <td colSpan={6 + dptCustomColumns.length} className="text-center py-6 text-muted-foreground border border-zinc-300">
                      No Weld Scan observations yet. Click <strong>Add Row</strong> to begin.
                    </td>
                  </tr>
                )}
                {dptObservations.map((obs, idx) => (
                  <tr key={idx} className="hover:bg-muted/30">
                    <td className="border border-zinc-300 p-1 text-center font-mono tabular-nums">{obs.serialNo}</td>
                    <td className="border border-zinc-300 p-1">
                      <Input className="h-8 text-xs" value={obs.description}
                        onChange={(e) => updateDptObservation(idx, { description: e.target.value })}
                        placeholder="Description of inspected area"
                      />
                    </td>
                    <td className="border border-zinc-300 p-1">
                      <Input className="h-8 text-xs" value={obs.weldType}
                        onChange={(e) => updateDptObservation(idx, { weldType: e.target.value })}
                        placeholder="e.g. Butt Weld"
                      />
                    </td>
                    <td className="border border-zinc-300 p-1">
                      <Select value={obs.result}
                        onValueChange={(v) => updateDptObservation(idx, { result: v as "Accept" | "Reject" })}
                      >
                        <SelectTrigger className={`h-8 text-xs font-bold ${obs.result === "Reject" ? "text-red-700" : "text-emerald-700"}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Accept" className="text-emerald-700">Accept</SelectItem>
                          <SelectItem value="Reject" className="text-red-700">Reject</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    {dptCustomColumns.map((cc) => (
                      <td key={cc.id} className="border border-zinc-300 p-1 text-center">
                        <Input type="text" className="h-8 text-xs text-center"
                          value={getDptCustomColumnValue(obs, cc.id)}
                          onChange={(e) => setDptCustomColumnValue(idx, cc.id, e.target.value)}
                          placeholder={cc.unit || "—"}
                        />
                      </td>
                    ))}
                    <td className="border border-zinc-300 p-1">
                      <Textarea rows={1} className="text-xs min-h-[32px] py-1"
                        value={obs.remarks}
                        onChange={(e) => updateDptObservation(idx, { remarks: e.target.value })}
                        placeholder="Observations, details..."
                      />
                    </td>
                    <td className="border border-zinc-300 p-1">
                      <div className="flex flex-col gap-1">
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]"
                          onClick={() => saveDptObservation(idx)} disabled={saving} title="Save row"
                        >
                          <Save className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="ghost"
                          className="h-6 w-6 p-0 text-red-600 hover:text-red-700"
                          onClick={() => deleteDptObservationApi(idx)} title="Delete row"
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
          <div><strong>Weld Scan Inspection:</strong> each row records one inspection point with Accept / Reject result.</div>
          <div><strong>Serial numbers:</strong> auto-generated (1, 2, 3…) and renumbered when rows are added or deleted.</div>
          <div><strong>Custom columns:</strong> click <strong>Add Column</strong> to add a new column. System columns (Sl. No, Description, Weld Type, Result, Remarks) cannot be deleted.</div>
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
      )}

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

            {/* B. Summary of Site Observations */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Summary Of Site Observations</Label>
              <Textarea
                rows={4}
                value={header.siteObservationSummary}
                onChange={(e) => updateHeader("siteObservationSummary", e.target.value)}
                placeholder="Concise summary of all observations made during the site inspection..."
                className="text-sm"
              />
            </div>

            {/* C. Results */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Results</Label>
              <Textarea
                rows={3}
                value={header.results}
                onChange={(e) => updateHeader("results", e.target.value)}
                placeholder="Summary of the inspection or measurement results..."
                className="text-sm"
              />
            </div>

            {/* D. Conclusion */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Conclusion</Label>
              <Textarea
                rows={2}
                value={header.conclusion}
                onChange={(e) => updateHeader("conclusion", e.target.value)}
                placeholder="Final overall conclusion of the inspection..."
                className="text-sm"
              />
            </div>

            {/* H. Sign-off fields — ALL fields are editable text inputs */}
            <div className="rounded-md border border-zinc-200 p-3 space-y-3 bg-muted/20">
              <Label className="text-sm font-semibold block">Sign-Off Details</Label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-2">
                  <Label className="text-xs">Inspected By — Name</Label>
                  <Input
                    value={header.inspectorName}
                    onChange={(e) => updateHeader("inspectorName", e.target.value)}
                    placeholder="e.g. Rahul Sharma"
                    className="text-sm"
                  />
                  <Label className="text-xs">Inspected By — Designation</Label>
                  <Input
                    value={header.inspectorDesignation}
                    onChange={(e) => updateHeader("inspectorDesignation", e.target.value)}
                    placeholder="e.g. NDT Technician"
                    className="text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Second Reviewed By — Name</Label>
                  <Input
                    value={header.secondReviewedByName}
                    onChange={(e) => updateHeader("secondReviewedByName", e.target.value)}
                    placeholder="e.g. Rahul Sharma"
                    className="text-sm"
                  />
                  <Label className="text-xs">Second Reviewed By — Designation</Label>
                  <Input
                    value={header.secondReviewedByDesignation}
                    onChange={(e) => updateHeader("secondReviewedByDesignation", e.target.value)}
                    placeholder="e.g. Senior Inspector"
                    className="text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Approved By — Name</Label>
                  <Input
                    value={header.approvedByName}
                    onChange={(e) => updateHeader("approvedByName", e.target.value)}
                    placeholder="e.g. Priya Admin"
                    className="text-sm"
                  />
                  <Label className="text-xs">Approved By — Designation</Label>
                  <Input
                    value={header.approvedByDesignation}
                    onChange={(e) => updateHeader("approvedByDesignation", e.target.value)}
                    placeholder="e.g. QA Manager"
                    className="text-sm"
                  />
                </div>
              </div>
            </div>

            {/* I. Photo Upload */}
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
                          <AuthImage
                            src={`/api/pipeline-inspections/${editingPipelineReportId}/photos/${photo.id}/raw`}
                            alt={photo.caption || photo.fileName}
                            className="w-full h-full object-cover"
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

        {/* ─── Equipment / Instrument Certificates ─── */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Equipment / Instrument Certificates</CardTitle>
                <CardDescription>Calibration certificates for instruments and equipment used during the inspection.</CardDescription>
              </div>
              <label className="cursor-pointer">
                <input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" multiple className="hidden"
                  onChange={async (e) => {
                    if (!e.target.files || !editingPipelineReportId) return;
                    const token = typeof window !== "undefined" ? window.localStorage.getItem("ira_session_token") : null;
                    for (const file of Array.from(e.target.files)) {
                      try {
                        const fd = new FormData(); fd.append("file", file); fd.append("category", "EQUIPMENT");
                        fd.append("title", file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim());
                        const res = await fetch(`/api/pipeline-inspections/${editingPipelineReportId}/certificates`, {
                          method: "POST", body: fd, credentials: "include",
                          headers: token ? { Authorization: `Bearer ${token}` } : {},
                        });
                        if (!res.ok) throw new Error("Upload failed");
                        toast.success(`Uploaded "${file.name}"`);
                      } catch { toast.error(`Failed to upload "${file.name}"`); }
                    }
                    e.target.value = ""; refresh();
                  }}
                />
                <Button size="sm" asChild disabled={!editingPipelineReportId}><span><Plus className="mr-1 h-4 w-4" /> Add Certificate</span></Button>
              </label>
            </div>
          </CardHeader>
          <CardContent><CertificateList reportId={editingPipelineReportId} category="EQUIPMENT" /></CardContent>
        </Card>

        {/* ─── Personnel / Inspector Certificates ─── */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Personnel / Inspector Certificates</CardTitle>
                <CardDescription>Certificates associated with inspectors or personnel involved in the inspection.</CardDescription>
              </div>
              <label className="cursor-pointer">
                <input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" multiple className="hidden"
                  onChange={async (e) => {
                    if (!e.target.files || !editingPipelineReportId) return;
                    const token = typeof window !== "undefined" ? window.localStorage.getItem("ira_session_token") : null;
                    for (const file of Array.from(e.target.files)) {
                      try {
                        const fd = new FormData(); fd.append("file", file); fd.append("category", "PERSONNEL");
                        fd.append("title", file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim());
                        const res = await fetch(`/api/pipeline-inspections/${editingPipelineReportId}/certificates`, {
                          method: "POST", body: fd, credentials: "include",
                          headers: token ? { Authorization: `Bearer ${token}` } : {},
                        });
                        if (!res.ok) throw new Error("Upload failed");
                        toast.success(`Uploaded "${file.name}"`);
                      } catch { toast.error(`Failed to upload "${file.name}"`); }
                    }
                    e.target.value = ""; refresh();
                  }}
                />
                <Button size="sm" asChild disabled={!editingPipelineReportId}><span><Plus className="mr-1 h-4 w-4" /> Add Certificate</span></Button>
              </label>
            </div>
          </CardHeader>
          <CardContent><CertificateList reportId={editingPipelineReportId} category="PERSONNEL" /></CardContent>
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

// ─── ConsumableSelector component ───
// A dropdown with preset product options PLUS an "Other / Custom" option.
// When the user picks "Other / Custom", a free-text input is revealed
// so they can enter any product / make / material not in the preset list.
//
// Behaviour:
//   • If the current value matches one of the preset options, the dropdown
//     shows that option selected and the custom input is hidden.
//   • If the current value is non-empty AND doesn't match any preset, the
//     dropdown shows "Other / Custom" selected and the custom input is
//     shown with the current value as its contents.
//   • If the current value is empty, the dropdown shows the placeholder
//     and the custom input is hidden.
//
// The parent component receives the final value via onChange — either a
// preset option value or whatever the user typed into the custom input.

interface ConsumableOption {
  value: string;
  label: string;
}

function ConsumableSelector({
  value,
  onChange,
  options,
  placeholder,
  customPrompt,
}: {
  value: string;
  onChange: (v: string) => void;
  options: ConsumableOption[];
  placeholder: string;
  customPrompt: string;
}) {
  // Determine whether the current value is a preset option or a custom value.
  const matchesPreset = options.some((o) => o.value === value);
  const isCustom = value !== "" && !matchesPreset;
  // The dropdown's current selected key:
  //   - "" when no value is set
  //   - the preset value when it matches
  //   - "__custom__" when the value is a non-preset custom entry
  const dropdownKey = matchesPreset ? value : isCustom ? "__custom__" : "";

  const [showCustom, setShowCustom] = useState(isCustom);

  // Keep the local showCustom state in sync if the value changes externally
  // (e.g. when loading an existing report).
  useEffect(() => {
    setShowCustom(value !== "" && !options.some((o) => o.value === value));
  }, [value, options]);

  return (
    <div className="flex flex-col gap-1.5">
      <Select
        value={dropdownKey}
        onValueChange={(key) => {
          if (key === "__custom__") {
            setShowCustom(true);
            // Don't clear the existing custom value — keep it so the user
            // can edit it. If there's no current value, leave it empty
            // and let them type.
          } else if (key === "__clear__") {
            setShowCustom(false);
            onChange("");
          } else {
            setShowCustom(false);
            onChange(key);
          }
        }}
      >
        <SelectTrigger className="h-8 text-sm">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {/* Clear / none option */}
          <SelectItem value="__clear__" className="text-muted-foreground italic">
            — None —
          </SelectItem>
          {/* Preset options */}
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
          {/* Other / Custom option */}
          <SelectItem value="__custom__" className="font-medium text-purple-700">
            Other / Custom…
          </SelectItem>
        </SelectContent>
      </Select>
      {showCustom && (
        <Input
          className="h-8 text-sm"
          value={matchesPreset ? "" : value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={customPrompt}
          autoFocus
        />
      )}
    </div>
  );
}

// ─── PrimaryPhotoUploader component ───
// A self-contained uploader for the Primary Inspection Photo.
//
// Design principles:
//   • The upload area (drag-and-drop + click) is ALWAYS visible. There is
//     no large warning box blocking the upload section.
//   • If the Report Header hasn't been saved yet (no reportId), the
//     upload handler auto-saves the header in the background before
//     uploading — so the user can fill in the header fields and upload
//     the photo in one smooth action, without having to click a separate
//     "Save Header" button first.
//   • If the header is missing required fields (report number, client,
//     plant) when the user tries to upload, a SMALL inline validation
//     message appears below the drop zone telling them which fields are
//     missing. The upload area itself stays visible and usable.
//   • After a successful upload, the component transitions to the preview
//     state showing the image + Replace / Remove buttons.
//
// Visual states:
//   STATE B — "Upload Photo" (always shown when no photo is uploaded yet)
//     Drag-and-drop zone with file-type / size hints, upload status
//     (idle / uploading / error), and retry on error.
//   STATE C — "Photo Preview" (shown after a successful upload)
//     Image preview + Replace / Remove buttons + success banner.
//
// Props:
//   reportId        — the editingPipelineReportId (null when no report saved yet)
//   primaryPhotoPath — current value of header.primaryPhotoPath
//   onPhotoChange   — parent callback to update header.primaryPhotoPath
//   onSaveHeader    — parent callback to save the report header (saveHeader()).
//                     Called automatically by the upload handler when the
//                     header hasn't been saved yet.
//   savingHeader    — whether the parent is currently saving the header
//   headerValid     — whether the header has the required fields filled in
//                     (report number, client, plant). Used to show a small
//                     validation message when the user tries to upload
//                     without filling in the required fields.
//
// All API calls use the dedicated /api/pipeline-inspections/[id]/primary-photo
// endpoint (POST for uploading, GET for serving, DELETE for clearing).

interface PrimaryPhotoUploaderProps {
  reportId: string | null;
  primaryPhotoPath: string;
  onPhotoChange: (path: string) => void;
  onSaveHeader: () => Promise<void>;
  savingHeader: boolean;
  headerValid: boolean;
}

type UploadStatus = "idle" | "uploading" | "error";

function PrimaryPhotoUploader({
  reportId,
  primaryPhotoPath,
  onPhotoChange,
  onSaveHeader,
  savingHeader,
  headerValid,
}: PrimaryPhotoUploaderProps) {
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // Bump this key to force the AuthImage to re-fetch after a replace
  // (otherwise the blob URL might be cached).
  const [previewKey, setPreviewKey] = useState(0);
  // When the user picks a file BEFORE the report header is saved, we store
  // the file here and save the header in the background. Once the parent
  // updates reportId (via onSaveHeader → setEditingPipelineReportId), a
  // useEffect below detects the new reportId and automatically retries
  // the upload with the pending file — so the user gets a seamless
  // "pick file → header saved → photo uploaded" flow in one action.
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  // Allowed file types — keep in sync with the API endpoint.
  const ACCEPTED_TYPES = "image/png,image/jpeg,image/webp,image/gif";
  const ACCEPTED_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
  const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

  // ─── Core upload function ───
  // Posts the file to the /primary-photo endpoint (POST). Returns true on
  // success, false on failure. Does NOT handle the "no reportId" case —
  // that's handled by uploadFile() below which decides whether to save
  // the header first.
  async function doUpload(file: File, activeReportId: string): Promise<boolean> {
    setUploadStatus("uploading");
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const token = typeof window !== "undefined" ? window.localStorage.getItem("ira_session_token") : null;
      const res = await fetch(
        `/api/pipeline-inspections/${activeReportId}/primary-photo`,
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
      const result = await res.json();
      onPhotoChange(result.filePath);
      setPreviewKey((k) => k + 1);
      setUploadStatus("idle");
      setUploadError(null);
      setPendingFile(null);
      toast.success("Primary photo uploaded");
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setUploadError(msg);
      setUploadStatus("error");
      toast.error(`Failed to upload primary photo: ${msg}`);
      return false;
    }
  }

  // ─── Upload handler (entry point) ───
  // Shared by both the initial upload (STATE B) and the replace flow (STATE C).
  //
  // If the report header hasn't been saved yet (no reportId), this handler
  // auto-saves the header first (via onSaveHeader) and stores the file as
  // "pending". A useEffect below watches for reportId to become non-null
  // and then automatically calls doUpload with the pending file — so the
  // user doesn't have to re-select the file.
  //
  // If the header is missing required fields, a small validation message
  // is shown below the drop zone and the upload is aborted.
  async function uploadFile(file: File) {
    // Client-side validation FIRST (before any API calls)
    if (!file.type.startsWith("image/")) {
      setUploadError(`"${file.name}" is not an image file. Allowed: PNG, JPG, JPEG, WebP, GIF.`);
      setUploadStatus("error");
      return;
    }
    if (!ACCEPTED_EXTS.some((ext) => file.name.toLowerCase().endsWith(ext))) {
      setUploadError(`"${file.name}" has an unsupported extension. Allowed: ${ACCEPTED_EXTS.join(", ")}.`);
      setUploadStatus("error");
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setUploadError(`File is too large (${(file.size / 1024 / 1024).toFixed(2)} MB). Maximum: 10 MB.`);
      setUploadStatus("error");
      return;
    }

    // If we already have a reportId, upload immediately.
    if (reportId) {
      await doUpload(file, reportId);
      return;
    }

    // No reportId yet — the header hasn't been saved.
    // If the header is missing required fields, show a small validation
    // message and abort. The upload area stays visible and usable.
    if (!headerValid) {
      setUploadError(
        "Please fill in the required header fields above (Report Number, Client, Plant Location) before uploading the photo.",
      );
      setUploadStatus("error");
      return;
    }

    // Header is valid but hasn't been saved yet. Save it in the background,
    // then store the file as "pending" — the useEffect below will detect
    // when reportId becomes non-null and automatically retry the upload.
    setPendingFile(file);
    setUploadStatus("uploading");
    setUploadError(null);
    try {
      await onSaveHeader();
      // After onSaveHeader resolves, the parent has set editingPipelineReportId.
      // The useEffect below will fire on the next render and call doUpload
      // with the pending file. We don't need to do anything else here.
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save report header";
      setUploadError(`Could not save the report header: ${msg}`);
      setUploadStatus("error");
      setPendingFile(null);
    }
  }

  // ─── Auto-retry effect ───
  // When reportId transitions from null to non-null AND there's a pending
  // file, automatically upload it. This gives the user a seamless
  // "pick file → header saved → photo uploaded" flow.
  useEffect(() => {
    if (reportId && pendingFile) {
      doUpload(pendingFile, reportId);
    }
    // We intentionally don't include doUpload in the deps — it's a stable
    // closure that captures the current props/state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId, pendingFile]);

  // ─── Remove handler ───
  async function removePhoto() {
    if (!reportId) return;
    try {
      const token = typeof window !== "undefined" ? window.localStorage.getItem("ira_session_token") : null;
      const res = await fetch(
        `/api/pipeline-inspections/${reportId}/primary-photo`,
        {
          method: "DELETE",
          credentials: "include",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Remove failed (HTTP ${res.status})`);
      }
      onPhotoChange("");
      setPreviewKey((k) => k + 1);
      setUploadStatus("idle");
      setUploadError(null);
      toast.success("Primary photo removed");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Remove failed";
      toast.error(`Failed to remove primary photo: ${msg}`);
    }
  }

  // ─── Drag-and-drop handlers ───
  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }
  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      uploadFile(files[0]);
    }
  }

  // ─── File input change handler ───
  function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      uploadFile(e.target.files[0]);
    }
    // Reset the input value so the same file can be selected again
    e.target.value = "";
  }

  // ─── STATE C: Photo already uploaded — show preview + Replace/Remove ───
  if (reportId && primaryPhotoPath) {
    return (
      <div className="space-y-3">
        {/* Preview + actions */}
        <div className="flex flex-col sm:flex-row items-start gap-4">
          {/* Image preview */}
          <div
            className="border rounded-md overflow-hidden bg-zinc-50"
            style={{ maxWidth: "360px", minWidth: "240px" }}
          >
            <AuthImage
              key={previewKey}
              src={`/api/pipeline-inspections/${reportId}/primary-photo`}
              alt="Primary inspection photo"
              className="w-full h-auto max-h-[260px] object-contain"
            />
          </div>
          {/* Metadata + actions */}
          <div className="flex flex-col gap-3 flex-1 min-w-0">
            <div className="flex items-start gap-2 text-emerald-700">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="text-xs">
                <p className="font-semibold">Photo uploaded successfully</p>
                <p className="text-muted-foreground mt-0.5">
                  This photo appears on the first page of the generated PDF,
                  immediately after the Client Details section.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {/* Replace Photo — triggers file picker */}
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept={ACCEPTED_TYPES}
                  className="hidden"
                  onChange={onFileInputChange}
                  disabled={uploadStatus === "uploading"}
                />
                <Button
                  size="sm"
                  variant="outline"
                  asChild
                  disabled={uploadStatus === "uploading"}
                >
                  <span>
                    {uploadStatus === "uploading" ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading…
                      </>
                    ) : (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4" /> Replace Photo
                      </>
                    )}
                  </span>
                </Button>
              </label>
              {/* Remove Photo */}
              <Button
                size="sm"
                variant="outline"
                className="text-red-600 hover:text-red-700"
                onClick={removePhoto}
                disabled={uploadStatus === "uploading"}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Remove Photo
              </Button>
            </div>
            {/* Inline error display after a failed replace */}
            {uploadStatus === "error" && uploadError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-semibold">Upload failed</p>
                  <p className="mt-0.5">{uploadError}</p>
                </div>
                <button
                  onClick={() => { setUploadStatus("idle"); setUploadError(null); }}
                  className="text-red-500 hover:text-red-700 shrink-0"
                  title="Dismiss"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── STATE B: Upload area (ALWAYS shown when no photo is uploaded) ───
  // This is the default state. The upload area is always visible — there is
  // no large yellow warning box blocking it. If the user tries to upload
  // before saving the header, the upload handler auto-saves the header in
  // the background (or shows a small validation message if required fields
  // are missing).
  return (
    <div className="space-y-3">
      {/* Drag-and-drop zone (also clickable) */}
      <label className="cursor-pointer block">
        <input
          type="file"
          accept={ACCEPTED_TYPES}
          className="hidden"
          onChange={onFileInputChange}
          disabled={uploadStatus === "uploading" || savingHeader}
        />
        <div
          className={`border-2 border-dashed rounded-md p-8 text-center transition-colors ${
            dragOver
              ? "border-amber-500 bg-amber-50"
              : uploadStatus === "error"
                ? "border-red-300 bg-red-50"
                : "border-zinc-300 hover:border-amber-400 hover:bg-zinc-50"
          } ${(uploadStatus === "uploading" || savingHeader) ? "opacity-60 pointer-events-none" : ""}`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          {uploadStatus === "uploading" ? (
            <>
              <Loader2 className="mx-auto h-10 w-10 text-amber-600 mb-3 animate-spin" />
              <p className="text-sm font-medium text-zinc-700">
                {pendingFile && savingHeader
                  ? "Saving report header, then uploading photo…"
                  : "Uploading photo…"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Please wait a moment</p>
            </>
          ) : uploadStatus === "error" ? (
            <>
              <AlertCircle className="mx-auto h-10 w-10 text-red-500 mb-3" />
              <p className="text-sm font-medium text-red-700">Upload failed</p>
              <p className="text-xs text-red-600 mt-1 max-w-sm mx-auto">{uploadError}</p>
              <p className="text-xs text-muted-foreground mt-3">Click here to try again</p>
            </>
          ) : (
            <>
              <Upload className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-sm font-medium text-zinc-700">
                Drag and drop the primary photo here
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                or <span className="text-amber-700 underline">click to select a file</span>
              </p>
              <div className="mt-4 flex items-center justify-center gap-2 text-[10px] text-muted-foreground">
                <Badge variant="outline" className="text-[10px] font-normal">PNG</Badge>
                <Badge variant="outline" className="text-[10px] font-normal">JPG</Badge>
                <Badge variant="outline" className="text-[10px] font-normal">JPEG</Badge>
                <Badge variant="outline" className="text-[10px] font-normal">WebP</Badge>
                <Badge variant="outline" className="text-[10px] font-normal">GIF</Badge>
                <span className="text-muted-foreground">·</span>
                <span>Max 10 MB</span>
              </div>
            </>
          )}
        </div>
      </label>
      {/* Small validation / error message below the drop zone.
          This is the ONLY place where validation feedback appears — the
          upload area itself is never replaced by a warning box. */}
      {uploadStatus === "error" && uploadError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold">Could not upload the photo</p>
            <p className="mt-0.5">{uploadError}</p>
            <p className="mt-1 text-muted-foreground">
              Fix the issue above and click the drop zone to try again.
            </p>
          </div>
          <button
            onClick={() => { setUploadStatus("idle"); setUploadError(null); }}
            className="text-red-500 hover:text-red-700 shrink-0"
            title="Dismiss"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── CertificateList component (used in Step 3 of the form) ───
// Fetches and displays certificates for a given report + category.
// Supports image previews (via AuthImage) and PDF file icons.
// Allows deletion.

function CertificateList({ reportId, category }: { reportId: string | null; category: string }) {
  const [items, setItems] = useState<Array<{
    id: string; title: string; fileName: string; fileExtension: string; fileSize: number;
  }>>([]);
  const [loading, setLoading] = useState(false);
  const { refreshKey } = useAppStore();

  useEffect(() => {
    if (!reportId) return;
    setLoading(true);
    apiFetch<{ items: any[] }>(`/api/pipeline-inspections/${reportId}/certificates`)
      .then((r) => setItems(r.items.filter((c) => c.category === category)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [reportId, category, refreshKey]);

  if (!reportId) return <p className="text-xs text-muted-foreground">Save the report first.</p>;
  if (loading) return <p className="text-xs text-muted-foreground">Loading…</p>;
  if (items.length === 0) return <p className="text-xs text-muted-foreground">No certificates uploaded.</p>;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((cert) => {
        const ext = (cert.fileExtension || "").toLowerCase();
        const isImage = [".png", ".jpg", ".jpeg"].includes(ext);
        const rawUrl = `/api/pipeline-inspections/${reportId}/certificates/${cert.id}/raw`;
        return (
          <div key={cert.id} className="border border-zinc-300 rounded overflow-hidden relative">
            <div className="bg-zinc-50 flex items-center justify-center" style={{ minHeight: "80px" }}>
              {isImage ? (
                <AuthImage src={rawUrl} alt={cert.title} className="w-full h-auto max-h-[100px] object-contain" />
              ) : (
                <div className="flex flex-col items-center text-muted-foreground p-2">
                  <FileText className="h-8 w-8" />
                  <span className="text-xs mt-1">PDF</span>
                </div>
              )}
            </div>
            <div className="p-2">
              <div className="text-xs font-medium truncate" title={cert.title}>{cert.title}</div>
              <div className="text-[10px] text-muted-foreground truncate">{cert.fileName}</div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[8px] uppercase text-muted-foreground">{ext.replace(".", "")}</span>
                <span className="text-[8px] text-muted-foreground">{Math.round(cert.fileSize / 1024)}KB</span>
              </div>
            </div>
            <button
              onClick={async () => {
                try {
                  await apiFetch(`/api/pipeline-inspections/${reportId}/certificates/${cert.id}`, { method: "DELETE" });
                  setItems((arr) => arr.filter((c) => c.id !== cert.id));
                  toast.success("Certificate removed");
                } catch { toast.error("Remove failed"); }
              }}
              className="absolute top-1 right-1 bg-red-600 text-white rounded-full p-1 hover:bg-red-700 z-10"
              title="Remove certificate"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
