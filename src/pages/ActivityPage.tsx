import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { activityApi, type ActivityItem } from "@/lib/api";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Activity, Filter, ShoppingCart, Wallet, Users, Building2, Package, Truck, CreditCard, Trash2, Undo2 } from "lucide-react";

const ICON_MAP: Record<string, typeof ShoppingCart> = {
  sale: ShoppingCart,
  expense: Wallet,
  add_customer: Users,
  add_supplier: Building2,
  add_product: Package,
  add_purchase: Truck,
  payment: CreditCard,
  delete_product: Trash2,
  delete_customer: Trash2,
  delete_supplier: Trash2,
  delete_expense: Trash2,
  void_sale: Undo2,
};

const formatTime = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const tz = "Asia/Karachi";
  const dStr = d.toLocaleDateString("en-CA", { timeZone: tz });
  const nowStr = new Date().toLocaleDateString("en-CA", { timeZone: tz });
  const sameDay = dStr === nowStr;
  if (sameDay) {
    return d.toLocaleTimeString("en-PK", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }
  return d.toLocaleDateString("en-PK", { timeZone: tz, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

const ActivityRow = ({ item }: { item: ActivityItem }) => {
  const Icon = ICON_MAP[item.type] || Activity;
  const isWhatsApp = item.source === "whatsapp";
  return (
    <div className="flex items-center gap-4 border-b border-border/80 px-4 py-3 last:border-0">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{item.summary}</p>
        <p className="text-xs text-muted-foreground">
          {formatTime(item.createdAt)}
          {item.cashier && ` · ${item.cashier}`}
        </p>
      </div>
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
          isWhatsApp ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-muted text-muted-foreground"
        }`}
      >
        {isWhatsApp ? "WhatsApp" : "POS"}
      </span>
    </div>
  );
};

const ActivityPage = () => {
  const [whatsappOnly, setWhatsappOnly] = useState(false);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["activity", whatsappOnly],
    queryFn: () => activityApi.list({ limit: 100, source: whatsappOnly ? "whatsapp" : undefined }),
    refetchInterval: 15000,
  });

  return (
    <div className="space-y-6 animate-slide-in">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-xl font-semibold text-foreground flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Activity
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Audit log of all changes</p>
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Button
            variant={whatsappOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setWhatsappOnly(!whatsappOnly)}
            className={`gap-1.5 ${whatsappOnly ? "bg-[#25D366] text-white hover:bg-[#20BD5A] dark:bg-[#25D366] dark:hover:bg-[#20BD5A] dark:text-white border-0" : ""}`}
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden
            >
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
            WhatsApp only
          </Button>
        </div>
      </div>

      <div className="card-elevated overflow-hidden">
        <ScrollArea className="h-[calc(100vh-14rem)]">
          {isLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {whatsappOnly ? "No WhatsApp activities yet." : "No activity yet."}
            </div>
          ) : (
            items.map((item) => <ActivityRow key={`${item.type}-${item.id}`} item={item} />)
          )}
        </ScrollArea>
      </div>
    </div>
  );
};

export default ActivityPage;
