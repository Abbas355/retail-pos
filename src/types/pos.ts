export interface Product {
  id: string;
  name: string;
  /** Urdu name for bilingual display (e.g. Sales tab) */
  nameUr?: string;
  price: number;
  cost: number;
  stock: number;
  category: string;
  lowStockThreshold: number;
  /** True if product appears in any sale (from API) */
  hasSales?: boolean;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface Sale {
  id: string;
  items: CartItem[];
  total: number;
  paymentMethod: "cash" | "card";
  customerId?: string;
  date: string;
  cashier: string;
  /** Subtotal before discount (optional, for receipt) */
  subtotal?: number;
  /** Discount amount in dollars (optional) */
  discountAmount?: number;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  email: string;
}

export interface Purchase {
  id: string;
  supplierId: string;
  items: { productId: string; productName: string; quantity: number; cost: number }[];
  total: number;
  date: string;
}
