const API = "/api";

async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${url}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error || "Request failed");
  }
  if (res.status === 204) return undefined as T;
  return res.json();
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
  create: (data: { name: string; nameUr?: string; price: number; cost?: number; stock?: number; category?: string; lowStockThreshold?: number }) =>
    fetchApi("/products", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<{ name: string; nameUr: string | null; price: number; cost: number; stock: number; category: string; lowStockThreshold: number }>) =>
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
