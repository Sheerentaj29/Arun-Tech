// GET    /api/pipeline-inspections/[id] - get full inspection with measurements + revisions
// PUT    /api/pipeline-inspections/[id] - update header fields (role-gated)
// DELETE /api/pipeline-inspections/[id] - delete entire report (admin only)

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const report = await db.pipelineInspection.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true } },
      plant: { select: { id: true, name: true, location: true, address: true } },
      inspector: { select: { id: true, name: true, email: true } },
      approver: { select: { id: true, name: true, email: true } },
      returnedBy: { select: { id: true, name: true, email: true } },
      measurements: {
        orderBy: { sortOrder: "asc" },
        include: {
          componentType: { select: { id: true, code: true, label: true } },
          standard: { select: { id: true, standard: true, edition: true, nominalSizeInch: true, schedule: true, wallThicknessMm: true, isVerified: true } },
        },
      },
      revisions: {
        orderBy: { revisionNumber: "desc" },
        include: {
          revisedBy: { select: { id: true, name: true } },
          approvedBy: { select: { id: true, name: true } },
        },
      },
      reportPhotos: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (!report) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // PERMISSION: employees can only view their own reports. Admins see all.
  const isAdmin = session.dashboardRole === "ADMIN";
  if (!isAdmin && report.inspectorId !== session.id) {
    return NextResponse.json(
      { error: "Forbidden — you can only view your own reports" },
      { status: 403 },
    );
  }

  return NextResponse.json(report);
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const existing = await db.pipelineInspection.findUnique({
    where: { id },
    include: { measurements: true, revisions: true, inspector: true, approver: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isAdmin = session.dashboardRole === "ADMIN";
  // PERMISSION: employees can only edit their OWN reports in Draft or
  // Returned for Revision state. Admins can edit any report.
  if (!isAdmin) {
    if (existing.inspectorId !== session.id) {
      return NextResponse.json(
        { error: "Forbidden — you can only edit your own reports" },
        { status: 403 },
      );
    }
    const editableStatuses = ["Draft", "Returned for Revision"];
    if (!editableStatuses.includes(existing.status)) {
      return NextResponse.json(
        {
          error:
            "This report is in an approval workflow state and can't be edited directly. " +
            "If it has been Approved, create a new revision instead. " +
            "If it has been Submitted for Review, wait for the admin to approve or return it.",
        },
        { status: 403 },
      );
    }
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  // If clientId/reportNumber changing, check for duplicates
  const newClientId = body.clientId ?? existing.clientId;
  const newReportNumber = (body.reportNumber ?? existing.reportNumber).trim();
  if (newClientId !== existing.clientId || newReportNumber !== existing.reportNumber) {
    const dupe = await db.pipelineInspection.findUnique({
      where: { clientId_reportNumber: { clientId: newClientId, reportNumber: newReportNumber } },
    });
    if (dupe && dupe.id !== id) {
      return NextResponse.json(
        { error: `Report number '${newReportNumber}' already exists for this client` },
        { status: 409 },
      );
    }
  }

  // Plant must belong to client
  if (body.plantId) {
    const plant = await db.plant.findUnique({ where: { id: body.plantId } });
    if (!plant || plant.clientId !== newClientId) {
      return NextResponse.json(
        { error: "Plant does not belong to the selected client" },
        { status: 400 },
      );
    }
  }

  const updated = await db.pipelineInspection.update({
    where: { id },
    data: {
      reportNumber: newReportNumber,
      clientId: newClientId,
      plantId: body.plantId ?? existing.plantId,
      inspectionArea: body.inspectionArea ?? existing.inspectionArea,
      pipelineDescription: body.pipelineDescription ?? existing.pipelineDescription,
      pipelineIdentificationNumber: body.pipelineIdentificationNumber ?? existing.pipelineIdentificationNumber,
      isometricDrawingNumber: body.isometricDrawingNumber ?? existing.isometricDrawingNumber,
      materialOfConstruction: body.materialOfConstruction ?? existing.materialOfConstruction,
      applicableStandard: body.applicableStandard ?? existing.applicableStandard,
      standardEdition: body.standardEdition ?? existing.standardEdition,
      inspectionDate: body.inspectionDate ? new Date(body.inspectionDate) : existing.inspectionDate,
      findingsSummary: body.findingsSummary ?? existing.findingsSummary,
      comments: body.comments ?? existing.comments,
      inspectionDescription: body.inspectionDescription ?? existing.inspectionDescription,
      customColumns: body.customColumns ?? existing.customColumns,
      photos: body.photos ?? existing.photos,
    },
  });

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "UPDATE", entity: "PipelineInspection", entityId: updated.id,
    details: `Updated pipeline report header ${updated.reportNumber} (status: ${existing.status})`,
  });

  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const existing = await db.pipelineInspection.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // PERMISSION: only the owner can delete their own Draft reports. Admins
  // can delete any report. Submitted/Approved reports are protected from
  // deletion — they must be archived through the workflow instead.
  const isAdmin = session.dashboardRole === "ADMIN";
  if (!isAdmin) {
    if (existing.inspectorId !== session.id) {
      return NextResponse.json(
        { error: "Forbidden — you can only delete your own reports" },
        { status: 403 },
      );
    }
    if (existing.status !== "Draft" && existing.status !== "Returned for Revision") {
      return NextResponse.json(
        {
          error:
            "Can only delete reports in Draft or Returned for Revision state. " +
            "Submitted or Approved reports must be archived through the workflow.",
        },
        { status: 403 },
      );
    }
  }

  await db.pipelineInspection.delete({ where: { id } });
  await recordAudit({
    userId: session.id, userName: session.name,
    action: "DELETE", entity: "PipelineInspection", entityId: id,
    details: `Deleted pipeline report ${existing.reportNumber}`,
  });
  return NextResponse.json({ ok: true });
}
