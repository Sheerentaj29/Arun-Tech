"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Users,
  Plus,
  Pencil,
  UserCheck,
  UserX,
  Loader2,
  ShieldCheck,
  HardHat,
  Hourglass,
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
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Switch } from "@/components/ui/switch";
import { useAppStore } from "@/lib/store";
import { apiFetch } from "@/lib/api-client";
import { toast } from "sonner";

interface UserItem {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  accountStatus?: string;
  googleId?: string | null;
  createdAt: string;
  _count: { pipelineInspections: number; approvedReports: number; auditLogs: number };
}

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Administrator",
  EMPLOYEE: "Employee",
  INSPECTOR: "Employee (legacy INSPECTOR)",
  APPROVER: "Administrator (legacy APPROVER)",
};

export function EmployeesView() {
  const { refreshKey, refresh } = useAppStore();
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<UserItem | null>(null);
  const [form, setForm] = useState({
    email: "",
    name: "",
    role: "EMPLOYEE",
    active: true,
    password: "",
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<{ items: UserItem[] }>("/api/users")
      .then((r) => setUsers(r.items))
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  function openNew() {
    setEditing(null);
    setForm({ email: "", name: "", role: "EMPLOYEE", active: true, password: "" });
    setDialogOpen(true);
  }

  function openEdit(u: UserItem) {
    setEditing(u);
    setForm({
      email: u.email,
      name: u.name,
      role: u.role,
      active: u.active,
      password: "",
    });
    setDialogOpen(true);
  }

  async function save() {
    if (!form.email.trim() || !form.name.trim()) {
      toast.error("Email and name are required");
      return;
    }
    if (!editing && (!form.password || form.password.length < 6)) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        email: form.email.trim(),
        name: form.name.trim(),
        role: form.role,
        active: form.active,
      };
      if (form.password) payload.password = form.password;
      if (editing) {
        await apiFetch(`/api/users/${editing.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        toast.success(`Updated ${form.email}`);
      } else {
        await apiFetch("/api/users", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        toast.success(`Created ${form.email}`);
      }
      setDialogOpen(false);
      refresh();
      load();
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(u: UserItem) {
    try {
      await apiFetch(`/api/users/${u.id}`, {
        method: "PUT",
        body: JSON.stringify({ active: !u.active }),
      });
      toast.success(`${u.active ? "Deactivated" : "Activated"} ${u.email}`);
      refresh();
      load();
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message ?? "Update failed");
    }
  }

  // Approve a Google-registered account (PENDING → ACTIVE). Until approved,
  // the user cannot sign in at all — Google registration never grants access
  // on its own and never grants a role above Employee.
  async function approveAccount(u: UserItem) {
    try {
      await apiFetch(`/api/users/${u.id}`, {
        method: "PUT",
        body: JSON.stringify({ accountStatus: "ACTIVE" }),
      });
      toast.success(`Approved ${u.email} — they can now sign in with Google`);
      refresh();
      load();
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message ?? "Approval failed");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users className="h-6 w-6 text-amber-600" /> Employees
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage employee accounts and roles. Admins can approve reports; employees
            can create and submit them.
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="mr-2 h-4 w-4" /> New User
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Users ({users.length})</CardTitle>
          <CardDescription>
            Click any row to edit. Active users can log in; inactive users are
            soft-deleted (their reports + audit history are preserved).
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading && (
            <div className="flex items-center gap-2 p-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading users...
            </div>
          )}
          {!loading && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="text-center">Reports</TableHead>
                    <TableHead className="text-center">Approved</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {u.role === "ADMIN" || u.role === "APPROVER" ? (
                            <ShieldCheck className="h-3.5 w-3.5 text-amber-600" />
                          ) : (
                            <HardHat className="h-3.5 w-3.5 text-zinc-500" />
                          )}
                          <span className="text-sm font-medium">{u.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs font-mono">{u.email}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            u.role === "ADMIN" || u.role === "APPROVER"
                              ? "border-amber-500 text-amber-700"
                              : "border-zinc-400 text-zinc-700"
                          }
                        >
                          {ROLE_LABEL[u.role] ?? u.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center tabular-nums">
                        {u._count.pipelineInspections}
                      </TableCell>
                      <TableCell className="text-center tabular-nums">
                        {u._count.approvedReports}
                      </TableCell>
                      <TableCell>
                        {u.active ? (
                          u.accountStatus === "PENDING" ? (
                            <Badge variant="outline" className="border-amber-500 text-amber-700">
                              <Hourglass className="mr-1 h-3 w-3" /> Pending approval
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-emerald-500 text-emerald-700">
                              <UserCheck className="mr-1 h-3 w-3" /> Active
                            </Badge>
                          )
                        ) : (
                          <Badge variant="outline" className="border-zinc-400 text-zinc-500">
                            <UserX className="mr-1 h-3 w-3" /> Inactive
                          </Badge>
                        )}
                        {u.googleId && (
                          <span className="mt-1 block text-[10px] text-muted-foreground">
                            via Google
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(u)}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                          {u.active && u.accountStatus === "PENDING" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs text-amber-700"
                              title="Approve this Google-registered account"
                              onClick={() => approveAccount(u)}
                            >
                              <UserCheck className="mr-1 h-3 w-3" /> Approve
                            </Button>
                          )}
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                title={u.active ? "Deactivate" : "Activate"}
                              >
                                {u.active ? "Deactivate" : "Activate"}
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  {u.active ? "Deactivate" : "Activate"} {u.email}?
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  {u.active
                                    ? "The user will be signed out and can't log in. Their reports + audit history are preserved."
                                    : "The user will be able to log in again."}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => toggleActive(u)}>
                                  Confirm
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit User" : "New User"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Update user details. Leave password blank to keep current."
                : "Create a new employee or admin account."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="EMPLOYEE">Employee (create + submit reports)</SelectItem>
                  <SelectItem value="ADMIN">Administrator (approve + manage employees)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Password {editing && <span className="text-muted-foreground">(leave blank to keep current)</span>}</Label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder={editing ? "••••••" : "At least 6 characters"}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={form.active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))}
              />
              <Label className="text-sm">Active (can log in)</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
