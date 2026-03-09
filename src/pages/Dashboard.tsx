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
    { label: "Today's Sales", value: todaySalesCount, icon: ShoppingCart, color: "text-primary" },
    { label: "Today's Revenue", value: `$${todayRevenue.toFixed(2)}`, icon: DollarSign, color: "text-success" },
    { label: "Total Revenue", value: `$${totalRevenue.toFixed(2)}`, icon: TrendingUp, color: "text-info" },
    { label: "Products", value: products.length, icon: Package, color: "text-muted-foreground" },
    { label: "Low Stock Items", value: lowStockProducts.length, icon: AlertTriangle, color: "text-warning" },
    { label: "Customers", value: customers.length, icon: Users, color: "text-primary" },
  ];

  return (
    <div className="space-y-6 animate-slide-in">
      <div>
        <h1 className="font-heading text-2xl font-bold">Welcome back, {user?.name}</h1>
        <p className="text-muted-foreground">Here's what's happening in your store today.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.label} className="stat-card flex items-center gap-4">
            <div className={`flex h-11 w-11 items-center justify-center rounded-lg bg-muted ${stat.color}`}>
              <stat.icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">
                {stat.label}
                {stat.label === "Today's Sales" && (
                  <span className="ml-1 text-xs">({today})</span>
                )}
              </p>
              <p className="font-heading text-xl font-bold">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      {lowStockProducts.length > 0 && (
        <div className="card-elevated p-5">
          <h2 className="mb-3 flex items-center gap-2 font-heading text-lg font-semibold">
            <AlertTriangle className="h-5 w-5 text-warning" /> Low Stock Alerts
          </h2>
          <div className="space-y-2">
            {lowStockProducts.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg bg-muted px-4 py-2.5 text-sm">
                <span className="font-medium">{p.name}</span>
                <span className="low-stock">{p.stock} left (threshold: {p.lowStockThreshold})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {todaySales.length > 0 && (
        <div className="card-elevated p-5">
          <h2 className="mb-3 font-heading text-lg font-semibold">Recent Sales Today</h2>
          <div className="space-y-2">
            {todaySales.slice(-5).reverse().map((sale) => (
              <div key={sale.id} className="flex items-center justify-between rounded-lg bg-muted px-4 py-2.5 text-sm">
                <span>{sale.items.map((i) => i.product?.name || (i as any).productName || "").filter(Boolean).join(", ") || "Sale"}</span>
                <span className="font-semibold">${sale.total.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
