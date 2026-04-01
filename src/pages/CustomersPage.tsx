import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Customer } from "@/types/pos";
import { customersApi } from "@/lib/api";
import { salesApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Eye, Pencil } from "lucide-react";
import { toast } from "sonner";
import { formatDateTimePK } from "@/lib/utils";
import type { CustomerActivityEntry } from "@/lib/api";

const emptyCustomer = { name: "", phone: "" };

function activityKindLabelClass(kind: CustomerActivityEntry["kind"]) {
  switch (kind) {
    case "sale":
      return "text-blue-600 dark:text-blue-400";
    case "sale_payment":
    case "khata_payment":
      return "text-emerald-600 dark:text-emerald-400";
    case "khata_udhaar":
      return "text-amber-600 dark:text-amber-400";
    case "created":
    default:
      return "text-muted-foreground";
  }
}

const CustomersPage = () => {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [form, setForm] = useState(emptyCustomer);
  const [logCustomer, setLogCustomer] = useState<Customer | null>(null);

  const { data: customers = [], isLoading: customersLoading } = useQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.list(),
  });

  const { data: sales = [] } = useQuery({
    queryKey: ["sales"],
    queryFn: () => salesApi.list(),
  });

  const { data: activityData, isLoading: activityLoading, isError: activityError } = useQuery({
    queryKey: ["customers", logCustomer?.id, "activity-log"],
    queryFn: () => customersApi.getActivityLog(logCustomer!.id),
    enabled: Boolean(logCustomer?.id),
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

  const getPurchaseCount = (customerId: string) =>
    sales.filter((s) => s.customerId === customerId).length;

  const isElectron = typeof window !== "undefined" && !!window.electronAPI;

  return (
    <div className="space-y-5 animate-slide-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">Customers</h1>
          {isElectron && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              Add works offline. Use &quot;Sync with MySQL&quot; in the sidebar when online to sync with the main database.
            </p>
          )}
        </div>
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
                        onClick={() => setLogCustomer(c)}
                        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="Activity log"
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

      <Sheet open={!!logCustomer} onOpenChange={(open) => !open && setLogCustomer(null)}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-lg">
          <SheetHeader className="text-left">
            <SheetTitle>Customer activity</SheetTitle>
            {logCustomer ? (
              <p className="text-sm font-normal text-muted-foreground">{logCustomer.name}</p>
            ) : null}
          </SheetHeader>
          <div className="mt-4 flex min-h-0 flex-1 flex-col">
            {activityLoading ? (
              <p className="text-sm text-muted-foreground py-6">Loading…</p>
            ) : activityError ? (
              <p className="text-sm text-destructive py-6">Could not load activity.</p>
            ) : !activityData?.entries?.length ? (
              <p className="text-sm text-muted-foreground py-6">No activity recorded for this customer yet.</p>
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

export default CustomersPage;
