import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Expense } from "@/types/pos";
import { expensesApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Eye } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/settings";
import { formatDatePK, formatDateTimePK } from "@/lib/utils";

const DEFAULT_CATEGORIES = ["Urgent", "Other", "Rent", "Utilities", "Salaries", "Supplies", "Maintenance"];

function expenseKindLabelClass(kind: "recorded" | "return") {
  switch (kind) {
    case "recorded":
      return "text-muted-foreground";
    case "return":
      return "text-emerald-700 dark:text-emerald-300";
    default:
      return "";
  }
}

const ExpensesPage = () => {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [logExpense, setLogExpense] = useState<Expense | null>(null);
  const [form, setForm] = useState({ amount: "", category: "", description: "" });

  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ["expenses"],
    queryFn: () => expensesApi.list(),
  });

  const { data: activityData, isLoading: activityLoading, isError: activityError } = useQuery({
    queryKey: ["expenses", logExpense?.id, "activity-log"],
    queryFn: () => expensesApi.getActivityLog(logExpense!.id),
    enabled: Boolean(logExpense?.id),
  });

  const createMutation = useMutation({
    mutationFn: (data: { amount: number; category: string; description?: string; date?: string }) =>
      expensesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"], refetchType: "all" });
      queryClient.invalidateQueries({ queryKey: ["khata"] });
      setDialogOpen(false);
      setForm({ amount: "", category: "", description: "" });
      toast.success("Expense added");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to add expense"),
  });

  const totalAmount = expenses.reduce((sum, e) => sum + e.amount, 0);

  const handleSubmit = () => {
    const amount = Number(form.amount);
    if (Number.isNaN(amount) || amount < 0) {
      toast.error("Enter a valid amount");
      return;
    }
    if (!form.category.trim()) {
      toast.error("Enter a category");
      return;
    }
    createMutation.mutate({
      amount,
      category: form.category.trim(),
      description: form.description.trim() || undefined,
    });
  };

  return (
    <div className="space-y-5 animate-slide-in">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-bold">Expenses</h1>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> Add Expense
        </Button>
      </div>

      {expenses.length > 0 && (
        <p className="text-muted-foreground text-sm">
          Total: <span className="font-semibold text-foreground">{formatCurrency(totalAmount)}</span>
        </p>
      )}

      <div className="card-elevated overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="w-[72px] text-right">Log</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : expenses.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  No expenses recorded. Add one to track shop expenses.
                </TableCell>
              </TableRow>
            ) : (
              expenses.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{formatDatePK(e.date)}</TableCell>
                  <TableCell>{e.category}</TableCell>
                  <TableCell className="max-w-[200px] truncate">{e.description || "—"}</TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(e.amount)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => setLogExpense(e)}
                      title="View expense activity"
                      aria-label="View expense activity"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Sheet open={!!logExpense} onOpenChange={(open) => !open && setLogExpense(null)}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-lg">
          <SheetHeader className="text-left">
            <SheetTitle>Expense activity</SheetTitle>
            {logExpense ? (
              <p className="text-sm font-normal text-muted-foreground">
                {logExpense.category}
                {logExpense.description ? ` · ${logExpense.description}` : ""} · {formatCurrency(logExpense.amount)}
              </p>
            ) : null}
          </SheetHeader>
          <div className="mt-4 flex min-h-0 flex-1 flex-col">
            {activityLoading ? (
              <p className="text-sm text-muted-foreground py-6">Loading…</p>
            ) : activityError ? (
              <p className="text-sm text-destructive py-6">Could not load activity.</p>
            ) : !activityData?.entries?.length ? (
              <p className="text-sm text-muted-foreground py-6">No activity entries.</p>
            ) : (
              <ScrollArea className="h-[min(70vh,32rem)] pr-3">
                <div className="space-y-2 pb-4">
                  {activityData.entries.map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-lg border border-border/80 bg-muted/30 px-3 py-2.5 text-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className={`font-medium ${expenseKindLabelClass(entry.kind)}`}>{entry.title}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {entry.at ? formatDateTimePK(entry.at) : "—"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-foreground/90 leading-snug">{entry.detail}</p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Expense</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Amount</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Input
                list="expense-categories"
                placeholder="e.g. Rent, Utilities"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              />
              <datalist id="expense-categories">
                {DEFAULT_CATEGORIES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label>Description (optional)</Label>
              <Input
                placeholder="Brief note"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <Button className="w-full" onClick={handleSubmit} disabled={createMutation.isPending}>
              {createMutation.isPending ? "Saving…" : "Save Expense"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ExpensesPage;
