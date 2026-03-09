import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  SETTINGS_CHANGE_EVENT,
  type AppSettings,
} from "@/lib/settings";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useQueryClient } from "@tanstack/react-query";
import { syncApi, salesApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Settings, Store, Receipt, Sliders, RefreshCw } from "lucide-react";
import { toast } from "sonner";

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

const CURRENCY_OPTIONS = [
  { value: "$", label: "USD ($)" },
  { value: "€", label: "EUR (€)" },
  { value: "£", label: "GBP (£)" },
  { value: "Rs", label: "PKR (Rs)" },
  { value: "₹", label: "INR (₹)" },
];

const SettingsPage = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [saved, setSaved] = useLocalStorage<AppSettings>(
    SETTINGS_STORAGE_KEY,
    DEFAULT_SETTINGS
  );
  const [form, setForm] = useState<AppSettings>(() => loadSettings());

  useEffect(() => {
    setForm(loadSettings());
  }, [saved]);

  const update = (patch: Partial<AppSettings>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const handleSave = () => {
    const next: AppSettings = {
      storeName: (form.storeName ?? "").trim() || DEFAULT_SETTINGS.storeName,
      currencySymbol:
        (form.currencySymbol ?? "").trim() || DEFAULT_SETTINGS.currencySymbol,
      defaultLowStockThreshold:
        Math.max(
          0,
          Math.floor(Number(form.defaultLowStockThreshold) || 0)
        ) || DEFAULT_SETTINGS.defaultLowStockThreshold,
      receiptHeader: (form.receiptHeader ?? "").trim(),
      receiptFooter: (form.receiptFooter ?? "").trim(),
      autoSync: form.autoSync ?? true,
    };
    setSaved(next);
    window.dispatchEvent(new CustomEvent(SETTINGS_CHANGE_EVENT, { detail: next }));
    toast.success(t("settings.saved"));
  };

  const [syncing, setSyncing] = useState(false);
  const [localSales] = useLocalStorage<Array<{ items: Array<{ product: { id: string; name: string; price: number }; quantity: number }>; total: number; paymentMethod: "cash" | "card"; cashier: string; customerId?: string; date?: string }>>("pos_sales", []);
  const handleSync = async () => {
    setSyncing(true);
    try {
      let salesPushed = 0;
      if (localSales.length > 0) {
        try {
          const r = await salesApi.pushSales(localSales);
          if (r.ok && r.pushed) salesPushed = r.pushed;
        } catch (_) { /* ignore */ }
      }
      const push = await syncApi.push();
      const pull = await syncApi.pull();
      if (push.ok || pull.ok || salesPushed > 0) {
        queryClient.invalidateQueries();
        const msg = salesPushed > 0 ? `${t("settings.synced")} (${salesPushed} sales → server)` : (push.ok && pull.ok ? t("settings.synced") : push.ok ? t("settings.syncedPush") : t("settings.syncedPull"));
        toast.success(msg);
      } else toast.error(pull.error || push.error || t("settings.syncFailed"));
    } catch {
      toast.error(t("settings.syncUnreachable"));
    } finally {
      setSyncing(false);
    }
  };

  const isElectron = typeof window !== "undefined" && !!window.electronAPI;

  return (
    <div className="space-y-6 animate-slide-in">
      <div>
        <h1 className="font-heading text-2xl font-bold flex items-center gap-2">
          <Settings className="h-7 w-7" />
          {t("settings.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.description")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Store className="h-5 w-5" />
            {t("settings.general")}
          </CardTitle>
          <CardDescription>{t("settings.generalDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 max-w-md">
            <Label htmlFor="storeName">{t("settings.storeName")}</Label>
            <Input
              id="storeName"
              value={form.storeName}
              onChange={(e) => update({ storeName: e.target.value })}
              placeholder={DEFAULT_SETTINGS.storeName}
            />
          </div>
          <div className="grid gap-2 max-w-md">
            <Label htmlFor="currencySymbol">{t("settings.currencySymbol")}</Label>
            <select
              id="currencySymbol"
              value={form.currencySymbol}
              onChange={(e) => update({ currencySymbol: e.target.value })}
              className="flex h-9 w-full max-w-[200px] rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {CURRENCY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Sliders className="h-5 w-5" />
            {t("settings.defaults")}
          </CardTitle>
          <CardDescription>{t("settings.defaultsDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 max-w-md">
            <Label htmlFor="defaultLowStock">{t("settings.defaultLowStock")}</Label>
            <Input
              id="defaultLowStock"
              type="number"
              min={0}
              value={form.defaultLowStockThreshold}
              onChange={(e) =>
                update({
                  defaultLowStockThreshold: Math.max(
                    0,
                    Math.floor(Number(e.target.value) || 0)
                  ),
                })
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Receipt className="h-5 w-5" />
            {t("settings.receipt")}
          </CardTitle>
          <CardDescription>{t("settings.receiptDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="receiptHeader">{t("settings.receiptHeader")}</Label>
            <Input
              id="receiptHeader"
              value={form.receiptHeader}
              onChange={(e) => update({ receiptHeader: e.target.value })}
              placeholder={t("settings.receiptHeaderPlaceholder")}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="receiptFooter">{t("settings.receiptFooter")}</Label>
            <Input
              id="receiptFooter"
              value={form.receiptFooter}
              onChange={(e) => update({ receiptFooter: e.target.value })}
              placeholder={t("settings.receiptFooterPlaceholder")}
            />
          </div>
        </CardContent>
      </Card>

      {isElectron && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <RefreshCw className="h-5 w-5" />
                {t("settings.sync")}
              </CardTitle>
              <CardDescription>{t("settings.syncDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-4 max-w-md">
                <div className="space-y-0.5">
                  <Label htmlFor="autoSync">{t("settings.autoSync")}</Label>
                  <p className="text-xs text-muted-foreground">{t("settings.autoSyncHint")}</p>
                </div>
                <Switch
                  id="autoSync"
                  checked={form.autoSync ?? true}
                  onCheckedChange={(checked) => update({ autoSync: checked })}
                />
              </div>
              <div>
                <Button
                  variant="outline"
                  onClick={handleSync}
                  disabled={syncing}
                  className="gap-2"
                >
                  <RefreshCw className={`h-4 w-4 shrink-0 ${syncing ? "animate-spin" : ""}`} />
                  {syncing ? t("settings.syncing") : t("settings.syncNow")}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-muted">
            <CardHeader>
              <CardTitle className="text-lg">{t("settings.desktop")}</CardTitle>
              <CardDescription>{t("settings.desktopDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {t("settings.desktopHint")}
              </p>
            </CardContent>
          </Card>
        </>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={handleSave}>{t("common.save")}</Button>
        <Button
          variant="outline"
          onClick={() => {
            setForm({ ...saved });
            toast.info(t("settings.discardChanges"));
          }}
        >
          {t("settings.discardChanges")}
        </Button>
      </div>
    </div>
  );
};

export default SettingsPage;
