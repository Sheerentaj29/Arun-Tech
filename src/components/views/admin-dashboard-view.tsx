"use client";

import { useEffect, useState } from "react";
import {
  FileText,
  Clock,
  CheckCircle2,
  RotateCcw,
  Users,
  ShieldCheck,
  AlertTriangle,
  Loader2,
  ChevronRight,
  User as UserIcon,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/lib/store";
import { apiFetch } from "@/lib/api-client";
import { toast } from "sonner";

interface AdminSummary {
  counts: {
    totalReports: number;
    pendingApprovals: number;
    changesPending: number;
    approvedReports: number;
    returnedReports: number;
    draftReports: number;
    totalEmployees: number;
    totalAdmins: number;
  };
  pendingApprovalsList: Array<{
    id: string;
    reportNumber: string;
    reportType: "PIPELINE_THICKNESS" | "PIPELINE_VISUAL" | "PIPELINE_CONDITION";
    status: string;
    pipelineDescription: string | null;
    updatedAt: string;
    inspector: { id: string; name: string; email: string };
    client: { id: string; name: string };
    plant: { id: string; name: string; location: string | null };
    _count: { measurements: number; revisions: number; visualObservations: number };
  }>;
  recentApproved: Array<{
    id: string;
    reportNumber: string;
    reportType: "PIPELINE_THICKNESS" | "PIPELINE_VISUAL" | "PIPELINE_CONDITION";
    approvedAt: string | null;
    inspector: { id: string; name: string };
    approver: { id: string; name: string } | null;
    client: { id: string; name: string };
    _count: { measurements: number; revisions: number; visualObservations: number };
  }>;
  recentActivity: Array<{
    id: string;
    userName: string | null;
    action: string;
    entity: string;
    details: string | null;
    createdAt: string;
  }>;
}

const REPORT_TYPE_BADGE: Record<string, { label: string; color: string }> = {
  PIPELINE_THICKNESS: { label: "Thickness", color: "border-emerald-500 text-emerald-700" },
  PIPELINE_VISUAL:    { label: "Visual",    color: "border-blue-500 text-blue-700" },
  PIPELINE_CONDITION: { label: "Condition", color: "border-amber-500 text-amber-700" },
  PIPELINE_DPT:       { label: "DPT/DPPT", color: "border-purple-500 text-purple-700" },
  PIPELINE_MPT:       { label: "MPT",      color: "border-orange-500 text-orange-700" },
  PIPELINE_WELD_SCAN: { label: "Weld Scan", color: "border-cyan-500 text-cyan-700" },
  VESSEL_DPT:         { label: "Vessel DPT", color: "border-purple-500 text-purple-700" },
  VESSEL_MPT:         { label: "Vessel MPT", color: "border-orange-500 text-orange-700" },
};

const ACTION_COLOR: Record<string, string> = {
  CREATE: "border-emerald-500 text-emerald-700",
  UPDATE: "border-blue-500 text-blue-700",
  DELETE: "border-red-500 text-red-700",
  LOGIN: "border-zinc-400 text-zinc-600",
  LOGOUT: "border-zinc-400 text-zinc-600",
  IMPORT: "border-amber-500 text-amber-700",
  EXPORT: "border-amber-500 text-amber-700",
  APPROVE: "border-emerald-500 text-emerald-700",
  RETURN: "border-amber-500 text-amber-700",
  SUBMIT: "border-blue-500 text-blue-700",
  REVISE: "border-purple-500 text-purple-700",
  OVERRIDE: "border-red-500 text-red-700",
};

export function AdminDashboardView() {
  const { openPipelineReport, refreshKey, setView } = useAppStore();
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    void apiFetch<AdminSummary>("/api/admin-summary")
      .then((s) => mounted && setSummary(s))
      .catch((e) => mounted && setError(e.message))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [refreshKey]);

  if (loading) {
    return (
      <div className="p-8 text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading admin dashboard...
      </div>
    );
  }
  if (error) {
    return <div className="p-8 text-red-600">Failed to load: {error}</div>;
  }
  if (!summary) return null;

  const cards = [
    { label: "Total Reports", value: summary.counts.totalReports, icon: FileText, color: "text-zinc-700" },
    { label: "Pending Approvals", value: summary.counts.pendingApprovals, icon: Clock, color: "text-blue-700" },
    { label: "Changes Pending", value: summary.counts.changesPending, icon: AlertTriangle, color: "text-amber-700" },
    { label: "Approved Reports", value: summary.counts.approvedReports, icon: CheckCircle2, color: "text-emerald-700" },
    { label: "Returned Reports", value: summary.counts.returnedReports, icon: RotateCcw, color: "text-red-700" },
    { label: "Total Employees", value: summary.counts.totalEmployees, icon: Users, color: "text-zinc-700" },
  ];

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-7 w-7 text-amber-600" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Admin Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Approve inspection reports, manage employees, and monitor audit activity.
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <Card key={c.label}>
              <CardContent className="flex flex-col items-start gap-1 p-4">
                <Icon className={`h-5 w-5 ${c.color}`} />
                <div className="text-2xl font-bold tabular-nums">{c.value}</div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground leading-tight">
                  {c.label}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Pending approvals */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-blue-700" /> Reports Awaiting Review
            </CardTitle>
            <CardDescription>
              {summary.pendingApprovalsList.length} report(s) need your action.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {summary.pendingApprovalsList.length === 0 && (
              <p className="text-sm text-muted-foreground py-3 text-center">
                No reports awaiting review. All caught up.
              </p>
            )}
            {summary.pendingApprovalsList.map((r) => {
              const ti = REPORT_TYPE_BADGE[r.reportType] ?? REPORT_TYPE_BADGE.PIPELINE_THICKNESS;
              return (
              <button
                key={r.id}
                onClick={() => openPipelineReport(r.id)}
                className="w-full text-left rounded-md border p-3 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-semibold">{r.reportNumber}</span>
                      <Badge variant="outline" className={`text-[10px] ${ti.color}`}>{ti.label}</Badge>
                      <Badge
                        variant="outline"
                        className={
                          r.status === "Submitted for Review"
                            ? "border-blue-500 text-blue-700"
                            : "border-amber-500 text-amber-700"
                        }
                      >
                        {r.status}
                      </Badge>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground truncate">
                      {r.client.name} · {r.plant.name}
                    </div>
                    <div className="text-xs truncate">{r.pipelineDescription ?? "—"}</div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </div>
                <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1">
                    <UserIcon className="h-3 w-3" /> {r.inspector.name}
                  </span>
                  {r.reportType === "PIPELINE_THICKNESS" && <span>{r._count.measurements} points</span>}
                  {r.reportType === "PIPELINE_VISUAL" && <span>{r._count.visualObservations} observations</span>}
                  {r._count.revisions > 0 && <span>rev {r._count.revisions}</span>}
                </div>
              </button>
              );
            })}
          </CardContent>
        </Card>

        {/* Recent activity */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" /> Recent Audit Activity
            </CardTitle>
            <CardDescription>Latest 10 audit entries across the system.</CardDescription>
          </CardHeader>
          <CardContent>
            {summary.recentActivity.length === 0 && (
              <p className="text-sm text-muted-foreground py-3 text-center">No recent activity.</p>
            )}
            <div className="space-y-2">
              {summary.recentActivity.map((a) => (
                <div key={a.id} className="flex items-start gap-2 text-xs">
                  <Badge variant="outline" className={ACTION_COLOR[a.action] ?? ""}>
                    {a.action}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <div className="truncate">
                      <span className="font-semibold">{a.userName ?? "system"}</span>
                      {" · "}
                      <span className="text-muted-foreground">{a.entity}</span>
                    </div>
                    {a.details && (
                      <div className="text-muted-foreground truncate">{a.details}</div>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground shrink-0">
                    {new Date(a.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => setView("audit-logs")}>
                View all
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recently approved reports */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="h-4 w-4 text-emerald-700" /> Recently Approved Reports
          </CardTitle>
          <CardDescription>
            Most recent 5 approved reports. Click any to view, download, or revise.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {summary.recentApproved.length === 0 && (
            <p className="text-sm text-muted-foreground py-3 text-center">No approved reports yet.</p>
          )}
          <div className="space-y-2">
            {summary.recentApproved.map((r) => {
              const ti = REPORT_TYPE_BADGE[r.reportType] ?? REPORT_TYPE_BADGE.PIPELINE_THICKNESS;
              return (
              <button
                key={r.id}
                onClick={() => openPipelineReport(r.id)}
                className="w-full text-left rounded-md border p-3 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-semibold">{r.reportNumber}</span>
                      <Badge variant="outline" className="border-emerald-500 text-emerald-700">
                        Approved
                      </Badge>
                      <Badge variant="outline" className={`text-[10px] ${ti.color}`}>{ti.label}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">{r.client.name}</div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <div>Inspector: {r.inspector.name}</div>
                    <div>Approved by: {r.approver?.name ?? "—"}</div>
                    <div>{r.approvedAt ? new Date(r.approvedAt).toLocaleDateString() : "—"}</div>
                  </div>
                </div>
              </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Demo banner */}
      <Card className="border-amber-300 bg-amber-50">
        <CardContent className="flex items-start gap-3 p-4">
          <Badge variant="outline" className="border-amber-500 text-amber-800 bg-white">DEMO</Badge>
          <p className="text-xs text-amber-900">
            The admin dashboard aggregates reports across all employees. Use the
            sidebar to access Report History, Employees, Clients &amp; Plants, Pipe
            Standards (admin reference data), and the Audit Log.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
