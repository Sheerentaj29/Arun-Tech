"use client";

import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/lib/store";
import {
  apiFetch,
  registerUnauthorizedHandler,
  setSessionToken,
  clearSessionToken,
} from "@/lib/api-client";
import { LoginScreen } from "@/components/login-screen";
import { AppSidebar } from "@/components/layout/sidebar";
import { AdminDashboardView } from "@/components/views/admin-dashboard-view";
import { EmployeeDashboardView } from "@/components/views/employee-dashboard-view";
import { ClientsView } from "@/components/views/clients-view";
import { AuditLogView } from "@/components/views/audit-log-view";
import { PipelineReportsListView } from "@/components/views/pipeline-reports-list-view";
import { PipelineReportTypeSelectorView } from "@/components/views/pipeline-report-type-selector-view";
import { PipelineReportFormView } from "@/components/views/pipeline-report-form-view";
import { PipelineReportDetailView } from "@/components/views/pipeline-report-detail-view";
import { PipeStandardsView } from "@/components/views/pipe-standards-view";
import { EmployeesView } from "@/components/views/employees-view";

interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "EMPLOYEE" | "INSPECTOR" | "APPROVER";
  dashboardRole: "ADMIN" | "EMPLOYEE";
}

export default function Home() {
  const { user, setUser, setView, view } = useAppStore();
  const [bootChecked, setBootChecked] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const loggingOutRef = useRef(false);

  useEffect(() => {
    const unregister = registerUnauthorizedHandler(() => {
      if (loggingOutRef.current) return;
      loggingOutRef.current = true;
      setUser(null);
      setView("dashboard");
      setSessionExpired(true);
      clearSessionToken();
      void fetch("/api/auth", { method: "DELETE", credentials: "include" })
        .catch(() => {})
        .finally(() => { loggingOutRef.current = false; });
    });
    return unregister;
  }, [setUser, setView]);

  // Re-hydrate session on first render. The apiFetch helper automatically
  // includes the Authorization: Bearer <userId> header from localStorage.
  useEffect(() => {
    apiFetch<{ user: SessionUser | null }>("/api/auth")
      .then((r) => {
        if (r.user) {
          setUser(r.user);
          setSessionToken(r.user.id);
        }
      })
      .catch(() => {})
      .finally(() => setBootChecked(true));
  }, [setUser]);

  if (!bootChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100">
        <div className="text-zinc-500">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen sessionExpired={sessionExpired} onDismissExpired={() => setSessionExpired(false)} />;
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">
          {/* Role-based dashboards */}
          {view === "admin-dashboard" && user.dashboardRole === "ADMIN" && <AdminDashboardView />}
          {view === "employee-dashboard" && <EmployeeDashboardView />}
          {/* Backward-compat: legacy "dashboard" view routes to role-appropriate dashboard */}
          {view === "dashboard" && (
            user.dashboardRole === "ADMIN" ? <AdminDashboardView /> : <EmployeeDashboardView />
          )}
          {/* Admin views.
              NOTE: Equipment Master (equipment / equipment-detail /
              equipment-form), CSV Import / Export, and the legacy
              equipment-inspections views were intentionally removed and
              must NOT be re-added. */}
          {view === "clients" && <ClientsView />}
          {view === "audit-logs" && <AuditLogView />}
          {/* Pipeline thickness reports */}
          {view === "pipeline-reports" && <PipelineReportsListView />}
          {view === "pipeline-report-type-selector" && <PipelineReportTypeSelectorView />}
          {view === "pipeline-report-form" && <PipelineReportFormView />}
          {view === "pipeline-report-detail" && <PipelineReportDetailView />}
          {view === "pipe-standards" && <PipeStandardsView />}
          {/* Employee management (admin only — sidebar hides it for employees) */}
          {view === "employees" && <EmployeesView />}
        </div>
      </main>
    </div>
  );
}
