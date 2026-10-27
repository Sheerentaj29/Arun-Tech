// PUT    /api/users/[id] - update user (admin only — name, role, active, password)
// DELETE /api/users/[id] - deactivate user (admin only; never delete — preserves audit trail)

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { hashPassword } from "@/lib/password";

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.dashboardRole !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden — administrator role required" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const existing = await db.user.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  // Role validation
  const validRoles = ["ADMIN", "EMPLOYEE", "INSPECTOR", "APPROVER"];
  const newRole = validRoles.includes(body.role) ? body.role : existing.role;

  // Email unique check
  const newEmail = body.email ? String(body.email).toLowerCase() : existing.email;
  if (newEmail !== existing.email) {
    const dupe = await db.user.findUnique({ where: { email: newEmail } });
    if (dupe && dupe.id !== id) {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }
  }

  // Password: only update if a new one is provided
  const passwordHash = body.password && String(body.password).length >= 6
    ? await hashPassword(String(body.password))
    : existing.passwordHash;

  // Don't allow the last admin to be demoted/deactivated (lockout protection)
  if (existing.role === "ADMIN" && newRole !== "ADMIN") {
    const adminCount = await db.user.count({ where: { role: "ADMIN", active: true } });
    if (adminCount <= 1) {
      return NextResponse.json(
        { error: "Cannot demote the last remaining administrator. Promote another user to ADMIN first." },
        { status: 400 },
      );
    }
  }
  if (existing.role === "ADMIN" && body.active === false) {
    const adminCount = await db.user.count({ where: { role: "ADMIN", active: true } });
    if (adminCount <= 1) {
      return NextResponse.json(
        { error: "Cannot deactivate the last remaining administrator. Promote another user to ADMIN first." },
        { status: 400 },
      );
    }
  }

  const updated = await db.user.update({
    where: { id },
    data: {
      email: newEmail,
      name: body.name ?? existing.name,
      role: newRole,
      active: body.active !== undefined ? Boolean(body.active) : existing.active,
      passwordHash,
    },
    select: { id: true, email: true, name: true, role: true, active: true, updatedAt: true },
  });

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "UPDATE", entity: "User", entityId: updated.id,
    details: `Updated user ${updated.email} (role: ${updated.role}, active: ${updated.active})`,
  });

  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.dashboardRole !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden — administrator role required" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const existing = await db.user.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Don't let the admin deactivate themselves or the last admin.
  if (session.id === id) {
    return NextResponse.json(
      { error: "Cannot deactivate your own account. Ask another administrator to do it." },
      { status: 400 },
    );
  }
  if (existing.role === "ADMIN") {
    const adminCount = await db.user.count({ where: { role: "ADMIN", active: true } });
    if (adminCount <= 1) {
      return NextResponse.json(
        { error: "Cannot deactivate the last remaining administrator. Promote another user to ADMIN first." },
        { status: 400 },
      );
    }
  }

  // Soft-delete: set active=false. We never hard-delete users because their
  // audit trail and ownership of reports needs to be preserved.
  const updated = await db.user.update({
    where: { id },
    data: { active: false },
  });

  await recordAudit({
    userId: session.id, userName: session.name,
    action: "DELETE", entity: "User", entityId: id,
    details: `Deactivated user ${existing.email} (soft delete)`,
  });

  return NextResponse.json({ ok: true, active: updated.active });
}
