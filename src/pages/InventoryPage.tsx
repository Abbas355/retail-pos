import { useMemo, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { Product } from "@/types/pos";
import { useAuth } from "@/context/AuthContext";
import { productsApi } from "@/lib/api";
import { translateProductNameToUrdu } from "@/lib/productTranslation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Pencil, Search, AlertTriangle, Languages, Barcode, Eye } from "lucide-react";
import { toast } from "sonner";
import { formatDateTimePK } from "@/lib/utils";

const NEW_CATEGORY_VALUE = "__new__";
const emptyProduct: Partial<Product> = {
  name: "",
  nameUr: "",
  barcode: "",
  price: undefined,
  cost: undefined,
  stock: undefined,
  category: "",
  lowStockThreshold: undefined,
};

function activityKindLabelClass(kind: "purchase" | "sale" | "created" | "deleted") {
  switch (kind) {
    case "purchase":
      return "text-emerald-700 dark:text-emerald-300";
    case "sale":
      return "text-blue-700 dark:text-blue-300";
    case "created":
      return "text-muted-foreground";
    case "deleted":
      return "text-destructive";
    default:
      return "";
  }
}

const InventoryPage = () => {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Partial<Product>>(emptyProduct);
  const [isEditing, setIsEditing] = useState(false);
  const [isNewCategory, setIsNewCategory] = useState(false);
  const [barcodeScan, setBarcodeScan] = useState("");
  const [logProduct, setLogProduct] = useState<Product | null>(null);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: () => productsApi.list(),
    refetchOnWindowFocus: false,
  });

  const { data: activityData, isLoading: activityLoading, isError: activityError } = useQuery({
    queryKey: ["products", logProduct?.id, "activity-log"],
    queryFn: () => productsApi.getActivityLog(logProduct!.id),
    enabled: Boolean(logProduct?.id),
  });

  const existingCategories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => p.category?.trim() && set.add(p.category.trim()));
    return Array.from(set).sort();
  }, [products]);

  const categoryOptions = useMemo(() => {
    const list = [...existingCategories];
    const current = editingProduct.category?.trim();
    if (current && !list.includes(current)) list.push(current);
    return list;
  }, [existingCategories, editingProduct.category]);

  const searchLower = search.toLowerCase();
  const filtered = products.filter(
    (p) =>
      p.name.toLowerCase().includes(searchLower) ||
      (p.nameUr?.toLowerCase().includes(searchLower) ?? false)
  );

  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof productsApi.create>[0]) => productsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      setDialogOpen(false);
      setEditingProduct(emptyProduct);
      toast.success(t("product.productAdded"));
    },
    onError: (err: Error) => toast.error(err.message || "Failed to add product"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof productsApi.update>[1] }) =>
      productsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      setDialogOpen(false);
      setEditingProduct(emptyProduct);
      toast.success(t("product.productUpdated"));
    },
    onError: (err: Error) => toast.error(err.message || "Failed to update product"),
  });

  const openAdd = (prefillBarcode?: string) => {
    setEditingProduct({ ...emptyProduct, barcode: prefillBarcode ?? "" });
    setIsEditing(false);
    setIsNewCategory(false);
    setDialogOpen(true);
  };

  useEffect(() => {
    const addBarcode = (location.state as { addBarcode?: string } | null)?.addBarcode;
    if (addBarcode && isAdmin) {
      setEditingProduct({ ...emptyProduct, barcode: addBarcode });
      setIsEditing(false);
      setIsNewCategory(false);
      setDialogOpen(true);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, isAdmin, location.pathname, navigate]);

  const handleBarcodeScan = async () => {
    const bc = barcodeScan.trim();
    if (!bc) return;
    setBarcodeScan("");
    try {
      const p = await productsApi.getByBarcode(bc);
      if (p) {
        openEdit(p);
        toast.success(`Found: ${p.name}`);
      } else {
        openAdd(bc);
        toast.info("New product detected. Please enter product details.");
      }
    } catch {
      openAdd(bc);
      toast.info("New product detected. Please enter product details.");
    }
  };
  const openEdit = (p: Product) => {
    setEditingProduct({ ...p });
    setIsEditing(true);
    setIsNewCategory(false);
    setDialogOpen(true);
  };

  const saveProduct = () => {
    const priceNum = editingProduct.price !== undefined && editingProduct.price !== "" ? Number(editingProduct.price) : NaN;
    if (!editingProduct.name?.trim() || Number.isNaN(priceNum)) {
      toast.error(t("product.nameAndPriceRequired"));
      return;
    }
    const name = editingProduct.name.trim();
    const nameUr = (editingProduct.nameUr ?? "").trim() || undefined;
    const price = priceNum;
    const cost = Number(editingProduct.cost) || 0;
    const stock = Number(editingProduct.stock) || 0;
    const category = (editingProduct.category ?? "").trim();
    const lowStockThreshold = Number(editingProduct.lowStockThreshold) ?? 5;
    const barcode = (editingProduct.barcode ?? "").trim() || undefined;
    if (isEditing && editingProduct.id) {
      updateMutation.mutate({
        id: editingProduct.id,
        data: { name, nameUr: nameUr ?? null, barcode: barcode ?? null, price, cost, stock, category, lowStockThreshold },
      });
    } else {
      createMutation.mutate({ name, nameUr, barcode, price, cost, stock, category, lowStockThreshold });
    }
  };

  const fillUrduFromEnglish = () => {
    const urdu = translateProductNameToUrdu(editingProduct.name ?? "");
    setEditingProduct((prev) => ({ ...prev, nameUr: urdu }));
  };

  const isElectron = typeof window !== "undefined" && !!window.electronAPI;

  return (
    <div className="space-y-5 animate-slide-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">{t("inventory.title")}</h1>
          {isElectron && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              Add works offline. Use &quot;Sync with MySQL&quot; in the sidebar when online to sync with the main database.
            </p>
          )}
        </div>
        {isAdmin && (
          <Button onClick={openAdd}>
            <Plus className="mr-1 h-4 w-4" /> {t("product.addProduct")}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-4 items-end">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder={t("inventory.searchProducts")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {isAdmin && (
          <div className="flex gap-2 items-center min-w-[280px]">
            <div className="relative flex-1">
              <Barcode className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Scan barcode to add product..."
                value={barcodeScan}
                onChange={(e) => setBarcodeScan(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleBarcodeScan()}
              />
            </div>
            <Button variant="secondary" onClick={handleBarcodeScan} disabled={!barcodeScan.trim()}>
              Add
            </Button>
          </div>
        )}
      </div>

      <div className="card-elevated overflow-hidden">
        {isLoading ? (
          <p className="p-6 text-center text-muted-foreground">Loading products…</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>Barcode</TableHead>
                <TableHead>{t("common.category")}</TableHead>
                <TableHead className="text-right">{t("common.price")}</TableHead>
                <TableHead className="text-right">{t("common.cost")}</TableHead>
                <TableHead className="text-right">{t("common.stock")}</TableHead>
                <TableHead className="text-right">{t("product.lowStockThreshold")}</TableHead>
                {isAdmin && <TableHead className="text-right">{t("inventory.actions")}</TableHead>}
                <TableHead className="text-right w-[72px]">Log</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="font-mono text-xs">{p.barcode || "—"}</TableCell>
                  <TableCell>{p.category}</TableCell>
                  <TableCell className="text-right">${p.price.toFixed(2)}</TableCell>
                  <TableCell className="text-right">${p.cost.toFixed(2)}</TableCell>
                  <TableCell className="text-right">
                    <span
                      className={`flex justify-end gap-1 ${p.stock <= p.lowStockThreshold ? "low-stock" : ""}`}
                    >
                      {p.stock <= p.lowStockThreshold && <AlertTriangle className="h-3 w-3" />}
                      {p.stock}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">{p.lowStockThreshold}</TableCell>
                  {isAdmin && (
                    <TableCell className="text-right">
                      <button
                        type="button"
                        onClick={() => openEdit(p)}
                        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="Edit"
                        aria-label="Edit product"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    <button
                      type="button"
                      onClick={() => setLogProduct(p)}
                      className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      title="View product activity"
                      aria-label="View product activity"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {!isLoading && filtered.length === 0 && (
          <p className="p-6 text-center text-muted-foreground">{t("product.noProductsMatch")}</p>
        )}
      </div>

      <Sheet open={!!logProduct} onOpenChange={(open) => !open && setLogProduct(null)}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-lg">
          <SheetHeader className="text-left">
            <SheetTitle>Product activity</SheetTitle>
            {logProduct ? (
              <p className="text-sm font-normal text-muted-foreground">{logProduct.name}</p>
            ) : null}
          </SheetHeader>
          <div className="mt-4 flex min-h-0 flex-1 flex-col">
            {activityLoading ? (
              <p className="text-sm text-muted-foreground py-6">Loading…</p>
            ) : activityError ? (
              <p className="text-sm text-destructive py-6">Could not load activity.</p>
            ) : !activityData?.entries?.length ? (
              <p className="text-sm text-muted-foreground py-6">No sales or purchase history for this product yet.</p>
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] flex flex-col overflow-hidden p-0 gap-0">
          <DialogHeader className="shrink-0 px-6 pt-10 pb-2 border-b border-border/40">
            <DialogTitle>{isEditing ? t("product.editProduct") : t("product.addProduct")}</DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto flex-1 min-h-0 px-6 pb-6">
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>Barcode</Label>
              <Input
                type="text"
                placeholder="Scan or enter barcode"
                value={editingProduct.barcode ?? ""}
                onChange={(e) => setEditingProduct({ ...editingProduct, barcode: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("product.name")}</Label>
              <Input
                type="text"
                value={editingProduct.name || ""}
                onChange={(e) => setEditingProduct({ ...editingProduct, name: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label>{t("product.nameUrdu")}</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={fillUrduFromEnglish}
                  disabled={!editingProduct.name?.trim()}
                  className="shrink-0"
                >
                  <Languages className="mr-1 h-3.5 w-3.5" />
                  {t("product.translateToUrdu")}
                </Button>
              </div>
              <Input
                type="text"
                dir="rtl"
                className="font-arabic"
                placeholder={t("product.nameUrduPlaceholder")}
                value={editingProduct.nameUr ?? ""}
                onChange={(e) => setEditingProduct({ ...editingProduct, nameUr: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("common.category")}</Label>
              {isNewCategory ? (
                <div className="flex gap-2">
                  <Input
                    type="text"
                    value={editingProduct.category || ""}
                    onChange={(e) =>
                      setEditingProduct({ ...editingProduct, category: e.target.value })
                    }
                    placeholder={t("product.enterNewCategory")}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsNewCategory(false)}
                  >
                    {t("product.chooseExisting")}
                  </Button>
                </div>
              ) : (
                <Select
                  value={
                    editingProduct.category && categoryOptions.includes(editingProduct.category)
                      ? editingProduct.category
                      : ""
                  }
                  onValueChange={(v) => {
                    if (v === NEW_CATEGORY_VALUE) {
                      setEditingProduct({ ...editingProduct, category: "" });
                      setIsNewCategory(true);
                    } else {
                      setEditingProduct({ ...editingProduct, category: v });
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("product.selectCategory")} />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryOptions.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                    <SelectItem value={NEW_CATEGORY_VALUE}>{t("product.addNewCategory")}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
            {[
              { key: "price", label: t("common.price"), type: "number" },
              { key: "cost", label: t("common.cost"), type: "number" },
              { key: "stock", label: t("common.stock"), type: "number" },
              { key: "lowStockThreshold", label: t("product.lowStockThreshold"), type: "number" },
            ].map((field) => (
              <div key={field.key} className="grid gap-1.5">
                <Label>{field.label}</Label>
                <Input
                  type={field.type}
                  value={(editingProduct as Record<string, unknown>)[field.key] === undefined || (field.type === "number" && (editingProduct as Record<string, unknown>)[field.key] === "")
                    ? ""
                    : (editingProduct as Record<string, unknown>)[field.key]}
                  onChange={(e) =>
                    setEditingProduct({
                      ...editingProduct,
                      [field.key]: field.type === "number"
                        ? (e.target.value === "" ? undefined : Number(e.target.value))
                        : e.target.value,
                    })
                  }
                />
              </div>
            ))}
            <Button
              onClick={saveProduct}
              disabled={
                createMutation.isPending ||
                updateMutation.isPending ||
                !editingProduct.name?.trim() ||
                (editingProduct.price !== 0 && !editingProduct.price) ||
                editingProduct.price === ""
              }
            >
              {isEditing ? t("product.updateProduct") : t("product.addProduct")}
            </Button>
          </div>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
};

export default InventoryPage;
