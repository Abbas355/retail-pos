import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Customer } from "@/types/pos";
import { useAuth } from "@/context/AuthContext";
import { customersApi } from "@/lib/api";
import { salesApi } from "@/lib/api";
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
import { Plus, Eye, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

const emptyCustomer = { name: "", phone: "" };

const CustomersPage = () => {
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [form, setForm] = useState(emptyCustomer);
  const [historyCustomer, setHistoryCustomer] = useState<Customer | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);

  const { data: customers = [], isLoading: customersLoading } = useQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.list(),
  });

  const { data: sales = [] } = useQuery({
    queryKey: ["sales"],
    queryFn: () => salesApi.list(),
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; phone?: string }) => customersApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setDialogOpen(false);
      setForm(emptyCustomer);
      toast.success("Customer added");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to add customer"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name: string; phone?: string } }) =>
      customersApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setDialogOpen(false);
      setEditingCustomer(null);
      setForm(emptyCustomer);
      toast.success("Customer updated");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to update customer"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      customersApi.delete(id, {
        deletedBy: (user?.name?.trim() || user?.username?.trim() || "Unknown") || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setDeleteTarget(null);
      toast.success("Customer removed from list (record kept in database)");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to remove customer"),
  });

  const openAdd = () => {
    setEditingCustomer(null);
    setForm(emptyCustomer);
    setDialogOpen(true);
  };

  const openEdit = (c: Customer) => {
    setEditingCustomer(c);
    setForm({ name: c.name, phone: c.phone ?? "" });
    setDialogOpen(true);
  };

  const handleSave = () => {
    const name = form.name?.trim();
    if (!name) {
      toast.error("Name is required");
      return;
    }
    if (editingCustomer) {
      updateMutation.mutate({
        id: editingCustomer.id,
        data: { name, phone: form.phone?.trim() || undefined },
      });
    } else {
      createMutation.mutate({ name, phone: form.phone?.trim() || undefined });
    }
  };

  const confirmDelete = (c: Customer) => setDeleteTarget(c);
  const doDelete = () => {
    if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
  };

  const customerSales = historyCustomer
    ? sales.filter((s) => s.customerId === historyCustomer.id)
    : [];
  const getPurchaseCount = (customerId: string) =>
    sales.filter((s) => s.customerId === customerId).length;

  return (
    <div className="space-y-5 animate-slide-in">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-bold">Customers</h1>
        <Button onClick={openAdd}>
          <Plus className="mr-1 h-4 w-4" /> Add Customer
        </Button>
      </div>

      <div className="card-elevated overflow-hidden">
        {customersLoading ? (
          <p className="p-6 text-center text-muted-foreground">Loading customers...</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="text-right">Purchases</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>{c.phone ?? "—"}</TableCell>
                  <TableCell className="text-right">{getPurchaseCount(c.id)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => setHistoryCustomer(c)}
                        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="View history"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => openEdit(c)}
                        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      {isAdmin && (
                        <button
                          onClick={() => confirmDelete(c)}
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
        {!customersLoading && customers.length === 0 && (
          <p className="p-6 text-center text-muted-foreground">No customers yet. Add one to get started.</p>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCustomer ? "Edit Customer" : "Add Customer"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Customer name"
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
            <Button
              onClick={handleSave}
              disabled={
                createMutation.isPending ||
                updateMutation.isPending ||
                !form.name?.trim()
              }
            >
              {editingCustomer ? "Update" : "Add"} Customer
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove customer from list?</AlertDialogTitle>
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

      <Dialog open={!!historyCustomer} onOpenChange={() => setHistoryCustomer(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Purchase History — {historyCustomer?.name}</DialogTitle>
          </DialogHeader>
          {customerSales.length === 0 ? (
            <p className="py-4 text-center text-muted-foreground">No purchase history</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-auto">
              {customerSales.map((s) => (
                <div
                  key={s.id}
                  className="flex justify-between rounded-lg bg-muted px-4 py-2.5 text-sm"
                >
                  <div>
                    <p className="font-medium">
                      {(s.items ?? []).map((i) => i.productName ?? i.product?.name).filter(Boolean).join(", ") || "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {s.date ? new Date(s.date).toLocaleString() : "—"}
                    </p>
                  </div>
                  <span className="font-semibold">${Number(s.total).toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CustomersPage;
