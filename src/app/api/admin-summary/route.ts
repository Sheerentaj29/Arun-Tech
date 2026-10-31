// GET /api/admin-summary - dashboard summary cards for admins
//
// Returns counts for:
//   totalReports
//   pendingApprovals   (status = "Submitted for Review")
//   changesPending     (status = "Changes Pending Review")
//   approvedReports    (status = "Approved")
//   returnedReports    (status = "Returned for Revision")
//   draftReports       (status = "Draft")
//   totalEmployees     (users with role EMPLOYEE / INSPECTOR, active)
//   totalAdmins        (users with role ADMIN / APPROVER, active)
//
// Plus the 10 most-recent pending-approval reports and the 10 most-recent
// audit entries for context on the admin dashboard.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.dashboardRole !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden — administrator role required" }, { status: 403 });
  }

  const [
    totalReports,
    pendingApprovals,
    changesPending,
    approvedReports,
    returnedReports,
    draftReports,
    totalEmployees,
    totalAdmins,
  ] = await Promise.all([
    db.pipelineInspection.count(),
    db.pipelineInspection.count({ where: { status: "Submitted for Review" } }),
    db.pipelineInspection.count({ where: { status: "Changes Pending Review" } }),
    db.pipelineInspection.count({ where: { status: "Approved" } }),
    db.pipelineInspection.count({ where: { status: "Returned for Revision" } }),
    db.pipelineInspection.count({ where: { status: "Draft" } }),
    db.user.count({ where: { role: { in: ["EMPLOYEE", "INSPECTOR"] }, active: true } }),
    db.user.count({ where: { role: { in: ["ADMIN", "APPROVER"] }, active: true } }),
  ]);

  // Recent pending approvals for the list view
  const pendingApprovalsList = await db.pipelineInspection.findMany({
    where: { status: { in: ["Submitted for Review", "Changes Pending Review"] } },
    orderBy: { updatedAt: "desc" },
    take: 10,
    include: {
      client: { select: { id: true, name: true } },
      plant: { select: { id: true, name: true, location: true } },
      inspector: { select: { id: true, name: true, email: true } },
      _count: {
        select: {
          measurements: true,
          revisions: true,
          visualObservations: true,
        },
      },
    },
  });

  // Recent audit entries for context
  const recentActivity = await db.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      userName: true,
      action: true,
      entity: true,
      details: true,
      createdAt: true,
    },
  });

  // Recent approved reports for the "approved reports" list
  const recentApproved = await db.pipelineInspection.findMany({
    where: { status: "Approved" },
    orderBy: { updatedAt: "desc" },
    take: 5,
    include: {
      client: { select: { id: true, name: true } },
      inspector: { select: { id: true, name: true } },
      approver: { select: { id: true, name: true } },
      _count: { select: { measurements: true, revisions: true } },
    },
  });

  return NextResponse.json({
    counts: {
      totalReports,
      pendingApprovals,
      changesPending,
      approvedReports,
      returnedReports,
      draftReports,
      totalEmployees,
      totalAdmins,
    },
    pendingApprovalsList,
    recentApproved,
    recentActivity,
  });
}
