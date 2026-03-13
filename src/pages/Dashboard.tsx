import { useQuery } from "@tanstack/react-query";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { getLocalDateString } from "@/lib/utils";
import { salesApi } from "@/lib/api";
import { SEED_PRODUCTS, SEED_CUSTOMERS } from "@/data/seedData";
import { Product, Sale } from "@/types/pos";
import { useAuth } from "@/context/AuthContext";
import {
  DollarSign, Package, ShoppingCart, AlertTriangle, TrendingUp, Users,
} from "lucide-react";

const Dashboard = () => {
  const { user } = useAuth();
  const [products] = useLocalStorage<Product[]>("pos_products", SEED_PRODUCTS);
  const { data: apiSales = [] } = useQuery({
    queryKey: ["sales"],
    queryFn: () => salesApi.list(),
    refetchOnWindowFocus: true,
    refetchInterval: 15000,
  });
  const sales: Sale[] = (apiSales as any[]).map((s) => ({
    id: s.id,
    items: (s.items || []).map((i: any) => ({
      product: { id: i.productId, name: i.product?.name || i.productName || "", price: i.price, cost: 0, stock: 0, category: "", lowStockThreshold: 5 },
      quantity: i.quantity,
    })),
    total: s.total,
    paymentMethod: s.paymentMethod || "cash",
    customerId: s.customerId,
    date: s.date,
    cashier: s.cashier || "",
  }));
  const [customers] = useLocalStorage("pos_customers", SEED_CUSTOMERS);

  const today = getLocalDateString(new Date());
  const todaySales = sales.filter((s) => {
    if (!s.date) return false;
    const saleDateStr = getLocalDateString(s.date);
    return saleDateStr === today;
  });
  const todaySalesCount = todaySales.length;
  const todayRevenue = todaySales.reduce((sum, s) => sum + s.total, 0);
  const lowStockProducts = products.filter((p) => p.stock <= p.lowStockThreshold);
  const totalRevenue = sales.reduce((sum, s) => sum + s.total, 0);

  const stats = [
    { label: "Today's Sales", value: todaySalesCount, icon: ShoppingCart },
    { label: "Today's Revenue", value: `$${todayRevenue.toFixed(2)}`, icon: DollarSign },
    { label: "Total Revenue", value: `$${totalRevenue.toFixed(2)}`, icon: TrendingUp },
    { label: "Products", value: products.length, icon: Package },
    { label: "Low Stock", value: lowStockProducts.length, icon: AlertTriangle },
    { label: "Customers", value: customers.length, icon: Users },
  ];

  return (
    <div className="space-y-8 animate-slide-in">
      <div>
        <h1 className="font-heading text-xl font-semibold text-foreground">Welcome, {user?.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Store overview</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.label} className="stat-card flex items-center gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/80">
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">
                {stat.label}
                {stat.label === "Today's Sales" && (
                  <span className="ml-1 text-xs">({today})</span>
                )}
              </p>
              <p className="font-heading text-lg font-semibold text-foreground">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      {lowStockProducts.length > 0 && (
        <div className="card-elevated p-4">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Low stock</h2>
          <div className="space-y-1.5">
            {lowStockProducts.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-md px-3 py-2 text-sm">
                <span className="text-foreground">{p.name}</span>
                <span className="text-muted-foreground">{p.stock} left</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {todaySales.length > 0 && (
        <div className="card-elevated p-4">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Recent sales</h2>
          <div className="space-y-1.5">
            {todaySales.slice(-5).reverse().map((sale) => (
              <div key={sale.id} className="flex items-center justify-between rounded-md px-3 py-2 text-sm">
                <span className="truncate text-foreground">{sale.items.map((i) => i.product?.name || (i as any).productName || "").filter(Boolean).join(", ") || "Sale"}</span>
                <span className="font-medium text-foreground">${sale.total.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
