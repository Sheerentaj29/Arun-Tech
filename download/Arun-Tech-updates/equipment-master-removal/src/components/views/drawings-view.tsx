"use client";

import { useEffect, useState, useCallback } from "react";
import {
  PenTool,
  Plus,
  Download,
  Trash2,
  Loader2,
  Search,
  FileText,
  Eye,
  ChevronRight,
  AlertTriangle,
  Upload,
  X,
  History,
  ShieldCheck,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useAppStore } from "@/lib/store";
import { apiFetch } from "@/lib/api-client";
import { toast } from "sonner";

interface DrawingItem {
  id: string;
  title: string;
  drawingNumber: string;
  drawingType: string;
  description: string | null;
  clientId: string;
  plantId: string | null;
  activeRevisionId: string | null;
  createdAt: string;
  updatedAt: string;
  client: { id: string; name: string };
  plant: { id: string; name: string; location: string | null } | null;
  revisions: Array<{
    id: string;
    revisionNumber: string;
    fileName: string;
    fileSize: number;
    fileExtension: string;
    mimeType: string;
    isActive: boolean;
    uploadedByName: string | null;
    createdAt: string;
    notes: string | null;
  }>;
  _count: { revisions: number; inspectionLinks: number };
}

interface ClientItem {
  id: string;
  name: string;
  plants: Array<{ id: string; name: string; location: string | null }>;
}

const DRAWING_TYPES = [
  "Plant Layout",
  "Piping and Instrumentation Diagram (P&ID)",
  "Isometric Drawing",
  "Pipeline Layout",
  "Equipment General Arrangement Drawing",
  "Mechanical Drawing",
  "Structural Drawing",
  "Electrical Drawing",
  "Instrumentation Drawing",
  "Other",
];

const ALLOWED_EXTENSIONS = [".dwg", ".dxf", ".dwt", ".dws", ".pdf", ".png", ".jpg", ".jpeg", ".tiff", ".tif"];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DrawingsView() {
  const { user, refreshKey, refresh } = useAppStore();
  const isAdmin = user?.dashboardRole === "ADMIN";

  const [drawings, setDrawings] = useState<DrawingItem[]>([]);
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [clientIdFilter, setClientIdFilter] = useState("");
  const [drawingTypeFilter, setDrawingTypeFilter] = useState("");

  // Upload dialog state
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    title: "",
    drawingNumber: "",
    drawingType: "Isometric Drawing",
    clientId: "",
    plantId: "",
    revisionNumber: "Rev 0",
    description: "",
    notes: "",
  });
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Detail dialog state
  const [detailDrawing, setDetailDrawing] = useState<DrawingItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Revision upload dialog state
  const [revUploadOpen, setRevUploadOpen] = useState(false);
  const [revUploadFile, setRevUploadFile] = useState<File | null>(null);
  const [revUploadNumber, setRevUploadNumber] = useState("");
  const [revUploading, setRevUploading] = useState(false);

  // Preview dialog state
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewNotSupported, setPreviewNotSupported] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ q });
    if (clientIdFilter) params.set("clientId", clientIdFilter);
    if (drawingTypeFilter) params.set("drawingType", drawingTypeFilter);
    apiFetch<{ items: DrawingItem[] }>(`/api/drawings?${params.toString()}`)
      .then((r) => setDrawings(r.items))
      .catch(() => toast.error("Failed to load drawings"))
      .finally(() => setLoading(false));
  }, [q, clientIdFilter, drawingTypeFilter]);

  useEffect(() => {
    apiFetch<{ items: ClientItem[] }>("/api/clients")
      .then((r) => setClients(r.items))
      .catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const plantsForClient = clients.find((c) => c.id === uploadForm.clientId)?.plants ?? [];

  async function handleUpload() {
    if (!uploadFile) { toast.error("Please select a file"); return; }
    if (!uploadForm.title.trim()) { toast.error("Drawing title is required"); return; }
    if (!uploadForm.drawingNumber.trim()) { toast.error("Drawing number is required"); return; }
    if (!uploadForm.clientId) { toast.error("Client is required"); return; }

    setUploading(true);
    setUploadProgress(0);
    try {
      const fd = new FormData();
      fd.append("file", uploadFile);
      fd.append("title", uploadForm.title.trim());
      fd.append("drawingNumber", uploadForm.drawingNumber.trim());
      fd.append("drawingType", uploadForm.drawingType);
      fd.append("clientId", uploadForm.clientId);
      if (uploadForm.plantId) fd.append("plantId", uploadForm.plantId);
      fd.append("revisionNumber", uploadForm.revisionNumber || "Rev 0");
      if (uploadForm.description) fd.append("description", uploadForm.description);
      if (uploadForm.notes) fd.append("notes", uploadForm.notes);

      const res = await fetch("/api/drawings", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Upload failed");
      }
      toast.success(`Uploaded "${uploadFile.name}"`);
      setUploadOpen(false);
      setUploadFile(null);
      setUploadForm({ title: "", drawingNumber: "", drawingType: "Isometric Drawing", clientId: "", plantId: "", revisionNumber: "Rev 0", description: "", notes: "" });
      refresh();
      load();
    } catch (e) {
      const err = e as Error;
      toast.error(err.message);
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }

  async function handleDelete(id: string, drawingNumber: string) {
    try {
      await apiFetch(`/api/drawings/${id}`, { method: "DELETE" });
      toast.success(`Deleted drawing ${drawingNumber}`);
      refresh();
      load();
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message ?? "Delete failed");
    }
  }

  async function handleDownload(id: string) {
    window.open(`/api/drawings/${id}/download`, "_blank");
  }

  async function handlePreview(drawing: DrawingItem) {
    const activeRev = drawing.revisions.find(r => r.isActive) ?? drawing.revisions[0];
    if (!activeRev) return;

    const ext = activeRev.fileExtension.toLowerCase();
    const isPreviewable = [".pdf", ".png", ".jpg", ".jpeg", ".tiff", ".tif"].includes(ext);

    if (!isPreviewable) {
      setPreviewNotSupported(`Preview is not available for ${ext} files. Please download the original file.`);
      setPreviewTitle(`${drawing.drawingNumber} — ${activeRev.fileName}`);
      setPreviewUrl(null);
      return;
    }

    // For previewable formats, open the preview endpoint
    setPreviewNotSupported(null);
    setPreviewTitle(`${drawing.drawingNumber} — ${activeRev.fileName}`);
    setPreviewUrl(`/api/drawings/${drawing.id}/preview`);
  }

  async function handleRevUpload() {
    if (!detailDrawing) return;
    if (!revUploadFile) { toast.error("Please select a file"); return; }
    if (!revUploadNumber.trim()) { toast.error("Revision number is required"); return; }

    setRevUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", revUploadFile);
      fd.append("title", detailDrawing.title);
      fd.append("drawingNumber", detailDrawing.drawingNumber);
      fd.append("drawingType", detailDrawing.drawingType);
      fd.append("clientId", detailDrawing.clientId);
      fd.append("revisionNumber", revUploadNumber.trim());
      if (detailDrawing.plantId) fd.append("plantId", detailDrawing.plantId);

      const res = await fetch("/api/drawings", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Upload failed");
      }
      toast.success(`Uploaded revision ${revUploadNumber}`);
      setRevUploadOpen(false);
      setRevUploadFile(null);
      setRevUploadNumber("");
      refresh();
      load();
      // Reload detail
      const updated = await apiFetch<DrawingItem>(`/api/drawings/${detailDrawing.id}`);
      setDetailDrawing(updated);
    } catch (e) {
      const err = e as Error;
      toast.error(err.message);
    } finally {
      setRevUploading(false);
    }
  }

  function openDetail(drawing: DrawingItem) {
    setDetailDrawing(drawing);
    setDetailOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <PenTool className="h-6 w-6 text-amber-600" /> Engineering Drawings
          </h1>
          <p className="text-sm text-muted-foreground">
            Upload, manage, and download AutoCAD drawings, isometrics, P&IDs, and other engineering documents.
          </p>
        </div>
        <Button onClick={() => setUploadOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Upload Drawing
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search title, number..." value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Select value={clientIdFilter || "ALL"} onValueChange={(v) => setClientIdFilter(v === "ALL" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="All clients" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All clients</SelectItem>
                {clients.map((c) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={drawingTypeFilter || "ALL"} onValueChange={(v) => setDrawingTypeFilter(v === "ALL" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="All types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All types</SelectItem>
                {DRAWING_TYPES.map((t) => (<SelectItem key={t} value={t}>{t}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Drawings table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Drawings ({drawings.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center gap-2 p-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading drawings...
            </div>
          ) : drawings.length === 0 ? (
            <p className="p-8 text-center text-muted-foreground text-sm">
              No drawings found. Click "Upload Drawing" to add one.
            </p>
          ) : (
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-muted">
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Drawing #</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>File</TableHead>
                    <TableHead>Revs</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {drawings.map((d) => {
                    const activeRev = d.revisions[0];
                    return (
                      <TableRow key={d.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openDetail(d)}>
                        <TableCell>
                          <div className="font-medium text-sm">{d.title}</div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{d.drawingNumber}</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{d.drawingType}</Badge></TableCell>
                        <TableCell className="text-xs">{d.client.name}</TableCell>
                        <TableCell className="text-xs">
                          {activeRev ? (
                            <div>
                              <Badge variant="outline" className="text-[10px] uppercase">{activeRev.fileExtension}</Badge>
                              <div className="text-muted-foreground">{formatBytes(activeRev.fileSize)}</div>
                            </div>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-center tabular-nums">{d._count.revisions}</TableCell>
                        <TableCell>
                          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handlePreview(d)} title="Preview">
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleDownload(d.id)} title="Download">
                              <Download className="h-3.5 w-3.5" />
                            </Button>
                            {isAdmin && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-600" title="Delete">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete drawing {d.drawingNumber}?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This permanently deletes the drawing, all its revisions, and all file copies on disk. This cannot be undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleDelete(d.id, d.drawingNumber)} className="bg-red-600">
                                      Delete
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
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

      {/* Upload Dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Upload Engineering Drawing</DialogTitle>
            <DialogDescription>
              Upload AutoCAD drawings, isometrics, P&IDs, or other engineering documents.
              Supported formats: {ALLOWED_EXTENSIONS.join(", ")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2 col-span-2">
              <Label>Drawing File *</Label>
              <div className="border-2 border-dashed border-zinc-300 rounded-md p-4 text-center cursor-pointer hover:border-amber-400"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files[0]) setUploadFile(e.dataTransfer.files[0]); }}
                onClick={() => { const input = document.createElement("input"); input.type = "file"; input.accept = ALLOWED_EXTENSIONS.join(","); input.onchange = (e) => { const t = e.target as HTMLInputElement; if (t.files?.[0]) setUploadFile(t.files[0]); }; input.click(); }}
              >
                {uploadFile ? (
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{uploadFile.name} ({formatBytes(uploadFile.size)})</span>
                    <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setUploadFile(null); }}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <Upload className="mx-auto h-6 w-6 text-muted-foreground mb-1" />
                    <p className="text-sm text-muted-foreground">Drag and drop or click to select</p>
                  </>
                )}
              </div>
            </div>
            <div className="space-y-2"><Label>Drawing Title *</Label><Input value={uploadForm.title} onChange={(e) => setUploadForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Steam Line Isometric" /></div>
            <div className="space-y-2"><Label>Drawing Number *</Label><Input value={uploadForm.drawingNumber} onChange={(e) => setUploadForm(f => ({ ...f, drawingNumber: e.target.value.toUpperCase() }))} placeholder="e.g. ISO-PIPE-001" className="font-mono" /></div>
            <div className="space-y-2">
              <Label>Drawing Type *</Label>
              <Select value={uploadForm.drawingType} onValueChange={(v) => setUploadForm(f => ({ ...f, drawingType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DRAWING_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Revision</Label><Input value={uploadForm.revisionNumber} onChange={(e) => setUploadForm(f => ({ ...f, revisionNumber: e.target.value }))} placeholder="Rev 0" /></div>
            <div className="space-y-2">
              <Label>Client *</Label>
              <Select value={uploadForm.clientId} onValueChange={(v) => setUploadForm(f => ({ ...f, clientId: v, plantId: "" }))}>
                <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Plant</Label>
              <Select value={uploadForm.plantId || "NONE"} onValueChange={(v) => setUploadForm(f => ({ ...f, plantId: v === "NONE" ? "" : v }))} disabled={!uploadForm.clientId}>
                <SelectTrigger><SelectValue placeholder="Select plant" /></SelectTrigger>
                <SelectContent><SelectItem value="NONE">—</SelectItem>{plantsForClient.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2 col-span-2"><Label>Description</Label><Textarea rows={2} value={uploadForm.description} onChange={(e) => setUploadForm(f => ({ ...f, description: e.target.value }))} /></div>
            <div className="space-y-2 col-span-2"><Label>Notes</Label><Textarea rows={1} value={uploadForm.notes} onChange={(e) => setUploadForm(f => ({ ...f, notes: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setUploadOpen(false)}>Cancel</Button>
            <Button onClick={handleUpload} disabled={uploading || !uploadFile}>
              {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {detailDrawing && (
            <>
              <DialogHeader>
                <DialogTitle>{detailDrawing.title}</DialogTitle>
                <DialogDescription>
                  <span className="font-mono">{detailDrawing.drawingNumber}</span> · {detailDrawing.drawingType}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-muted-foreground">Client:</span> {detailDrawing.client.name}</div>
                  <div><span className="text-muted-foreground">Plant:</span> {detailDrawing.plant?.name ?? "—"}</div>
                  {detailDrawing.description && <div className="col-span-2"><span className="text-muted-foreground">Description:</span> {detailDrawing.description}</div>}
                </div>

                {/* Revisions */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold flex items-center gap-1"><History className="h-4 w-4" /> Revisions ({detailDrawing.revisions.length})</h3>
                    <Button size="sm" variant="outline" onClick={() => setRevUploadOpen(true)}>
                      <Plus className="mr-1 h-3 w-3" /> New Revision
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {detailDrawing.revisions.map((rev) => (
                      <div key={rev.id} className={`flex items-center justify-between rounded-md border p-2 ${rev.isActive ? "border-emerald-400 bg-emerald-50/50" : ""}`}>
                        <div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="font-mono">{rev.revisionNumber}</Badge>
                            {rev.isActive && <Badge variant="outline" className="border-emerald-500 text-emerald-700"><ShieldCheck className="mr-1 h-3 w-3" /> Active</Badge>}
                            <Badge variant="outline" className="text-[10px] uppercase">{rev.fileExtension}</Badge>
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {rev.fileName} · {formatBytes(rev.fileSize)} · {rev.uploadedByName ?? "—"} · {new Date(rev.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => window.open(`/api/drawings/${detailDrawing.id}/revisions/${rev.id}/download`, "_blank")}>
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Linked inspections */}
                {detailDrawing._count.inspectionLinks > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold mb-1">Linked Inspection Reports ({detailDrawing._count.inspectionLinks})</h3>
                    <p className="text-xs text-muted-foreground">This drawing is attached to inspection reports.</p>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Revision Upload Dialog */}
      <Dialog open={revUploadOpen} onOpenChange={setRevUploadOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Upload New Revision</DialogTitle>
            <DialogDescription>Upload a new revision of "{detailDrawing?.title}". Previous revisions remain accessible.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Revision Number</Label>
              <Input value={revUploadNumber} onChange={(e) => setRevUploadNumber(e.target.value)} placeholder="e.g. Rev 1" />
            </div>
            <div className="space-y-2">
              <Label>Drawing File</Label>
              <div className="border-2 border-dashed border-zinc-300 rounded-md p-4 text-center cursor-pointer hover:border-amber-400"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files[0]) setRevUploadFile(e.dataTransfer.files[0]); }}
                onClick={() => { const input = document.createElement("input"); input.type = "file"; input.accept = ALLOWED_EXTENSIONS.join(","); input.onchange = (e) => { const t = e.target as HTMLInputElement; if (t.files?.[0]) setRevUploadFile(t.files[0]); }; input.click(); }}
              >
                {revUploadFile ? (
                  <span className="text-sm font-medium">{revUploadFile.name} ({formatBytes(revUploadFile.size)})</span>
                ) : (
                  <><Upload className="mx-auto h-5 w-5 text-muted-foreground mb-1" /><p className="text-sm text-muted-foreground">Select file</p></>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRevUploadOpen(false)}>Cancel</Button>
            <Button onClick={handleRevUpload} disabled={revUploading || !revUploadFile}>
              {revUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Upload Revision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={!!previewUrl || !!previewNotSupported} onOpenChange={() => { setPreviewUrl(null); setPreviewNotSupported(null); }}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader><DialogTitle>{previewTitle}</DialogTitle></DialogHeader>
          {previewNotSupported ? (
            <Alert className="border-amber-300 bg-amber-50">
              <AlertTriangle className="h-4 w-4 text-amber-700" />
              <AlertTitle className="text-amber-900">Preview not available</AlertTitle>
              <AlertDescription className="text-amber-900">{previewNotSupported}</AlertDescription>
            </Alert>
          ) : previewUrl ? (
            <div className="flex-1 overflow-auto">
              {previewUrl.includes(".pdf") || previewUrl.includes("pdf") ? (
                <iframe src={previewUrl} className="w-full h-[70vh] border-0" title="Drawing Preview" />
              ) : (
                <img src={previewUrl} alt={previewTitle} className="max-w-full max-h-[70vh] mx-auto" />
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
