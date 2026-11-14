"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ArrowLeft,
  Pencil,
  Trash2,
  ShieldCheck,
  ShieldAlert,
  Loader2,
  Building2,
  Factory,
  Ruler,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { DIMENSION_FIELD_META } from "@/lib/domain/equipment-catalog";

const CATEGORY_LABEL: Record<string, string> = {
  STORAGE: "Storage Equipment",
  PRESSURE: "Pressure and Process Equipment",
  SEPARATION: "Separation and Thermal Equipment",
  UTILITY: "Utility Equipment",
  PIPE: "Pipes",
  VALVE: "Valves",
  PUMP: "Pumps",
  OTHER: "Other Equipment",
};

interface EquipmentFull {
  id: string;
  equipmentId: string;
  name: string;
  category: string;
  type: string;
  orientation: string | null;
  diameter: number | null;
  height: number | null;
  length: number | null;
  width: number | null;
  capacity: number | null;
  wallThickness: number | null;
  nominalDiameter: number | null;
  outsideDiameter: number | null;
  tubeLength: number | null;
  shellDiameter: number | null;
  material: string | null;
  manufacturer: string | null;
  serialNumber: string | null;
  tagNumber: string | null;
  dimensionSource: string | null;
  verificationStatus: "Verified" | "Unverified";
  isDemo: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  client: { id: string; name: string };
  plant: { id: string; name: string; location: string | null; address: string | null };
  createdBy: { id: string; name: string };
}

export function EquipmentDetailView() {
  const {
    user,
    selectedEquipmentId,
    setView,
    openEditEquipment,
    refresh,
    refreshKey,
  } = useAppStore();
  const isAdmin = user?.role === "ADMIN";

  const [eq, setEq] = useState<EquipmentFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!selectedEquipmentId) return;
    setLoading(true);
    apiFetch<EquipmentFull>(`/api/equipment/${selectedEquipmentId}`)
      .then((e) => setEq(e))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [selectedEquipmentId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function deleteEquipment() {
    if (!eq) return;
    try {
      await apiFetch(`/api/equipment/${eq.id}`, { method: "DELETE" });
      toast.success(`Deleted ${eq.equipmentId}`);
      refresh();
      setView("equipment");
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message ?? "Delete failed");
    }
  }

  if (loading) {
    return (
      <div className="p-8 text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading equipment details...
      </div>
    );
  }
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Failed to load</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!eq) {
    return <p className="p-8 text-muted-foreground">No equipment selected.</p>;
  }

  // Dimension rows to display — only non-null values
  const dimEntries = (
    [
      "diameter",
      "height",
      "length",
      "width",
      "capacity",
      "wallThickness",
      "nominalDiameter",
      "outsideDiameter",
      "tubeLength",
      "shellDiameter",
    ] as Array<keyof typeof DIMENSION_FIELD_META>
  )
    .map((f) => ({ field: f, value: eq[f] as number | null }))
    .filter((x) => x.value !== null && x.value !== undefined);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <Button variant="ghost" size="sm" onClick={() => setView("equipment")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to list
        </Button>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{eq.name}</h1>
              {eq.verificationStatus === "Verified" ? (
                <Badge variant="outline" className="border-emerald-500 text-emerald-700">
                  <ShieldCheck className="mr-1 h-3 w-3" /> Verified
                </Badge>
              ) : (
                <Badge variant="outline" className="border-amber-500 text-amber-700">
                  <ShieldAlert className="mr-1 h-3 w-3" /> Unverified
                </Badge>
              )}
              {eq.isDemo && (
                <Badge variant="outline" className="border-zinc-400 text-zinc-500">
                  DEMO DATA
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-mono">{eq.equipmentId}</span>
              {eq.tagNumber && <> · Tag <span className="font-mono">{eq.tagNumber}</span></>}
              {" · "}
              {CATEGORY_LABEL[eq.category] ?? eq.category} — {eq.type}
            </p>
          </div>
          {isAdmin && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => openEditEquipment(eq.id)}>
                <Pencil className="mr-2 h-4 w-4" /> Edit
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700">
                    <Trash2 className="mr-2 h-4 w-4" /> Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this equipment?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete <strong>{eq.equipmentId}</strong>. This
                      action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={deleteEquipment} className="bg-red-600 hover:bg-red-700">
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </div>
      </div>

      {eq.verificationStatus === "Unverified" && (
        <Alert className="border-amber-300 bg-amber-50">
          <ShieldAlert className="h-4 w-4 text-amber-700" />
          <AlertTitle className="text-amber-900">Unverified specifications</AlertTitle>
          <AlertDescription className="text-amber-900">
            Dimensions below are marked UNVERIFIED. They must be confirmed from approved
            drawings, manufacturer records, nameplate data, or verified field measurements
            before use as engineering design, safety, or inspection acceptance values.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Specs */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Ruler className="h-4 w-4" /> Registered Specifications
            </CardTitle>
            <CardDescription>
              Master specifications preserved on this equipment. Reports created in the
              report workflow never modify these master values.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Identification */}
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Identification
              </h3>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <SpecRow label="Equipment ID" value={eq.equipmentId} mono />
                <SpecRow label="Tag Number" value={eq.tagNumber} mono />
                <SpecRow label="Serial Number" value={eq.serialNumber} mono />
                <SpecRow label="Manufacturer" value={eq.manufacturer} />
                <SpecRow label="Material" value={eq.material} />
                <SpecRow label="Orientation" value={eq.orientation} />
                <SpecRow label="Dimension Source" value={eq.dimensionSource} />
              </dl>
            </div>
            <Separator />
            {/* Dimensions */}
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Dimensions
              </h3>
              {dimEntries.length > 0 ? (
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {dimEntries.map(({ field, value }) => {
                    const meta = DIMENSION_FIELD_META[field];
                    return (
                      <div key={field} className="flex flex-col">
                        <dt className="text-xs text-muted-foreground">{meta.label}</dt>
                        <dd className="text-base font-semibold tabular-nums">
                          {value} <span className="text-xs font-normal text-muted-foreground">{meta.unit}</span>
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No dimensional data recorded. Empty dimensions are stored as{" "}
                  <code>null</code>, not as zero, so they remain visibly distinct from
                  measured zero values.
                </p>
              )}
            </div>
            {eq.notes && (
              <>
                <Separator />
                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    Notes
                  </h3>
                  <p className="text-sm whitespace-pre-wrap">{eq.notes}</p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Sidebar: Client / Plant / Audit */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4" /> Assignment
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-xs text-muted-foreground">Client Company</div>
              <div className="font-medium">{eq.client.name}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <Factory className="h-3 w-3" /> Plant
              </div>
              <div className="font-medium">{eq.plant.name}</div>
              {eq.plant.location && (
                <div className="text-xs text-muted-foreground">{eq.plant.location}</div>
              )}
            </div>
            <Separator />
            <div>
              <div className="text-xs text-muted-foreground">Created by</div>
              <div className="text-sm">{eq.createdBy.name}</div>
              <div className="text-xs text-muted-foreground">
                {new Date(eq.createdAt).toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Last updated</div>
              <div className="text-xs">
                {new Date(eq.updatedAt).toLocaleString()}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

    </div>
  );
}

function SpecRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono text-sm" : "text-sm"}>
        {value ?? <span className="text-muted-foreground">—</span>}
      </dd>
    </div>
  );
}
