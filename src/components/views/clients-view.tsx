"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Building2,
  Factory,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  ChevronDown,
  ChevronRight,
  Database,
  Mail,
  Phone,
  MapPin,
  ImagePlus,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { AuthImage } from "@/components/auth-image";
import { resolveClientLogo } from "@/lib/client-logo-mapping";
import { toast } from "sonner";

// Client logo upload constraints (mirrors the server-side limits in
// /api/clients/[id]/logo). Only the four formats required for client
// logos are accepted by the UI; the API additionally tolerates GIF.
const LOGO_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const LOGO_ACCEPT = "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp";

function isSupportedLogoFile(f: File): boolean {
  const typeOk = f.type === "image/png" || f.type === "image/jpeg" || f.type === "image/webp";
  const extOk = /\.(png|jpe?g|webp)$/i.test(f.name);
  return typeOk && extOk;
}

interface PlantItem {
  id: string;
  name: string;
  location: string | null;
  address: string | null;
  isDemo: boolean;
}

interface ClientItem {
  id: string;
  name: string;
  industry: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  notes: string | null;
  // Server-side path of the client's uploaded logo file (null when the
  // client has no logo of its own). The path itself is not rendered —
  // the logo is fetched via GET /api/clients/{id}/logo.
  logoPath: string | null;
  isDemo: boolean;
  plants: PlantItem[];
  // NOTE: Equipment Master was removed from the application. The clients
  // API may still return an equipment count for legacy data, but the UI
  // no longer displays equipment anywhere.
}

interface ClientForm {
  id?: string;
  name: string;
  industry: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  notes: string;
}

interface PlantForm {
  id?: string;
  clientId: string;
  name: string;
  location: string;
  address: string;
  notes: string;
}

const EMPTY_CLIENT: ClientForm = {
  name: "",
  industry: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  address: "",
  notes: "",
};

const EMPTY_PLANT: PlantForm = {
  clientId: "",
  name: "",
  location: "",
  address: "",
  notes: "",
};

export function ClientsView() {
  const { user, refreshKey, refresh } = useAppStore();
  const isAdmin = user?.role === "ADMIN";

  const [clients, setClients] = useState<ClientItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Client dialog
  const [clientOpen, setClientOpen] = useState(false);
  const [clientForm, setClientForm] = useState<ClientForm>(EMPTY_CLIENT);
  const [savingClient, setSavingClient] = useState(false);

  // Plant dialog
  const [plantOpen, setPlantOpen] = useState(false);
  const [plantForm, setPlantForm] = useState<PlantForm>(EMPTY_PLANT);
  const [savingPlant, setSavingPlant] = useState(false);

  // Client logo (per-client upload) — New/Edit dialog state.
  //   logoFile        the pending File selected in this dialog session
  //                   (not yet uploaded; persisted only after save)
  //   logoPreview     object URL for the immediate preview of logoFile
  //   dialogLogoPath  mirror of the client's stored logo (edit mode);
  //                   cleared when the logo is removed while the dialog
  //                   is open
  //   logoVersion     bumped after every upload/removal so AuthImage
  //                   re-fetches the logo instead of showing a stale one
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [dialogLogoPath, setDialogLogoPath] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoVersion, setLogoVersion] = useState(0);
  const logoFileInputRef = useRef<HTMLInputElement | null>(null);
  const logoPreviewRef = useRef<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<{ items: ClientItem[] }>("/api/clients")
      .then((r) => {
        setClients(r.items);
        // auto-expand the first client
        if (r.items.length > 0 && expanded.size === 0) {
          setExpanded(new Set([r.items[0].id]));
        }
      })
      .catch(() => toast.error("Failed to load clients"))
      .finally(() => setLoading(false));
  }, [expanded.size]);

  useEffect(() => {
    load();
  }, [refreshKey]);

  function toggle(id: string) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ---------- Client handlers ----------
  function openNewClient() {
    setClientForm(EMPTY_CLIENT);
    clearLogoSelection();
    setDialogLogoPath(null);
    setClientOpen(true);
  }
  function openEditClient(c: ClientItem) {
    setClientForm({
      id: c.id,
      name: c.name,
      industry: c.industry ?? "",
      contactName: c.contactName ?? "",
      contactEmail: c.contactEmail ?? "",
      contactPhone: c.contactPhone ?? "",
      address: c.address ?? "",
      notes: c.notes ?? "",
    });
    clearLogoSelection();
    setDialogLogoPath(c.logoPath ?? null);
    setClientOpen(true);
  }

  // ---------- Client logo helpers ----------
  /** Revoke the pending preview URL and clear the pending selection. */
  function clearLogoSelection() {
    if (logoPreviewRef.current) {
      URL.revokeObjectURL(logoPreviewRef.current);
      logoPreviewRef.current = null;
    }
    setLogoFile(null);
    setLogoPreview(null);
  }

  /** Validate + stage a newly selected logo file with instant preview. */
  function handleLogoFileSelected(f: File | null | undefined) {
    if (!f) return;
    if (!isSupportedLogoFile(f)) {
      toast.error("Unsupported logo file — please choose a PNG, JPG, JPEG or WebP image");
      return;
    }
    if (f.size > LOGO_MAX_BYTES) {
      toast.error("Logo file too large — the maximum size is 5 MB");
      return;
    }
    if (logoPreviewRef.current) URL.revokeObjectURL(logoPreviewRef.current);
    const url = URL.createObjectURL(f);
    logoPreviewRef.current = url;
    setLogoFile(f);
    setLogoPreview(url);
  }

  /**
   * Remove the logo:
   *  - a pending (not yet saved) selection is simply cleared;
   *  - an already-stored logo is deleted on the server immediately
   *    (the rest of the client record stays intact).
   */
  async function removeClientLogo() {
    if (logoFile) {
      clearLogoSelection();
      return;
    }
    if (!clientForm.id || !dialogLogoPath) return;
    setLogoBusy(true);
    try {
      await apiFetch(`/api/clients/${clientForm.id}/logo`, { method: "DELETE" });
      setDialogLogoPath(null);
      setLogoVersion((v) => v + 1);
      toast.success("Client logo removed");
      load();
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message ?? "Failed to remove logo");
    } finally {
      setLogoBusy(false);
    }
  }

  /** POST the staged logo file to the server (multipart form upload). */
  async function uploadClientLogo(clientId: string, file: File) {
    const token =
      typeof window !== "undefined"
        ? window.localStorage.getItem("ira_session_token")
        : null;
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/clients/${clientId}/logo`, {
      method: "POST",
      body: fd,
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      let msg = `Upload failed (${res.status})`;
      try {
        const j = await res.json();
        if (j?.error) msg = String(j.error);
      } catch { /* keep default message */ }
      throw new Error(msg);
    }
  }

  // Revoke the preview object URL when the view unmounts.
  useEffect(() => () => {
    if (logoPreviewRef.current) URL.revokeObjectURL(logoPreviewRef.current);
  }, []);

  async function saveClient() {
    if (!clientForm.name.trim()) {
      toast.error("Client name is required");
      return;
    }
    setSavingClient(true);
    try {
      let savedId = clientForm.id;
      if (clientForm.id) {
        await apiFetch(`/api/clients/${clientForm.id}`, {
          method: "PUT",
          body: JSON.stringify(clientForm),
        });
        toast.success("Client updated");
      } else {
        const created = await apiFetch<{ id: string }>("/api/clients", {
          method: "POST",
          body: JSON.stringify(clientForm),
        });
        savedId = created.id;
        toast.success("Client created");
      }
      // Persist the staged logo against the (new or existing) client record.
      if (logoFile && savedId) {
        try {
          await uploadClientLogo(savedId, logoFile);
          toast.success("Client logo saved");
        } catch (e) {
          // The client record itself is saved — only the logo failed.
          const err = e as { message?: string };
          toast.error(`Client saved, but the logo upload failed: ${err.message ?? "unknown error"}`);
        }
        clearLogoSelection();
        setLogoVersion((v) => v + 1);
      }
      setClientOpen(false);
      refresh();
      load();
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message ?? "Save failed");
    } finally {
      setSavingClient(false);
    }
  }
  async function deleteClient(c: ClientItem) {
    try {
      await apiFetch(`/api/clients/${c.id}`, { method: "DELETE" });
      toast.success(`Deleted ${c.name}`);
      refresh();
      load();
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message ?? "Delete failed");
    }
  }

  // ---------- Plant handlers ----------
  function openNewPlant(clientId: string) {
    setPlantForm({ ...EMPTY_PLANT, clientId });
    setPlantOpen(true);
  }
  async function savePlant() {
    if (!plantForm.clientId) {
      toast.error("Client is required");
      return;
    }
    if (!plantForm.name.trim()) {
      toast.error("Plant name is required");
      return;
    }
    setSavingPlant(true);
    try {
      await apiFetch("/api/plants", {
        method: "POST",
        body: JSON.stringify(plantForm),
      });
      toast.success("Plant created");
      setPlantOpen(false);
      refresh();
      load();
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message ?? "Save failed");
    } finally {
      setSavingPlant(false);
    }
  }

  if (!isAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Access required</CardTitle>
          <CardDescription>
            Only administrators can manage clients and plants.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Clients &amp; Plants</h1>
          <p className="text-sm text-muted-foreground">
            Manage client companies and the plants where inspections are performed.
          </p>
        </div>
        <Button onClick={openNewClient}>
          <Plus className="mr-2 h-4 w-4" /> New Client
        </Button>
      </div>

      {loading && (
        <div className="p-8 text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </div>
      )}

      {!loading && clients.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No clients registered. Click “New Client” to begin.
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {clients.map((c) => {
          const isOpen = expanded.has(c.id);
          // Logo resolution for this client — same precedence as the
          // report form banner: the client's own uploaded logo first,
          // then the system logo library, then a clean placeholder.
          const uploadedLogoUrl = c.logoPath
            ? `/api/clients/${c.id}/logo?v=${logoVersion}`
            : null;
          const mappedLogoFile = resolveClientLogo(c.name);
          return (
            <Card key={c.id}>
              <Collapsible open={isOpen} onOpenChange={() => toggle(c.id)}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <CollapsibleTrigger asChild>
                      <button className="flex items-center gap-2 text-left">
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-zinc-100 text-zinc-700">
                          {uploadedLogoUrl ? (
                            <AuthImage
                              src={uploadedLogoUrl}
                              alt={`${c.name} logo`}
                              className="max-h-[36px] max-w-[36px] h-auto w-auto object-contain"
                            />
                          ) : mappedLogoFile ? (
                            <AuthImage
                              src={`/api/client-logo/${encodeURIComponent(mappedLogoFile)}`}
                              alt={`${c.name} logo`}
                              className="max-h-[36px] max-w-[36px] h-auto w-auto object-contain"
                            />
                          ) : (
                            <Building2 className="h-5 w-5" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <CardTitle className="text-base">{c.name}</CardTitle>
                            {c.isDemo && (
                              <Badge variant="outline" className="border-zinc-300 text-zinc-500 text-[10px]">DEMO</Badge>
                            )}
                          </div>
                          <CardDescription className="text-xs">
                            {c.industry ?? "Industry not specified"}
                            {" · "}
                            {c.plants.length} plants
                          </CardDescription>
                        </div>
                      </button>
                    </CollapsibleTrigger>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEditClient(c)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete {c.name}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete the client and all its plants.
                              This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deleteClient(c)} className="bg-red-600 hover:bg-red-700">
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </CardHeader>
                <CollapsibleContent>
                  <CardContent className="space-y-3">
                    {/* Client logo + contact info.
                        The logo keeps its original aspect ratio
                        (object-contain) — it is never stretched. */}
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                      <div className="flex shrink-0 flex-col items-center gap-1">
                        <div className="flex h-[70px] w-[140px] items-center justify-center overflow-hidden rounded-md border bg-white">
                          {uploadedLogoUrl ? (
                            <AuthImage
                              src={uploadedLogoUrl}
                              alt={`${c.name} logo`}
                              className="max-h-[62px] max-w-[132px] h-auto w-auto object-contain"
                            />
                          ) : mappedLogoFile ? (
                            <AuthImage
                              src={`/api/client-logo/${encodeURIComponent(mappedLogoFile)}`}
                              alt={`${c.name} logo`}
                              className="max-h-[62px] max-w-[132px] h-auto w-auto object-contain"
                            />
                          ) : (
                            <span className="px-2 text-center text-[10px] leading-tight text-zinc-400">
                              {c.name.length > 20 ? c.name.slice(0, 20) + "…" : c.name}
                              <br />
                              No logo
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Client Logo
                        </span>
                      </div>
                      <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <InfoItem icon={MapPin} label="Address" value={c.address} />
                        <InfoItem icon={Mail} label="Email" value={c.contactEmail} />
                        <InfoItem icon={Phone} label="Phone" value={c.contactPhone} />
                      </div>
                    </div>
                    {c.notes && (
                      <div className="rounded-md border bg-muted/40 p-3 text-xs">
                        <div className="mb-1 font-semibold text-muted-foreground">Notes</div>
                        {c.notes}
                      </div>
                    )}
                    <Separator />
                    {/* Plants */}
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <div className="text-sm font-semibold flex items-center gap-2">
                          <Factory className="h-4 w-4" /> Plants
                        </div>
                        <Button size="sm" variant="outline" onClick={() => openNewPlant(c.id)}>
                          <Plus className="mr-1 h-3 w-3" /> Add Plant
                        </Button>
                      </div>
                      {c.plants.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-3">
                          No plants registered.
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
                          {c.plants.map((p) => (
                            <div key={p.id} className="rounded-md border bg-background p-3">
                              <div className="flex items-start justify-between">
                                <div>
                                  <div className="flex items-center gap-1.5">
                                    <Factory className="h-3.5 w-3.5 text-muted-foreground" />
                                    <span className="text-sm font-medium">{p.name}</span>
                                    {p.isDemo && (
                                      <Badge variant="outline" className="text-[10px]">DEMO</Badge>
                                    )}
                                  </div>
                                  {p.location && (
                                    <div className="mt-0.5 text-xs text-muted-foreground flex items-center gap-1">
                                      <MapPin className="h-3 w-3" /> {p.location}
                                    </div>
                                  )}
                                  {p.address && (
                                    <div className="mt-0.5 text-xs text-muted-foreground">{p.address}</div>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          );
        })}
      </div>

      {/* Client dialog */}
      <Dialog open={clientOpen} onOpenChange={setClientOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{clientForm.id ? "Edit Client" : "New Client"}</DialogTitle>
            <DialogDescription>
              Register a client company. Each client can have multiple plants.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-2">
              <Label>Client Name *</Label>
              <Input value={clientForm.name} onChange={(e) => setClientForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Industry</Label>
              <Input value={clientForm.industry} onChange={(e) => setClientForm((f) => ({ ...f, industry: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Primary Contact</Label>
              <Input value={clientForm.contactName} onChange={(e) => setClientForm((f) => ({ ...f, contactName: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Contact Email</Label>
              <Input type="email" value={clientForm.contactEmail} onChange={(e) => setClientForm((f) => ({ ...f, contactEmail: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Contact Phone</Label>
              <Input value={clientForm.contactPhone} onChange={(e) => setClientForm((f) => ({ ...f, contactPhone: e.target.value }))} />
            </div>
            <div className="sm:col-span-2 space-y-2">
              <Label>Address</Label>
              <Textarea rows={2} value={clientForm.address} onChange={(e) => setClientForm((f) => ({ ...f, address: e.target.value }))} />
            </div>
            <div className="sm:col-span-2 space-y-2">
              <Label>Notes</Label>
              <Textarea rows={2} value={clientForm.notes} onChange={(e) => setClientForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            {/* Client Logo — upload with instant preview, replace or remove.
                A newly selected file is uploaded to the server when the
                client is saved, so the logo is stored persistently on the
                client record (never only as a browser preview). */}
            <div className="sm:col-span-2 space-y-2">
              <Label>Client Logo</Label>
              <div className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-start">
                <div className="flex h-[70px] w-[140px] shrink-0 items-center justify-center overflow-hidden rounded-md border bg-white">
                  {logoPreview ? (
                    // Immediate local preview of the staged file.
                    <img
                      src={logoPreview}
                      alt="Client logo preview"
                      className="max-h-[62px] max-w-[132px] h-auto w-auto object-contain"
                    />
                  ) : dialogLogoPath ? (
                    // Logo already stored on the client record.
                    <AuthImage
                      src={`/api/clients/${clientForm.id}/logo?v=${logoVersion}`}
                      alt="Client logo"
                      className="max-h-[62px] max-w-[132px] h-auto w-auto object-contain"
                    />
                  ) : resolveClientLogo(clientForm.name) ? (
                    // No uploaded logo, but a system library logo exists.
                    <AuthImage
                      src={`/api/client-logo/${encodeURIComponent(resolveClientLogo(clientForm.name) as string)}`}
                      alt="Client logo (library)"
                      className="max-h-[62px] max-w-[132px] h-auto w-auto object-contain"
                    />
                  ) : (
                    <span className="px-2 text-center text-[10px] leading-tight text-zinc-400">
                      No logo<br />uploaded
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <input
                      ref={logoFileInputRef}
                      type="file"
                      accept={LOGO_ACCEPT}
                      className="hidden"
                      onChange={(e) => {
                        handleLogoFileSelected(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => logoFileInputRef.current?.click()}
                    >
                      <ImagePlus className="mr-2 h-4 w-4" />
                      {logoFile || dialogLogoPath ? "Replace Logo" : "Upload Logo"}
                    </Button>
                    {(logoFile || dialogLogoPath) && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-red-600 hover:text-red-700"
                        onClick={removeClientLogo}
                        disabled={logoBusy}
                      >
                        {logoBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                        {logoFile ? "Remove Selection" : "Remove Logo"}
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    PNG, JPG, JPEG or WebP · up to 5 MB. The logo keeps its
                    original aspect ratio and is stored with the client record.
                  </p>
                  {!dialogLogoPath && !logoFile && resolveClientLogo(clientForm.name) && (
                    <p className="text-xs text-muted-foreground">
                      This client currently uses a logo from the system logo
                      library. Uploading a logo here stores this client&apos;s own
                      logo image.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setClientOpen(false)}>Cancel</Button>
            <Button onClick={saveClient} disabled={savingClient}>
              {savingClient ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {clientForm.id ? "Save Changes" : "Create Client"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Plant dialog */}
      <Dialog open={plantOpen} onOpenChange={setPlantOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Plant</DialogTitle>
            <DialogDescription>
              Add a plant under the selected client.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Plant Name *</Label>
              <Input value={plantForm.name} onChange={(e) => setPlantForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Location</Label>
              <Input value={plantForm.location} onChange={(e) => setPlantForm((f) => ({ ...f, location: e.target.value }))} placeholder="e.g. Vapi, Gujarat" />
            </div>
            <div className="space-y-2">
              <Label>Address</Label>
              <Textarea rows={2} value={plantForm.address} onChange={(e) => setPlantForm((f) => ({ ...f, address: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPlantOpen(false)}>Cancel</Button>
            <Button onClick={savePlant} disabled={savingPlant}>
              {savingPlant ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Create Plant
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InfoItem({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="h-3.5 w-3.5 mt-0.5 text-muted-foreground" />
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-xs">{value ?? "—"}</div>
      </div>
    </div>
  );
}

const _ = Database; // (kept import to avoid tree-shake warning)
export { _ };
