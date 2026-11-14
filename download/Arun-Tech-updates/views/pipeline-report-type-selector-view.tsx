"use client";

import { useState } from "react";
import {
  ArrowLeft,
  Gauge,
  Droplet,
  Magnet,
  Zap,
  Eye,
  Waypoints,
  Container,
  ChevronRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAppStore, type PipelineReportType, type EquipmentType } from "@/lib/store";

interface EquipmentOption {
  equipmentType: EquipmentType;
  title: string;
  subtitle: string;
  icon: React.ElementType;
  accent: string;
}

// Step 1 — the two supported equipment categories.
const EQUIPMENT_OPTIONS: EquipmentOption[] = [
  {
    equipmentType: "PIPING",
    title: "Piping",
    subtitle: "Pipeline & piping system inspection",
    icon: Waypoints,
    accent: "border-emerald-500 bg-emerald-50 hover:bg-emerald-100",
  },
  {
    equipmentType: "VESSEL",
    title: "Vessel",
    subtitle: "Pressure vessels, tanks & exchangers",
    icon: Container,
    accent: "border-sky-500 bg-sky-50 hover:bg-sky-100",
  },
];

interface TypeOption {
  type: PipelineReportType;
  title: string;
  subtitle: string;
  icon: React.ElementType;
  accent: string;
}

// Step 2 — report options per equipment category. Piping keeps the exact
// four options that already existed; Vessel gets its own set (Visual
// Inspection is vessel-only). The Ultrasonic Test Report stays removed.
const PIPING_TYPES: TypeOption[] = [
  {
    type: "PIPELINE_DPT",
    title: "Penetrant Testing",
    subtitle: "Dye Penetrant Inspection",
    icon: Droplet,
    accent: "border-purple-500 bg-purple-50 hover:bg-purple-100",
  },
  {
    type: "PIPELINE_MPT",
    title: "Particle Testing",
    subtitle: "Magnetic Particle Inspection",
    icon: Magnet,
    accent: "border-orange-500 bg-orange-50 hover:bg-orange-100",
  },
  {
    type: "PIPELINE_WELD_SCAN",
    title: "Weld Scan",
    subtitle: "Weld Inspection",
    icon: Zap,
    accent: "border-cyan-500 bg-cyan-50 hover:bg-cyan-100",
  },
  {
    type: "PIPELINE_THICKNESS",
    title: "Thickness Measurement",
    subtitle: "Thickness Measurement",
    icon: Gauge,
    accent: "border-emerald-500 bg-emerald-50 hover:bg-emerald-100",
  },
];

const VESSEL_TYPES: TypeOption[] = [
  {
    type: "PIPELINE_VISUAL",
    title: "Visual Inspection",
    subtitle: "External visual examination",
    icon: Eye,
    accent: "border-blue-500 bg-blue-50 hover:bg-blue-100",
  },
  {
    type: "PIPELINE_DPT",
    title: "Penetrant Testing",
    subtitle: "Dye Penetrant Inspection",
    icon: Droplet,
    accent: "border-purple-500 bg-purple-50 hover:bg-purple-100",
  },
  {
    type: "PIPELINE_MPT",
    title: "Particle Testing",
    subtitle: "Magnetic Particle Inspection",
    icon: Magnet,
    accent: "border-orange-500 bg-orange-50 hover:bg-orange-100",
  },
  {
    type: "PIPELINE_WELD_SCAN",
    title: "Weld Scan",
    subtitle: "Weld Inspection",
    icon: Zap,
    accent: "border-cyan-500 bg-cyan-50 hover:bg-cyan-100",
  },
  {
    type: "PIPELINE_THICKNESS",
    title: "Thickness Measurement",
    subtitle: "Thickness Measurement",
    icon: Gauge,
    accent: "border-emerald-500 bg-emerald-50 hover:bg-emerald-100",
  },
];

export function PipelineReportTypeSelectorView() {
  const { setView, openNewPipelineReportWithType } = useAppStore();
  // null = Step 1 (equipment type not yet chosen). Once set, Step 2 shows
  // the report types for that equipment category.
  const [equipmentType, setEquipmentType] = useState<EquipmentType | null>(null);

  const typeOptions: TypeOption[] = equipmentType === "VESSEL" ? VESSEL_TYPES : PIPING_TYPES;

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" onClick={() => (equipmentType ? setEquipmentType(null) : setView("pipeline-reports"))}>
          <ArrowLeft className="mr-2 h-4 w-4" /> {equipmentType ? "Back to equipment type" : "Back to list"}
        </Button>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">New Inspection Report</h1>
        <p className="text-sm text-muted-foreground">
          Select the equipment type, then the report type. The form fields, PDF template,
          and report title are determined by this choice — pick carefully, they cannot be
          changed after the report is created.
        </p>
      </div>

      {/* Step breadcrumb */}
      <div className="rounded-md border bg-muted/30 p-4">
        <div className="flex items-center gap-3 text-sm flex-wrap">
          <Badge variant="outline" className="border-amber-500 text-amber-700">
            Step 1: Select Equipment Type
          </Badge>
          <span className="text-muted-foreground">→</span>
          <Badge variant="outline" className="border-amber-500 text-amber-700">
            Step 2: Select Report Type
          </Badge>
          {equipmentType && (
            <>
              <span className="text-muted-foreground ml-auto flex items-center gap-2">
                Selected:
                <Badge variant="outline" className="border-sky-500 text-sky-700 capitalize">
                  {equipmentType === "PIPING" ? "Piping" : "Vessel"}
                </Badge>
              </span>
            </>
          )}
        </div>
      </div>

      {/* ─── STEP 1: EQUIPMENT TYPE ─── */}
      {equipmentType === null && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {EQUIPMENT_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            return (
              <Card
                key={opt.equipmentType}
                className={`cursor-pointer border-2 transition-all hover:shadow-md ${opt.accent}`}
                onClick={() => setEquipmentType(opt.equipmentType)}
              >
                <CardContent className="flex h-full flex-col p-6">
                  <div className="mb-3 flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-md bg-white shrink-0">
                      <Icon className="h-7 w-7" />
                    </div>
                    <div>
                      <div className="text-lg font-semibold leading-tight">{opt.title}</div>
                      <div className="text-xs text-muted-foreground leading-tight">
                        {opt.subtitle}
                      </div>
                    </div>
                  </div>
                  <div className="mt-auto flex items-center justify-end pt-4">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEquipmentType(opt.equipmentType);
                      }}
                    >
                      Select <ChevronRight className="ml-1 h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ─── STEP 2: REPORT TYPE (per equipment category) ─── */}
      {equipmentType !== null && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {typeOptions.map((opt) => {
            const Icon = opt.icon;
            return (
              <Card
                key={opt.type}
                className={`cursor-pointer border-2 transition-all hover:shadow-md ${opt.accent}`}
                onClick={() => openNewPipelineReportWithType(opt.type, equipmentType)}
              >
                <CardContent className="flex h-full flex-col p-5">
                  <div className="mb-3 flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-white shrink-0">
                      <Icon className="h-6 w-6" />
                    </div>
                    <div>
                      <div className="font-semibold leading-tight">{opt.title}</div>
                      <div className="text-xs text-muted-foreground leading-tight">
                        {opt.subtitle}
                      </div>
                    </div>
                  </div>
                  <div className="mt-auto flex items-center justify-end pt-4">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        openNewPipelineReportWithType(opt.type, equipmentType);
                      }}
                    >
                      Select <ChevronRight className="ml-1 h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="border-zinc-200 bg-zinc-50">
        <CardContent className="p-4 text-xs text-muted-foreground">
          <strong>Common features for all report types:</strong> client / plant / equipment
          identification header, inspection photo gallery with captions, drawings
          (vessel reports and piping thickness reports), certificates, and the existing
          approval workflow (Draft → Submitted for Review → Approved / Returned for Revision →
          Changes Pending Review). The selected equipment and report type are shown in the
          report list, report history, detail view, admin dashboard, generated PDF, and
          revision history.
          <br /><br />
          <strong>Note:</strong> DPT/DPPT reports include a complete Dye Penetrant
          Procedure section with Consumable Details. Thickness Measurement reports
          support multiple named tables with automatic index numbering (7.1, 7.2, ...)
          for both Piping and Vessel.
        </CardContent>
      </Card>
    </div>
  );
}
