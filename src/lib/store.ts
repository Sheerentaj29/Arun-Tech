// Global app state for the Equipment Master UI.
// Tracks current session, navigation target, and refresh counters
// so list views can re-fetch after mutations.

import { create } from "zustand";

export type ViewKey =
  // Role-specific dashboards (only these two are shown per spec)
  | "admin-dashboard"
  | "employee-dashboard"
  // Equipment master
  | "equipment"
  | "equipment-detail"
  | "equipment-form"
  // Existing inspection + audit + admin views
  | "inspections"
  | "clients"
  | "import"
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
export type PipelineReportType = "PIPELINE_THICKNESS" | "PIPELINE_VISUAL" | "PIPELINE_CONDITION";

interface AppState {
  view: ViewKey;
  selectedEquipmentId: string | null;
  editingEquipmentId: string | null;
  inspectionClientId: string | null;
  selectedPipelineReportId: string | null;
  editingPipelineReportId: string | null;
  // When opening the form for a NEW report, this holds the report type
  // the user picked in the selector screen. Cleared after the form
  // consumes it (so reopening the form later doesn't reuse a stale type).
  pendingPipelineReportType: PipelineReportType | null;
  refreshKey: number;
  user: AppUser | null;
  setView: (v: ViewKey) => void;
  /** Navigate to the role-appropriate dashboard. */
  goToMyDashboard: () => void;
  openEquipment: (id: string) => void;
  openNewEquipment: () => void;
  openEditEquipment: (id: string) => void;
  openPipelineReport: (id: string) => void;
  /** Show the report type selector (then the user picks a type → openNewPipelineReportWithType). */
  openNewPipelineReport: () => void;
  /** Open the form for a new report of the given type. */
  openNewPipelineReportWithType: (type: PipelineReportType) => void;
  openEditPipelineReport: (id: string) => void;
  setEditingPipelineReportId: (id: string) => void;
  setUser: (u: AppUser | null) => void;
  refresh: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  view: "dashboard",
  selectedEquipmentId: null,
  editingEquipmentId: null,
  inspectionClientId: null,
  selectedPipelineReportId: null,
  editingPipelineReportId: null,
  pendingPipelineReportType: null,
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
  openEquipment: (id) => set({ view: "equipment-detail", selectedEquipmentId: id }),
  openNewEquipment: () => set({ view: "equipment-form", editingEquipmentId: null }),
  openEditEquipment: (id) => set({ view: "equipment-form", editingEquipmentId: id }),
  openPipelineReport: (id) => set({ view: "pipeline-report-detail", selectedPipelineReportId: id }),
  // Default: show the report type selector screen.
  openNewPipelineReport: () =>
    set({ view: "pipeline-report-type-selector", editingPipelineReportId: null, pendingPipelineReportType: null }),
  // After the user picks a type, set it and switch to the form view.
  openNewPipelineReportWithType: (type) =>
    set({ view: "pipeline-report-form", editingPipelineReportId: null, pendingPipelineReportType: type }),
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
