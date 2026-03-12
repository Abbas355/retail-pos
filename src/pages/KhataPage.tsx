import { useState } from "react";
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
import { Wallet, Banknote, CreditCard } from "lucide-react";
import { toast } from "sonner";

const KhataPage = () => {
  const queryClient = useQueryClient();
  const [recordingPaymentFor, setRecordingPaymentFor] = useState<{ saleId: string; balance: number } | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card">("cash");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["khata", "ledger"],
    queryFn: () => khataApi.getLedger(),
  });

  const recordPaymentMutation = useMutation({
    mutationFn: ({ saleId, amount, pm }: { saleId: string; amount: number; pm: "cash" | "card" }) =>
      salesApi.recordPayment(saleId, { amount, paymentMethod: pm }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["khata"] });
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      setRecordingPaymentFor(null);
      setPaymentAmount("");
      toast.success("Payment recorded");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to record payment"),
  });

  const handleRecordPayment = () => {
    if (!recordingPaymentFor) return;
    const amount = parseFloat(paymentAmount) || 0;
    if (amount <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    if (amount > recordingPaymentFor.balance) {
      toast.error("Amount exceeds balance");
      return;
    }
    recordPaymentMutation.mutate({
      saleId: recordingPaymentFor.saleId,
      amount,
      pm: paymentMethod,
    });
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Wallet className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-heading font-bold">Khata</h1>
          <p className="text-sm text-muted-foreground">
            Credit sales and outstanding amounts
          </p>
        </div>
      </div>

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
        <div className="card-elevated rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead className="text-right">Amount Paid</TableHead>
                  <TableHead className="text-right">Amount Due</TableHead>
                  <TableHead className="text-right w-[100px]">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.saleId}>
                    <TableCell className="font-medium">{row.customerName}</TableCell>
                    <TableCell className="max-w-[240px] truncate text-muted-foreground" title={row.items}>
                      {row.items || "—"}
                    </TableCell>
                    <TableCell className="text-right">${row.paidAmount.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-semibold">${row.amountDue.toFixed(2)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        onClick={() => {
                          setRecordingPaymentFor({ saleId: row.saleId, balance: row.amountDue });
                          setPaymentAmount("");
                          setPaymentMethod("cash");
                        }}
                      >
                        Pay
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Record payment modal */}
      {recordingPaymentFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80">
          <div className="card-elevated w-full max-w-sm rounded-lg p-6 shadow-lg">
            <h3 className="font-semibold">Record payment</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Balance: ${recordingPaymentFor.balance.toFixed(2)}
            </p>
            <div className="mt-4 space-y-4">
              <div>
                <Label htmlFor="pay-amt">Amount</Label>
                <Input
                  id="pay-amt"
                  type="number"
                  min={0}
                  step={0.01}
                  max={recordingPaymentFor.balance}
                  placeholder={`0 - ${recordingPaymentFor.balance.toFixed(2)}`}
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
            <div className="mt-6 flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setRecordingPaymentFor(null);
                  setPaymentAmount("");
                }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={handleRecordPayment}
                disabled={recordPaymentMutation.isPending || !paymentAmount}
              >
                {recordPaymentMutation.isPending ? "Saving…" : "Record"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default KhataPage;
