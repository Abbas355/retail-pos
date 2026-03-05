import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { Product, CartItem, Sale } from "@/types/pos";
import { useAuth } from "@/context/AuthContext";
import { customersApi, productsApi } from "@/lib/api";
import { getProductDisplayName } from "@/lib/productTranslation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Minus, Trash2, CreditCard, Banknote, Receipt, Search, ShoppingBag, Percent } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

const SalesPage = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const locale = i18n.language;
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: () => productsApi.list(),
    refetchOnWindowFocus: true,
  });
  const [sales, setSales] = useLocalStorage<Sale[]>("pos_sales", []);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState("");
  const ALL_ITEMS = "__all__";
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL_ITEMS);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card">("cash");
  const [selectedCustomer, setSelectedCustomer] = useState<string>("");
  const [receiptSale, setReceiptSale] = useState<Sale | null>(null);
  const [discountType, setDiscountType] = useState<"percent" | "fixed">("percent");
  const [discountValue, setDiscountValue] = useState<string>("");
  const [isAddingCustomer, setIsAddingCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.list(),
  });

  const createCustomerMutation = useMutation({
    mutationFn: (data: { name: string; phone?: string }) => customersApi.create(data),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setSelectedCustomer(created.id);
      setIsAddingCustomer(false);
      setNewCustomerName("");
      setNewCustomerPhone("");
      toast.success("Customer saved");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to save customer"),
  });

  const saveNewCustomer = () => {
    const name = newCustomerName.trim();
    if (!name) {
      toast.error("Name is required");
      return;
    }
    createCustomerMutation.mutate({ name, phone: newCustomerPhone.trim() || undefined });
  };

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => p.category?.trim() && set.add(p.category.trim()));
    return Array.from(set).sort();
  }, [products]);

  const filteredProducts = useMemo(
    () =>
      products.filter((p) => {
        const searchLower = search.toLowerCase();
        const matchesSearch =
          p.name.toLowerCase().includes(searchLower) ||
          (p.nameUr?.toLowerCase().includes(searchLower) ?? false);
        const matchesCategory =
          categoryFilter === ALL_ITEMS || (p.category?.trim() === categoryFilter);
        return matchesSearch && matchesCategory && p.stock > 0;
      }),
    [products, search, categoryFilter]
  );

  const addToCart = (product: Product) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.product.id === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) {
          toast.error("Not enough stock");
          return prev;
        }
        return prev.map((i) =>
          i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart((prev) =>
      prev.map((i) => {
        if (i.product.id !== productId) return i;
        const newQty = i.quantity + delta;
        if (newQty <= 0) return i;
        if (newQty > i.product.stock) {
          toast.error("Not enough stock");
          return i;
        }
        return { ...i, quantity: newQty };
      })
    );
  };

  const removeFromCart = (productId: string) =>
    setCart((prev) => prev.filter((i) => i.product.id !== productId));

  const subtotal = cart.reduce((sum, i) => sum + i.product.price * i.quantity, 0);
  const discountAmount = (() => {
    const val = parseFloat(discountValue) || 0;
    if (val <= 0) return 0;
    if (discountType === "percent") return Math.min(subtotal * (val / 100), subtotal);
    return Math.min(val, subtotal);
  })();
  const total = Math.max(0, subtotal - discountAmount);

  const clearDiscount = () => {
    setDiscountValue("");
  };

  const completeSale = () => {
    if (cart.length === 0) {
      toast.error("Cart is empty");
      return;
    }
    const sale: Sale = {
      id: `sale-${Date.now()}`,
      items: cart,
      total,
      paymentMethod,
      customerId: selectedCustomer || undefined,
      date: new Date().toISOString(),
      cashier: user?.name || "Unknown",
      subtotal,
      ...(discountAmount > 0 && { discountAmount }),
    };
    setSales([...sales, sale]);
    queryClient.invalidateQueries({ queryKey: ["products"] });
    setReceiptSale(sale);
    setCart([]);
    setDiscountValue("");
    toast.success("Sale completed!");
  };

  return (
    <div className="flex h-[calc(100vh-3rem)] gap-5 animate-slide-in">
      {/* Left: Product catalog */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        <div className="relative mb-4 shrink-0 w-full min-w-0 p-2">
          <Search className="absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            className="w-full min-w-0 pl-9 pr-4"
            placeholder="Search items..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex gap-2 mb-4 overflow-x-auto pb-1 shrink-0">
          <button
            onClick={() => setCategoryFilter(ALL_ITEMS)}
            className={`shrink-0 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              categoryFilter === ALL_ITEMS
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {t("sales.allItems")}
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`shrink-0 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                categoryFilter === cat
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto">
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
            {filteredProducts.map((p) => {
              const { primary, secondary } = getProductDisplayName(p, locale);
              return (
                <button
                  key={p.id}
                  onClick={() => addToCart(p)}
                  className="card-elevated flex flex-col items-stretch p-4 text-left rounded-lg transition-shadow hover:shadow-md"
                >
                  <span className={`font-medium truncate ${locale === "ur" ? "text-right" : ""}`} dir={locale === "ur" ? "rtl" : "ltr"}>
                    {primary}
                  </span>
                  {secondary && (
                    <span className="text-sm text-muted-foreground truncate mt-0.5" dir={locale === "ur" ? "ltr" : "rtl"}>
                      {secondary}
                    </span>
                  )}
                  <span className="mt-2 font-heading text-lg font-bold text-primary">
                    ${p.price.toFixed(2)}
                  </span>
                </button>
              );
            })}
          </div>
          {filteredProducts.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("sales.noProductsMatch")}</p>
          )}
        </div>
      </div>

      {/* Right: Current Order */}
      <div className="flex w-80 shrink-0 flex-col card-elevated p-4 rounded-lg overflow-hidden">
        <h2 className="mb-3 font-heading text-lg font-semibold flex items-center gap-2">
          <ShoppingBag className="h-5 w-5" />
          {t("sales.currentOrder")}
        </h2>

        <div className="flex-1 flex flex-col min-h-0">
          {cart.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-8 text-center">
              <ShoppingBag className="h-14 w-14 text-muted-foreground/50 mb-3" strokeWidth={1.5} />
              <p className="text-sm font-medium text-muted-foreground">{t("sales.noItemsYet")}</p>
              <p className="text-xs text-muted-foreground mt-1">{t("sales.tapProductToAdd")}</p>
            </div>
          ) : (
            <div className="flex-1 space-y-2 overflow-auto min-h-0">
              {cart.map((item) => {
                const { primary, secondary } = getProductDisplayName(item.product, locale);
                return (
                <div key={item.product.id} className="rounded-lg bg-muted p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className={`truncate text-sm font-medium ${locale === "ur" ? "text-right" : ""}`} dir={locale === "ur" ? "rtl" : "ltr"}>{primary}</p>
                      {secondary && (
                        <p className="text-xs text-muted-foreground truncate" dir={locale === "ur" ? "ltr" : "rtl"}>{secondary}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        ${item.product.price.toFixed(2)} {t("sales.each")}
                      </p>
                    </div>
                    <button
                      onClick={() => removeFromCart(item.product.id)}
                      className="text-muted-foreground hover:text-destructive shrink-0"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updateQuantity(item.product.id, -1)}
                        className="flex h-7 w-7 items-center justify-center rounded-md border hover:bg-background"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="w-8 text-center text-sm font-semibold">{item.quantity}</span>
                      <button
                        onClick={() => updateQuantity(item.product.id, 1)}
                        className="flex h-7 w-7 items-center justify-center rounded-md border hover:bg-background"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                    <span className="font-semibold">
                      ${(item.product.price * item.quantity).toFixed(2)}
                    </span>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-4 space-y-3 border-t pt-4 shrink-0">
          {isAddingCustomer ? (
            <div className="space-y-3">
              <div className="grid gap-1.5">
                <Label>Name</Label>
                <Input
                  value={newCustomerName}
                  onChange={(e) => setNewCustomerName(e.target.value)}
                  placeholder="Customer name"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Phone</Label>
                <Input
                  value={newCustomerPhone}
                  onChange={(e) => setNewCustomerPhone(e.target.value)}
                  placeholder="Phone (optional)"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={saveNewCustomer}
                  disabled={createCustomerMutation.isPending || !newCustomerName.trim()}
                  className="flex-1"
                >
                  {createCustomerMutation.isPending ? "Saving…" : "Save"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsAddingCustomer(false);
                    setNewCustomerName("");
                    setNewCustomerPhone("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Select
                value={selectedCustomer || "none"}
                onValueChange={(v) => setSelectedCustomer(v === "none" ? "" : v)}
                className="flex-1"
              >
                <SelectTrigger>
                  <SelectValue placeholder="Walk-in customer" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Walk-in customer</SelectItem>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setIsAddingCustomer(true)}
                title="Add customer"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              variant={paymentMethod === "cash" ? "default" : "outline"}
              className="flex-1"
              onClick={() => setPaymentMethod("cash")}
            >
              <Banknote className="mr-1 h-4 w-4" /> Cash
            </Button>
            <Button
              variant={paymentMethod === "card" ? "default" : "outline"}
              className="flex-1"
              onClick={() => setPaymentMethod("card")}
            >
              <CreditCard className="mr-1 h-4 w-4" /> Card
            </Button>
          </div>

          <div className="space-y-2 border-t pt-3">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Subtotal</span>
              <span>${subtotal.toFixed(2)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground flex items-center gap-1">
                <Percent className="h-3.5 w-3.5" /> Discount
              </span>
              <Select value={discountType} onValueChange={(v) => setDiscountType(v as "percent" | "fixed")}>
                <SelectTrigger className="w-24 h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">%</SelectItem>
                  <SelectItem value="fixed">$</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="number"
                min={0}
                step={discountType === "percent" ? 1 : 0.01}
                placeholder={discountType === "percent" ? "0–100" : "0.00"}
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                className="w-20 h-8 text-sm"
              />
              {discountValue && (
                <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={clearDiscount}>
                  Clear
                </Button>
              )}
            </div>
            {discountAmount > 0 && (
              <div className="flex items-center justify-between text-sm text-destructive">
                <span>Discount</span>
                <span>${discountAmount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-lg font-bold pt-1">
              <span>Total</span>
              <span className="font-heading">${total.toFixed(2)}</span>
            </div>
          </div>

          <Button
            className="w-full"
            size="lg"
            onClick={completeSale}
            disabled={cart.length === 0}
          >
            Complete Sale
          </Button>
        </div>
      </div>

      <Dialog open={!!receiptSale} onOpenChange={() => setReceiptSale(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5" /> Receipt
            </DialogTitle>
          </DialogHeader>
          {receiptSale && (
            <div className="space-y-3 text-sm">
              <div className="text-center">
                <p className="font-heading text-lg font-bold">RetailPOS</p>
                <p className="text-muted-foreground">
                  {new Date(receiptSale.date).toLocaleString()}
                </p>
              </div>
              <div className="border-t pt-2">
                {receiptSale.items.map((i) => {
                  const { primary, secondary } = getProductDisplayName(i.product, locale);
                  return (
                    <div key={i.product.id} className="flex justify-between py-1 gap-2">
                      <span className="min-w-0">
                        <span className={`block truncate ${locale === "ur" ? "text-right" : ""}`} dir={locale === "ur" ? "rtl" : "ltr"}>{primary} x{i.quantity}</span>
                        {secondary && (
                          <span className="block text-xs text-muted-foreground truncate" dir={locale === "ur" ? "ltr" : "rtl"}>{secondary}</span>
                        )}
                      </span>
                      <span className="shrink-0">${(i.product.price * i.quantity).toFixed(2)}</span>
                    </div>
                  );
                })}
              </div>
              {receiptSale.subtotal != null && receiptSale.subtotal !== receiptSale.total && (
                <div className="border-t pt-2 space-y-1 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>{t("sales.subtotal")}</span>
                    <span>${receiptSale.subtotal.toFixed(2)}</span>
                  </div>
                  {receiptSale.discountAmount != null && receiptSale.discountAmount > 0 && (
                    <div className="flex justify-between text-destructive">
                      <span>{t("sales.discount")}</span>
                      <span>${receiptSale.discountAmount.toFixed(2)}</span>
                    </div>
                  )}
                </div>
              )}
              <div className="border-t pt-2 flex justify-between font-bold text-base">
                <span>{t("sales.total")}</span>
                <span>${receiptSale.total.toFixed(2)}</span>
              </div>
              <p className="text-center text-muted-foreground">
                Paid by {receiptSale.paymentMethod} · Cashier: {receiptSale.cashier}
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default SalesPage;
