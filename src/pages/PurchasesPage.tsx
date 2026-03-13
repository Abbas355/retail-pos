import { useState } from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { SEED_PRODUCTS, SEED_SUPPLIERS } from "@/data/seedData";
import { Product, Supplier, Purchase } from "@/types/pos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Minus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatDatePK } from "@/lib/utils";

const PurchasesPage = () => {
  const [products, setProducts] = useLocalStorage<Product[]>("pos_products", SEED_PRODUCTS);
  const [suppliers] = useLocalStorage<Supplier[]>("pos_suppliers", SEED_SUPPLIERS);
  const [purchases, setPurchases] = useLocalStorage<Purchase[]>("pos_purchases", []);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [items, setItems] = useState<{ productId: string; quantity: number; cost: number }[]>([]);

  const addItem = () => setItems([...items, { productId: "", quantity: 1, cost: 0 }]);
  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const updateItem = (i: number, field: string, value: any) =>
    setItems(items.map((item, idx) => (idx === i ? { ...item, [field]: value } : item)));

  const total = items.reduce((sum, i) => sum + i.cost * i.quantity, 0);

  const recordPurchase = () => {
    if (!selectedSupplier || items.length === 0) { toast.error("Select supplier and add items"); return; }
    if (items.some((i) => !i.productId)) { toast.error("Select product for all items"); return; }

    const purchase: Purchase = {
      id: `pur-${Date.now()}`,
      supplierId: selectedSupplier,
      items: items.map((i) => ({
        ...i,
        productName: products.find((p) => p.id === i.productId)?.name || "",
      })),
      total,
      date: new Date().toISOString(),
    };
    setPurchases([...purchases, purchase]);

    // Increase stock
    setProducts(products.map((p) => {
      const purchaseItem = items.find((i) => i.productId === p.id);
      return purchaseItem ? { ...p, stock: p.stock + purchaseItem.quantity } : p;
    }));

    setDialogOpen(false);
    setItems([]);
    setSelectedSupplier("");
    toast.success("Purchase recorded, stock updated!");
  };

  return (
    <div className="space-y-5 animate-slide-in">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-bold">Purchases</h1>
        <Button onClick={() => setDialogOpen(true)}><Plus className="mr-1 h-4 w-4" /> New Purchase</Button>
      </div>

      <div className="card-elevated overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Items</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {purchases.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No purchases recorded</TableCell></TableRow>
            ) : purchases.slice().reverse().map((p) => (
              <TableRow key={p.id}>
                <TableCell>{formatDatePK(p.date)}</TableCell>
                <TableCell>{suppliers.find((s) => s.id === p.supplierId)?.name}</TableCell>
                <TableCell>{p.items.map((i) => `${i.productName} (${i.quantity})`).join(", ")}</TableCell>
                <TableCell className="text-right font-semibold">${p.total.toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Record Purchase</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Supplier</Label>
              <Select value={selectedSupplier} onValueChange={setSelectedSupplier}>
                <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Items</Label>
              {items.map((item, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Select value={item.productId} onValueChange={(v) => updateItem(i, "productId", v)}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Product" /></SelectTrigger>
                    <SelectContent>
                      {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input className="w-20" type="number" placeholder="Qty" value={item.quantity} onChange={(e) => updateItem(i, "quantity", Number(e.target.value))} />
                  <Input className="w-24" type="number" placeholder="Cost" value={item.cost} onChange={(e) => updateItem(i, "cost", Number(e.target.value))} />
                  <button onClick={() => removeItem(i)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addItem}><Plus className="mr-1 h-3 w-3" /> Add Item</Button>
            </div>

            <div className="flex justify-between items-center pt-2 border-t font-bold">
              <span>Total</span>
              <span>${total.toFixed(2)}</span>
            </div>
            <Button className="w-full" onClick={recordPurchase}>Record Purchase</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PurchasesPage;
