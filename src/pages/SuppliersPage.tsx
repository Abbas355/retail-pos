import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Supplier } from "@/types/pos";
import { useAuth } from "@/context/AuthContext";
import { suppliersApi, purchasesApi } from "@/lib/api";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, Eye } from "lucide-react";
import { toast } from "sonner";

const emptySupplier = { name: "", phone: "", email: "" };

const SuppliersPage = () => {
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [form, setForm] = useState(emptySupplier);
  const [historySupplier, setHistorySupplier] = useState<Supplier | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null);

  const { data: suppliers = [], isLoading: suppliersLoading } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => suppliersApi.list(),
  });

  const { data: purchases = [] } = useQuery({
    queryKey: ["purchases"],
    queryFn: () => purchasesApi.list(),
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; phone?: string; email?: string }) => suppliersApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      setDialogOpen(false);
      setForm(emptySupplier);
      toast.success("Supplier added");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to add supplier"),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: { name: string; phone?: string; email?: string };
    }) => suppliersApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      setDialogOpen(false);
      setEditingSupplier(null);
      setForm(emptySupplier);
      toast.success("Supplier updated");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to update supplier"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      suppliersApi.delete(id, {
        deletedBy: (user?.name?.trim() || user?.username?.trim() || "Unknown") || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      setDeleteTarget(null);
      toast.success("Supplier removed from list (record kept in database)");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to remove supplier"),
  });

  const openAdd = () => {
    setEditingSupplier(null);
    setForm(emptySupplier);
    setDialogOpen(true);
  };

  const openEdit = (s: Supplier) => {
    setEditingSupplier(s);
    setForm({
      name: s.name,
      phone: s.phone ?? "",
      email: s.email ?? "",
    });
    setDialogOpen(true);
  };

  const handleSave = () => {
    const name = form.name?.trim();
    if (!name) {
      toast.error("Name is required");
      return;
    }
    if (editingSupplier) {
      updateMutation.mutate({
        id: editingSupplier.id,
        data: {
          name,
          phone: form.phone?.trim() || undefined,
          email: form.email?.trim() || undefined,
        },
      });
    } else {
      createMutation.mutate({
        name,
        phone: form.phone?.trim() || undefined,
        email: form.email?.trim() || undefined,
      });
    }
  };

  const confirmDelete = (s: Supplier) => setDeleteTarget(s);
  const doDelete = () => {
    if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
  };

  const supplierPurchases = historySupplier
    ? purchases.filter((p) => p.supplierId === historySupplier.id)
    : [];
  const getPurchaseCount = (supplierId: string) =>
    purchases.filter((p) => p.supplierId === supplierId).length;

  return (
    <div className="space-y-5 animate-slide-in">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-bold">Suppliers</h1>
        <Button onClick={openAdd}>
          <Plus className="mr-1 h-4 w-4" /> Add Supplier
        </Button>
      </div>

      <div className="card-elevated overflow-hidden">
        {suppliersLoading ? (
          <p className="p-6 text-center text-muted-foreground">Loading suppliers...</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="text-right">Purchases</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppliers.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>{s.phone ?? "—"}</TableCell>
                  <TableCell>{s.email ?? "—"}</TableCell>
                  <TableCell className="text-right">{getPurchaseCount(s.id)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => setHistorySupplier(s)}
                        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="View purchase history"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => openEdit(s)}
                        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      {isAdmin && (
                        <button
                          onClick={() => confirmDelete(s)}
                          className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                          title="Remove from list (soft delete)"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {!suppliersLoading && suppliers.length === 0 && (
          <p className="p-6 text-center text-muted-foreground">
            No suppliers yet. Add one to get started.
          </p>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingSupplier ? "Edit Supplier" : "Add Supplier"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Supplier name"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Phone</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="Phone (optional)"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="Email (optional)"
              />
            </div>
            <Button
              onClick={handleSave}
              disabled={
                createMutation.isPending ||
                updateMutation.isPending ||
                !form.name?.trim()
              }
            >
              {editingSupplier ? "Update" : "Add"} Supplier
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove supplier from list?</AlertDialogTitle>
            <AlertDialogDescription>
              This will hide &quot;{deleteTarget?.name}&quot; from the list. The record is kept in the
              database with deletion date and your name for audit. You can restore it later from the
              database if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={doDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Removing…" : "Remove from list"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!historySupplier} onOpenChange={() => setHistorySupplier(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Purchase History — {historySupplier?.name}</DialogTitle>
          </DialogHeader>
          {supplierPurchases.length === 0 ? (
            <p className="py-4 text-center text-muted-foreground">No purchase history</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-auto">
              {supplierPurchases.map((p) => (
                <div
                  key={p.id}
                  className="flex justify-between rounded-lg bg-muted px-4 py-2.5 text-sm"
                >
                  <div>
                    <p className="font-medium">
                      {(p.items ?? [])
                        .map((i) => `${i.productName ?? ""} (${i.quantity})`)
                        .filter(Boolean)
                        .join(", ") || "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {p.date ? new Date(p.date).toLocaleString() : "—"}
                    </p>
                  </div>
                  <span className="font-semibold">${Number(p.total).toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SuppliersPage;
