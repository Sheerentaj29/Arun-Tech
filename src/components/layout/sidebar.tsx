"use client";

import {
  LayoutDashboard,
  Database,
  FileText,
  Building2,
  Upload,
  ScrollText,
  ShieldCheck,
  LogOut,
  HardHat,
  Gauge,
  Ruler,
  Users,
} from "lucide-react";
import { useAppStore, type ViewKey } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// All sidebar items. Each item declares which dashboard roles can see it.
// ADMIN sees everything; EMPLOYEE sees only their own dashboard, equipment,
// pipeline reports, and inspections.
const NAV: Array<{
  key: ViewKey;
  label: string;
  icon: React.ElementType;
  roles: Array<"ADMIN" | "EMPLOYEE">;
}> = [
  // Admin's own dashboard
  { key: "admin-dashboard", label: "Admin Dashboard", icon: ShieldCheck, roles: ["ADMIN"] },
  // Employee's own dashboard
  { key: "employee-dashboard", label: "My Dashboard", icon: HardHat, roles: ["EMPLOYEE"] },
  // Shared equipment master
  { key: "equipment", label: "Equipment Master", icon: Database, roles: ["ADMIN", "EMPLOYEE"] },
  // Pipeline thickness reports — admin sees all, employee sees their own
  { key: "pipeline-reports", label: "Pipeline Reports", icon: Gauge, roles: ["ADMIN", "EMPLOYEE"] },
  // Inspections (equipment-master inspection history — preserved)
  { key: "inspections", label: "Inspections", icon: FileText, roles: ["ADMIN", "EMPLOYEE"] },
  // Admin-only views
  { key: "employees", label: "Employees", icon: Users, roles: ["ADMIN"] },
  { key: "clients", label: "Clients & Plants", icon: Building2, roles: ["ADMIN"] },
  { key: "pipe-standards", label: "Pipe Standards", icon: Ruler, roles: ["ADMIN"] },
  { key: "import", label: "CSV Import / Export", icon: Upload, roles: ["ADMIN"] },
  { key: "audit-logs", label: "Audit Log", icon: ScrollText, roles: ["ADMIN"] },
];

export function AppSidebar() {
  const { view, setView, user, setUser, goToMyDashboard } = useAppStore();
  if (!user) return null;
  const visibleNav = NAV.filter((n) => n.roles.includes(user.dashboardRole));

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
        <button
          onClick={goToMyDashboard}
          className="flex h-10 w-10 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground hover:opacity-90 transition-opacity"
          title="Back to dashboard"
        >
          {user.dashboardRole === "ADMIN" ? (
            <ShieldCheck className="h-6 w-6" />
          ) : (
            <HardHat className="h-6 w-6" />
          )}
        </button>
        <div className="flex flex-col">
          <span className="text-sm font-bold tracking-tight leading-tight">
            Inspection Report
          </span>
          <span className="text-xs text-sidebar-foreground/70 leading-tight">
            Automation System
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const active = view === item.key;
            return (
              <li key={item.key}>
                <button
                  onClick={() => setView(item.key)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* User footer */}
      <div className="border-t border-sidebar-border p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sidebar-accent text-sidebar-accent-foreground text-sm font-bold uppercase">
            {user.name.charAt(0)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-sidebar-foreground">
              {user.name}
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="h-5 px-1.5 text-[10px] uppercase border-sidebar-primary/50 text-sidebar-primary"
              >
                {user.dashboardRole === "ADMIN" ? "Administrator" : "Employee"}
              </Badge>
            </div>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="mt-3 w-full justify-start text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
          onClick={async () => {
            // Clear the localStorage token (client-side) + DELETE cookie (server-side)
            try {
              if (typeof window !== "undefined") {
                window.localStorage.removeItem("ira_session_token");
              }
            } catch { /* ignore */ }
            try {
              await fetch("/api/auth", { method: "DELETE", credentials: "include" });
            } catch { /* ignore */ }
            setUser(null);
            setView("dashboard");
          }}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </Button>
        <div className="mt-3 flex items-center gap-1.5 px-1 text-[10px] text-sidebar-foreground/60">
          <ShieldCheck className="h-3 w-3" />
          <span>DEMO BUILD · Use for evaluation only</span>
        </div>
      </div>
    </aside>
  );
}

// Keep LayoutDashboard import warm for potential future use
const _ = LayoutDashboard;
export { _ };
