// Global app state for the inspection report automation UI.
// Tracks current session, navigation target, and refresh counters
// so list views can re-fetch after mutations.

import { create } from "zustand";

export type ViewKey =
  // Role-specific dashboards (only these two are shown per spec)
  | "admin-dashboard"
  | "employee-dashboard"
  // Report history + audit + admin views
  | "report-history"
  | "clients"
  | "audit-logs"
  // Pipeline thickness reports
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
//   • PIPELINE_THICKNESS  → Thickness Measurement Report
//   • PIPELINE_DPT        → DPT / DPPT Dye Penetrant Testing Report
//   • PIPELINE_MPT        → Magnetic Particle Testing Report
//   • PIPELINE_WELD_SCAN  → Weld Scan Report
//   • PIPELINE_VISUAL     → Visual Inspection Report (vessel module)
//
// Legacy report types (kept type-compatible for existing DB rows):
//   • PIPELINE_CONDITION  → Pipeline Condition Assessment Report (legacy)
export type PipelineReportType =
  | "PIPELINE_THICKNESS"
  | "PIPELINE_DPT"
  | "PIPELINE_MPT"
  | "PIPELINE_WELD_SCAN"
  | "PIPELINE_VISUAL"
  | "PIPELINE_CONDITION";

// Equipment category — selected at the very start of New Report creation,
// before the report type. Every report stores exactly one of these so the
// report history, detail view, and PDF can identify piping vs vessel data.
export type EquipmentType = "PIPING" | "VESSEL";

interface AppState {
  view: ViewKey;
  inspectionClientId: string | null;
  selectedPipelineReportId: string | null;
  editingPipelineReportId: string | null;
  // When opening the form for a NEW report, this holds the report type
  // the user picked in the selector screen. Cleared after the form
  // consumes it (so reopening the form later doesn't reuse a stale type).
  pendingPipelineReportType: PipelineReportType | null;
  // The equipment category (PIPING / VESSEL) picked in the selector screen.
  // Consumed by the form on first render; defaults to PIPING for edit mode.
  pendingEquipmentType: EquipmentType | null;
  refreshKey: number;
  user: AppUser | null;
  setView: (v: ViewKey) => void;
  /** Navigate to the role-appropriate dashboard. */
  goToMyDashboard: () => void;
  openPipelineReport: (id: string) => void;
  /** Show the report type selector (then the user picks a type → openNewPipelineReportWithType). */
  openNewPipelineReport: () => void;
  /** Open the form for a new report of the given type and equipment category. */
  openNewPipelineReportWithType: (type: PipelineReportType, equipmentType?: EquipmentType) => void;
  openEditPipelineReport: (id: string) => void;
  setEditingPipelineReportId: (id: string) => void;
  setUser: (u: AppUser | null) => void;
  refresh: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  view: "dashboard",
  inspectionClientId: null,
  selectedPipelineReportId: null,
  editingPipelineReportId: null,
  pendingPipelineReportType: null,
  pendingEquipmentType: null,
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
  // Default: show the report type selector screen.
  openNewPipelineReport: () =>
    set({ view: "pipeline-report-type-selector", editingPipelineReportId: null, pendingPipelineReportType: null, pendingEquipmentType: null }),
  // After the user picks a type (and the equipment category), set both and
  // switch to the form view. equipmentType defaults to PIPING so legacy
  // callers (e.g. dashboard quick-links) keep creating piping reports.
  openNewPipelineReportWithType: (type, equipmentType = "PIPING") =>
    set({ view: "pipeline-report-form", editingPipelineReportId: null, pendingPipelineReportType: type, pendingEquipmentType: equipmentType }),
  openEditPipelineReport: (id) =>
    set({ view: "pipeline-report-form", editingPipelineReportId: id, pendingPipelineReportType: null }),
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
