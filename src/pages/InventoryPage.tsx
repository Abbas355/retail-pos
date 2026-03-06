import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Product, Sale, Purchase } from "@/types/pos";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useAuth } from "@/context/AuthContext";
import { productsApi } from "@/lib/api";
import { translateProductNameToUrdu } from "@/lib/productTranslation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, Pencil, Trash2, Search, AlertTriangle, Languages } from "lucide-react";
import { toast } from "sonner";

const NEW_CATEGORY_VALUE = "__new__";
const emptyProduct: Partial<Product> = {
  name: "",
  nameUr: "",
  price: undefined,
  cost: undefined,
  stock: undefined,
  category: "",
  lowStockThreshold: undefined,
};

const InventoryPage = () => {
  const { t } = useTranslation();
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Partial<Product>>(emptyProduct);
  const [isEditing, setIsEditing] = useState(false);
  const [isNewCategory, setIsNewCategory] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: () => productsApi.list(),
    refetchOnWindowFocus: false,
  });

  const [localSales] = useLocalStorage<Sale[]>("pos_sales", []);
  const [localPurchases] = useLocalStorage<Purchase[]>("pos_purchases", []);

  const productIdsWithLocalHistory = useMemo(() => {
    const salesIds = new Set<string>();
    localSales.forEach((s) =>
      s.items?.forEach((i) => i.product?.id && salesIds.add(i.product.id))
    );
    const purchaseIds = new Set<string>();
    localPurchases.forEach((p) =>
      p.items?.forEach((i) => i.productId && purchaseIds.add(i.productId))
    );
    return { sales: salesIds, purchases: purchaseIds };
  }, [localSales, localPurchases]);

  const hasHistory = (p: Product) =>
    p.hasSales ||
    p.hasPurchases ||
    productIdsWithLocalHistory.sales.has(p.id) ||
    productIdsWithLocalHistory.purchases.has(p.id);

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

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      productsApi.delete(id, {
        deletedBy: user?.name ?? undefined,
        deletedByRole: user?.role ?? undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      setDeleteTarget(null);
      toast.success(t("product.productRemoved"));
    },
    onError: (err: Error) => toast.error(err.message || "Failed to remove product"),
  });

  const openAdd = () => {
    setEditingProduct(emptyProduct);
    setIsEditing(false);
    setIsNewCategory(false);
    setDialogOpen(true);
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
    if (isEditing && editingProduct.id) {
      updateMutation.mutate({
        id: editingProduct.id,
        data: { name, nameUr: nameUr ?? null, price, cost, stock, category, lowStockThreshold },
      });
    } else {
      createMutation.mutate({ name, nameUr, price, cost, stock, category, lowStockThreshold });
    }
  };

  const confirmDelete = (p: Product) => {
    if (hasHistory(p)) {
      toast.error("Cannot delete product with sales or purchase history.");
      return;
    }
    setDeleteTarget(p);
  };
  const doDelete = () => {
    if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
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

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder={t("inventory.searchProducts")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="card-elevated overflow-hidden">
        {isLoading ? (
          <p className="p-6 text-center text-muted-foreground">Loading products…</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("common.category")}</TableHead>
                <TableHead className="text-right">{t("common.price")}</TableHead>
                <TableHead className="text-right">{t("common.cost")}</TableHead>
                <TableHead className="text-right">{t("common.stock")}</TableHead>
                <TableHead className="text-right">{t("product.lowStockThreshold")}</TableHead>
                {isAdmin && <TableHead className="text-right">{t("inventory.actions")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
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
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => openEdit(p)}
                          className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                          title="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-block">
                                <button
                                  onClick={() => confirmDelete(p)}
                                  disabled={hasHistory(p)}
                                  className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50 disabled:cursor-not-allowed"
                                  title={hasHistory(p) ? "Has sales or purchase history" : "Remove"}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {hasHistory(p)
                                ? "Cannot delete: product has sales or purchase history"
                                : "Remove from list (record kept in database)"}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {!isLoading && filtered.length === 0 && (
          <p className="p-6 text-center text-muted-foreground">{t("product.noProductsMatch")}</p>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] flex flex-col overflow-hidden p-0 gap-0">
          <DialogHeader className="shrink-0 px-6 pt-10 pb-2 border-b border-border/40">
            <DialogTitle>{isEditing ? t("product.editProduct") : t("product.addProduct")}</DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto flex-1 min-h-0 px-6 pb-6">
          <div className="grid gap-4 py-2">
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

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("product.removeProductConfirm")}</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove &quot;{deleteTarget?.name}&quot; from the list immediately. When you click
              &quot;Sync with MySQL&quot; in the sidebar, the deletion is applied to the main database.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={doDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "…" : t("common.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default InventoryPage;
