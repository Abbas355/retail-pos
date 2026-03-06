import { useState } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { syncApi } from "@/lib/api";
import { toast } from "sonner";
import {
  LayoutDashboard, ShoppingCart, Package, TruckIcon, Users, Building2, BarChart3, UserCog, LogOut, ShoppingBag, RefreshCw
} from "lucide-react";

const navKeys: { to: string; labelKey: string; icon: typeof LayoutDashboard; roles: string[] }[] = [
  { to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard, roles: ["admin", "manager", "cashier"] },
  { to: "/sales", labelKey: "nav.sales", icon: ShoppingCart, roles: ["admin", "manager", "cashier"] },
  { to: "/inventory", labelKey: "nav.inventory", icon: Package, roles: ["admin", "manager", "cashier"] },
  { to: "/purchases", labelKey: "nav.purchases", icon: TruckIcon, roles: ["admin", "manager"] },
  { to: "/customers", labelKey: "nav.customers", icon: Users, roles: ["admin", "manager", "cashier"] },
  { to: "/suppliers", labelKey: "nav.suppliers", icon: Building2, roles: ["admin", "manager"] },
  { to: "/reports", labelKey: "nav.reports", icon: BarChart3, roles: ["admin", "manager"] },
  { to: "/users", labelKey: "nav.users", icon: UserCog, roles: ["admin"] },
];

const AppSidebar = () => {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const isElectron = typeof window !== "undefined" && !!window.electronAPI;

  const handleSync = async () => {
    setSyncing(true);
    try {
      const push = await syncApi.push();
      const pull = await syncApi.pull();
      if (push.ok || pull.ok) {
        queryClient.invalidateQueries();
        toast.success(push.ok && pull.ok ? "Synced with MySQL" : push.ok ? "Changes saved to MySQL" : "Data refreshed from MySQL");
      } else toast.error(pull.error || push.error || "Sync failed");
    } catch {
      toast.error("MySQL not reachable. Connect and try again.");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <aside className="flex h-screen w-60 flex-col shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 flex items-center gap-3 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sidebar-primary">
            <ShoppingBag className="h-5 w-5 text-sidebar-primary-foreground" />
          </div>
          <span className="font-heading text-lg font-bold">RetailPOS</span>
        </div>

        <div className="shrink-0 flex items-center gap-1 px-3 pb-2">
          <button
            type="button"
            onClick={() => i18n.changeLanguage("en")}
            className={`rounded px-2 py-1 text-xs font-medium transition-colors ${i18n.language === "en" ? "bg-sidebar-accent text-sidebar-primary" : "text-sidebar-foreground/70 hover:bg-sidebar-accent"}`}
          >
            EN
          </button>
          <button
            type="button"
            onClick={() => i18n.changeLanguage("ur")}
            className={`rounded px-2 py-1 text-xs font-medium transition-colors ${i18n.language === "ur" ? "bg-sidebar-accent text-sidebar-primary" : "text-sidebar-foreground/70 hover:bg-sidebar-accent"}`}
            dir="rtl"
          >
            اردو
          </button>
        </div>

        <nav className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden space-y-1 px-3 py-2">
          {navKeys
            .filter((item) => user && item.roles.includes(user.role))
            .map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-sidebar-accent text-sidebar-primary"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  }`
                }
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {t(item.labelKey)}
              </NavLink>
            ))}
        </nav>

        <div className="shrink-0 border-t border-sidebar-border p-4">
        {isElectron && (
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="mb-3 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 shrink-0 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing..." : "Sync with MySQL"}
          </button>
        )}
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-accent text-xs font-bold">
            {user?.name.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="truncate text-sm font-medium">{user?.name}</p>
            <p className="text-xs capitalize text-sidebar-foreground/60">{user?.role}</p>
          </div>
        </div>
        <button
          onClick={logout}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-destructive"
        >
          <LogOut className="h-4 w-4 shrink-0" /> {t("common.signOut")}
        </button>
        </div>
      </div>
    </aside>
  );
};

export default AppSidebar;
