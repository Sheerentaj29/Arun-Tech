"use client";

import { useEffect, useState } from "react";
import {
  FileText,
  Edit,
  RotateCcw,
  CheckCircle2,
  Clock,
  AlertTriangle,
  HardHat,
  ChevronRight,
  Loader2,
  Plus,
  Eye,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/lib/store";
import { apiFetch } from "@/lib/api-client";

interface EmployeeSummary {
  counts: {
    myTotalReports: number;
    myDrafts: number;
    mySubmitted: number;
    myReturned: number;
    myApproved: number;
    myChangesPending: number;
  };
  draftList: Array<{
    id: string;
    reportNumber: string;
    reportType: "PIPELINE_THICKNESS" | "PIPELINE_VISUAL" | "PIPELINE_CONDITION";
    pipelineDescription: string | null;
    updatedAt: string;
    client: { id: string; name: string };
    plant: { id: string; name: string; location: string | null };
    _count: { measurements: number; visualObservations: number };
  }>;
  returnedList: Array<{
    id: string;
    reportNumber: string;
    reportType: "PIPELINE_THICKNESS" | "PIPELINE_VISUAL" | "PIPELINE_CONDITION";
    pipelineDescription: string | null;
    reviewComments: string | null;
    returnedAt: string | null;
    returnedBy: { id: string; name: string } | null;
    client: { id: string; name: string };
    plant: { id: string; name: string; location: string | null };
    _count: { measurements: number; visualObservations: number };
  }>;
  approvedList: Array<{
    id: string;
    reportNumber: string;
    reportType: "PIPELINE_THICKNESS" | "PIPELINE_VISUAL" | "PIPELINE_CONDITION";
    pipelineDescription: string | null;
    approvedAt: string | null;
    revisionNumber: number;
    approver: { id: string; name: string } | null;
    client: { id: string; name: string };
    _count: { measurements: number; revisions: number; visualObservations: number };
  }>;
}

const REPORT_TYPE_BADGE: Record<string, { label: string; color: string }> = {
  PIPELINE_THICKNESS: { label: "Thickness", color: "border-emerald-500 text-emerald-700" },
  PIPELINE_VISUAL:    { label: "Visual",    color: "border-blue-500 text-blue-700" },
  PIPELINE_CONDITION: { label: "Condition", color: "border-amber-500 text-amber-700" },
};

export function EmployeeDashboardView() {
  const { openPipelineReport, openNewPipelineReport, refreshKey } = useAppStore();
  const [summary, setSummary] = useState<EmployeeSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    void apiFetch<EmployeeSummary>("/api/employee-summary")
      .then((s) => mounted && setSummary(s))
      .catch((e) => mounted && setError(e.message))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [refreshKey]);

  if (loading) {
    return (
      <div className="p-8 text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your dashboard...
      </div>
    );
  }
  if (error) return <div className="p-8 text-red-600">Failed to load: {error}</div>;
  if (!summary) return null;

  const cards = [
    { label: "My Reports", value: summary.counts.myTotalReports, icon: FileText, color: "text-zinc-700" },
    { label: "Drafts", value: summary.counts.myDrafts, icon: Edit, color: "text-blue-700" },
    { label: "Submitted", value: summary.counts.mySubmitted, icon: Clock, color: "text-blue-700" },
    { label: "Returned", value: summary.counts.myReturned, icon: RotateCcw, color: "text-red-700" },
    { label: "Approved", value: summary.counts.myApproved, icon: CheckCircle2, color: "text-emerald-700" },
    { label: "Changes Pending", value: summary.counts.myChangesPending, icon: AlertTriangle, color: "text-amber-700" },
  ];

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <HardHat className="h-7 w-7 text-amber-600" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Employee Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Create inspection reports, submit them for admin approval, and manage your drafts.
            </p>
          </div>
        </div>
        <Button onClick={() => openNewPipelineReport()}>
          <Plus className="mr-2 h-4 w-4" /> New Report
        </Button>
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
        {/* Returned reports — needs attention */}
        <Card className="border-red-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RotateCcw className="h-4 w-4 text-red-700" /> Returned for Revision
            </CardTitle>
            <CardDescription>
              Admin has returned these reports. Address the comments and resubmit.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {summary.returnedList.length === 0 && (
              <p className="text-sm text-muted-foreground py-3 text-center">
                No returned reports. You're all caught up.
              </p>
            )}
            {summary.returnedList.map((r) => {
              const ti = REPORT_TYPE_BADGE[r.reportType] ?? REPORT_TYPE_BADGE.PIPELINE_THICKNESS;
              return (
              <button
                key={r.id}
                onClick={() => openPipelineReport(r.id)}
                className="w-full text-left rounded-md border border-red-200 bg-red-50/50 p-3 hover:bg-red-50 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{r.reportNumber}</span>
                      <Badge variant="outline" className="border-red-500 text-red-700">
                        Returned
                      </Badge>
                      <Badge variant="outline" className={`text-[10px] ${ti.color}`}>{ti.label}</Badge>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground truncate">
                      {r.client.name} · {r.plant.name}
                    </div>
                    {r.reviewComments && (
                      <div className="mt-1 text-xs text-red-800 italic line-clamp-2">
                        "{r.reviewComments}"
                      </div>
                    )}
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Returned by {r.returnedBy?.name ?? "—"}
                      {r.returnedAt ? ` on ${new Date(r.returnedAt).toLocaleDateString()}` : ""}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </div>
              </button>
              );
            })}
          </CardContent>
        </Card>

        {/* Draft reports — continue editing */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Edit className="h-4 w-4 text-blue-700" /> Continue Editing
            </CardTitle>
            <CardDescription>
              Your draft reports. Pick up where you left off.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {summary.draftList.length === 0 && (
              <p className="text-sm text-muted-foreground py-3 text-center">
                No drafts. Click "New Report" to start one.
              </p>
            )}
            {summary.draftList.map((r) => {
              const ti = REPORT_TYPE_BADGE[r.reportType] ?? REPORT_TYPE_BADGE.PIPELINE_THICKNESS;
              return (
              <button
                key={r.id}
                onClick={() => openPipelineReport(r.id)}
                className="w-full text-left rounded-md border p-3 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{r.reportNumber}</span>
                      <Badge variant="outline" className="border-zinc-400 text-zinc-600">Draft</Badge>
                      <Badge variant="outline" className={`text-[10px] ${ti.color}`}>{ti.label}</Badge>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground truncate">
                      {r.client.name} · {r.plant.name}
                    </div>
                    <div className="text-xs truncate">{r.pipelineDescription ?? "—"}</div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {r.reportType === "PIPELINE_THICKNESS"
                    ? `${r._count.measurements} measurement point(s)`
                    : r.reportType === "PIPELINE_VISUAL"
                      ? `${r._count.visualObservations} observation(s)`
                      : "Condition assessment"}
                  {" · updated " + new Date(r.updatedAt).toLocaleDateString()}
                </div>
              </button>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* Approved reports */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="h-4 w-4 text-emerald-700" /> My Approved Reports
          </CardTitle>
          <CardDescription>
            Reports admin has approved. You can view, download the PDF, or revise
            (creates a new revision that needs admin approval).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {summary.approvedList.length === 0 && (
            <p className="text-sm text-muted-foreground py-3 text-center">
              No approved reports yet. Submit a report and wait for admin approval.
            </p>
          )}
          <div className="space-y-2">
            {summary.approvedList.map((r) => {
              const ti = REPORT_TYPE_BADGE[r.reportType] ?? REPORT_TYPE_BADGE.PIPELINE_THICKNESS;
              return (
              <button
                key={r.id}
                onClick={() => openPipelineReport(r.id)}
                className="w-full text-left rounded-md border p-3 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{r.reportNumber}</span>
                      <Badge variant="outline" className="border-emerald-500 text-emerald-700">
                        Approved
                      </Badge>
                      <Badge variant="outline" className={`text-[10px] ${ti.color}`}>{ti.label}</Badge>
                      {r.revisionNumber > 1 && (
                        <Badge variant="outline" className="text-[10px]">Rev {r.revisionNumber}</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">{r.client.name}</div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <div>Approved: {r.approvedAt ? new Date(r.approvedAt).toLocaleDateString() : "—"}</div>
                    <div>By: {r.approver?.name ?? "—"}</div>
                  </div>
                </div>
              </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="border-amber-300 bg-amber-50">
        <CardContent className="flex items-start gap-3 p-4">
          <Badge variant="outline" className="border-amber-500 text-amber-800 bg-white">DEMO</Badge>
          <p className="text-xs text-amber-900">
            Use the sidebar to access Equipment Master and Pipeline Reports. As an
            employee, you can create new reports, edit your own drafts and returned
            reports, and revise approved reports (creating a new revision that needs
            admin approval). You can't approve your own reports or see other
            employees' reports.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

const _ = Eye; // keep import warning-free
export { _ };
