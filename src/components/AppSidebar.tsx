import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import {
  LayoutDashboard, ShoppingCart, Package, TruckIcon, Users, Building2, BarChart3, UserCog, LogOut, ShoppingBag, Settings, Wallet, BookOpen, Activity
} from "lucide-react";

const navKeys: { to: string; labelKey: string; icon: typeof LayoutDashboard; roles: string[] }[] = [
  { to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard, roles: ["admin", "manager", "cashier"] },
  { to: "/sales", labelKey: "nav.sales", icon: ShoppingCart, roles: ["admin", "manager", "cashier"] },
  { to: "/activity", labelKey: "nav.activity", icon: Activity, roles: ["admin", "manager", "cashier"] },
  { to: "/khata", labelKey: "nav.khata", icon: BookOpen, roles: ["admin", "manager", "cashier"] },
  { to: "/inventory", labelKey: "nav.inventory", icon: Package, roles: ["admin", "manager", "cashier"] },
  { to: "/purchases", labelKey: "nav.purchases", icon: TruckIcon, roles: ["admin", "manager"] },
  { to: "/expenses", labelKey: "nav.expenses", icon: Wallet, roles: ["admin", "manager"] },
  { to: "/customers", labelKey: "nav.customers", icon: Users, roles: ["admin", "manager", "cashier"] },
  { to: "/suppliers", labelKey: "nav.suppliers", icon: Building2, roles: ["admin", "manager"] },
  { to: "/reports", labelKey: "nav.reports", icon: BarChart3, roles: ["admin", "manager"] },
  { to: "/users", labelKey: "nav.users", icon: UserCog, roles: ["admin"] },
  { to: "/settings", labelKey: "nav.settings", icon: Settings, roles: ["admin", "manager"] },
];

interface AppSidebarProps {
  onClose?: () => void;
}

const AppSidebar = ({ onClose }: AppSidebarProps) => {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();

  return (
    <aside className="flex h-screen w-full max-w-[15rem] flex-col shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
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
                onClick={onClose}
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
