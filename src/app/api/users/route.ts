// GET  /api/users - list all users (admin only)
// POST /api/users - create a new user (admin only)

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { hashPassword } from "@/lib/password";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // PERMISSION: only admins can list all users.
  if (session.dashboardRole !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden — administrator role required" }, { status: 403 });
  }
  // Order by role then name. Include the count of reports each user owns.
  const users = await db.user.findMany({
    orderBy: [{ role: "asc" }, { name: "asc" }],
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      active: true,
      accountStatus: true,
      googleId: true,
      createdAt: true,
      _count: {
        select: {
          pipelineInspections: true,
          approvedReports: true,
          auditLogs: true,
        },
      },
    },
  });
  return NextResponse.json({ items: users });
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.dashboardRole !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden — administrator role required" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  if (!body.email || !body.name || !body.password) {
    return NextResponse.json({ error: "Email, name and password are required" }, { status: 400 });
  }
  if (typeof body.password !== "string" || body.password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }
  // Normalize role: accept ADMIN, EMPLOYEE, INSPECTOR, APPROVER.
  // APPROVER is legacy — recommended new accounts use ADMIN or EMPLOYEE.
  const validRoles = ["ADMIN", "EMPLOYEE", "INSPECTOR", "APPROVER"];
  const role = validRoles.includes(body.role) ? body.role : "EMPLOYEE";

  const existing = await db.user.findUnique({ where: { email: String(body.email).toLowerCase() } });
  if (existing) {
    return NextResponse.json({ error: "Email already registered" }, { status: 409 });
  }

  const created = await db.user.create({
    data: {
      email: String(body.email).toLowerCase(),
      name: String(body.name),
      passwordHash: await hashPassword(String(body.password)),
      role,
      active: body.active !== false,
    },
  });

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "CREATE", entity: "User", entityId: created.id,
    details: `Created user ${created.email} (role: ${created.role})`,
  });

  return NextResponse.json({
    id: created.id,
    email: created.email,
    name: created.name,
    role: created.role,
    active: created.active,
    createdAt: created.createdAt,
  }, { status: 201 });
}
