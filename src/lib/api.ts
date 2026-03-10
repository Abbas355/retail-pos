declare global {
  interface Window {
    electronAPI?: { getApiBaseUrl: () => string };
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

export const productsApi = {
  list: () => fetchApi<any[]>("/products"),
  get: (id: string) => fetchApi(`/products/${id}`),
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

export const customersApi = {
  list: () => fetchApi("/customers"),
  get: (id: string) => fetchApi(`/customers/${id}`),
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

export const suppliersApi = {
  list: () => fetchApi("/suppliers"),
  get: (id: string) => fetchApi(`/suppliers/${id}`),
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
  }) => fetchApi("/sales", { method: "POST", body: JSON.stringify(data) }),
};

export const purchasesApi = {
  list: () => fetchApi("/purchases"),
  create: (data: {
    supplierId: string;
    items: { productId: string; productName: string; quantity: number; cost: number }[];
    total: number;
  }) => fetchApi("/purchases", { method: "POST", body: JSON.stringify(data) }),
};

export const expensesApi = {
  list: (params?: { from?: string; to?: string; category?: string }) => {
    const q = new URLSearchParams(params as Record<string, string>).toString();
    return fetchApi<import("@/types/pos").Expense[]>(`/expenses${q ? `?${q}` : ""}`);
  },
  create: (data: { amount: number; category: string; description?: string; date?: string }) =>
    fetchApi<import("@/types/pos").Expense>("/expenses", { method: "POST", body: JSON.stringify(data) }),
  delete: (id: string) => fetchApi(`/expenses/${id}`, { method: "DELETE" }),
};

export interface ApiUser {
  id: string;
  username: string;
  role: string;
  name: string;
}
export const usersApi = {
  list: () => fetchApi<ApiUser[]>("/users"),
  get: (id: string) => fetchApi<ApiUser>(`/users/${id}`),
  create: (data: { username: string; password: string; name: string; role: string }) =>
    fetchApi("/users", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: { name?: string; role?: string; password?: string }) =>
    fetchApi(`/users/${id}`, { method: "PUT", body: JSON.stringify(data) }),
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
