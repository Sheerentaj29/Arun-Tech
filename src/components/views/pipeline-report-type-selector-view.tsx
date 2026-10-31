"use client";

import {
  ArrowLeft,
  Gauge,
  Droplet,
  Magnet,
  Zap,
  ChevronRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAppStore, type PipelineReportType } from "@/lib/store";

interface TypeOption {
  type: PipelineReportType;
  title: string;
  subtitle: string;
  description: string;
  icon: React.ElementType;
  accent: string;
  /** When true, the option is shown but not yet fully implemented. The user
   * can still pick it (a basic shell report is created) but the form will
   * show a "Coming soon" notice. */
  comingSoon?: boolean;
}

const OPTIONS: TypeOption[] = [
  {
    type: "PIPELINE_DPT",
    title: "DPT / DPPT – Dye Penetrant Testing",
    subtitle: "Dye penetrant inspection with Accept/Reject results",
    description:
      "Record dye penetrant testing with a complete Dye Penetrant Procedure " +
      "section (Testing Standard, Acceptance Criteria, Surface Preparation, " +
      "Penetrant Type / Process / Method, Development / Interpretation Times, " +
      "Lighting, Post Cleaning), Consumable Details (Solvent, Penetrant, " +
      "Developer), and an editable inspection table with auto-serial numbers, " +
      "custom columns, and Accept / Reject results. No engineering drawing " +
      "upload required for DPT reports.",
    icon: Droplet,
    accent: "border-purple-500 bg-purple-50 hover:bg-purple-100",
  },
  {
    type: "PIPELINE_MPT",
    title: "MPT – Magnetic Particle Testing",
    subtitle: "Magnetic particle inspection (coming soon)",
    description:
      "Magnetic Particle Testing report for surface and near-surface flaw " +
      "detection in ferromagnetic materials. The detailed MPT workflow — " +
      "including magnetising equipment, particle medium, inspection " +
      "parameters, and observation table — will be available shortly. " +
      "You can create a placeholder report now and complete the inspection " +
      "details later.",
    icon: Magnet,
    accent: "border-orange-500 bg-orange-50 hover:bg-orange-100",
    comingSoon: true,
  },
  {
    type: "PIPELINE_WELD_SCAN",
    title: "Weld Scan",
    subtitle: "Weld scan inspection (coming soon)",
    description:
      "Weld Scan report for systematic weld inspection along a pipeline or " +
      "vessel. The detailed Weld Scan workflow — including scan parameters, " +
      "weld map references, and observation table — will be available " +
      "shortly. You can create a placeholder report now and complete the " +
      "inspection details later.",
    icon: Zap,
    accent: "border-cyan-500 bg-cyan-50 hover:bg-cyan-100",
    comingSoon: true,
  },
  {
    type: "PIPELINE_THICKNESS",
    title: "Pipeline Thickness Measurement",
    subtitle: "UT thickness measurement at clock positions",
    description:
      "Record ultrasonic thickness readings at the 12/3/6/9 o'clock positions " +
      "for each inspection point. Auto-looks up nominal wall thickness from " +
      "ASME B36.10M / B36.19M, computes observed minimum, and supports custom " +
      "columns. Engineering drawings, photos, and certificates are included.",
    icon: Gauge,
    accent: "border-emerald-500 bg-emerald-50 hover:bg-emerald-100",
  },
];

export function PipelineReportTypeSelectorView() {
  const { setView, openNewPipelineReportWithType } = useAppStore();

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" onClick={() => setView("pipeline-reports")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to list
        </Button>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">New Pipeline Report</h1>
        <p className="text-sm text-muted-foreground">
          Select the type of pipeline inspection report to create. The form fields,
          PDF template, and report title are determined by this choice — pick
          carefully, the report type cannot be changed after the report is created.
        </p>
      </div>

      <div className="rounded-md border bg-muted/30 p-4">
        <div className="flex items-center gap-3 text-sm flex-wrap">
          <Badge variant="outline" className="border-zinc-400 text-zinc-700">
            Step 1
          </Badge>
          <span className="font-medium">Equipment / Component Type</span>
          <span className="text-muted-foreground">→</span>
          <Badge variant="outline" className="border-emerald-500 text-emerald-700">
            Pipeline
          </Badge>
          <span className="text-muted-foreground">→</span>
          <Badge variant="outline" className="border-amber-500 text-amber-700">
            Step 2: Select Report Type
          </Badge>
          <span className="text-muted-foreground ml-auto">Choose one →</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {OPTIONS.map((opt) => {
          const Icon = opt.icon;
          return (
            <Card
              key={opt.type}
              className={`cursor-pointer border-2 transition-all hover:shadow-md ${opt.accent}`}
              onClick={() => openNewPipelineReportWithType(opt.type)}
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
                <p className="text-xs text-muted-foreground leading-relaxed flex-1">
                  {opt.description}
                </p>
                <div className="mt-4 flex items-center justify-between">
                  {opt.comingSoon ? (
                    <Badge variant="outline" className="border-amber-400 text-amber-700 text-[10px]">
                      Coming soon
                    </Badge>
                  ) : (
                    <span />
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      openNewPipelineReportWithType(opt.type);
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

      <Card className="border-zinc-200 bg-zinc-50">
        <CardContent className="p-4 text-xs text-muted-foreground">
          <strong>Common features for all report types:</strong> client / plant / pipeline
          identification header, inspection photo gallery with captions, and the existing
          approval workflow (Draft → Submitted for Review → Approved / Returned for Revision →
          Changes Pending Review). The selected report type is shown in the report list,
          detail view, admin dashboard, generated PDF, and revision history.
          <br /><br />
          <strong>Note:</strong> DPT/DPPT reports include a complete Dye Penetrant
          Procedure section with Consumable Details and do <strong>not</strong> include
          engineering drawing uploads. Thickness Measurement reports retain all
          existing features including drawings, certificates, and the full measurement table.
        </CardContent>
      </Card>
    </div>
  );
}
