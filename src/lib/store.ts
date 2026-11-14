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
//   • PIPELINE_WELD_SCAN  → Weld Scan Report (Piping)
//   • VESSEL_DPT          → Vessel Dye Penetrant Testing Report (Vessel)
//   • VESSEL_MPT          → Vessel Magnetic Particle Testing Report (Vessel)
//   • VESSEL_WELD_SCAN    → Vessel Weld Scan Report (Vessel; own parameter
//                           sections and Vessel-specific testing-details
//                           table — completely separate from the Piping
//                           Weld Scan, which stays untouched)
//   • VESSEL_UTM          → Vessel UT Thickness Measurement Report (Vessel;
//                           requires a Horizontal / Vertical orientation —
//                           the ONLY module that asks for one. Horizontal
//                           vessels measure at clock positions (12 / 3 / 6
//                           / 9 o'clock), vertical vessels in directions
//                           (East / West / North / South); every position
//                           starts with ONE reading and grows dynamically.
//                           Completely separate from the Piping Thickness
//                           Measurement (PIPELINE_THICKNESS), which stays
//                           untouched)
//   • VESSEL_VISUAL       → RESERVED for "Visual Inspection" on Vessel —
//                           shown as a "Coming soon" card in the selector
//                           only. NOT implemented; the API refuses to
//                           create reports of this type. Do not build UI
//                           for it until it is explicitly requested.
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
  | "VESSEL_WELD_SCAN"
  | "VESSEL_UTM"
  | "VESSEL_VISUAL"
  | "PIPELINE_VISUAL"
  | "PIPELINE_CONDITION";

// Equipment type chosen in the report-creation flow (Step 1 of the
// selector). Persisted on the report so the list / review / PDF know
// whether the inspection was performed on piping or a vessel.
export type EquipmentType = "PIPING" | "VESSEL";

// Vessel orientation — required ONLY for VESSEL_UTM (Vessel UT Thickness
// Measurement) reports, picked in the selector before the form opens.
// Horizontal vessels measure at clock positions, vertical vessels in
// East/West/North/South directions. No other module asks for an
// orientation (DPT / MPT / Weld Scan / Visual / all Piping).
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
  // Vessel orientation picked in the selector — set ONLY for VESSEL_UTM
  // reports ("HORIZONTAL" or "VERTICAL"); null for every other type.
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
   * report type + equipment type (Piping/Vessel) +, for VESSEL_UTM only,
   * the vessel orientation (Horizontal/Vertical).
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
  // (No equipment type — used by legacy callers.)
  openNewPipelineReportWithType: (type) =>
    set({
      view: "pipeline-report-form",
      editingPipelineReportId: null,
      pendingPipelineReportType: type,
      pendingEquipmentType: null,
      pendingVesselOrientation: null,
    }),
  // Full selection from the staged selector:
  //   type + equipment type (Piping/Vessel) +, for VESSEL_UTM only, the
  //   vessel orientation (Horizontal/Vertical).
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
