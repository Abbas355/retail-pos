import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getLocalDateString, getDatePartFromApi, formatDateTimePK } from "@/lib/utils";
import type { Sale } from "@/types/pos";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { salesApi } from "@/lib/api";
import { BarChart3, TrendingUp, DollarSign, Filter } from "lucide-react";

type DatePreset = "today" | "thisWeek" | "thisMonth" | "last7" | "last30" | "custom";

const DATE_RANGE_OPTIONS: { value: DatePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "thisWeek", label: "This week" },
  { value: "thisMonth", label: "This month" },
  { value: "last7", label: "Last 7 days" },
  { value: "last30", label: "Last 30 days" },
  { value: "custom", label: "Custom range" },
];

function getDateRange(preset: DatePreset, customFrom?: string, customTo?: string): { from: string; to: string } {
  const now = new Date();
  const todayStr = getLocalDateString(now);

  switch (preset) {
    case "today":
      return { from: todayStr, to: todayStr };
    case "thisWeek": {
      const day = now.getDay();
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
      return { from: getLocalDateString(weekStart), to: todayStr };
    }
    case "thisMonth":
      return {
        from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`,
        to: todayStr,
      };
    case "last7": {
      const from7 = new Date(now);
      from7.setDate(from7.getDate() - 6);
      return { from: getLocalDateString(from7), to: todayStr };
    }
    case "last30": {
      const from30 = new Date(now);
      from30.setDate(from30.getDate() - 29);
      return { from: getLocalDateString(from30), to: todayStr };
    }
    case "custom":
      return { from: customFrom || todayStr, to: customTo || todayStr };
    default:
      return { from: todayStr, to: todayStr };
  }
}

function getItemCost(item: { quantity: number; product?: { cost?: number | null } | null }): number {
  const cost = item.product?.cost ?? 0;
  return (typeof cost === "number" ? cost : 0) * (item.quantity || 0);
}

const CASH_COLOR = "#22c55e";
const CARD_COLOR = "#3b82f6";
const BAR_COLOR = "hsl(var(--primary))";

const ReportsPage = () => {
  const [datePreset, setDatePreset] = useState<DatePreset>("last7");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [paymentFilter, setPaymentFilter] = useState<string>("all");
  const [cashierFilter, setCashierFilter] = useState<string>("all");
  const [pieActiveIndex, setPieActiveIndex] = useState<number | undefined>(undefined);

  const { data: apiSales = [], isLoading } = useQuery({
    queryKey: ["sales"],
    queryFn: () => salesApi.list(),
    refetchOnWindowFocus: true,
    refetchInterval: 15000,
  });
  const sales: Sale[] = (apiSales as any[]).map((s) => ({
    id: s.id,
    items: (s.items || []).map((i: any) => ({
      product: {
        id: i.productId,
        name: i.product?.name || i.productName || "",
        price: i.price,
        cost: i.product?.cost ?? 0,
        stock: 0,
        category: "",
        lowStockThreshold: 5,
      },
      quantity: i.quantity,
    })),
    total: s.total,
    paymentMethod: s.paymentMethod || "cash",
    customerId: s.customerId,
    date: s.date,
    cashier: s.cashier || "",
  }));

  const cashiers = useMemo(() => {
    const set = new Set<string>();
    sales.forEach((s) => s.cashier && set.add(s.cashier));
    return Array.from(set).sort();
  }, [sales]);

  const dateRange = useMemo(
    () => getDateRange(datePreset, customFrom || undefined, customTo || undefined),
    [datePreset, customFrom, customTo]
  );

  const filteredSales = useMemo(() => {
    return sales.filter((s) => {
      const dateStr = getDatePartFromApi(s.date);
      if (!dateStr) return false;
      if (dateStr < dateRange.from || dateStr > dateRange.to) return false;
      if (paymentFilter !== "all" && s.paymentMethod !== paymentFilter) return false;
      if (cashierFilter !== "all" && s.cashier !== cashierFilter) return false;
      return true;
    });
  }, [sales, dateRange, paymentFilter, cashierFilter]);

  const barChartData = useMemo(() => {
    const byDate: Record<string, { date: string; revenue: number; count: number }> = {};
    filteredSales.forEach((s) => {
      const dateStr = getDatePartFromApi(s.date);
      if (!dateStr) return;
      if (!byDate[dateStr]) byDate[dateStr] = { date: dateStr, revenue: 0, count: 0 };
      byDate[dateStr].revenue += Number(s.total ?? 0);
      byDate[dateStr].count += 1;
    });
    const from = new Date(dateRange.from + "T12:00:00");
    const to = new Date(dateRange.to + "T12:00:00");
    const allDates: string[] = [];
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      allDates.push(getLocalDateString(d));
    }
    return allDates.map((dateStr) => {
      const entry = byDate[dateStr] || { date: dateStr, revenue: 0, count: 0 };
      return {
        ...entry,
        label: new Date(dateStr + "T12:00:00").toLocaleDateString("en-PK", { timeZone: "Asia/Karachi", month: "short", day: "numeric", year: dateStr.slice(0, 4) !== new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" }).slice(0, 4) ? "2-digit" : undefined }),
      };
    });
  }, [filteredSales, dateRange]);

  const pieChartData = useMemo(() => {
    const cash = filteredSales.filter((s) => (s.paymentMethod ?? "").toLowerCase() === "cash").reduce((sum, s) => sum + Number(s.total ?? 0), 0);
    const card = filteredSales.filter((s) => (s.paymentMethod ?? "").toLowerCase() === "card").reduce((sum, s) => sum + Number(s.total ?? 0), 0);
    return [
      { name: "Cash", value: cash, color: CASH_COLOR },
      { name: "Card", value: card, color: CARD_COLOR },
    ].filter((d) => d.value > 0);
  }, [filteredSales]);

  const calcStats = (salesList: typeof sales) => {
    const revenue = salesList.reduce((sum, s) => sum + Number(s.total || 0), 0);
    const cost = salesList.reduce((sum, s) => {
      const saleCost = (s.items ?? []).reduce((iSum: number, i: any) => iSum + getItemCost(i), 0);
      return sum + saleCost;
    }, 0);
    const profit = revenue - cost;
    return { revenue, cost, profit, count: salesList.length };
  };

  const stats = calcStats(filteredSales);

  const StatCards = ({ label }: { label: string }) => (
    <div className="grid gap-4 sm:grid-cols-4 mb-6">
      {[
        { title: `${label} Sales`, value: stats.count },
        { title: "Revenue", value: `$${stats.revenue.toFixed(2)}` },
        { title: "Cost", value: `$${stats.cost.toFixed(2)}` },
        { title: "Profit", value: `$${stats.profit.toFixed(2)}` },
      ].map((s) => (
        <div key={s.title} className="stat-card">
          <p className="text-sm text-muted-foreground">{s.title}</p>
          <p className="font-heading text-xl font-bold mt-1">{s.value}</p>
        </div>
      ))}
    </div>
  );

  const SalesTable = ({ salesList }: { salesList: typeof sales }) => (
    <div className="card-elevated overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date/Time</TableHead>
            <TableHead>Items</TableHead>
            <TableHead>Payment</TableHead>
            <TableHead>Cashier</TableHead>
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {salesList.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                No sales in this range
              </TableCell>
            </TableRow>
          ) : (
            salesList
              .slice()
              .reverse()
              .map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{s.date ? formatDateTimePK(s.date) : "—"}</TableCell>
                  <TableCell>
                    {(s.items ?? [])
                      .map((i: any) => `${i.productName ?? i.product?.name ?? "—"} x${i.quantity}`)
                      .join(", ")}
                  </TableCell>
                  <TableCell className="capitalize">{s.paymentMethod ?? "—"}</TableCell>
                  <TableCell>{s.cashier ?? "—"}</TableCell>
                  <TableCell className="text-right font-semibold">
                    ${Number(s.total ?? 0).toFixed(2)}
                  </TableCell>
                </TableRow>
              ))
          )}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div className="space-y-5 animate-slide-in">
      <h1 className="font-heading text-2xl font-bold">Reports</h1>

      <div className="card-elevated p-4 space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium mb-2">
          <Filter className="h-4 w-4" /> Filters
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Date range</Label>
            <Select value={datePreset} onValueChange={(v) => setDatePreset(v as DatePreset)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select range" />
              </SelectTrigger>
              <SelectContent>
                {DATE_RANGE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {datePreset === "custom" && (
              <div className="flex items-center gap-2 mt-2">
                <Input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="w-40"
                  placeholder="From"
                />
                <span className="text-muted-foreground text-sm">to</span>
                <Input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="w-40"
                  placeholder="To"
                />
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Payment</Label>
            <Select value={paymentFilter} onValueChange={setPaymentFilter}>
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="card">Card</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Cashier</Label>
            <Select value={cashierFilter} onValueChange={setCashierFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {cashiers.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {datePreset === "custom" ? `${dateRange.from} to ${dateRange.to}` : DATE_RANGE_OPTIONS.find((o) => o.value === datePreset)?.label}
          {paymentFilter !== "all" && ` · Payment: ${paymentFilter}`}
          {cashierFilter !== "all" && ` · Cashier: ${cashierFilter}`}
        </p>
      </div>

      {isLoading ? (
        <p className="py-8 text-center text-muted-foreground">Loading sales…</p>
      ) : (
        <>
          <StatCards label="Filtered" />

          <div className="grid gap-6 lg:grid-cols-5">
            <div className="lg:col-span-3 card-elevated p-4">
              <h2 className="font-heading text-lg font-semibold mb-4 flex items-center gap-2">
                <BarChart3 className="h-5 w-5" /> Sales by date
              </h2>
              <div className="h-[320px]">
                {barChartData.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    No data in this range
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={barChartData}
                      margin={{ top: 12, right: 16, left: 8, bottom: 8 }}
                      barCategoryGap="20%"
                      barGap={4}
                    >
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${Number(v).toLocaleString()}`} />
                      <RechartsTooltip
                        formatter={(value: number) => [`$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, "Revenue"]}
                        labelFormatter={(_, payload) => payload[0]?.payload?.date && new Date(payload[0].payload.date + "T12:00:00").toLocaleDateString("en-PK", { timeZone: "Asia/Karachi", weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                      />
                      <Bar
                        dataKey="revenue"
                        fill={BAR_COLOR}
                        radius={[4, 4, 0, 0]}
                        name="Revenue"
                        barSize={32}
                        minPointSize={2}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="lg:col-span-2 card-elevated p-4 overflow-visible">
              <h2 className="font-heading text-lg font-semibold mb-4">Cash vs Card</h2>
              <div className="h-[320px] min-h-0 overflow-visible">
                {pieChartData.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    No payment data in this range
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart margin={{ top: 16, right: 80, bottom: 16, left: 80 }}>
                      <Pie
                        data={pieChartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={2}
                        dataKey="value"
                        nameKey="name"
                        activeIndex={pieActiveIndex}
                        activeShape={{ outerRadius: 88, strokeWidth: 2, stroke: "var(--background)" }}
                        onMouseEnter={(_, index) => setPieActiveIndex(index)}
                        onMouseLeave={() => setPieActiveIndex(undefined)}
                        label={({ value }) => `$${Number(value).toFixed(2)}`}
                        labelLine={{ strokeWidth: 1.5 }}
                      >
                        {pieChartData.map((entry, i) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <RechartsTooltip formatter={(value: number) => [`$${Number(value).toFixed(2)}`, "Revenue"]} />
                      <Legend formatter={(value) => value} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          <SalesTable salesList={filteredSales} />
        </>
      )}
    </div>
  );
};

export default ReportsPage;
