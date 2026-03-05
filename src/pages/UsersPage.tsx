import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { usersApi, permissionsApi, type ApiUser } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, Check, UserCog } from "lucide-react";
import { toast } from "sonner";

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

const UsersPage = () => {
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<ApiUser | null>(null);
  const [form, setForm] = useState({ username: "", name: "", role: "cashier" as string, password: "" });
  const [deleteTarget, setDeleteTarget] = useState<ApiUser | null>(null);

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

  const createMutation = useMutation({
    mutationFn: (data: { username: string; password: string; name: string; role: string }) =>
      usersApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setDialogOpen(false);
      setForm({ username: "", name: "", role: "cashier", password: "" });
      toast.success("User created");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to create user"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; role?: string; password?: string } }) =>
      usersApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setDialogOpen(false);
      setEditingUser(null);
      setForm({ username: "", name: "", role: "cashier", password: "" });
      toast.success("User updated");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to update user"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => usersApi.delete(id, { currentUserId: currentUser?.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setDeleteTarget(null);
      toast.success("User removed");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to delete user"),
  });

  const roleHasPermission = (role: string, permissionKey: string) =>
    rolePermissions.some((r) => r.role === role && r.permission_key === permissionKey);

  const openAdd = () => {
    setEditingUser(null);
    setForm({ username: "", name: "", role: "cashier", password: "" });
    setDialogOpen(true);
  };

  const openEdit = (u: ApiUser) => {
    setEditingUser(u);
    setForm({ username: u.username, name: u.name, role: u.role, password: "" });
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
          ...(form.password ? { password: form.password } : {}),
        },
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

  const doDelete = () => {
    if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
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
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.username}</TableCell>
                <TableCell>{u.name}</TableCell>
                <TableCell className="capitalize">{u.role}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <button
                      onClick={() => openEdit(u)}
                      className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      title="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(u)}
                      disabled={currentUser?.id === u.id}
                      className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50 disabled:pointer-events-none"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
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

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove user?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &quot;{deleteTarget?.username}&quot;. They will no longer be
              able to sign in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={doDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default UsersPage;
