import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { khataApi, salesApi, purchasesApi } from "@/lib/api";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Wallet, Banknote, CreditCard, Search, X, Eye, Users, Truck, ArrowDownToLine, Plus } from "lucide-react";
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

/** One unpaid/partial purchase from supplier-ledger list (for grouped table) */
type SupplierLedgerRow = {
  purchaseId: string;
  supplierId: string;
  supplierName: string;
  items: string;
  total: number;
  paidAmount: number;
  amountDue: number;
  date: string | null;
};

/** Purchase entry from getSupplierLedger (for record payment mutation) */
type SupplierLedgerPurchase = {
  id: string;
  total: number;
  paidAmount: number;
  paymentStatus: string;
  balance: number;
  date: string | null;
  type: "purchase";
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

  const [activeTab, setActiveTab] = useState<"customers" | "suppliers" | "cashin">("customers");
  const [supplierSearchQuery, setSupplierSearchQuery] = useState("");
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [detailsSupplier, setDetailsSupplier] = useState<{
    supplierName: string;
    purchases: SupplierLedgerRow[];
  } | null>(null);
  const [supplierPaymentFor, setSupplierPaymentFor] = useState<{
    supplierId: string;
    supplierName: string;
    purchases: SupplierLedgerPurchase[];
    totalBalance: number;
  } | null>(null);
  const [supplierPaymentAmount, setSupplierPaymentAmount] = useState("");
  const [supplierPaymentMethod, setSupplierPaymentMethod] = useState<"cash" | "card">("cash");

  const [cashInDialogOpen, setCashInDialogOpen] = useState(false);
  const [cashInAmount, setCashInAmount] = useState("");
  const [cashInNote, setCashInNote] = useState("");
  const [cashInDate, setCashInDate] = useState("");
  const [recordReturnFor, setRecordReturnFor] = useState<{
    id: string;
    amount: number;
    returnedAmount: number;
    balance: number;
    category: string;
    description: string;
    date: string;
  } | null>(null);
  const [returnAmount, setReturnAmount] = useState("");
  const [returnNote, setReturnNote] = useState("");
  const [returnDate, setReturnDate] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["khata", "ledger"],
    queryFn: () => khataApi.getLedger(),
  });

  const { data: supplierLedgerRows = [], isLoading: supplierLedgerLoading } = useQuery({
    queryKey: ["khata", "supplier-ledger"],
    queryFn: () => khataApi.getSupplierLedgerList(),
    enabled: activeTab === "suppliers",
  });

  const { data: supplierLedger, isLoading: supplierLedgerDetailLoading } = useQuery({
    queryKey: ["khata", "supplier", selectedSupplierId],
    queryFn: () => khataApi.getSupplierLedger(selectedSupplierId!),
    enabled: activeTab === "suppliers" && !!selectedSupplierId,
  });

  const { data: cashInList = [], isLoading: cashInLoading } = useQuery({
    queryKey: ["khata", "cash-in"],
    queryFn: () => khataApi.listCashIn(),
    enabled: activeTab === "cashin",
  });

  const { data: advancesOut = [], isLoading: advancesOutLoading } = useQuery({
    queryKey: ["khata", "advances-out"],
    queryFn: () => khataApi.getAdvancesOut(),
    enabled: activeTab === "cashin",
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

  const supplierSearchLower = supplierSearchQuery.trim().toLowerCase();
  const filteredSupplierRows = useMemo(() => {
    if (!supplierSearchLower) return supplierLedgerRows as SupplierLedgerRow[];
    return (supplierLedgerRows as SupplierLedgerRow[]).filter((r) =>
      (r.supplierName || "").toLowerCase().includes(supplierSearchLower)
    );
  }, [supplierLedgerRows, supplierSearchLower]);

  const displaySupplierRows = supplierSearchLower ? filteredSupplierRows : (supplierLedgerRows as SupplierLedgerRow[]);
  const groupedBySupplier = useMemo(() => {
    const bySupplier: Record<
      string,
      { supplierId: string; supplierName: string; purchases: SupplierLedgerRow[]; totalPaid: number; totalDue: number }
    > = {};
    for (const row of displaySupplierRows) {
      const key = row.supplierId;
      if (!bySupplier[key]) {
        bySupplier[key] = { supplierId: row.supplierId, supplierName: row.supplierName, purchases: [], totalPaid: 0, totalDue: 0 };
      }
      bySupplier[key].purchases.push(row);
      bySupplier[key].totalPaid += row.paidAmount;
      bySupplier[key].totalDue += row.amountDue;
    }
    return Object.values(bySupplier);
  }, [displaySupplierRows]);

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

  const recordSupplierPaymentMutation = useMutation({
    mutationFn: async ({
      purchases,
      amount,
      pm,
    }: {
      purchases: SupplierLedgerPurchase[];
      amount: number;
      pm: "cash" | "card";
    }) => {
      const sorted = [...purchases].sort(
        (a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime()
      );
      let remaining = amount;
      for (const p of sorted) {
        if (remaining <= 0 || p.balance <= 0) continue;
        const pay = Math.min(remaining, p.balance);
        if (pay > 0) {
          await purchasesApi.recordPayment(p.id, { amount: pay, paymentMethod: pm });
          remaining -= pay;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["khata"] });
      queryClient.invalidateQueries({ queryKey: ["purchases"] });
      queryClient.invalidateQueries({ queryKey: ["khata", "supplier-ledger"] });
      setSupplierPaymentFor(null);
      setSupplierPaymentAmount("");
      if (selectedSupplierId) {
        queryClient.invalidateQueries({ queryKey: ["khata", "supplier", selectedSupplierId] });
      }
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

  const createCashInMutation = useMutation({
    mutationFn: (data: { amount: number; note?: string; date?: string; expenseId?: string }) => khataApi.createCashIn(data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["khata", "cash-in"] });
      queryClient.invalidateQueries({ queryKey: ["khata", "advances-out"] });
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      setCashInDialogOpen(false);
      setCashInAmount("");
      setCashInNote("");
      setCashInDate("");
      if (variables.expenseId) {
        setRecordReturnFor(null);
        setReturnAmount("");
        setReturnNote("");
        setReturnDate("");
        toast.success("Return recorded");
      } else {
        toast.success("Cash in recorded");
      }
    },
    onError: (err: Error) => toast.error(err.message || "Failed to record cash in"),
  });

  const handleRecordReturn = (isFull: boolean) => {
    if (!recordReturnFor) return;
    const amount = isFull ? recordReturnFor.balance : parseFloat(returnAmount) || 0;
    if (amount <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    if (amount > recordReturnFor.balance) {
      toast.error("Amount exceeds balance");
      return;
    }
    createCashInMutation.mutate({
      amount,
      note: returnNote.trim() || undefined,
      date: returnDate.trim() || undefined,
      expenseId: recordReturnFor.id,
    });
  };

  const handleRecordSupplierPayment = (isFull: boolean) => {
    if (!supplierPaymentFor) return;
    const amount = isFull
      ? supplierPaymentFor.totalBalance
      : parseFloat(supplierPaymentAmount) || 0;
    if (amount <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    if (amount > supplierPaymentFor.totalBalance) {
      toast.error("Amount exceeds balance");
      return;
    }
    recordSupplierPaymentMutation.mutate({
      purchases: supplierPaymentFor.purchases,
      amount,
      pm: supplierPaymentMethod,
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
              Customers and suppliers — credit and outstanding amounts
            </p>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "customers" | "suppliers" | "cashin")}>
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="customers" className="flex items-center gap-2">
            <Users className="h-4 w-4" /> Customers
          </TabsTrigger>
          <TabsTrigger value="suppliers" className="flex items-center gap-2">
            <Truck className="h-4 w-4" /> Suppliers
          </TabsTrigger>
          <TabsTrigger value="cashin" className="flex items-center gap-2">
            <ArrowDownToLine className="h-4 w-4" /> Cash in
          </TabsTrigger>
        </TabsList>

        <TabsContent value="customers" className="space-y-6 mt-6">
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
        </TabsContent>

        <TabsContent value="suppliers" className="space-y-6 mt-6">
          <div className="flex gap-2">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search supplier name..."
                value={supplierSearchQuery}
                onChange={(e) => setSupplierSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            {supplierSearchQuery && (
              <Button variant="ghost" size="icon" title="Clear search" onClick={() => setSupplierSearchQuery("")} aria-label="Clear search">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          {supplierLedgerLoading ? (
            <p className="py-8 text-center text-muted-foreground">Loading…</p>
          ) : groupedBySupplier.length === 0 ? (
            <div className="card-elevated rounded-lg p-8 text-center">
              <Truck className="mx-auto h-12 w-12 text-muted-foreground/50" strokeWidth={1.5} />
              <p className="mt-3 font-medium">No supplier balance</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Purchases (credit) and payments appear here. Record a purchase with partial or no payment to see it in Khata.
              </p>
            </div>
          ) : !selectedSupplierId ? (
            <div className="card-elevated rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Supplier</TableHead>
                      <TableHead className="text-right">Amount paid</TableHead>
                      <TableHead className="text-right">Balance due</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groupedBySupplier.map((sup) => (
                      <TableRow key={sup.supplierId}>
                        <TableCell className="font-medium">{sup.supplierName}</TableCell>
                        <TableCell className="text-right">${sup.totalPaid.toFixed(2)}</TableCell>
                        <TableCell className="text-right font-semibold">${sup.totalDue.toFixed(2)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              title="View purchases"
                              onClick={() => setDetailsSupplier({ supplierName: sup.supplierName, purchases: sup.purchases })}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => {
                                const purchasesForPayment: SupplierLedgerPurchase[] = sup.purchases.map((p) => ({
                                  id: p.purchaseId,
                                  total: p.total,
                                  paidAmount: p.paidAmount,
                                  paymentStatus: p.paidAmount >= p.total ? "paid" : "partial",
                                  balance: p.amountDue,
                                  date: p.date,
                                  type: "purchase",
                                }));
                                setSupplierPaymentFor({
                                  supplierId: sup.supplierId,
                                  supplierName: sup.supplierName,
                                  purchases: purchasesForPayment,
                                  totalBalance: sup.totalDue,
                                });
                                setSupplierPaymentAmount("");
                                setSupplierPaymentMethod("cash");
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
          ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Button variant="ghost" size="sm" onClick={() => setSelectedSupplierId(null)}>
                      ← Back to suppliers
                    </Button>
                    {supplierLedger && (
                      <span className="font-heading text-lg font-bold text-primary">
                        Balance: ${supplierLedger.balance.toFixed(2)}
                      </span>
                    )}
                  </div>
                  {supplierLedgerDetailLoading ? (
                    <p className="py-6 text-center text-muted-foreground">Loading ledger…</p>
                  ) : supplierLedger ? (
                    <div className="card-elevated rounded-lg overflow-hidden">
                      <div className="p-4 border-b">
                        <h3 className="font-heading font-semibold">{supplierLedger.supplier.name}</h3>
                        {supplierLedger.supplier.phone && (
                          <p className="text-sm text-muted-foreground">{supplierLedger.supplier.phone}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">What we have to pay (purchases) and what we paid (payments)</p>
                      </div>
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Date</TableHead>
                              <TableHead>Type</TableHead>
                              <TableHead className="text-right">Amount</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {supplierLedger.ledger.map((entry) => (
                              <TableRow key={entry.id}>
                                <TableCell className="text-muted-foreground text-sm">
                                  {entry.date ? new Date(entry.date).toLocaleDateString() : "—"}
                                </TableCell>
                                <TableCell>
                                  {entry.type === "purchase" ? "Purchase (due)" : "Payment (paid)"}
                                </TableCell>
                                <TableCell className="text-right font-medium">
                                  {entry.type === "purchase"
                                    ? `$${(entry as SupplierLedgerPurchase).balance.toFixed(2)} due`
                                    : `-$${entry.amount.toFixed(2)} paid`}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                      <div className="p-4 border-t flex justify-end">
                        <Button
                          size="sm"
                          disabled={supplierLedger.balance <= 0}
                          onClick={() => {
                            const purchases = supplierLedger.ledger.filter(
                              (e): e is SupplierLedgerPurchase => e.type === "purchase" && (e as SupplierLedgerPurchase).balance > 0
                            );
                            setSupplierPaymentFor({
                              supplierId: supplierLedger.supplier.id,
                              supplierName: supplierLedger.supplier.name,
                              purchases,
                              totalBalance: supplierLedger.balance,
                            });
                            setSupplierPaymentAmount("");
                            setSupplierPaymentMethod("cash");
                          }}
                        >
                          Record payment
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

          <Dialog open={!!detailsSupplier} onOpenChange={() => setDetailsSupplier(null)}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{detailsSupplier?.supplierName} — Purchase details</DialogTitle>
              </DialogHeader>
              {detailsSupplier && (
                <div className="space-y-3 max-h-[60vh] overflow-y-auto">
                  {detailsSupplier.purchases.map((p) => (
                    <div key={p.purchaseId} className="rounded-lg border p-3">
                      <p className="text-sm text-muted-foreground">{p.items || "—"}</p>
                      <p className="text-sm font-medium mt-1">${p.amountDue.toFixed(2)} due</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Paid ${p.paidAmount.toFixed(2)} of ${p.total.toFixed(2)}
                      </p>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      if (detailsSupplier.purchases.length > 0) {
                        setSelectedSupplierId(detailsSupplier.purchases[0].supplierId);
                        setDetailsSupplier(null);
                      }
                    }}
                  >
                    View full ledger (payments + purchases)
                  </Button>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="cashin" className="space-y-6 mt-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Expenses with category <strong>Urgent</strong> or <strong>Other</strong> appear below as given out. Record returns here.
            </p>
            <Button onClick={() => { setCashInDialogOpen(true); setCashInDate(""); setCashInAmount(""); setCashInNote(""); }}>
              <Plus className="mr-1 h-4 w-4" /> Add cash in
            </Button>
          </div>

          {advancesOutLoading ? (
            <p className="py-4 text-center text-muted-foreground text-sm">Loading given out…</p>
          ) : advancesOut.length > 0 ? (
            <div className="card-elevated rounded-lg overflow-hidden">
              <h3 className="font-heading font-semibold p-4 border-b">Given out (pending return)</h3>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Given</TableHead>
                      <TableHead className="text-right">Balance due</TableHead>
                      <TableHead className="w-[120px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {advancesOut.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="text-muted-foreground text-sm">
                          {e.date ? new Date(e.date).toLocaleDateString() : "—"}
                        </TableCell>
                        <TableCell>{e.category}</TableCell>
                        <TableCell>{e.description || "—"}</TableCell>
                        <TableCell className="text-right">${e.amount.toFixed(2)}</TableCell>
                        <TableCell className="text-right font-semibold">${e.balance.toFixed(2)}</TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setRecordReturnFor(e);
                              setReturnAmount("");
                              setReturnNote(e.description || "");
                              setReturnDate("");
                            }}
                          >
                            Record return
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}

          <h3 className="font-heading font-semibold">Received back</h3>
          {cashInLoading ? (
            <p className="py-8 text-center text-muted-foreground">Loading…</p>
          ) : cashInList.length === 0 ? (
            <div className="card-elevated rounded-lg p-8 text-center">
              <ArrowDownToLine className="mx-auto h-12 w-12 text-muted-foreground/50" strokeWidth={1.5} />
              <p className="mt-3 font-medium">No cash in recorded</p>
              <p className="mt-1 text-sm text-muted-foreground">
                When someone returns money you gave (record &quot;out&quot; in Expenses), add it here.
              </p>
            </div>
          ) : (
            <div className="card-elevated rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Note</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cashInList.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="text-muted-foreground text-sm">
                          {entry.date ? new Date(entry.date).toLocaleDateString() : "—"}
                        </TableCell>
                        <TableCell>{entry.note || "—"}</TableCell>
                        <TableCell className="text-right font-semibold">+${entry.amount.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="p-4 border-t flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Total received</span>
                <span className="font-heading font-bold text-primary">
                  ${cashInList.reduce((s, e) => s + e.amount, 0).toFixed(2)}
                </span>
              </div>
            </div>
          )}

          <Dialog open={cashInDialogOpen} onOpenChange={setCashInDialogOpen}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Add cash in (advance returned)</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="cashin-amount">Amount *</Label>
                  <Input
                    id="cashin-amount"
                    type="number"
                    min={0}
                    step={0.01}
                    value={cashInAmount}
                    onChange={(e) => setCashInAmount(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <Label htmlFor="cashin-note">Note (who / reason)</Label>
                  <Input
                    id="cashin-note"
                    value={cashInNote}
                    onChange={(e) => setCashInNote(e.target.value)}
                    placeholder="e.g. Ahmed returned"
                  />
                </div>
                <div>
                  <Label htmlFor="cashin-date">Date</Label>
                  <Input
                    id="cashin-date"
                    type="date"
                    value={cashInDate}
                    onChange={(e) => setCashInDate(e.target.value)}
                  />
                </div>
                <Button
                  className="w-full"
                  disabled={createCashInMutation.isPending || !cashInAmount || parseFloat(cashInAmount) <= 0}
                  onClick={() => {
                    const amount = parseFloat(cashInAmount);
                    if (isNaN(amount) || amount <= 0) return;
                    createCashInMutation.mutate({
                      amount,
                      note: cashInNote.trim() || undefined,
                      date: cashInDate.trim() || undefined,
                    });
                  }}
                >
                  {createCashInMutation.isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={!!recordReturnFor} onOpenChange={(open) => !open && setRecordReturnFor(null)}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Record return</DialogTitle>
              </DialogHeader>
              {recordReturnFor && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Balance due: <span className="font-semibold text-foreground">${recordReturnFor.balance.toFixed(2)}</span>
                    {recordReturnFor.returnedAmount > 0 && (
                      <span className="block text-xs mt-0.5">Already returned: ${recordReturnFor.returnedAmount.toFixed(2)} of ${recordReturnFor.amount.toFixed(2)}</span>
                    )}
                  </p>
                  <div>
                    <Label htmlFor="return-amount">Amount (partial return)</Label>
                    <Input
                      id="return-amount"
                      type="number"
                      min={0}
                      step={0.01}
                      max={recordReturnFor.balance}
                      value={returnAmount}
                      onChange={(e) => setReturnAmount(e.target.value)}
                      placeholder={`0 - ${recordReturnFor.balance.toFixed(2)}`}
                    />
                  </div>
                  <div>
                    <Label htmlFor="return-note">Note</Label>
                    <Input
                      id="return-note"
                      value={returnNote}
                      onChange={(e) => setReturnNote(e.target.value)}
                      placeholder="e.g. Ahmed returned"
                    />
                  </div>
                  <div>
                    <Label htmlFor="return-date">Date</Label>
                    <Input
                      id="return-date"
                      type="date"
                      value={returnDate}
                      onChange={(e) => setReturnDate(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="flex-1"
                        disabled={createCashInMutation.isPending || !returnAmount || parseFloat(returnAmount) <= 0}
                        onClick={() => handleRecordReturn(false)}
                      >
                        {createCashInMutation.isPending ? "Saving…" : "Partial return"}
                      </Button>
                      <Button
                        className="flex-1"
                        disabled={createCashInMutation.isPending}
                        onClick={() => handleRecordReturn(true)}
                      >
                        {createCashInMutation.isPending ? "Saving…" : "Full return"}
                      </Button>
                    </div>
                    <Button variant="ghost" onClick={() => setRecordReturnFor(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </TabsContent>
      </Tabs>

      {/* Record payment modal (customer) */}
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

      {/* Record payment modal (supplier) */}
      {supplierPaymentFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80">
          <div className="card-elevated w-full max-w-sm rounded-lg p-6 shadow-lg">
            <h3 className="font-semibold">Record payment — {supplierPaymentFor.supplierName}</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Balance: ${supplierPaymentFor.totalBalance.toFixed(2)}
            </p>
            <div className="mt-4 space-y-4">
              <div>
                <Label htmlFor="supplier-pay-amt">Amount (partial pay)</Label>
                <Input
                  id="supplier-pay-amt"
                  type="number"
                  min={0}
                  step={0.01}
                  max={supplierPaymentFor.totalBalance}
                  placeholder={`0 - ${supplierPaymentFor.totalBalance.toFixed(2)}`}
                  value={supplierPaymentAmount}
                  onChange={(e) => setSupplierPaymentAmount(e.target.value)}
                />
              </div>
              <div>
                <Label>Method</Label>
                <div className="flex gap-2 mt-1">
                  <Button
                    variant={supplierPaymentMethod === "cash" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSupplierPaymentMethod("cash")}
                  >
                    <Banknote className="h-4 w-4 mr-1" /> Cash
                  </Button>
                  <Button
                    variant={supplierPaymentMethod === "card" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSupplierPaymentMethod("card")}
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
                  onClick={() => handleRecordSupplierPayment(false)}
                  disabled={recordSupplierPaymentMutation.isPending || !supplierPaymentAmount}
                >
                  {recordSupplierPaymentMutation.isPending ? "Saving…" : "Partial pay"}
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => handleRecordSupplierPayment(true)}
                  disabled={recordSupplierPaymentMutation.isPending}
                >
                  {recordSupplierPaymentMutation.isPending ? "Saving…" : "Full pay"}
                </Button>
              </div>
              <Button
                variant="ghost"
                onClick={() => {
                  setSupplierPaymentFor(null);
                  setSupplierPaymentAmount("");
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
