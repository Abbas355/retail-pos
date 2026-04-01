import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { usersApi, permissionsApi, type ApiUser, type UserActivityEntry } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Pencil, Check, UserCog, Eye } from "lucide-react";
import { toast } from "sonner";
import { formatDateTimePK } from "@/lib/utils";

const ROLES = ["admin", "manager", "cashier"] as const;

function permissionToLabel(key: string): string {
  const map: Record<string, string> = {
    view_dashboard: "Dashboard",
    view_sales: "Sales",
    manage_sales: "Sales",
    view_inventory: "Inventory",
    manage_inventory: "Inventory",
    delete_products: "Inventory",
    view_customers: "Customers",
    manage_customers: "Customers",
    delete_customers: "Customers",
    view_purchases: "Purchases",
    manage_purchases: "Purchases",
    view_suppliers: "Suppliers",
    manage_suppliers: "Suppliers",
    delete_suppliers: "Suppliers",
    view_reports: "Reports",
    manage_users: "Users",
  };
  return map[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function activityKindLabelClass(kind: UserActivityEntry["kind"]) {
  switch (kind) {
    case "password_changed":
      return "text-amber-600 dark:text-amber-400";
    case "login_disabled":
    case "deleted":
      return "text-destructive";
    case "login_enabled":
      return "text-emerald-600 dark:text-emerald-400";
    case "updated":
      return "text-blue-600 dark:text-blue-400";
    case "created":
    default:
      return "text-muted-foreground";
  }
}

const UsersPage = () => {
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<ApiUser | null>(null);
  const [form, setForm] = useState({
    username: "",
    name: "",
    role: "cashier" as string,
    password: "",
    disabled: false,
  });
  const [logUser, setLogUser] = useState<ApiUser | null>(null);

  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: () => usersApi.list(),
  });

  const { data: permissions = [] } = useQuery({
    queryKey: ["permissions"],
    queryFn: () => permissionsApi.list(),
  });

  const { data: rolePermissions = [] } = useQuery({
    queryKey: ["rolePermissions"],
    queryFn: () => permissionsApi.listRolePermissions(),
  });

  const { data: activityData, isLoading: activityLoading, isError: activityError } = useQuery({
    queryKey: ["users", logUser?.id, "activity-log"],
    queryFn: () => usersApi.getActivityLog(logUser!.id),
    enabled: Boolean(logUser?.id),
  });

  const createMutation = useMutation({
    mutationFn: (data: { username: string; password: string; name: string; role: string }) =>
      usersApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setDialogOpen(false);
      setForm({ username: "", name: "", role: "cashier", password: "", disabled: false });
      toast.success("User created");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to create user"),
  });

  const updateMutation = useMutation({
    mutationFn: (vars: {
      id: string;
      data: { name?: string; role?: string; password?: string; disabled?: boolean };
      currentUserId?: string;
    }) => usersApi.update(vars.id, vars.data, { currentUserId: vars.currentUserId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setDialogOpen(false);
      setEditingUser(null);
      setForm({ username: "", name: "", role: "cashier", password: "", disabled: false });
      toast.success("User updated");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to update user"),
  });

  const roleHasPermission = (role: string, permissionKey: string) =>
    rolePermissions.some((r) => r.role === role && r.permission_key === permissionKey);

  const openAdd = () => {
    setEditingUser(null);
    setForm({ username: "", name: "", role: "cashier", password: "", disabled: false });
    setDialogOpen(true);
  };

  const openEdit = (u: ApiUser) => {
    setEditingUser(u);
    setForm({
      username: u.username,
      name: u.name,
      role: u.role,
      password: "",
      disabled: Boolean(u.disabled),
    });
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (editingUser) {
      if (!form.name?.trim()) {
        toast.error("Name is required");
        return;
      }
      updateMutation.mutate({
        id: editingUser.id,
        data: {
          name: form.name.trim(),
          role: form.role,
          disabled: form.disabled,
          ...(form.password ? { password: form.password } : {}),
        },
        currentUserId: currentUser?.id,
      });
    } else {
      if (!form.username?.trim() || !form.password) {
        toast.error("Username and password are required");
        return;
      }
      createMutation.mutate({
        username: form.username.trim(),
        password: form.password,
        name: form.name.trim() || form.username.trim(),
        role: form.role,
      });
    }
  };

  const roleHasAnyForLabel = (role: string, label: string) => {
    const keysForLabel = permissions
      .filter((p) => permissionToLabel(p.permission_key) === label)
      .map((p) => p.permission_key);
    return keysForLabel.some((key) => roleHasPermission(role, key));
  };

  const permissionLabels = Array.from(
    new Set(permissions.map((p) => permissionToLabel(p.permission_key)))
  ).sort();

  const editingSelf = Boolean(editingUser && currentUser?.id === editingUser.id);

  return (
    <div className="space-y-6 animate-slide-in">
      <h1 className="font-heading text-2xl font-bold">User Management</h1>

      <div className="card-elevated overflow-hidden rounded-lg">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold flex items-center gap-2">
            <UserCog className="h-5 w-5" /> Users
          </h2>
          <Button onClick={openAdd}>
            <Plus className="mr-1 h-4 w-4" /> Add User
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Username</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.username}</TableCell>
                <TableCell>{u.name}</TableCell>
                <TableCell className="capitalize">{u.role}</TableCell>
                <TableCell>
                  {u.disabled ? (
                    <span className="text-xs font-medium text-destructive">Login disabled</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Active</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => setLogUser(u)}
                      className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      title="Activity log"
                      aria-label="Activity log"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(u)}
                      className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      title="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="card-elevated rounded-lg overflow-hidden">
        <div className="p-4 border-b">
          <h2 className="font-heading text-lg font-semibold">Role permissions</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Permissions assigned to each role (from database)
          </p>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[180px]">Permission</TableHead>
                <TableHead className="text-center w-[120px]">Admin</TableHead>
                <TableHead className="text-center w-[120px]">Manager</TableHead>
                <TableHead className="text-center w-[120px]">Cashier</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {permissionLabels.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                    No permissions in database. Run seed:roles to populate.
                  </TableCell>
                </TableRow>
              ) : (
                permissionLabels.map((label) => (
                  <TableRow key={label}>
                    <TableCell className="font-medium">{label}</TableCell>
                    <TableCell className="text-center">
                      {roleHasAnyForLabel("admin", label) ? (
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-green-600 text-white">
                          <Check className="h-3.5 w-3.5" />
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {roleHasAnyForLabel("manager", label) ? (
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-green-600 text-white">
                          <Check className="h-3.5 w-3.5" />
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {roleHasAnyForLabel("cashier", label) ? (
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-green-600 text-white">
                          <Check className="h-3.5 w-3.5" />
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingUser ? "Edit User" : "Add User"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>Username</Label>
              <Input
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="Username"
                disabled={!!editingUser}
              />
              {editingUser && (
                <p className="text-xs text-muted-foreground">Username cannot be changed</p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Full name"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r.charAt(0).toUpperCase() + r.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {editingUser && (
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border/80 bg-muted/20 px-3 py-3">
                <div className="space-y-0.5 min-w-0">
                  <Label htmlFor="user-disable-login" className="text-sm">
                    Disable login
                  </Label>
                  <p className="text-xs text-muted-foreground leading-snug">
                    When enabled, this user cannot sign in until you turn this off.
                  </p>
                  {editingSelf && (
                    <p className="text-xs text-amber-600 dark:text-amber-500 pt-0.5">
                      You cannot disable your own account.
                    </p>
                  )}
                </div>
                <Switch
                  id="user-disable-login"
                  checked={form.disabled}
                  onCheckedChange={(checked) => setForm((f) => ({ ...f, disabled: checked }))}
                  disabled={editingSelf}
                  className="shrink-0"
                />
              </div>
            )}
            <div className="grid gap-1.5">
              <Label>Password {editingUser && "(leave blank to keep current)"}</Label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={editingUser ? "Optional" : "Required for new user"}
              />
            </div>
            <Button
              onClick={handleSave}
              disabled={
                createMutation.isPending ||
                updateMutation.isPending ||
                (!editingUser && (!form.username?.trim() || !form.password)) ||
                (!!editingUser && !form.name?.trim())
              }
            >
              {editingUser ? "Update" : "Create"} User
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Sheet open={!!logUser} onOpenChange={(open) => !open && setLogUser(null)}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-lg">
          <SheetHeader className="text-left">
            <SheetTitle>User activity</SheetTitle>
            {logUser ? (
              <p className="text-sm font-normal text-muted-foreground">
                {logUser.name || logUser.username} · @{logUser.username}
              </p>
            ) : null}
          </SheetHeader>
          <div className="mt-4 flex min-h-0 flex-1 flex-col">
            {activityLoading ? (
              <p className="text-sm text-muted-foreground py-6">Loading…</p>
            ) : activityError ? (
              <p className="text-sm text-destructive py-6">Could not load activity.</p>
            ) : !activityData?.entries?.length ? (
              <p className="text-sm text-muted-foreground py-6">No activity recorded for this user yet.</p>
            ) : (
              <ScrollArea className="h-[min(70vh,32rem)] pr-3">
                <div className="space-y-2 pb-4">
                  {activityData.entries.map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-lg border border-border/80 bg-muted/30 px-3 py-2.5 text-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className={`font-medium ${activityKindLabelClass(entry.kind)}`}>{entry.title}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatDateTimePK(entry.at)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-foreground/90 leading-snug">{entry.detail}</p>
                      {entry.meta ? (
                        <p className="mt-1 text-xs text-muted-foreground">By {entry.meta}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default UsersPage;
