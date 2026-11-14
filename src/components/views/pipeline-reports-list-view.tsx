"use client";

import { useEffect, useState } from "react";
import {
  History,
  Plus,
  Search,
  Loader2,
  FileText,
  Calendar,
  User as UserIcon,
  ShieldCheck,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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

interface PipelineReportListItem {
  id: string;
  reportNumber: string;
  reportType: "PIPELINE_THICKNESS" | "PIPELINE_VISUAL" | "PIPELINE_CONDITION" | "PIPELINE_DPT" | "PIPELINE_MPT" | "PIPELINE_WELD_SCAN" | "VESSEL_DPT" | "VESSEL_MPT" | "VESSEL_WELD_SCAN" | "VESSEL_UTM" | "TANK_DPT" | "TANK_MPT" | "TANK_WELD_SCAN" | "TANK_UTM";
  inspectionDate: string;
  status: "Draft" | "Submitted" | "Approved" | "Rejected" | "Superseded";
  revisionNumber: number;
  pipelineDescription: string | null;
  pipelineIdentificationNumber: string | null;
  isometricDrawingNumber: string | null;
  materialOfConstruction: string | null;
  isDemo: boolean;
  client: { id: string; name: string };
  plant: { id: string; name: string; location: string | null };
  inspector: { id: string; name: string };
  approver: { id: string; name: string } | null;
  _count: { measurements: number; revisions: number; visualObservations: number };
}

interface ClientItem {
  id: string;
  name: string;
  plants: Array<{ id: string; name: string; location: string | null }>;
}

const STATUS_COLOR: Record<string, string> = {
  Draft: "border-zinc-400 text-zinc-600",
  "Submitted for Review": "border-blue-500 text-blue-700",
  "Returned for Revision": "border-red-500 text-red-700",
  Approved: "border-emerald-500 text-emerald-700",
  "Changes Pending Review": "border-amber-500 text-amber-700",
  // Legacy statuses (shouldn't appear after migration but kept for safety)
  Submitted: "border-blue-500 text-blue-700",
  Rejected: "border-red-500 text-red-700",
  Superseded: "border-zinc-400 text-zinc-500",
};

const REPORT_TYPE_LABEL: Record<string, { label: string; color: string }> = {
  PIPELINE_THICKNESS: { label: "Thickness", color: "border-emerald-500 text-emerald-700" },
  PIPELINE_VISUAL:    { label: "Visual",    color: "border-blue-500 text-blue-700" },
  PIPELINE_CONDITION: { label: "Condition", color: "border-amber-500 text-amber-700" },
  PIPELINE_DPT:       { label: "DPT/DPPT", color: "border-purple-500 text-purple-700" },
  PIPELINE_MPT:       { label: "MPT",      color: "border-orange-500 text-orange-700" },
  PIPELINE_WELD_SCAN: { label: "Weld Scan", color: "border-cyan-500 text-cyan-700" },
  VESSEL_DPT:         { label: "Vessel DPT", color: "border-purple-500 text-purple-700" },
  VESSEL_MPT:         { label: "Vessel MPT", color: "border-orange-500 text-orange-700" },
  VESSEL_WELD_SCAN:   { label: "Vessel Weld Scan", color: "border-cyan-500 text-cyan-700" },
  VESSEL_UTM:         { label: "Vessel UT Thickness", color: "border-emerald-500 text-emerald-700" },
  TANK_DPT:           { label: "Tank DPT", color: "border-fuchsia-500 text-fuchsia-700" },
  TANK_MPT:           { label: "Tank MPT", color: "border-amber-500 text-amber-700" },
  TANK_WELD_SCAN:     { label: "Tank Weld Scan", color: "border-sky-500 text-sky-700" },
  TANK_UTM:           { label: "Tank UT Thickness", color: "border-teal-500 text-teal-700" },
};

export function PipelineReportsListView() {
  const { user, openPipelineReport, openNewPipelineReport, refreshKey } = useAppStore();
  // Any authenticated user (admin or employee) can create reports — they
  // become the inspector of record.
  const canCreate = !!user;

  const [items, setItems] = useState<PipelineReportListItem[]>([]);
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [clientId, setClientId] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

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
    void apiFetch<{ items: PipelineReportListItem[] }>(`/api/pipeline-inspections?${params.toString()}`)
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
  }, [q, clientId, statusFilter, refreshKey]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <History className="h-6 w-6 text-amber-600" /> Report History
          </h1>
          <p className="text-sm text-muted-foreground">
            Previously created piping and vessel inspection reports — drafts,
            reports submitted for review, returned reports, and approved reports.
            Click <strong>New Inspection Report</strong> to pick the equipment
            type and test type, then start a new inspection.
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => openNewPipelineReport()}>
            <Plus className="mr-2 h-4 w-4" /> New Inspection Report
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <Label className="text-xs">Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Report #, pipeline, isometric..."
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

      <Card>
        <CardContent className="p-0">
          {loading && (
            <div className="flex items-center gap-2 p-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading reports...
            </div>
          )}
          {!loading && items.length === 0 && (
            <div className="p-8 text-center text-muted-foreground text-sm">
              No reports found. Click <strong>New Inspection Report</strong> to create one.
            </div>
          )}
          {!loading && items.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Report #</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Plant / Location</TableHead>
                    <TableHead>Pipeline</TableHead>
                    <TableHead>MOC</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Inspector</TableHead>
                    <TableHead className="text-center">Points</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((r) => {
                    const typeInfo = REPORT_TYPE_LABEL[r.reportType] ?? REPORT_TYPE_LABEL.PIPELINE_THICKNESS;
                    // Points counter: thickness uses measurements, visual uses visualObservations,
                    // condition has no rows (shows "—")
                    const pointsCount =
                      r.reportType === "PIPELINE_THICKNESS" ? r._count.measurements :
                      r.reportType === "PIPELINE_VISUAL" ? r._count.visualObservations :
                      null;
                    return (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => openPipelineReport(r.id)}
                    >
                      <TableCell className="font-mono text-xs">
                        {r.reportNumber}
                        {r.isDemo && (
                          <Badge variant="outline" className="ml-1 text-[10px]">DEMO</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] ${typeInfo.color}`}>
                          {typeInfo.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{r.client.name}</TableCell>
                      <TableCell className="text-xs">
                        <div>{r.plant.name}</div>
                        <div className="text-muted-foreground">{r.plant.location ?? "—"}</div>
                      </TableCell>
                      <TableCell className="text-xs max-w-[260px]">
                        <div className="truncate">{r.pipelineDescription ?? "—"}</div>
                        <div className="text-muted-foreground font-mono">
                          {r.pipelineIdentificationNumber ?? ""}
                          {r.isometricDrawingNumber ? ` · ${r.isometricDrawingNumber}` : ""}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">{r.materialOfConstruction ?? "—"}</TableCell>
                      <TableCell className="text-xs">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3 text-muted-foreground" />
                          {new Date(r.inspectionDate).toLocaleDateString()}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="flex items-center gap-1">
                          <UserIcon className="h-3 w-3 text-muted-foreground" />
                          {r.inspector.name}
                        </div>
                      </TableCell>
                      <TableCell className="text-center tabular-nums">
                        {pointsCount === null ? "—" : pointsCount}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={STATUS_COLOR[r.status] ?? ""}>
                          {r.status}
                        </Badge>
                        {r.status === "Approved" && r.approver && (
                          <div className="mt-0.5 flex items-center gap-1 text-[10px] text-emerald-700">
                            <ShieldCheck className="h-2.5 w-2.5" /> rev {r.revisionNumber}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
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

      <Card className="border-amber-300 bg-amber-50">
        <CardContent className="flex items-start gap-3 p-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700 mt-0.5" />
          <p className="text-xs text-amber-900">
            <strong>Reference standards:</strong> All nominal wall thickness values
            are sourced from publicly published ASME B36.10M / B36.19M reference
            tables and are marked <code className="rounded bg-amber-100 px-1">UNVERIFIED</code> until
            an authorized administrator confirms them against the licensed / official
            ASME standard edition. The third column (Nominal Thickness) is a
            dimensional reference value — it is <em>distinct from</em> the
            measured remaining wall thickness and is not, by itself, an
            inspection pass / fail criterion.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
