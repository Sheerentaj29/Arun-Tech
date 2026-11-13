"use client";

import { useState } from "react";
import {
  ArrowLeft,
  Gauge,
  Droplet,
  Magnet,
  Zap,
  ChevronRight,
  Workflow,
  Cylinder,
  MoveHorizontal,
  MoveVertical,
  Eye,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAppStore, type PipelineReportType } from "@/lib/store";

// One option card in the selector. Options are deliberately minimal —
// title + short subtitle only, no long explanatory paragraphs.
interface TypeOption {
  type: PipelineReportType;
  title: string;
  subtitle: string;
  icon: React.ElementType;
  accent: string;
  /** When true, the option is shown but not yet implemented. */
  comingSoon?: boolean;
}

// Test-type options per equipment type.
const PIPING_OPTIONS: TypeOption[] = [
  {
    type: "PIPELINE_DPT",
    title: "Dye Penetrant Testing (DPT)",
    subtitle: "Dye penetrant inspection with Accept / Reject results",
    icon: Droplet,
    accent: "border-purple-500 bg-purple-50 hover:bg-purple-100",
  },
  {
    type: "PIPELINE_MPT",
    title: "Magnetic Particle Testing (MPT)",
    subtitle: "Magnetic particle inspection with Accept / Reject results",
    icon: Magnet,
    accent: "border-orange-500 bg-orange-50 hover:bg-orange-100",
  },
  {
    type: "PIPELINE_WELD_SCAN",
    title: "Weld Scan",
    subtitle: "Weld scan inspection with Accept / Reject results",
    icon: Zap,
    accent: "border-cyan-500 bg-cyan-50 hover:bg-cyan-100",
  },
  {
    type: "PIPELINE_THICKNESS",
    title: "Thickness Measurement",
    subtitle: "UT thickness measurement at clock positions",
    icon: Gauge,
    accent: "border-emerald-500 bg-emerald-50 hover:bg-emerald-100",
  },
];

const VESSEL_OPTIONS: TypeOption[] = [
  {
    type: "VESSEL_DPT",
    title: "Dye Penetrant Testing (DPT)",
    subtitle: "Dye penetrant inspection for vessel welds and nozzles",
    icon: Droplet,
    accent: "border-purple-500 bg-purple-50 hover:bg-purple-100",
  },
  {
    type: "VESSEL_MPT",
    title: "Magnetic Particle Testing (MPT)",
    subtitle: "Magnetic particle inspection for vessel welds and nozzles",
    icon: Magnet,
    accent: "border-orange-500 bg-orange-50 hover:bg-orange-100",
  },
  {
    type: "VESSEL_WELD_SCAN",
    title: "Weld Scan",
    subtitle: "Weld scan inspection for vessel welds and nozzles",
    icon: Zap,
    accent: "border-cyan-500 bg-cyan-50 hover:bg-cyan-100",
  },
  {
    type: "VESSEL_UTM",
    title: "UT Thickness Measurement",
    subtitle: "UT thickness measurement for vessel shells, dish ends and nozzles",
    icon: Gauge,
    accent: "border-emerald-500 bg-emerald-50 hover:bg-emerald-100",
  },
  {
    type: "VESSEL_VISUAL",
    title: "Visual Inspection",
    subtitle: "Coming soon for vessels",
    icon: Eye,
    accent: "border-zinc-300 bg-zinc-50",
    comingSoon: true,
  },
];

// Vessel test types that require the orientation step (Horizontal /
// Vertical) before the form opens. The selected orientation is saved
// with the report and shown on the review page and in the PDF.
//
// NOTE: VESSEL_DPT / VESSEL_MPT already required the orientation step
// before this update (their existing workflow — preserved unchanged).
// VESSEL_UTM is added here by the Vessel UT Thickness Measurement update:
// the orientation determines the readings-table structure (clock
// positions for horizontal vessels vs East/West/North/South directions
// for vertical vessels). VESSEL_WELD_SCAN and VESSEL_VISUAL deliberately
// do NOT appear here — no orientation step for them.
const VESSEL_ORIENTATION_REQUIRED = new Set<PipelineReportType>([
  "VESSEL_DPT",
  "VESSEL_MPT",
  "VESSEL_UTM",
]);

// Labels used by the Step-3 breadcrumb for the orientation-stage test
// types.
const ORIENTATION_STAGE_TEST_LABELS: Partial<Record<PipelineReportType, string>> = {
  VESSEL_DPT: "Dye Penetrant Testing (DPT)",
  VESSEL_MPT: "Magnetic Particle Testing (MPT)",
  VESSEL_UTM: "UT Thickness Measurement",
};

type Stage = "equipment" | "test" | "orientation";

export function PipelineReportTypeSelectorView() {
  const { setView, openNewPipelineReportWithSelection } = useAppStore();
  // Stage 1: Equipment Type → Stage 2: Test Type → Stage 3 (Vessel DPT,
  // Vessel MPT and Vessel UT Thickness Measurement only): Vessel
  // Orientation → form.
  const [stage, setStage] = useState<Stage>("equipment");
  const [equipmentType, setEquipmentType] = useState<"PIPING" | "VESSEL" | null>(null);
  // Test type picked in Stage 2. Kept so the orientation stage knows
  // which vessel report type to open (VESSEL_DPT, VESSEL_MPT or
  // VESSEL_UTM).
  const [selectedTestType, setSelectedTestType] = useState<PipelineReportType | null>(null);

  const options = equipmentType === "VESSEL" ? VESSEL_OPTIONS : PIPING_OPTIONS;
  const stepNumber = stage === "equipment" ? 1 : stage === "test" ? 2 : 3;

  function pickEquipment(t: "PIPING" | "VESSEL") {
    setEquipmentType(t);
    setStage("test");
  }

  function pickTest(opt: TypeOption) {
    if (opt.comingSoon) return;
    // Vessel DPT, Vessel MPT and Vessel UT Thickness Measurement require
    // the orientation step before the form opens — it cannot be skipped.
    if (VESSEL_ORIENTATION_REQUIRED.has(opt.type)) {
      setSelectedTestType(opt.type);
      setStage("orientation");
      return;
    }
    openNewPipelineReportWithSelection(opt.type, equipmentType, null);
  }

  function pickOrientation(orientation: "HORIZONTAL" | "VERTICAL") {
    if (selectedTestType) {
      openNewPipelineReportWithSelection(selectedTestType, "VESSEL", orientation);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" onClick={() => setView("pipeline-reports")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to list
        </Button>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">New Inspection Report</h1>
        <p className="text-sm text-muted-foreground">
          Select the equipment type and the inspection / test type. The form fields,
          PDF template, and report title are determined by this choice — pick
          carefully, the report type cannot be changed after the report is created.
        </p>
      </div>

      {/* Step indicator — mirrors the selected flow */}
      <div className="rounded-md border bg-muted/30 p-4">
        <div className="flex items-center gap-3 text-sm flex-wrap">
          <Badge
            variant="outline"
            className={
              stepNumber === 1
                ? "border-amber-500 text-amber-700"
                : "border-emerald-500 text-emerald-700"
            }
          >
            Step {stepNumber}
          </Badge>
          <span className="font-medium">
            {stage === "equipment"
              ? "Select Equipment Type"
              : stage === "test"
                ? "Select Test Type"
                : "Select Vessel Orientation"}
          </span>
          <span className="text-muted-foreground ml-auto">Choose one →</span>
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
          <span className={equipmentType ? "font-medium text-emerald-700" : ""}>
            {stage === "equipment"
              ? "Equipment / Component Type"
              : equipmentType === "VESSEL"
                ? "Vessel"
                : "Piping"}
          </span>
          {stage !== "equipment" && (
            <>
              <span>→</span>
              <span className="font-medium">
                {stage === "test"
                  ? "…"
                  : (ORIENTATION_STAGE_TEST_LABELS[selectedTestType ?? ""] ??
                     "Selected Test Type")}
              </span>
            </>
          )}
        </div>
      </div>

      {/* ─── STAGE 1: EQUIPMENT TYPE ─── */}
      {stage === "equipment" && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {([
            {
              key: "PIPING",
              title: "Piping",
              icon: Workflow,
              accent: "border-emerald-500 bg-emerald-50 hover:bg-emerald-100",
            },
            {
              key: "VESSEL",
              title: "Vessel",
              icon: Cylinder,
              accent: "border-blue-500 bg-blue-50 hover:bg-blue-100",
            },
          ] as const).map((opt) => {
            const Icon = opt.icon;
            return (
              <Card
                key={opt.key}
                className={`cursor-pointer border-2 transition-all hover:shadow-md ${opt.accent}`}
                onClick={() => pickEquipment(opt.key)}
              >
                <CardContent className="flex h-full flex-col p-6">
                  <div className="flex items-center gap-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-md bg-white shrink-0">
                      <Icon className="h-8 w-8" />
                    </div>
                    <div className="font-semibold text-lg">{opt.title}</div>
                  </div>
                  <div className="mt-4 flex items-center justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        pickEquipment(opt.key);
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

      {/* ─── STAGE 2: TEST TYPE ─── */}
      {stage === "test" && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {options.map((opt) => {
            const Icon = opt.icon;
            return (
              <Card
                key={opt.type}
                className={`border-2 transition-all ${
                  opt.comingSoon
                    ? "opacity-60 cursor-not-allowed"
                    : "cursor-pointer hover:shadow-md"
                } ${opt.accent}`}
                onClick={() => pickTest(opt)}
              >
                <CardContent className="flex h-full flex-col p-5">
                  <div className="mb-3 flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-white shrink-0">
                      <Icon className="h-6 w-6" />
                    </div>
                    <div className="font-semibold leading-tight">{opt.title}</div>
                  </div>
                  <div className="text-xs text-muted-foreground leading-tight flex-1">
                    {opt.subtitle}
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    {opt.comingSoon ? (
                      <Badge variant="outline" className="border-amber-400 text-amber-700 text-[10px]">
                        Coming soon
                      </Badge>
                    ) : (
                      <span />
                    )}
                    {!opt.comingSoon && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          pickTest(opt);
                        }}
                      >
                        Select <ChevronRight className="ml-1 h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ─── STAGE 3: VESSEL ORIENTATION (Vessel DPT / MPT / UT Thickness Measurement) ─── */}
      {stage === "orientation" && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {([
            {
              key: "HORIZONTAL",
              title: "Horizontal Vessel",
              icon: MoveHorizontal,
              accent: "border-purple-500 bg-purple-50 hover:bg-purple-100",
            },
            {
              key: "VERTICAL",
              title: "Vertical Vessel",
              icon: MoveVertical,
              accent: "border-purple-500 bg-purple-50 hover:bg-purple-100",
            },
          ] as const).map((opt) => {
            const Icon = opt.icon;
            return (
              <Card
                key={opt.key}
                className={`cursor-pointer border-2 transition-all hover:shadow-md ${opt.accent}`}
                onClick={() => pickOrientation(opt.key)}
              >
                <CardContent className="flex h-full flex-col p-6">
                  <div className="flex items-center gap-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-md bg-white shrink-0">
                      <Icon className="h-8 w-8" />
                    </div>
                    <div className="font-semibold text-lg">{opt.title}</div>
                  </div>
                  <div className="mt-4 flex items-center justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        pickOrientation(opt.key);
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

      {/* Back navigation between stages */}
      <div>
        {stage === "test" && (
          <Button variant="ghost" size="sm" onClick={() => setStage("equipment")}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Equipment Type
          </Button>
        )}
        {stage === "orientation" && (
          <Button variant="ghost" size="sm" onClick={() => setStage("test")}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Test Type
          </Button>
        )}
      </div>

      <Card className="border-zinc-200 bg-zinc-50">
        <CardContent className="p-4 text-xs text-muted-foreground">
          <strong>Common features for all report types:</strong> client / plant identification
          header, inspection photo gallery with captions, and the existing approval workflow
          (Draft → Submitted for Review → Approved / Returned for Revision → Changes Pending
          Review). The selected equipment type, test type, and vessel orientation (for vessel
          DPT / MPT / UT Thickness Measurement reports) are shown in the report list, detail
          view, generated PDF, and revision history.
        </CardContent>
      </Card>
    </div>
  );
}
