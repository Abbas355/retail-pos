declare global {
  interface Window {
    electronAPI?: {
      getApiBaseUrl: () => string;
      printReceipt?: (html: string) => Promise<void>;
    };
  }
}

const getApiBase = (): string =>
  typeof window !== "undefined" && window.electronAPI?.getApiBaseUrl?.()
    ? `${window.electronAPI.getApiBaseUrl()}/api`
    : "/api";

async function fetchApi<T>(url: string, options?: RequestInit, retries = 3): Promise<T> {
  const base = getApiBase();
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${base}${url}`, {
        ...options,
        headers: { "Content-Type": "application/json", ...options?.headers },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error((err as { error?: string }).error || "Request failed");
      }
      if (res.status === 204) return undefined as T;
      return res.json();
    } catch (e) {
      lastErr = e;
      if (i < retries - 1) await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : "Request failed";
  throw new Error(msg.includes("fetch") ? "Connection error. Ensure the app is running." : msg);
}

export async function login(username: string, password: string) {
  return fetchApi<{ id: string; username: string; role: string; name: string; permissions: string[] }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export type ProductActivityEntry = {
  kind: "purchase" | "sale" | "created" | "deleted";
  id: string;
  at: string | null;
  title: string;
  detail: string;
  refId?: string;
  meta?: string | null;
};

export const productsApi = {
  list: () => fetchApi<any[]>("/products"),
  get: (id: string) => fetchApi(`/products/${id}`),
  getActivityLog: (id: string) =>
    fetchApi<{ productId: string; productName: string; entries: ProductActivityEntry[] }>(
      `/products/${encodeURIComponent(id)}/activity-log`
    ),
  getByBarcode: (barcode: string) => fetchApi<any>(`/products/by-barcode/${encodeURIComponent(barcode)}`),
  create: (data: { name: string; nameUr?: string; barcode?: string; price: number; cost?: number; stock?: number; category?: string; lowStockThreshold?: number }) =>
    fetchApi("/products", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<{ name: string; nameUr: string | null; barcode?: string | null; price: number; cost: number; stock: number; category: string; lowStockThreshold: number }>) =>
    fetchApi(`/products/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  delete: (id: string, options?: { deletedBy?: string; deletedByRole?: string }) => {
    const deletedBy = options?.deletedBy?.trim();
    const url = deletedBy ? `/products/${id}?deletedBy=${encodeURIComponent(deletedBy)}` : `/products/${id}`;
    return fetchApi(url, {
      method: "DELETE",
      ...(deletedBy && { body: JSON.stringify({ deletedBy, deletedByRole: options?.deletedByRole }) }),
    });
  },
};

export type CustomerActivityEntry = {
  kind: "created" | "sale" | "sale_payment" | "khata_udhaar" | "khata_payment";
  id: string;
  at: string | null;
  title: string;
  detail: string;
  refId?: string;
  meta?: string | null;
};

export const customersApi = {
  list: () => fetchApi("/customers"),
  get: (id: string) => fetchApi(`/customers/${id}`),
  getActivityLog: (id: string) =>
    fetchApi<{ customerId: string; customerName: string; entries: CustomerActivityEntry[] }>(
      `/customers/${encodeURIComponent(id)}/activity-log`
    ),
  create: (data: { name: string; phone?: string }) => fetchApi("/customers", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: { name: string; phone?: string }) => fetchApi(`/customers/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  delete: (id: string, options?: { deletedBy?: string }) => {
    const deletedBy = options?.deletedBy?.trim();
    const url = deletedBy ? `/customers/${id}?deletedBy=${encodeURIComponent(deletedBy)}` : `/customers/${id}`;
    return fetchApi(url, {
      method: "DELETE",
      ...(deletedBy && { body: JSON.stringify({ deletedBy }) }),
    });
  },
};

export type SupplierActivityEntry = {
  kind: "created" | "purchase" | "purchase_payment" | "khata_udhaar" | "khata_payment";
  id: string;
  at: string | null;
  title: string;
  detail: string;
  refId?: string;
  meta?: string | null;
};

export const suppliersApi = {
  list: () => fetchApi("/suppliers"),
  get: (id: string) => fetchApi(`/suppliers/${id}`),
  getActivityLog: (id: string) =>
    fetchApi<{ supplierId: string; supplierName: string; entries: SupplierActivityEntry[] }>(
      `/suppliers/${encodeURIComponent(id)}/activity-log`
    ),
  create: (data: { name: string; phone?: string; email?: string }) => fetchApi("/suppliers", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: { name: string; phone?: string; email?: string }) => fetchApi(`/suppliers/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  delete: (id: string, options?: { deletedBy?: string }) => {
    const deletedBy = options?.deletedBy?.trim();
    const url = deletedBy ? `/suppliers/${id}?deletedBy=${encodeURIComponent(deletedBy)}` : `/suppliers/${id}`;
    return fetchApi(url, {
      method: "DELETE",
      ...(deletedBy && { body: JSON.stringify({ deletedBy }) }),
    });
  },
};

export const salesApi = {
  list: () => fetchApi("/sales"),
  pushSales: (sales: Array<{
    items: Array<{ product: { id: string; name: string; price: number }; quantity: number }>;
    total: number;
    paymentMethod: "cash" | "card";
    cashier: string;
    customerId?: string;
    date?: string;
  }>) => fetchApi<{ ok: boolean; pushed: number; message?: string }>("/sales/sync", { method: "POST", body: JSON.stringify({ sales }) }),
  create: (data: {
    items: { product: { id: string; name: string; price: number }; quantity: number }[];
    total: number;
    paymentMethod: "cash" | "card";
    cashier: string;
    customerId?: string;
    /** Amount paid now. Omit or equal to total = full payment. 0 = credit, else partial */
    paidAmount?: number;
  }) => fetchApi("/sales", { method: "POST", body: JSON.stringify(data) }),
  recordPayment: (saleId: string, data: { amount: number; paymentMethod?: "cash" | "card" }) =>
    fetchApi<{ payment: { id: string; saleId: string; amount: number; paymentMethod: string }; sale: { id: string; total: number; paidAmount: number; paymentStatus: string; balance: number } }>(`/sales/${encodeURIComponent(saleId)}/payments`, { method: "POST", body: JSON.stringify(data) }),
};

export const khataApi = {
  /** Total credit and debit. Optional from/to (YYYY-MM-DD) to filter by date range. */
  getTotals: (params?: { from?: string; to?: string }) => {
    const sp = new URLSearchParams();
    if (params?.from) sp.set("from", params.from);
    if (params?.to) sp.set("to", params.to);
    const q = sp.toString();
    return fetchApi<{ totalCredit: number; totalDebit: number }>(`/khata/totals${q ? `?${q}` : ""}`);
  },
  listCustomers: () => fetchApi<{ id: string; name: string; phone: string | null; balance: number }[]>("/khata/customers"),
  getLedger: () =>
    fetchApi<{
      saleId: string;
      customerId: string;
      customerName: string;
      items: string;
      total: number;
      paidAmount: number;
      amountDue: number;
      date: string | null;
    }[]>("/khata/ledger"),
  getCustomerLedger: (customerId: string) =>
    fetchApi<{
      customer: { id: string; name: string; phone: string | null };
      balance: number;
      ledger: Array<
        | { id: string; total: number; paidAmount: number; paymentStatus: string; balance: number; date: string | null; type: "sale" }
        | { id: string; saleId: string; amount: number; paymentMethod: string; date: string | null; type: "payment" }
        | { id: string; type: "udhaar_added" | "payment_received"; amount: number; note: string | null; date: string | null }
      >;
    }>(`/khata/customers/${encodeURIComponent(customerId)}`),
  /** Manual khata entry: udhaar_added (balance +) or payment_received (balance -). */
  createCustomerKhataEntry: (customerId: string, data: { type: "udhaar_added" | "payment_received"; amount: number; note?: string; date?: string }) =>
    fetchApi<{ id: string; type: string; amount: number; note: string | null; date: string | null }>(
      `/khata/customers/${encodeURIComponent(customerId)}/entries`,
      { method: "POST", body: JSON.stringify(data) }
    ),
  listSuppliers: () =>
    fetchApi<{ id: string; name: string; phone: string | null; balance: number }[]>("/khata/suppliers"),
  /** All unpaid/partial purchases with supplier (for grouped table, like customer ledger) */
  getSupplierLedgerList: () =>
    fetchApi<{
      purchaseId: string;
      supplierId: string;
      supplierName: string;
      items: string;
      total: number;
      paidAmount: number;
      amountDue: number;
      date: string | null;
    }[]>("/khata/supplier-ledger"),
  getSupplierLedger: (supplierId: string) =>
    fetchApi<{
      supplier: { id: string; name: string; phone: string | null };
      balance: number;
      ledger: Array<
        | { id: string; total: number; paidAmount: number; paymentStatus: string; balance: number; date: string | null; type: "purchase" }
        | { id: string; purchaseId: string; amount: number; paymentMethod: string; date: string | null; type: "payment" }
        | { id: string; type: "udhaar_added" | "payment_received"; amount: number; note: string | null; date: string | null }
      >;
    }>(`/khata/suppliers/${encodeURIComponent(supplierId)}`),
  /** Manual supplier khata entry: udhaar_added (balance +) or payment_received (balance -). */
  createSupplierKhataEntry: (supplierId: string, data: { type: "udhaar_added" | "payment_received"; amount: number; note?: string; date?: string }) =>
    fetchApi<{ id: string; type: string; amount: number; note: string | null; date: string | null }>(
      `/khata/suppliers/${encodeURIComponent(supplierId)}/entries`,
      { method: "POST", body: JSON.stringify(data) }
    ),
  /** Cash in / advances returned – money received back (out is in Expenses) */
  listCashIn: () =>
    fetchApi<{ id: string; amount: number; note: string; date: string; createdAt: string | null }[]>("/khata/cash-in"),
  createCashIn: (data: { amount: number; note?: string; date?: string; expenseId?: string }) =>
    fetchApi<{ id: string; amount: number; note: string; date: string; createdAt: string | null }>("/khata/cash-in", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  /** Expenses with category Urgent/Other with balance still to be returned (given out, show in Khata Cash in) */
  getAdvancesOut: () =>
    fetchApi<{ id: string; amount: number; returnedAmount: number; balance: number; category: string; description: string; date: string }[]>("/khata/advances-out"),
  /** Cash in Khata statement: combined timeline (given out + received back + manual entries). */
  getCashinStatement: () =>
    fetchApi<{
      totalOut: number;
      totalIn: number;
      entries: Array<{
        id: string;
        type: "in" | "out";
        amount: number;
        note: string | null;
        date: string | null;
        source: "advance" | "cash_in" | "manual";
      }>;
    }>("/khata/cashin-statement"),
  /** Manual Cash in Khata entry. */
  createCashinKhataEntry: (data: { type: "in" | "out"; amount: number; note?: string; date?: string }) =>
    fetchApi<{ id: string; type: string; amount: number; note: string | null; date: string | null; source: string }>(
      "/khata/cashin-entries",
      { method: "POST", body: JSON.stringify(data) }
    ),
  deleteCashinKhataEntry: (id: string) =>
    fetchApi(`/khata/cashin-entries/${encodeURIComponent(id)}`, { method: "DELETE" }),
  /** General in/out khata entries. Optional type (in|out), from, to. */
  listKhataEntries: (params?: { type?: "in" | "out"; from?: string; to?: string }) => {
    const sp = new URLSearchParams();
    if (params?.type) sp.set("type", params.type);
    if (params?.from) sp.set("from", params.from);
    if (params?.to) sp.set("to", params.to);
    const q = sp.toString();
    return fetchApi<KhataEntry[]>(`/khata/entries${q ? `?${q}` : ""}`);
  },
  createKhataEntry: (data: {
    type: "in" | "out";
    amount: number;
    note?: string;
    date?: string;
    linkType?: "random" | "customer" | "supplier" | "cashin";
    linkId?: string;
    createdBy?: string;
  }) =>
    fetchApi<KhataEntry>("/khata/entries", { method: "POST", body: JSON.stringify(data) }),
  deleteKhataEntry: (id: string) =>
    fetchApi(`/khata/entries/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

export interface KhataEntry {
  id: string;
  type: "in" | "out";
  amount: number;
  note: string | null;
  date: string | null;
  linkType: "random" | "customer" | "supplier" | "cashin";
  linkId: string | null;
  /** Server timestamp when the row was saved */
  createdAt: string | null;
  /** Display name or username of the user who recorded the entry */
  createdBy: string | null;
}

export const purchasesApi = {
  list: () => fetchApi("/purchases"),
  create: (data: {
    supplierId: string;
    items: { productId: string; productName: string; quantity: number; cost: number }[];
    total: number;
    paidAmount?: number;
    paymentMethod?: "cash" | "card";
  }) => fetchApi("/purchases", { method: "POST", body: JSON.stringify(data) }),
  recordPayment: (purchaseId: string, data: { amount: number; paymentMethod?: "cash" | "card" }) =>
    fetchApi<{
      payment: { id: string; purchaseId: string; amount: number; paymentMethod: string };
      purchase: { id: string; total: number; paidAmount: number; paymentStatus: string; balance: number };
    }>(`/purchases/${encodeURIComponent(purchaseId)}/payments`, { method: "POST", body: JSON.stringify(data) }),
};

export type ExpenseActivityEntry = {
  kind: "recorded" | "return";
  id: string;
  at: string | null;
  title: string;
  detail: string;
};

export const expensesApi = {
  list: (params?: { from?: string; to?: string; category?: string }) => {
    const q = new URLSearchParams(params as Record<string, string>).toString();
    return fetchApi<import("@/types/pos").Expense[]>(`/expenses${q ? `?${q}` : ""}`);
  },
  create: (data: { amount: number; category: string; description?: string; date?: string }) =>
    fetchApi<import("@/types/pos").Expense>("/expenses", { method: "POST", body: JSON.stringify(data) }),
  getActivityLog: (id: string) =>
    fetchApi<{ expenseId: string; entries: ExpenseActivityEntry[] }>(
      `/expenses/${encodeURIComponent(id)}/activity-log`
    ),
  delete: (id: string) => fetchApi(`/expenses/${id}`, { method: "DELETE" }),
};

export interface ApiUser {
  id: string;
  username: string;
  role: string;
  name: string;
  disabled?: boolean;
}

export type UserActivityEntry = {
  kind: "created" | "updated" | "password_changed" | "login_disabled" | "login_enabled" | "deleted";
  id: string;
  at: string | null;
  title: string;
  detail: string;
  meta?: string | null;
};

export const usersApi = {
  list: () => fetchApi<ApiUser[]>("/users"),
  get: (id: string) => fetchApi<ApiUser>(`/users/${id}`),
  getActivityLog: (id: string) =>
    fetchApi<{ userId: string; username: string; entries: UserActivityEntry[] }>(
      `/users/${encodeURIComponent(id)}/activity-log`
    ),
  create: (data: { username: string; password: string; name: string; role: string }) =>
    fetchApi("/users", { method: "POST", body: JSON.stringify(data) }),
  update: (
    id: string,
    data: { name?: string; role?: string; password?: string; disabled?: boolean },
    options?: { currentUserId?: string }
  ) =>
    fetchApi(`/users/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
      ...(options?.currentUserId != null && { headers: { "X-User-Id": options.currentUserId } }),
    }),
  delete: (id: string, options?: { currentUserId?: string }) =>
    fetchApi(`/users/${id}`, { method: "DELETE", ...(options?.currentUserId != null && { headers: { "X-User-Id": options.currentUserId } }) }),
};

export interface ApiPermission {
  permission_key: string;
  description: string;
}
export interface RolePermission {
  role: string;
  permission_key: string;
}
export const permissionsApi = {
  list: () => fetchApi<ApiPermission[]>("/permissions"),
  listRolePermissions: () => fetchApi<RolePermission[]>("/permissions/role-permissions"),
};

export const syncApi = {
  pull: () => fetchApi<{ ok: boolean; message?: string; error?: string }>("/sync/pull", { method: "POST" }),
  push: () => fetchApi<{ ok: boolean; message?: string; error?: string }>("/sync/push", { method: "POST" }),
};

export const printApi = {
  receipt: (data: { sale: import("@/types/pos").Sale; settings: { storeName: string; currencySymbol: string; receiptHeader?: string; receiptFooter?: string; receiptWidthChars?: number }; locale?: string }) =>
    fetchApi<{ ok: boolean }>("/print/receipt", { method: "POST", body: JSON.stringify(data) }),
};

export interface ActivityItem {
  type:
    | "sale"
    | "expense"
    | "add_customer"
    | "add_supplier"
    | "add_product"
    | "add_purchase"
    | "payment"
    | "delete_product"
    | "delete_customer"
    | "delete_supplier"
    | "delete_expense"
    | "void_sale";
  id: string;
  summary: string;
  amount: number;
  source: "whatsapp" | "pos";
  createdAt: string | null;
  cashier?: string | null;
}
export const activityApi = {
  list: (params?: { limit?: number; source?: "whatsapp"; category?: string }) => {
    const search = new URLSearchParams();
    if (params?.limit != null) search.set("limit", String(Math.min(100, Math.max(1, params.limit))));
    if (params?.source === "whatsapp") search.set("source", "whatsapp");
    if (params?.category && params.category !== "all") search.set("category", params.category);
    return fetchApi<ActivityItem[]>(`/activity${search.toString() ? `?${search}` : ""}`);
  },
};
