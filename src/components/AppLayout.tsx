import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Menu } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import { Button } from "@/components/ui/button";
import { syncApi } from "@/lib/api";
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, SETTINGS_CHANGE_EVENT, type AppSettings } from "@/lib/settings";

function getAutoSync(): boolean {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS.autoSync;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return parsed.autoSync ?? DEFAULT_SETTINGS.autoSync;
  } catch {
    return DEFAULT_SETTINGS.autoSync;
  }
}

const AppLayout = () => {
  const queryClient = useQueryClient();
  const [autoSync, setAutoSync] = useState(getAutoSync);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const onSettingsChange = (e: Event) => {
      const ev = e as CustomEvent<AppSettings>;
      setAutoSync(ev.detail?.autoSync ?? true);
    };
    window.addEventListener(SETTINGS_CHANGE_EVENT, onSettingsChange);
    return () => window.removeEventListener(SETTINGS_CHANGE_EVENT, onSettingsChange);
  }, []);

  /* On load: pull MySQL data when autoSync enabled. */
  useEffect(() => {
    if (!autoSync) return;
    const pull = async () => {
      try {
        const r = await syncApi.pull();
        if (r.ok) queryClient.invalidateQueries();
      } catch { /* MySQL offline - use SQLite data */ }
    };
    pull();
  }, [queryClient, autoSync]);

  /* When coming online: sync when autoSync enabled. */
  useEffect(() => {
    if (!autoSync) return;
    const sync = async () => {
      try {
        await syncApi.push();
        await syncApi.pull();
        queryClient.invalidateQueries();
      } catch { /* MySQL offline */ }
    };
    window.addEventListener("online", sync);
    return () => window.removeEventListener("online", sync);
  }, [queryClient, autoSync]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar overlay when open */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside
        className={`fixed left-0 top-0 z-50 h-screen w-60 transform transition-transform duration-200 ease-out ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <AppSidebar onClose={() => setSidebarOpen(false)} />
      </aside>

      <div className="flex flex-1 flex-col min-w-0">
        <header className="sticky top-0 z-30 flex shrink-0 items-center gap-3 border-b border-sidebar-border bg-sidebar text-sidebar-foreground px-4 py-2.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Open menu"
            className="shrink-0 h-9 w-9 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <span className="font-heading text-base font-semibold text-sidebar-foreground">RetailPOS</span>
        </header>
        <main className="flex-1 overflow-auto p-6 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
