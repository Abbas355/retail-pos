import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { khataApi, salesApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Wallet, Banknote, CreditCard, Search, X, Eye } from "lucide-react";
import { toast } from "sonner";

type LedgerRow = {
  saleId: string;
  customerId: string;
  customerName: string;
  items: string;
  total: number;
  paidAmount: number;
  amountDue: number;
  date: string | null;
};

const KhataPage = () => {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [recordingPaymentFor, setRecordingPaymentFor] = useState<{
    sales: LedgerRow[];
    totalBalance: number;
  } | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card">("cash");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["khata", "ledger"],
    queryFn: () => khataApi.getLedger(),
  });

  const searchLower = searchQuery.trim().toLowerCase();
  const filteredRows = useMemo(() => {
    if (!searchLower) return rows as LedgerRow[];
    return (rows as LedgerRow[]).filter((r) =>
      (r.customerName || "").toLowerCase().includes(searchLower)
    );
  }, [rows, searchLower]);

  const billSummaryByCustomer = useMemo(() => {
    const byCustomer: Record<string, { customerName: string; sales: LedgerRow[]; totalDue: number }> = {};
    for (const row of filteredRows) {
      const key = row.customerId || row.customerName;
      if (!byCustomer[key]) {
        byCustomer[key] = { customerName: row.customerName, sales: [], totalDue: 0 };
      }
      byCustomer[key].sales.push(row);
      byCustomer[key].totalDue += row.amountDue;
    }
    return Object.values(byCustomer);
  }, [filteredRows]);

  const displayRows = searchLower ? filteredRows : (rows as LedgerRow[]);
  const groupedByCustomer = useMemo(() => {
    const byCustomer: Record<string, { customerName: string; sales: LedgerRow[]; totalPaid: number; totalDue: number }> = {};
    for (const row of displayRows) {
      const key = row.customerId || row.customerName;
      if (!byCustomer[key]) {
        byCustomer[key] = { customerName: row.customerName, sales: [], totalPaid: 0, totalDue: 0 };
      }
      byCustomer[key].sales.push(row);
      byCustomer[key].totalPaid += row.paidAmount;
      byCustomer[key].totalDue += row.amountDue;
    }
    return Object.values(byCustomer);
  }, [displayRows]);

  const [detailsCustomer, setDetailsCustomer] = useState<{
    customerName: string;
    sales: LedgerRow[];
  } | null>(null);

  const recordPaymentMutation = useMutation({
    mutationFn: async ({
      sales,
      amount,
      pm,
    }: {
      sales: LedgerRow[];
      amount: number;
      pm: "cash" | "card";
    }) => {
      let remaining = amount;
      for (const sale of sales) {
        if (remaining <= 0) break;
        const pay = Math.min(remaining, sale.amountDue);
        if (pay > 0) {
          await salesApi.recordPayment(sale.saleId, { amount: pay, paymentMethod: pm });
          remaining -= pay;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["khata"] });
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      setRecordingPaymentFor(null);
      setPaymentAmount("");
      toast.success("Payment recorded");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to record payment"),
  });

  const handleRecordPayment = (isFull: boolean) => {
    if (!recordingPaymentFor) return;
    const amount = isFull
      ? recordingPaymentFor.totalBalance
      : parseFloat(paymentAmount) || 0;
    if (amount <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    if (amount > recordingPaymentFor.totalBalance) {
      toast.error("Amount exceeds balance");
      return;
    }
    recordPaymentMutation.mutate({
      sales: recordingPaymentFor.sales,
      amount,
      pm: paymentMethod,
    });
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Wallet className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-heading font-bold">Khata</h1>
            <p className="text-sm text-muted-foreground">
              Credit sales and outstanding amounts
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search customer name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          {searchQuery && (
            <Button
              variant="ghost"
              size="icon"
              title="Clear search"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {searchLower && billSummaryByCustomer.length > 0 && (
        <div className="card-elevated rounded-lg p-6 space-y-6">
          <h2 className="font-heading text-lg font-semibold">Bill Summary</h2>
          {billSummaryByCustomer.map((cust) => (
            <div key={cust.customerName} className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-foreground">{cust.customerName}</h3>
                <span className="font-heading text-lg font-bold text-primary">
                  Total due: ${cust.totalDue.toFixed(2)}
                </span>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {cust.sales.map((sale) => (
                  <li
                    key={sale.saleId}
                    className="flex justify-between items-start gap-4 py-2 border-b border-muted/50 last:border-0"
                  >
                    <span className="flex-1 min-w-0">{sale.items || "—"}</span>
                    <span className="font-medium text-foreground shrink-0">
                      ${sale.amountDue.toFixed(2)} due
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2 pt-2">
                <Button
                  size="sm"
                  onClick={() => {
                    setRecordingPaymentFor({ sales: cust.sales, totalBalance: cust.totalDue });
                    setPaymentAmount("");
                    setPaymentMethod("cash");
                  }}
                >
                  Pay
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {searchLower && billSummaryByCustomer.length === 0 && !isLoading && (
        <div className="card-elevated rounded-lg p-8 text-center">
          <p className="font-medium">No customer found</p>
          <p className="text-sm text-muted-foreground mt-1">
            No pending payments for &quot;{searchQuery}&quot;
          </p>
        </div>
      )}

      {isLoading ? (
        <p className="py-8 text-center text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card-elevated rounded-lg p-8 text-center">
          <Wallet className="mx-auto h-12 w-12 text-muted-foreground/50" strokeWidth={1.5} />
          <p className="mt-3 font-medium">No credit sales</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Use Pay later or Partial when completing a sale with a customer.
          </p>
        </div>
      ) : (
        <>
        <div className="card-elevated rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Amount Paid</TableHead>
                  <TableHead className="text-right">Amount Due</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupedByCustomer.map((cust) => (
                  <TableRow key={(cust.sales[0]?.customerId || cust.customerName) + cust.sales.map((s) => s.saleId).join("-")}>
                    <TableCell className="font-medium">{cust.customerName}</TableCell>
                    <TableCell className="text-right">${cust.totalPaid.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-semibold">${cust.totalDue.toFixed(2)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          title="View items"
                          onClick={() =>
                            setDetailsCustomer({ customerName: cust.customerName, sales: cust.sales })
                          }
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            setRecordingPaymentFor({ sales: cust.sales, totalBalance: cust.totalDue });
                            setPaymentAmount("");
                            setPaymentMethod("cash");
                          }}
                        >
                          Pay
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        <Dialog open={!!detailsCustomer} onOpenChange={() => setDetailsCustomer(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{detailsCustomer?.customerName} — Bill details</DialogTitle>
            </DialogHeader>
            {detailsCustomer && (
              <div className="space-y-3 max-h-[60vh] overflow-y-auto">
                {detailsCustomer.sales.map((sale) => (
                  <div
                    key={sale.saleId}
                    className="rounded-lg border p-3"
                  >
                    <p className="text-sm text-muted-foreground">{sale.items || "—"}</p>
                    <p className="text-sm font-medium mt-1">${sale.amountDue.toFixed(2)} due</p>
                  </div>
                ))}
              </div>
            )}
          </DialogContent>
        </Dialog>
        </>
      )}

      {/* Record payment modal */}
      {recordingPaymentFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80">
          <div className="card-elevated w-full max-w-sm rounded-lg p-6 shadow-lg">
            <h3 className="font-semibold">Record payment</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Balance: ${recordingPaymentFor.totalBalance.toFixed(2)}
            </p>
            <div className="mt-4 space-y-4">
              <div>
                <Label htmlFor="pay-amt">Amount (for partial pay)</Label>
                <Input
                  id="pay-amt"
                  type="number"
                  min={0}
                  step={0.01}
                  max={recordingPaymentFor.totalBalance}
                  placeholder={`0 - ${recordingPaymentFor.totalBalance.toFixed(2)}`}
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                />
              </div>
              <div>
                <Label>Method</Label>
                <div className="flex gap-2 mt-1">
                  <Button
                    variant={paymentMethod === "cash" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPaymentMethod("cash")}
                  >
                    <Banknote className="h-4 w-4 mr-1" /> Cash
                  </Button>
                  <Button
                    variant={paymentMethod === "card" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPaymentMethod("card")}
                  >
                    <CreditCard className="h-4 w-4 mr-1" /> Card
                  </Button>
                </div>
              </div>
            </div>
            <div className="mt-6 flex flex-col gap-2">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => handleRecordPayment(false)}
                  disabled={recordPaymentMutation.isPending || !paymentAmount}
                >
                  {recordPaymentMutation.isPending ? "Saving…" : "Partial pay"}
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => handleRecordPayment(true)}
                  disabled={recordPaymentMutation.isPending}
                >
                  {recordPaymentMutation.isPending ? "Saving…" : "Full pay"}
                </Button>
              </div>
              <Button
                variant="ghost"
                onClick={() => {
                  setRecordingPaymentFor(null);
                  setPaymentAmount("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default KhataPage;
