import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { productsApi, suppliersApi, purchasesApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Trash2, UserPlus, PackagePlus, Banknote, CreditCard } from "lucide-react";
import { toast } from "sonner";
import { formatDatePK } from "@/lib/utils";

type PurchaseItemRow = { productId: string; productName: string; quantity: number; cost: number };

const PurchasesPage = () => {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [items, setItems] = useState<PurchaseItemRow[]>([]);
  const [amountPaid, setAmountPaid] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card">("cash");

  const [newSupplierOpen, setNewSupplierOpen] = useState(false);
  const [newSupplierForm, setNewSupplierForm] = useState({ name: "", phone: "", email: "" });

  const [newProductOpen, setNewProductOpen] = useState(false);
  const [newProductForRow, setNewProductForRow] = useState<number | null>(null);
  const [newProductForm, setNewProductForm] = useState({ name: "", price: "", cost: "", category: "" });

  const { data: products = [], isLoading: productsLoading } = useQuery({
    queryKey: ["products"],
    queryFn: () => productsApi.list(),
  });

  const { data: suppliers = [], isLoading: suppliersLoading } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => suppliersApi.list(),
  });

  const { data: purchases = [], isLoading: purchasesLoading } = useQuery({
    queryKey: ["purchases"],
    queryFn: () => purchasesApi.list(),
  });

  const createSupplierMutation = useMutation({
    mutationFn: (data: { name: string; phone?: string; email?: string }) => suppliersApi.create(data),
    onSuccess: (created: { id: string }) => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      setSelectedSupplier(created.id);
      setNewSupplierOpen(false);
      setNewSupplierForm({ name: "", phone: "", email: "" });
      toast.success("Supplier added");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to add supplier"),
  });

  const createProductMutation = useMutation({
    mutationFn: (payload: { name: string; price: number; cost?: number; category?: string; forRow?: number | null }) =>
      productsApi.create({
        name: payload.name,
        price: payload.price,
        cost: payload.cost ?? 0,
        category: payload.category ?? "General",
      }),
    onSuccess: (created: { id: string; name: string; cost?: number }, variables) => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      const forRow = variables.forRow;
      if (forRow != null) {
        setItems((prev) =>
          prev.map((item, idx) =>
            idx === forRow
              ? { productId: created.id, productName: created.name, quantity: item.quantity || 1, cost: created.cost ?? 0 }
              : item
          )
        );
      } else {
        setItems((prev) => [...prev, { productId: created.id, productName: created.name, quantity: 1, cost: created.cost ?? 0 }]);
      }
      setNewProductOpen(false);
      setNewProductForRow(null);
      setNewProductForm({ name: "", price: "", cost: "", category: "" });
      toast.success("Product added");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to add product"),
  });

  const createPurchaseMutation = useMutation({
    mutationFn: (payload: {
      supplierId: string;
      items: { productId: string; productName: string; quantity: number; cost: number }[];
      total: number;
      paidAmount: number;
      paymentMethod: "cash" | "card";
    }) =>
      purchasesApi.create({
        supplierId: payload.supplierId,
        items: payload.items,
        total: payload.total,
        paidAmount: payload.paidAmount || undefined,
        paymentMethod: payload.paidAmount > 0 ? payload.paymentMethod : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchases"] });
      queryClient.invalidateQueries({ queryKey: ["khata"] });
      setDialogOpen(false);
      setItems([]);
      setSelectedSupplier("");
      setAmountPaid(0);
      setPaymentMethod("cash");
      toast.success("Purchase recorded. Any amount due is in Khata → Suppliers.");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to record purchase"),
  });

  const addItem = () => setItems([...items, { productId: "", productName: "", quantity: 1, cost: 0 }]);
  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const updateItem = (i: number, field: keyof PurchaseItemRow, value: string | number) =>
    setItems(items.map((item, idx) => (idx === i ? { ...item, [field]: value } : item)));

  const onSelectProduct = (i: number, productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (p) {
      const productCost = Number(p.cost);
      const productPrice = Number(p.price);
      // Use product's cost if set and > 0, otherwise use price so the field shows existing value; user can edit either way
      const cost = productCost > 0 ? productCost : (productPrice >= 0 ? productPrice : 0);
      setItems((prev) =>
        prev.map((item, idx) =>
          idx === i
            ? { ...item, productId, productName: p.name ?? "", cost }
            : item
        )
      );
    }
  };

  const total = items.reduce((sum, i) => sum + i.cost * i.quantity, 0);
  const amountDue = Math.max(0, total - amountPaid);

  const recordPurchase = () => {
    if (!selectedSupplier || items.length === 0) {
      toast.error("Select supplier and add items");
      return;
    }
    const invalid = items.some((i) => !i.productId || !i.productName);
    if (invalid) {
      toast.error("Select a product for every item");
      return;
    }
    const pay = Math.max(0, Math.min(amountPaid, total));
    createPurchaseMutation.mutate({
      supplierId: selectedSupplier,
      items: items.map((i) => ({ productId: i.productId, productName: i.productName, quantity: i.quantity, cost: i.cost })),
      total,
      paidAmount: pay,
      paymentMethod,
    });
  };

  const openNewSupplier = () => setNewSupplierOpen(true);
  const openNewProduct = (forRow?: number) => {
    setNewProductForRow(forRow ?? null);
    setNewProductOpen(true);
  };

  const handleNewSupplierSubmit = () => {
    const name = newSupplierForm.name.trim();
    if (!name) {
      toast.error("Supplier name is required");
      return;
    }
    createSupplierMutation.mutate({
      name,
      phone: newSupplierForm.phone.trim() || undefined,
      email: newSupplierForm.email.trim() || undefined,
    });
  };

  const handleNewProductSubmit = () => {
    const name = newProductForm.name.trim();
    const price = parseFloat(newProductForm.price);
    const cost = parseFloat(newProductForm.cost) || 0;
    if (!name || isNaN(price) || price < 0) {
      toast.error("Product name and price are required");
      return;
    }
    createProductMutation.mutate({
      name,
      price,
      cost: isNaN(cost) ? 0 : cost,
      category: newProductForm.category.trim() || "General",
      forRow: newProductForRow ?? undefined,
    });
  };

  const supplierName = (id: string) => suppliers.find((s) => s.id === id)?.name ?? id;

  return (
    <div className="space-y-5 animate-slide-in">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-bold">Purchases</h1>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> New Purchase
        </Button>
      </div>

      <div className="card-elevated overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Items</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {purchasesLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : purchases.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  No purchases recorded
                </TableCell>
              </TableRow>
            ) : (
              purchases.slice().reverse().map((p: any) => {
                const paid = p.paidAmount ?? 0;
                const due = Math.max(0, (p.total ?? 0) - paid);
                const status = due <= 0 ? "Paid" : paid > 0 ? "Partial" : "Due";
                return (
                  <TableRow key={p.id}>
                    <TableCell>{formatDatePK(p.date)}</TableCell>
                    <TableCell>{supplierName(p.supplierId)}</TableCell>
                    <TableCell>
                      {p.items?.map((i: any) => `${i.productName || "?"} (${i.quantity})`).join(", ")}
                    </TableCell>
                    <TableCell className="text-right font-semibold">${Number(p.total).toFixed(2)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{status}</TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* New Purchase dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Record Purchase</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Supplier</Label>
              <div className="flex gap-2">
                <Select value={selectedSupplier} onValueChange={setSelectedSupplier} disabled={suppliersLoading}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select supplier" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" size="icon" onClick={openNewSupplier} title="Add new supplier">
                  <UserPlus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Items</Label>
              {items.map((item, i) => (
                <div key={i} className="flex gap-2 items-center flex-wrap">
                  <Select
                    value={item.productId ? item.productId : undefined}
                    onValueChange={(v) => (v === "_new" ? openNewProduct(i) : v ? onSelectProduct(i, v) : undefined)}
                    disabled={productsLoading}
                  >
                    <SelectTrigger className="flex-1 min-w-[140px]">
                      <SelectValue placeholder="Select product" />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                      <SelectItem value="_new">
                        <span className="flex items-center gap-1 text-primary">
                          <PackagePlus className="h-3 w-3" /> Add new product
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    className="w-20"
                    type="number"
                    min={1}
                    placeholder="Qty"
                    value={item.quantity || ""}
                    onChange={(e) => updateItem(i, "quantity", Number(e.target.value) || 1)}
                  />
                  <Input
                    className="w-24"
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="Cost"
                    value={item.cost ?? ""}
                    onChange={(e) => updateItem(i, "cost", parseFloat(e.target.value) || 0)}
                  />
                  <button
                    type="button"
                    onClick={() => removeItem(i)}
                    className="text-muted-foreground hover:text-destructive p-1"
                    aria-label="Remove item"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={addItem}>
                  <Plus className="mr-1 h-3 w-3" /> Add Item
                </Button>
                <Button variant="ghost" size="sm" onClick={() => openNewProduct()}>
                  <PackagePlus className="mr-1 h-3 w-3" /> New product
                </Button>
              </div>
            </div>

            <div className="flex justify-between items-center pt-2 border-t font-bold">
              <span>Total</span>
              <span>${total.toFixed(2)}</span>
            </div>

            <div className="space-y-3 border-t pt-4">
              <Label>Payment at purchase</Label>
              <p className="text-sm text-muted-foreground">
                Pay now or leave due in Khata (Suppliers). Any amount not paid will appear in Khata → Suppliers.
              </p>
              <div className="flex gap-4 flex-wrap items-center">
                <div className="space-y-1">
                  <Label className="text-xs">Amount paid now</Label>
                  <Input
                    type="number"
                    min={0}
                    max={total}
                    step={0.01}
                    value={amountPaid || ""}
                    onChange={(e) => setAmountPaid(Math.max(0, Math.min(total, parseFloat(e.target.value) || 0)))}
                    placeholder="0"
                    className="w-32"
                  />
                </div>
                <div className="flex gap-2 items-center">
                  <Button
                    type="button"
                    variant={paymentMethod === "cash" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPaymentMethod("cash")}
                  >
                    <Banknote className="h-4 w-4 mr-1" /> Cash
                  </Button>
                  <Button
                    type="button"
                    variant={paymentMethod === "card" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPaymentMethod("card")}
                  >
                    <CreditCard className="h-4 w-4 mr-1" /> Card
                  </Button>
                </div>
              </div>
              {amountDue > 0 && (
                <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                  ${amountDue.toFixed(2)} will be due in Khata → Suppliers
                </p>
              )}
            </div>

            <Button
              className="w-full"
              onClick={recordPurchase}
              disabled={createPurchaseMutation.isPending || !selectedSupplier || items.length === 0}
            >
              {createPurchaseMutation.isPending ? "Saving…" : "Record Purchase"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add new supplier dialog */}
      <Dialog open={newSupplierOpen} onOpenChange={setNewSupplierOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add supplier</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="sup-name">Name *</Label>
              <Input
                id="sup-name"
                value={newSupplierForm.name}
                onChange={(e) => setNewSupplierForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Supplier name"
              />
            </div>
            <div>
              <Label htmlFor="sup-phone">Phone</Label>
              <Input
                id="sup-phone"
                value={newSupplierForm.phone}
                onChange={(e) => setNewSupplierForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="Phone"
              />
            </div>
            <div>
              <Label htmlFor="sup-email">Email</Label>
              <Input
                id="sup-email"
                type="email"
                value={newSupplierForm.email}
                onChange={(e) => setNewSupplierForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="Email"
              />
            </div>
            <Button className="w-full" onClick={handleNewSupplierSubmit} disabled={createSupplierMutation.isPending}>
              {createSupplierMutation.isPending ? "Adding…" : "Add supplier"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add new product dialog */}
      <Dialog open={newProductOpen} onOpenChange={setNewProductOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add product</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="prod-name">Name *</Label>
              <Input
                id="prod-name"
                value={newProductForm.name}
                onChange={(e) => setNewProductForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Product name"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="prod-price">Price *</Label>
                <Input
                  id="prod-price"
                  type="number"
                  min={0}
                  step={0.01}
                  value={newProductForm.price}
                  onChange={(e) => setNewProductForm((f) => ({ ...f, price: e.target.value }))}
                  placeholder="0"
                />
              </div>
              <div>
                <Label htmlFor="prod-cost">Cost</Label>
                <Input
                  id="prod-cost"
                  type="number"
                  min={0}
                  step={0.01}
                  value={newProductForm.cost}
                  onChange={(e) => setNewProductForm((f) => ({ ...f, cost: e.target.value }))}
                  placeholder="0"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="prod-cat">Category</Label>
              <Input
                id="prod-cat"
                value={newProductForm.category}
                onChange={(e) => setNewProductForm((f) => ({ ...f, category: e.target.value }))}
                placeholder="General"
              />
            </div>
            <Button className="w-full" onClick={handleNewProductSubmit} disabled={createProductMutation.isPending}>
              {createProductMutation.isPending ? "Adding…" : "Add product & add to items"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PurchasesPage;
