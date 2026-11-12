// GET /api/employee-summary - dashboard summary cards for employees
//
// Returns counts for the CURRENT user's reports:
//   myTotalReports
//   myDrafts         (status = "Draft")
//   mySubmitted      (status = "Submitted for Review")
//   myReturned       (status = "Returned for Revision")  ← needs attention
//   myApproved       (status = "Approved")
//   myChangesPending (status = "Changes Pending Review")
//
// Plus lists of:
//   - draft reports (so the employee can pick up where they left off)
//   - returned reports (so the employee knows what needs fixing)
//   - approved reports (so the employee can view/download them)

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const where = { inspectorId: session.id };

  const [
    myTotalReports,
    myDrafts,
    mySubmitted,
    myReturned,
    myApproved,
    myChangesPending,
  ] = await Promise.all([
    db.pipelineInspection.count({ where }),
    db.pipelineInspection.count({ where: { ...where, status: "Draft" } }),
    db.pipelineInspection.count({ where: { ...where, status: "Submitted for Review" } }),
    db.pipelineInspection.count({ where: { ...where, status: "Returned for Revision" } }),
    db.pipelineInspection.count({ where: { ...where, status: "Approved" } }),
    db.pipelineInspection.count({ where: { ...where, status: "Changes Pending Review" } }),
  ]);

  // Draft reports — employee can pick up editing. Include reportType so
  // the dashboard can show which kind of report it is.
  const draftList = await db.pipelineInspection.findMany({
    where: { ...where, status: "Draft" },
    orderBy: { updatedAt: "desc" },
    take: 10,
    include: {
      client: { select: { id: true, name: true } },
      plant: { select: { id: true, name: true, location: true } },
      _count: { select: { measurements: true, visualObservations: true } },
    },
  });

  // Returned reports — employee needs to address admin's comments
  const returnedList = await db.pipelineInspection.findMany({
    where: { ...where, status: "Returned for Revision" },
    orderBy: { updatedAt: "desc" },
    take: 10,
    include: {
      client: { select: { id: true, name: true } },
      plant: { select: { id: true, name: true, location: true } },
      returnedBy: { select: { id: true, name: true } },
      _count: { select: { measurements: true, visualObservations: true } },
    },
  });

  // Approved reports — employee can view/download
  const approvedList = await db.pipelineInspection.findMany({
    where: { ...where, status: "Approved" },
    orderBy: { updatedAt: "desc" },
    take: 10,
    include: {
      client: { select: { id: true, name: true } },
      plant: { select: { id: true, name: true, location: true } },
      approver: { select: { id: true, name: true } },
      _count: { select: { measurements: true, revisions: true, visualObservations: true } },
    },
  });

  return NextResponse.json({
    counts: {
      myTotalReports,
      myDrafts,
      mySubmitted,
      myReturned,
      myApproved,
      myChangesPending,
    },
    draftList,
    returnedList,
    approvedList,
  });
}
