import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import AppSidebar from "@/components/AppSidebar";
import { syncApi } from "@/lib/api";

const AppLayout = () => {
  const queryClient = useQueryClient();

  /* On load: pull MySQL data so desktop shows latest when online. */
  useEffect(() => {
    const pull = async () => {
      try {
        const r = await syncApi.pull();
        if (r.ok) queryClient.invalidateQueries();
      } catch { /* MySQL offline - use SQLite data */ }
    };
    pull();
  }, [queryClient]);

  /* When coming online: push offline changes to MySQL, then pull latest. */
  useEffect(() => {
    const sync = async () => {
      try {
        await syncApi.push();
        await syncApi.pull();
        queryClient.invalidateQueries();
      } catch { /* MySQL offline */ }
    };
    window.addEventListener("online", sync);
    return () => window.removeEventListener("online", sync);
  }, [queryClient]);

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
