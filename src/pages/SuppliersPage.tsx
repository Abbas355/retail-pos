import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Supplier } from "@/types/pos";
import { suppliersApi, purchasesApi, type SupplierActivityEntry } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Pencil, Eye } from "lucide-react";
import { toast } from "sonner";
import { formatDateTimePK } from "@/lib/utils";

const emptySupplier = { name: "", phone: "", email: "" };

function activityKindLabelClass(kind: SupplierActivityEntry["kind"]) {
  switch (kind) {
    case "purchase":
      return "text-blue-600 dark:text-blue-400";
    case "purchase_payment":
    case "khata_payment":
      return "text-emerald-600 dark:text-emerald-400";
    case "khata_udhaar":
      return "text-amber-600 dark:text-amber-400";
    case "created":
    default:
      return "text-muted-foreground";
  }
}

const SuppliersPage = () => {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [form, setForm] = useState(emptySupplier);
  const [logSupplier, setLogSupplier] = useState<Supplier | null>(null);

  const { data: suppliers = [], isLoading: suppliersLoading } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => suppliersApi.list(),
  });

  const { data: purchases = [] } = useQuery({
    queryKey: ["purchases"],
    queryFn: () => purchasesApi.list(),
  });

  const { data: activityData, isLoading: activityLoading, isError: activityError } = useQuery({
    queryKey: ["suppliers", logSupplier?.id, "activity-log"],
    queryFn: () => suppliersApi.getActivityLog(logSupplier!.id),
    enabled: Boolean(logSupplier?.id),
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
                        onClick={() => setLogSupplier(s)}
                        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="Activity log"
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

      <Sheet open={!!logSupplier} onOpenChange={(open) => !open && setLogSupplier(null)}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-lg">
          <SheetHeader className="text-left">
            <SheetTitle>Supplier activity</SheetTitle>
            {logSupplier ? (
              <p className="text-sm font-normal text-muted-foreground">{logSupplier.name}</p>
            ) : null}
          </SheetHeader>
          <div className="mt-4 flex min-h-0 flex-1 flex-col">
            {activityLoading ? (
              <p className="text-sm text-muted-foreground py-6">Loading…</p>
            ) : activityError ? (
              <p className="text-sm text-destructive py-6">Could not load activity.</p>
            ) : !activityData?.entries?.length ? (
              <p className="text-sm text-muted-foreground py-6">No activity recorded for this supplier yet.</p>
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

export default SuppliersPage;
