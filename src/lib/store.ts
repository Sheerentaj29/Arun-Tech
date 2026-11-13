// Global app state for the Inspection Report Automation UI.
// Tracks current session, navigation target, and refresh counters
// so list views can re-fetch after mutations.
//
// NOTE: Equipment Master was intentionally REMOVED from this application.
// Its views, routes, and navigation were deleted and must NOT be re-added.
// The report workflow is: Create New Report → Select Equipment Type
// (Piping/Vessel) → Select Test Type → Fill Report → Submit for Review →
// Approve → Report History.

import { create } from "zustand";

export type ViewKey =
  // Role-specific dashboards (only these two are shown per spec)
  | "admin-dashboard"
  | "employee-dashboard"
  // Admin views
  | "clients"
  | "audit-logs"
  // Inspection reports (Report History) — Piping + Vessel
  | "pipeline-reports"
  | "pipeline-report-type-selector"
  | "pipeline-report-form"
  | "pipeline-report-detail"
  | "pipe-standards"
  // Admin: employee management
  | "employees"
  // Engineering drawings module
  | "drawings"
  // Alias for backwards compat with code that uses "dashboard"
  | "dashboard";

interface AppUser {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "EMPLOYEE" | "INSPECTOR" | "APPROVER";
  dashboardRole: "ADMIN" | "EMPLOYEE";
}

// Pipeline report type — set when the user picks a type in the selector
// screen before opening the form. When null (default), the form opens
// without a type, which only makes sense when editing an existing report
// (the type is read from the API response in that case).
//
// Active report types (shown in the selector):
//   • PIPELINE_THICKNESS  → Pipeline Thickness Measurement Report (Piping)
//   • PIPELINE_DPT        → DPT / DPPT Dye Penetrant Testing Report (Piping)
//   • PIPELINE_MPT        → Magnetic Particle Testing Report (Piping)
//   • PIPELINE_WELD_SCAN  → Weld Scan Report (Piping + Vessel; the
//                           testing-details table adapts to the asset
//                           type; no vessel orientation step)
//   • VESSEL_DPT          → Vessel Dye Penetrant Testing Report (Vessel,
//                           requires a Horizontal / Vertical orientation)
//   • VESSEL_MPT          → Vessel Magnetic Particle Testing Report (Vessel,
//                           requires a Horizontal / Vertical orientation)
//
// NOTE: no PIPELINE_UT / UT Report type exists — the UT report was
// intentionally removed and must NOT be re-added. Likewise, Equipment
// Master was removed — do not re-add it.
//
// Legacy report types (kept type-compatible for existing DB rows):
//   • PIPELINE_VISUAL     → Pipeline Visual Inspection Report (legacy)
//   • PIPELINE_CONDITION  → Pipeline Condition Assessment Report (legacy)
export type PipelineReportType =
  | "PIPELINE_THICKNESS"
  | "PIPELINE_DPT"
  | "PIPELINE_MPT"
  | "PIPELINE_WELD_SCAN"
  | "VESSEL_DPT"
  | "VESSEL_MPT"
  | "PIPELINE_VISUAL"
  | "PIPELINE_CONDITION";

// Equipment type chosen in the report-creation flow (Step 1 of the
// selector). Persisted on the report so the list / review / PDF know
// whether the inspection was performed on piping or a vessel.
export type EquipmentType = "PIPING" | "VESSEL";

// Vessel orientation — required for VESSEL_DPT and VESSEL_MPT reports.
// Selected in the selector before the form opens, stored on the report,
// and shown in the review page / PDF.
export type VesselOrientation = "HORIZONTAL" | "VERTICAL";

interface AppState {
  view: ViewKey;
  selectedPipelineReportId: string | null;
  editingPipelineReportId: string | null;
  // When opening the form for a NEW report, this holds the report type
  // the user picked in the selector screen. Cleared after the form
  // consumes it (so reopening the form later doesn't reuse a stale type).
  pendingPipelineReportType: PipelineReportType | null;
  // Equipment type picked in the selector ("PIPING" or "VESSEL"). Stored
  // on the created report; null when editing an existing report.
  pendingEquipmentType: EquipmentType | null;
  // Vessel orientation picked in the selector for VESSEL_DPT reports
  // ("HORIZONTAL" or "VERTICAL"). Null for all other report types.
  pendingVesselOrientation: VesselOrientation | null;
  refreshKey: number;
  user: AppUser | null;
  setView: (v: ViewKey) => void;
  /** Navigate to the role-appropriate dashboard. */
  goToMyDashboard: () => void;
  openPipelineReport: (id: string) => void;
  /** Show the report type selector (then the user picks a type → openNewPipelineReportWithType). */
  openNewPipelineReport: () => void;
  /** Open the form for a new report of the given type. */
  openNewPipelineReportWithType: (type: PipelineReportType) => void;
  /**
   * Open the form for a new report with the full selector selection:
   * report type + equipment type (Piping/Vessel) +, for VESSEL_DPT and
   * VESSEL_MPT, the vessel orientation (Horizontal/Vertical).
   */
  openNewPipelineReportWithSelection: (
    type: PipelineReportType,
    equipmentType: EquipmentType | null,
    vesselOrientation?: VesselOrientation | null,
  ) => void;
  openEditPipelineReport: (id: string) => void;
  setEditingPipelineReportId: (id: string) => void;
  setUser: (u: AppUser | null) => void;
  refresh: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  view: "dashboard",
  selectedPipelineReportId: null,
  editingPipelineReportId: null,
  pendingPipelineReportType: null,
  pendingEquipmentType: null,
  pendingVesselOrientation: null,
  refreshKey: 0,
  user: null,
  setView: (v) => set({ view: v }),
  goToMyDashboard: () => {
    const u = get().user;
    if (!u) {
      set({ view: "dashboard" });
      return;
    }
    set({ view: u.dashboardRole === "ADMIN" ? "admin-dashboard" : "employee-dashboard" });
  },
  openPipelineReport: (id) => set({ view: "pipeline-report-detail", selectedPipelineReportId: id }),
  // Default: show the report type selector screen (Step 1: Equipment Type).
  openNewPipelineReport: () =>
    set({
      view: "pipeline-report-type-selector",
      editingPipelineReportId: null,
      pendingPipelineReportType: null,
      pendingEquipmentType: null,
      pendingVesselOrientation: null,
    }),
  // After the user picks a type, set it and switch to the form view.
  // (No equipment type / orientation — used by legacy callers.)
  openNewPipelineReportWithType: (type) =>
    set({
      view: "pipeline-report-form",
      editingPipelineReportId: null,
      pendingPipelineReportType: type,
      pendingEquipmentType: null,
      pendingVesselOrientation: null,
    }),
  // Full selection from the staged selector:
  //   type + equipment type (Piping/Vessel) + optional vessel orientation
  //   (required for VESSEL_DPT and VESSEL_MPT).
  openNewPipelineReportWithSelection: (type, equipmentType, vesselOrientation = null) =>
    set({
      view: "pipeline-report-form",
      editingPipelineReportId: null,
      pendingPipelineReportType: type,
      pendingEquipmentType: equipmentType,
      pendingVesselOrientation: vesselOrientation,
    }),
  openEditPipelineReport: (id) =>
    set({
      view: "pipeline-report-form",
      editingPipelineReportId: id,
      pendingPipelineReportType: null,
      pendingEquipmentType: null,
      pendingVesselOrientation: null,
    }),
  setEditingPipelineReportId: (id) => set({ editingPipelineReportId: id }),
  setUser: (u) =>
    set((s) => ({
      user: u,
      // On login, route to the appropriate dashboard
      view: u
        ? u.dashboardRole === "ADMIN"
          ? "admin-dashboard"
          : "employee-dashboard"
        : s.view,
    })),
  refresh: () => set((s) => ({ refreshKey: s.refreshKey + 1 })),
}));
