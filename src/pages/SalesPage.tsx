import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { Product, CartItem, Sale } from "@/types/pos";
import { useAuth } from "@/context/AuthContext";
import { customersApi, productsApi, salesApi, printApi } from "@/lib/api";
import { getProductDisplayName } from "@/lib/productTranslation";
import { formatDateTimePK, cn } from "@/lib/utils";
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY } from "@/lib/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Minus, Trash2, CreditCard, Banknote, Receipt, Search, ShoppingBag, Printer } from "lucide-react";
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
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

const SalesPage = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const locale = i18n.language;
  const walkInLabel = t("sales.walkIn");
  const walkInLabelRef = useRef(walkInLabel);
  walkInLabelRef.current = walkInLabel;

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
  type PayMode = "full" | "credit" | "partial";
  const [payMode, setPayMode] = useState<PayMode>("full");
  const [paidAmountInput, setPaidAmountInput] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<string>("");
  const [receiptSale, setReceiptSale] = useState<Sale | null>(null);
  const [discountType, setDiscountType] = useState<"percent" | "fixed">("percent");
  const [discountValue, setDiscountValue] = useState<string>("");
  const [isAddingCustomer, setIsAddingCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [productNotFoundBarcode, setProductNotFoundBarcode] = useState<string | null>(null);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [customerField, setCustomerField] = useState(walkInLabel);
  const [customerHighlightIndex, setCustomerHighlightIndex] = useState(0);
  const customerComboRef = useRef<HTMLDivElement>(null);
  const customerListRef = useRef<HTMLDivElement>(null);

  const getSettings = () => {
    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (!raw) return DEFAULT_SETTINGS;
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
      return DEFAULT_SETTINGS;
    }
  };

  const handlePrintReceipt = async () => {
    if (!receiptSale) return;
    const settings = getSettings();
    try {
      await printApi.receipt({ sale: receiptSale, settings, locale });
      toast.success("Receipt sent to printer");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Print failed");
    }
  };

  const barcodeBufferRef = useRef("");
  const barcodeResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.list(),
  });

  const customersRef = useRef(customers);
  customersRef.current = customers;
  const selectedCustomerRef = useRef(selectedCustomer);
  selectedCustomerRef.current = selectedCustomer;
  const customerFieldRef = useRef(customerField);
  customerFieldRef.current = customerField;

  const reconcileCustomerField = useCallback(() => {
    const list = customersRef.current;
    const sc = selectedCustomerRef.current;
    const cf = customerFieldRef.current;
    const w = walkInLabelRef.current;
    const sel = sc ? list.find((c) => c.id === sc) : null;
    if (sel) {
      if (cf.trim() !== sel.name.trim()) setCustomerField(sel.name);
    } else {
      const cfTrim = cf.trim();
      const wLower = w.toLowerCase();
      // Keep typed name when closing the list (e.g. clicking Complete Sale) so ad-hoc customers still work
      if (!cfTrim || cfTrim.toLowerCase() === wLower) {
        setCustomerField(w);
      }
    }
  }, []);

  const filteredCustomers = useMemo(() => {
    const raw = customerField.trim();
    const rawLower = raw.toLowerCase();
    const wLower = walkInLabel.toLowerCase();
    const q = !rawLower || rawLower === wLower ? "" : raw;
    if (!q) return customers;
    const qLower = q.toLowerCase();
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(qLower) ||
        (c.phone?.toLowerCase().includes(qLower) ?? false),
    );
  }, [customers, customerField, walkInLabel]);

  useEffect(() => {
    if (selectedCustomerRef.current) return;
    setCustomerField(walkInLabelRef.current);
  }, [i18n.language, walkInLabel]);

  const walkInLooksSelected =
    !selectedCustomer && customerField.trim().toLowerCase() === walkInLabel.toLowerCase();

  const walkInRowActive =
    !selectedCustomer &&
    (customerField.trim().toLowerCase() === walkInLabel.toLowerCase() || customerField.trim() === "");

  const customerFieldIsWalkInOrEmpty =
    customerField.trim() === "" || customerField.trim().toLowerCase() === walkInLabel.toLowerCase();

  /** Hide Walk-in row while user types a real search / new name (not walk-in label). */
  const showWalkInInDropdown =
    customerField.trim() === "" ||
    customerField.trim().toLowerCase() === walkInLabel.toLowerCase();

  const customerDropdownMaxIndex = showWalkInInDropdown
    ? filteredCustomers.length
    : filteredCustomers.length > 0
      ? filteredCustomers.length - 1
      : -1;

  useEffect(() => {
    if (!customerPickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (customerComboRef.current?.contains(e.target as Node)) return;
      setCustomerPickerOpen(false);
      reconcileCustomerField();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [customerPickerOpen, reconcileCustomerField]);

  const prevCustomerPickerOpen = useRef(false);
  useEffect(() => {
    if (!customerPickerOpen) {
      prevCustomerPickerOpen.current = false;
      return;
    }
    if (!prevCustomerPickerOpen.current) {
      setCustomerHighlightIndex(0);
    } else {
      const maxIdx = showWalkInInDropdown
        ? filteredCustomers.length
        : filteredCustomers.length > 0
          ? filteredCustomers.length - 1
          : -1;
      setCustomerHighlightIndex((i) =>
        maxIdx < 0 ? 0 : Math.max(0, Math.min(i, maxIdx)),
      );
    }
    prevCustomerPickerOpen.current = true;
  }, [customerPickerOpen, filteredCustomers.length, showWalkInInDropdown]);

  useEffect(() => {
    if (!customerPickerOpen) return;
    const root = customerListRef.current;
    if (!root) return;
    const el = root.querySelector(`[data-customer-option-index="${customerHighlightIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [customerHighlightIndex, customerPickerOpen, filteredCustomers.length, showWalkInInDropdown]);

  const applyCustomerOptionIndex = (idx: number) => {
    if (showWalkInInDropdown) {
      if (idx === 0) {
        setSelectedCustomer("");
        setCustomerField(walkInLabel);
        setCustomerPickerOpen(false);
        return;
      }
      const c = filteredCustomers[idx - 1];
      if (!c) return;
      setSelectedCustomer(c.id);
      setCustomerField(c.name);
    } else {
      const c = filteredCustomers[idx];
      if (!c) return;
      setSelectedCustomer(c.id);
      setCustomerField(c.name);
    }
    setCustomerPickerOpen(false);
  };

  const createCustomerMutation = useMutation({
    mutationFn: (data: { name: string; phone?: string }) => customersApi.create(data),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setSelectedCustomer(created.id);
      setCustomerField(created.name);
      setCustomerPickerOpen(false);
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
          (p.nameUr?.toLowerCase().includes(searchLower) ?? false) ||
          (p.barcode?.toLowerCase().includes(searchLower) ?? false);
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

  const addByBarcode = async (bc: string) => {
    const barcode = bc.trim();
    if (!barcode) return;
    try {
      const p = await productsApi.getByBarcode(barcode);
      if (p && p.stock > 0) {
        addToCart(p);
        toast.success(`${p.name} × 1 added`);
      } else if (p && p.stock <= 0) {
        toast.error("Out of stock");
      } else {
        setProductNotFoundBarcode(barcode);
      }
    } catch {
      setProductNotFoundBarcode(barcode);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable;
      if (isInput) return;

      if (e.key === "Enter") {
        const buf = barcodeBufferRef.current.trim();
        if (buf && /^\d{6,}$/.test(buf)) {
          e.preventDefault();
          addByBarcode(buf);
        }
        barcodeBufferRef.current = "";
        return;
      }

      if (e.key.length === 1 && /[\dA-Za-z]/.test(e.key)) {
        if (barcodeResetTimerRef.current) clearTimeout(barcodeResetTimerRef.current);
        barcodeBufferRef.current += e.key;
        barcodeResetTimerRef.current = setTimeout(() => {
          barcodeBufferRef.current = "";
          barcodeResetTimerRef.current = null;
        }, 150);
      } else if (e.key === "Backspace" && barcodeBufferRef.current.length > 0) {
        barcodeBufferRef.current = barcodeBufferRef.current.slice(0, -1);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (barcodeResetTimerRef.current) clearTimeout(barcodeResetTimerRef.current);
    };
  }, []);

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

  const completeSale = async () => {
    if (cart.length === 0) {
      toast.error("Cart is empty");
      return;
    }

    let paidAmount: number;
    if (payMode === "full") paidAmount = total;
    else if (payMode === "credit") paidAmount = 0;
    else {
      const parsed = parseFloat(paidAmountInput) || 0;
      if (parsed <= 0 || parsed > total) {
        toast.error("Enter a valid amount between 0 and total");
        return;
      }
      paidAmount = parsed;
    }

    // Use ref so name survives any blur/reconcile ordering when clicking Complete Sale
    const rawCustomerName = customerFieldRef.current.trim();
    const wLabel = walkInLabelRef.current;
    const isWalkInField =
      rawCustomerName === "" || rawCustomerName.toLowerCase() === wLabel.toLowerCase();

    let customerIdToUse: string | undefined = selectedCustomer || undefined;

    if (!customerIdToUse && !isWalkInField) {
      const byName = customers.find(
        (c) => c.name.trim().toLowerCase() === rawCustomerName.toLowerCase(),
      );
      if (byName) {
        customerIdToUse = byName.id;
      } else {
        try {
          // Sales-field quick add: name only (phone optional on Customers page later)
          const created = await customersApi.create({ name: rawCustomerName });
          customerIdToUse = created.id;
          queryClient.invalidateQueries({ queryKey: ["customers"] });
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Could not save new customer");
          return;
        }
      }
    }

    if ((payMode === "credit" || payMode === "partial") && !customerIdToUse) {
      toast.error("Select a customer or enter a customer name for credit or partial payment");
      return;
    }

    const itemsPayload = cart.map((i) => ({
      product: { id: i.product.id, name: i.product.name, price: i.product.price },
      quantity: i.quantity,
    }));

    const sale: Sale = {
      id: `sale-${Date.now()}`,
      items: cart,
      total,
      paymentMethod,
      customerId: customerIdToUse,
      date: new Date().toISOString(),
      cashier: user?.name || "Unknown",
      subtotal,
      paidAmount,
      ...(discountAmount > 0 && { discountAmount }),
    };
    setSales([...sales, sale]);
    queryClient.invalidateQueries({ queryKey: ["products"] });
    setReceiptSale(sale);
    setCart([]);
    setDiscountValue("");
    setPaidAmountInput("");
    setPayMode("full");
    setSelectedCustomer("");
    setCustomerField(walkInLabelRef.current);
    const statusText = paidAmount >= total ? "completed" : paidAmount > 0 ? `partial ($${paidAmount.toFixed(2)} paid, $${(total - paidAmount).toFixed(2)} in khata)` : `credit ($${total.toFixed(2)} in khata)`;
    toast.success(`Sale ${statusText}!`);
    try {
      await salesApi.create({
        items: itemsPayload,
        total,
        paymentMethod,
        cashier: user?.name || "Unknown",
        customerId: customerIdToUse,
        paidAmount,
      });
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["khata"] });
    } catch {
      /* API save failed (offline etc); localStorage sale still visible in dashboard */
    }
  };

  return (
    <div className="flex h-[calc(100vh-3rem)] min-h-0 gap-5 animate-slide-in">
      {/* Left: Product catalog - constrained so cart gets more space */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden min-w-0 max-w-3xl">
        <div className="relative mb-4 shrink-0 w-full min-w-0 p-2">
          <Search className="absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            className="w-full min-w-0 pl-9 pr-4"
            placeholder="Search or scan barcode..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const val = (e.target as HTMLInputElement).value.trim();
                if (val && /^\d{6,}$/.test(val)) {
                  e.preventDefault();
                  addByBarcode(val);
                  setSearch("");
                }
              }
            }}
            autoComplete="off"
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

      {/* Right: Current Order — min-h-0 + flex-1 cart so footers (subtotal / Complete Sale) are never clipped */}
      <div className="flex h-full min-h-0 w-[440px] min-w-[400px] shrink-0 flex-col card-elevated rounded-lg overflow-hidden border">
        {/* 1. Title */}
        <div className="shrink-0 px-4 py-3 border-b bg-muted/30">
          <h2 className="font-heading text-lg font-semibold flex items-center gap-2">
            <ShoppingBag className="h-5 w-5" />
            {t("sales.currentOrder")}
          </h2>
        </div>

        {/* 2. Customer selection - always at top */}
        <div className="shrink-0 px-4 py-3 border-b">
          {isAddingCustomer ? (
            <div className="space-y-2">
              <Input value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} placeholder="Customer name" className="h-9" />
              <Input value={newCustomerPhone} onChange={(e) => setNewCustomerPhone(e.target.value)} placeholder="Phone (optional)" className="h-9" />
              <div className="flex gap-2">
                <Button size="sm" onClick={saveNewCustomer} disabled={createCustomerMutation.isPending || !newCustomerName.trim()} className="flex-1">
                  {createCustomerMutation.isPending ? "Saving…" : "Save"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setIsAddingCustomer(false); setNewCustomerName(""); setNewCustomerPhone(""); }}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <div ref={customerComboRef} className="relative flex-1 min-w-0">
                <Input
                  className={cn(
                    "h-9 transition-colors",
                    walkInLooksSelected &&
                      "border-primary/70 bg-primary/10 font-medium text-foreground shadow-sm ring-1 ring-primary/25",
                  )}
                  placeholder={customerField.trim() === "" ? t("sales.customerSearchPlaceholder") : undefined}
                  value={customerField}
                  onChange={(e) => {
                    const v = e.target.value;
                    setCustomerField(v);
                    setCustomerPickerOpen(true);
                    setCustomerHighlightIndex(0);
                    const sel = selectedCustomer ? customers.find((c) => c.id === selectedCustomer) : null;
                    if (!v.trim()) setSelectedCustomer("");
                    else if (sel && v.trim() !== sel.name.trim()) setSelectedCustomer("");
                  }}
                  onFocus={() => {
                    setCustomerPickerOpen(true);
                    setCustomerHighlightIndex(0);
                    if (
                      !selectedCustomer &&
                      customerField.trim().toLowerCase() === walkInLabel.toLowerCase()
                    ) {
                      setCustomerField("");
                    }
                  }}
                  onKeyDown={(e) => {
                    const maxIdx = customerDropdownMaxIndex;

                    if (e.key === "Escape") {
                      e.preventDefault();
                      setCustomerPickerOpen(false);
                      reconcileCustomerField();
                      return;
                    }

                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      if (!customerPickerOpen) {
                        setCustomerPickerOpen(true);
                        setCustomerHighlightIndex(0);
                        return;
                      }
                      if (maxIdx < 0) return;
                      setCustomerHighlightIndex((i) => Math.min(maxIdx, i + 1));
                      return;
                    }

                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      if (!customerPickerOpen) return;
                      if (maxIdx < 0) return;
                      setCustomerHighlightIndex((i) => Math.max(0, i - 1));
                      return;
                    }

                    if (e.key === "Enter") {
                      if (!customerPickerOpen) return;
                      e.preventDefault();
                      const idx = customerHighlightIndex;
                      if (maxIdx < 0 || idx < 0 || idx > maxIdx) return;
                      applyCustomerOptionIndex(idx);
                      return;
                    }
                  }}
                  autoComplete="off"
                  aria-expanded={customerPickerOpen}
                  aria-controls="sales-customer-suggestions"
                  aria-autocomplete="list"
                  role="combobox"
                />
                {customerPickerOpen && (
                  <div
                    ref={customerListRef}
                    id="sales-customer-suggestions"
                    role="listbox"
                    className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[min(280px,50vh)] overflow-y-auto rounded-md border bg-popover py-1 text-popover-foreground shadow-md"
                  >
                    {showWalkInInDropdown && (
                      <button
                        type="button"
                        data-customer-option-index={0}
                        role="option"
                        aria-selected={walkInRowActive}
                        className={cn(
                          "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                          customerHighlightIndex === 0 &&
                            "bg-accent font-medium ring-1 ring-inset ring-primary/35",
                          customerHighlightIndex !== 0 && walkInRowActive && "bg-accent/50 font-medium",
                        )}
                        onMouseEnter={() => setCustomerHighlightIndex(0)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => applyCustomerOptionIndex(0)}
                      >
                        {walkInLabel}
                      </button>
                    )}
                    {filteredCustomers.length === 0 ? (
                      <div className="px-3 py-2 text-center text-sm text-muted-foreground">{t("sales.noCustomerMatch")}</div>
                    ) : (
                      filteredCustomers.map((c, i) => {
                        const optionIdx = showWalkInInDropdown ? i + 1 : i;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            data-customer-option-index={optionIdx}
                            role="option"
                            aria-selected={selectedCustomer === c.id}
                            className={cn(
                              "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                              customerHighlightIndex === optionIdx &&
                                "bg-accent font-medium ring-1 ring-inset ring-primary/35",
                              selectedCustomer === c.id &&
                                customerHighlightIndex !== optionIdx &&
                                "bg-accent/50",
                            )}
                            onMouseEnter={() => setCustomerHighlightIndex(optionIdx)}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => applyCustomerOptionIndex(optionIdx)}
                          >
                            <span className="min-w-0 flex-1 truncate">{c.name}</span>
                            {c.phone ? (
                              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{c.phone}</span>
                            ) : null}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
              <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => setIsAddingCustomer(true)} title="Add customer">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        {/* 3. Cart items — scrolls; min-h-0 so payment footer stays in view */}
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-3">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
              <ShoppingBag className="h-12 w-12 mb-2 opacity-40" strokeWidth={1.5} />
              <p className="text-sm font-medium">{t("sales.noItemsYet")}</p>
              <p className="text-xs mt-0.5">{t("sales.tapProductToAdd")}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {cart.map((item) => {
                const { primary, secondary } = getProductDisplayName(item.product, locale);
                return (
                  <div key={item.product.id} className="rounded-lg border bg-muted/50 p-2 flex gap-2 items-center">
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <p className={`text-sm font-medium truncate ${locale === "ur" ? "text-right" : ""}`} dir={locale === "ur" ? "rtl" : "ltr"}>{primary}</p>
                      {secondary && <p className="text-xs text-muted-foreground truncate" dir={locale === "ur" ? "rtl" : "ltr"}>{secondary}</p>}
                      <p className="text-xs text-muted-foreground">${item.product.price.toFixed(2)} {t("sales.each")}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => updateQuantity(item.product.id, -1)} className="h-7 w-7 flex items-center justify-center rounded border hover:bg-background" aria-label="Decrease"><Minus className="h-3 w-3" /></button>
                      <span className="w-7 text-center text-sm font-semibold tabular-nums">{item.quantity}</span>
                      <button onClick={() => updateQuantity(item.product.id, 1)} className="h-7 w-7 flex items-center justify-center rounded border hover:bg-background" aria-label="Increase"><Plus className="h-3 w-3" /></button>
                    </div>
                    <span className="text-sm font-semibold shrink-0 min-w-[52px] text-right">${(item.product.price * item.quantity).toFixed(2)}</span>
                    <button onClick={() => removeFromCart(item.product.id)} className="text-muted-foreground hover:text-destructive shrink-0 p-0.5" aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Payment method & discount */}
        <div className="shrink-0 px-4 py-2 border-t bg-muted/10">
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              <Label className="text-xs text-muted-foreground mb-1.5 block">{t("sales.paymentMethod")}</Label>
              <div className="flex flex-wrap gap-1.5">
                {(["cash", "card"] as const).map((m) => (
                  <Button key={m} variant={paymentMethod === m ? "default" : "outline"} size="sm" className="h-8 text-xs" onClick={() => setPaymentMethod(m)}>
                    {m === "cash" && <Banknote className="mr-1 h-3.5 w-3.5" />}
                    {m === "card" && <CreditCard className="mr-1 h-3.5 w-3.5" />}
                    {t(`sales.${m}`)}
                  </Button>
                ))}
              </div>
            </div>
            <div className="shrink-0">
              <Label className="text-xs text-muted-foreground mb-1.5 block">{t("sales.discount")}</Label>
              <div className="flex items-center gap-1.5">
                <Select value={discountType} onValueChange={(v) => setDiscountType(v as "percent" | "fixed")}>
                  <SelectTrigger className="w-14 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="percent">%</SelectItem><SelectItem value="fixed">$</SelectItem></SelectContent>
                </Select>
                <Input
                  type="number"
                  min={0}
                  step={discountType === "percent" ? 1 : 0.01}
                  placeholder={discountType === "percent" ? "0–100" : "0"}
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  className={cn(
                    "h-8 w-14 text-xs [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
                  )}
                />
                {discountValue && <Button type="button" variant="ghost" size="sm" className="h-8 text-xs px-1.5" onClick={clearDiscount}>Clear</Button>}
              </div>
            </div>
          </div>
        </div>

        {/* Payment type (Pay now / Pay later / Partial) */}
        <div className="shrink-0 px-4 py-3 border-t space-y-2 bg-muted/20">
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Payment type</Label>
            <div className="flex flex-wrap gap-1 items-center">
              <Button variant={payMode === "full" ? "default" : "outline"} size="sm" className="h-7 text-xs px-2" onClick={() => { setPayMode("full"); setPaidAmountInput(""); }}>Pay now</Button>
              <Button variant={payMode === "credit" ? "default" : "outline"} size="sm" className="h-7 text-xs px-2" onClick={() => { setPayMode("credit"); setPaidAmountInput(""); }} title="Requires customer">Pay later</Button>
              <Button variant={payMode === "partial" ? "default" : "outline"} size="sm" className="h-7 text-xs px-2" onClick={() => setPayMode("partial")} title="Requires customer">Partial</Button>
            </div>
            {payMode === "partial" && (
              <div className="flex items-center gap-2 mt-2">
                <Label htmlFor="paid-amt" className="text-xs shrink-0">Paid now</Label>
                <Input id="paid-amt" type="number" min={0} step={0.01} max={total} placeholder={`0–${total.toFixed(2)}`} value={paidAmountInput} onChange={(e) => setPaidAmountInput(e.target.value)} className="h-8 w-24 text-sm" />
              </div>
            )}
            {(payMode === "credit" || payMode === "partial") &&
              !selectedCustomer &&
              customerFieldIsWalkInOrEmpty && (
              <p className="text-xs text-amber-600 mt-1">Select a customer or type a name for credit/partial</p>
            )}
          </div>
        </div>

        {/* Subtotal */}
        <div className="shrink-0 border-t bg-muted/10 px-4 py-2 flex justify-between items-baseline">
          <span className="text-sm text-muted-foreground">{t("sales.subtotal")}</span>
          <span className="font-semibold font-heading tabular-nums">${subtotal.toFixed(2)}</span>
        </div>

        {/* Totals + Complete Sale */}
        <div className="shrink-0 space-y-3 border-t bg-background px-4 py-3">
          {discountAmount > 0 && (
            <div className="flex justify-between text-sm text-destructive">
              <span>{t("sales.discount")}</span>
              <span>−${discountAmount.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between text-lg font-bold">
            <span>{t("sales.total")}</span>
            <span className="font-heading tabular-nums">${total.toFixed(2)}</span>
          </div>
          <Button
            type="button"
            className="h-10 w-full font-semibold"
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
            <DialogTitle className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <Receipt className="h-5 w-5" /> Receipt
              </span>
              <Button variant="outline" size="sm" onClick={handlePrintReceipt} className="shrink-0">
                <Printer className="h-4 w-4 mr-1" /> Print
              </Button>
            </DialogTitle>
          </DialogHeader>
          {receiptSale && (
            <div className="space-y-3 text-sm">
              <div className="text-center">
                <p className="font-heading text-lg font-bold">RetailPOS</p>
                <p className="text-muted-foreground">
                  {formatDateTimePK(receiptSale.date)}
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
                {receiptSale.paidAmount != null && receiptSale.paidAmount < receiptSale.total ? (
                  <>Paid: ${receiptSale.paidAmount.toFixed(2)} · Balance: ${(receiptSale.total - receiptSale.paidAmount).toFixed(2)} in khata</>
                ) : (
                  <>Paid by {receiptSale.paymentMethod}</>
                )}
                {" · "}Cashier: {receiptSale.cashier}
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!productNotFoundBarcode} onOpenChange={() => setProductNotFoundBarcode(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Product not found</AlertDialogTitle>
            <AlertDialogDescription>
              Barcode &quot;{productNotFoundBarcode}&quot; is not in the inventory. Do you want to add this product?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (productNotFoundBarcode) {
                  navigate("/inventory", { state: { addBarcode: productNotFoundBarcode } });
                  setProductNotFoundBarcode(null);
                }
              }}
            >
              Add new product
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default SalesPage;
