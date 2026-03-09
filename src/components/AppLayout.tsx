import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import AppSidebar from "@/components/AppSidebar";
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
      <AppSidebar />
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
};

export default AppLayout;
