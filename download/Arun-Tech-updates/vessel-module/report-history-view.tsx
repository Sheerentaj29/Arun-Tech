"use client";

// Report History — lists the real reports created through the application's
// report creation workflow (no demo/hardcoded data). Data comes live from
// GET /api/pipeline-inspections, which applies the existing role-based
// filtering: admins see every report, employees see only their own.
//
// Actions shown per row follow the same permission model as the report
// detail view:
//   • View               — always available (opens the report detail page)
//   • Edit               — admins, or the report owner while it is a Draft
//                          or Returned for Revision
//   • Review / Approve   — admins, while the report is Submitted for Review
//                          or Changes Pending Review (handled in detail view)
//   • Download PDF       — always available (generated on demand by the
//                          existing PDF endpoint)

import { useEffect, useState } from "react";
import {
  History,
  Search,
  Loader2,
  Calendar,
  Eye,
  Pencil,
  ShieldCheck,
  Download,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAppStore } from "@/lib/store";
import { apiFetch } from "@/lib/api-client";
import { toast } from "sonner";

interface ReportHistoryItem {
  id: string;
  reportNumber: string;
  equipmentType: string; // PIPING | VESSEL
  reportType: string;
  inspectionDate: string;
  fromDate: string | null;
  toDate: string | null;
  status: string;
  revisionNumber: number;
  inspectionArea: string | null;
  pipelineDescription: string | null;
  pipelineIdentificationNumber: string | null;
  isometricDrawingNumber: string | null;
  inspectorId: string;
  client: { id: string; name: string };
  plant: { id: string; name: string; location: string | null };
}

interface ClientItem {
  id: string;
  name: string;
  plants: Array<{ id: string; name: string; location: string | null }>;
}

// Status colors — the existing workflow status values, shared with the
// pipeline reports list view.
const STATUS_COLOR: Record<string, string> = {
  Draft: "border-zinc-400 text-zinc-600",
  "Submitted for Review": "border-blue-500 text-blue-700",
  "Returned for Revision": "border-red-500 text-red-700",
  Approved: "border-emerald-500 text-emerald-700",
  "Changes Pending Review": "border-amber-500 text-amber-700",
  // Legacy statuses kept for safety on old rows
  Submitted: "border-blue-500 text-blue-700",
  Rejected: "border-red-500 text-red-700",
  Superseded: "border-zinc-400 text-zinc-500",
};

// Report type labels — the four active report types plus the legacy types
// (defensive: old rows keep their correct label instead of a wrong fallback).
const REPORT_TYPE_LABEL: Record<string, { label: string; color: string }> = {
  PIPELINE_DPT:       { label: "Penetrant Testing",      color: "border-purple-500 text-purple-700" },
  PIPELINE_MPT:       { label: "Particle Testing",       color: "border-orange-500 text-orange-700" },
  PIPELINE_WELD_SCAN: { label: "Weld Scan",              color: "border-cyan-500 text-cyan-700" },
  PIPELINE_THICKNESS: { label: "Thickness Measurement",  color: "border-emerald-500 text-emerald-700" },
  // Legacy types (no longer creatable but may exist on old rows)
  PIPELINE_VISUAL:    { label: "Visual",                 color: "border-blue-500 text-blue-700" },
  PIPELINE_CONDITION: { label: "Condition",              color: "border-amber-500 text-amber-700" },
};

// The active report types offered in the type filter (mirrors the report
// type selector).
const ACTIVE_TYPES: Array<{ value: string; label: string }> = [
  { value: "PIPELINE_DPT", label: "Penetrant Testing" },
  { value: "PIPELINE_MPT", label: "Particle Testing" },
  { value: "PIPELINE_WELD_SCAN", label: "Weld Scan" },
  { value: "PIPELINE_THICKNESS", label: "Thickness Measurement" },
];

export function ReportHistoryView() {
  const { user, openPipelineReport, openEditPipelineReport, refreshKey } = useAppStore();

  const [items, setItems] = useState<ReportHistoryItem[]>([]);
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [clientId, setClientId] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [equipmentFilter, setEquipmentFilter] = useState("");

  useEffect(() => {
    apiFetch<{ items: ClientItem[] }>("/api/clients")
      .then((r) => setClients(r.items))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let mounted = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const params = new URLSearchParams({ q, pageSize: "100" });
    if (clientId) params.set("clientId", clientId);
    if (statusFilter) params.set("status", statusFilter);
    if (typeFilter) params.set("reportType", typeFilter);
    if (equipmentFilter) params.set("equipmentType", equipmentFilter);
    void apiFetch<{ items: ReportHistoryItem[] }>(`/api/pipeline-inspections?${params.toString()}`)
      .then((r) => {
        if (!mounted) return;
        setItems(r.items);
      })
      .catch(() => {})
      .finally(() => {
        if (!mounted) return;
        setLoading(false);
      });
    return () => { mounted = false; };
  }, [q, clientId, statusFilter, typeFilter, equipmentFilter, refreshKey]);

  // Role-based permissions — same model as the report detail view.
  const isAdmin = user?.dashboardRole === "ADMIN";
  function canEdit(r: ReportHistoryItem) {
    if (!user) return false;
    if (isAdmin) return true;
    const isOwner = r.inspectorId === user.id;
    return isOwner && (r.status === "Draft" || r.status === "Returned for Revision");
  }
  function canReview(r: ReportHistoryItem) {
    return (
      isAdmin &&
      (r.status === "Submitted for Review" || r.status === "Changes Pending Review")
    );
  }

  async function downloadPdf(r: ReportHistoryItem) {
    try {
      // Same download flow as the report detail view: fetch with the
      // Authorization header so auth succeeds, then save the blob.
      const token = typeof window !== "undefined" ? window.localStorage.getItem("ira_session_token") : null;
      const res = await fetch(`/api/pipeline-inspections/${r.id}/pdf?orientation=landscape`, {
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Download failed (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Inspection_Report_${r.reportNumber.replace(/[^a-zA-Z0-9-]/g, "_")}_landscape.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Downloaded PDF for ${r.reportNumber}`);
    } catch (e) {
      const err = e as Error;
      toast.error(`PDF download failed: ${err.message}`);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <History className="h-6 w-6 text-amber-600" /> Report History
          </h1>
          <p className="text-sm text-muted-foreground">
            All reports created through the report creation workflow, newest
            first. Every report you create appears here automatically.
          </p>
        </div>
      </div>

      {/* Search & filters */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
            <div>
              <Label className="text-xs">Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Report no., client, component..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Client</Label>
              <Select value={clientId || "ALL"} onValueChange={(v) => setClientId(v === "ALL" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="All clients" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All clients</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Equipment Type</Label>
              <Select value={equipmentFilter || "ALL"} onValueChange={(v) => setEquipmentFilter(v === "ALL" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="All equipment" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All equipment</SelectItem>
                  <SelectItem value="PIPING">Piping</SelectItem>
                  <SelectItem value="VESSEL">Vessel</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Report Type</Label>
              <Select value={typeFilter || "ALL"} onValueChange={(v) => setTypeFilter(v === "ALL" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="All types" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All types</SelectItem>
                  {ACTIVE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={statusFilter || "ALL"} onValueChange={(v) => setStatusFilter(v === "ALL" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="All statuses" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All statuses</SelectItem>
                  <SelectItem value="Draft">Draft</SelectItem>
                  <SelectItem value="Submitted for Review">Submitted for Review</SelectItem>
                  <SelectItem value="Returned for Revision">Returned for Revision</SelectItem>
                  <SelectItem value="Approved">Approved</SelectItem>
                  <SelectItem value="Changes Pending Review">Changes Pending Review</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* History table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" /> Reports
          </CardTitle>
          <CardDescription>
            Live data from the report workflow — no sample records.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading && (
            <div className="flex items-center gap-2 p-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading report history...
            </div>
          )}
          {!loading && items.length === 0 && (
            <p className="p-8 text-center text-muted-foreground text-sm">
              No reports found. Reports created through{" "}
              <strong>Pipeline Reports → New Pipeline Report</strong> appear here
              automatically.
            </p>
          )}
          {!loading && items.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Report No.</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Equipment</TableHead>
                    <TableHead>Equipment / Component</TableHead>
                    <TableHead>Report Type</TableHead>
                    <TableHead>From Date</TableHead>
                    <TableHead>To Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((r) => {
                    const typeInfo = REPORT_TYPE_LABEL[r.reportType];
                    const fromDate = r.fromDate ?? r.inspectionDate;
                    const toDate = r.toDate ?? r.inspectionDate;
                    return (
                      <TableRow
                        key={r.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => openPipelineReport(r.id)}
                      >
                        <TableCell className="font-mono text-xs">
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3 text-muted-foreground" />
                            {r.reportNumber}
                          </div>
                          {r.revisionNumber > 1 && (
                            <div className="text-[10px] text-muted-foreground">rev {r.revisionNumber}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          <div>{r.client.name}</div>
                          <div className="text-muted-foreground">{r.plant.name}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-[10px] ${r.equipmentType === "VESSEL" ? "border-sky-500 text-sky-700" : "border-emerald-500 text-emerald-700"}`}>
                            {r.equipmentType === "VESSEL" ? "Vessel" : "Piping"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs max-w-[240px]">
                          <div className="truncate">
                            {r.inspectionArea || r.pipelineDescription || "—"}
                          </div>
                          {(r.pipelineIdentificationNumber || r.isometricDrawingNumber) && (
                            <div className="text-muted-foreground font-mono truncate">
                              {r.pipelineIdentificationNumber ?? ""}
                              {r.isometricDrawingNumber ? ` · ${r.isometricDrawingNumber}` : ""}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {typeInfo ? (
                            <Badge variant="outline" className={`text-[10px] ${typeInfo.color}`}>
                              {typeInfo.label}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">{r.reportType}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          {new Date(fromDate).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          {new Date(toDate).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={STATUS_COLOR[r.status] ?? ""}>
                            {r.status}
                          </Badge>
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              title="View report"
                              onClick={() => openPipelineReport(r.id)}
                            >
                              <Eye className="mr-1 h-3 w-3" /> View
                            </Button>
                            {canEdit(r) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                title="Edit report"
                                onClick={() => openEditPipelineReport(r.id)}
                              >
                                <Pencil className="mr-1 h-3 w-3" /> Edit
                              </Button>
                            )}
                            {canReview(r) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-blue-700"
                                title="Review / Approve / Return in report detail"
                                onClick={() => openPipelineReport(r.id)}
                              >
                                <ShieldCheck className="mr-1 h-3 w-3" /> Review
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              title="Download PDF"
                              onClick={() => downloadPdf(r)}
                            >
                              <Download className="mr-1 h-3 w-3" /> PDF
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
