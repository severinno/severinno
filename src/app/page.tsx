"use client";

/**
 * AppShell — the single user-visible route ("/").
 *
 * The Severinno Marketplace is an SPA: everything lives on `/` and view
 * switching is driven by `useViewStore` (persisted dotted strings like
 * 'vitrine', 'client.dashboard', 'provider.services', 'admin.taxonomy').
 *
 * Responsibilities:
 *   1. Hydrate the persisted view store (avoid SSR mismatch).
 *   2. Run the initial auth check (`fetchMe`) once on mount.
 *   3. Route to the right top-level surface based on `view`.
 *   4. Guard panel views — if a logged-out / wrong-role user lands on a
 *      panel view, bounce back to the vitrine and prompt auth.
 *   5. Mount the global ModalsHost (auth, provider profile, quote, booking).
 *   6. Join the realtime room when authenticated (notifications + messages).
 */

import dynamic from "next/dynamic";
import { useEffect, useSyncExternalStore } from "react";

import { useAuthStore, useUIStore, useViewStore } from "@/store";
import { useRealtime } from "@/hooks/use-realtime";

// All heavy components are dynamically imported to reduce Turbopack compile
// memory.  On this 4 GB sandbox the server was OOM-killed whenever Chrome and
// the Next.js dev server ran simultaneously; lazy compilation keeps peak RSS
// under ~1.5 GB so both can coexist.
const Vitrine = dynamic(() => import("@/components/vitrine/vitrine"));
const ClientPanel = dynamic(() =>
  import("@/components/client/client-panel").then((m) => m.ClientPanel),
);
const ProviderPanel = dynamic(() =>
  import("@/components/provider/provider-panel").then((m) => m.ProviderPanel),
);
const AdminPanel = dynamic(() =>
  import("@/components/admin/admin-panel").then((m) => m.AdminPanel),
);
const ModalsHost = dynamic(
  () => import("@/components/modals/modals-host").then((m) => m.ModalsHost),
  { ssr: false },
);

// Hydration gate: returns false during SSR + first client render, true after.
// This avoids hydration mismatches caused by the persisted view store without
// touching setState in an effect (React 19 friendly).
const useHydrated = () =>
  useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

export default function Home() {
  const mounted = useHydrated();

  const view = useViewStore((s) => s.view);
  const reset = useViewStore((s) => s.reset);
  const user = useAuthStore((s) => s.user);
  const initialized = useAuthStore((s) => s.initialized);
  const fetchMe = useAuthStore((s) => s.fetchMe);
  const openAuth = useUIStore((s) => s.openAuth);

  // Realtime singleton (connects only in the browser)
  const { join } = useRealtime();

  // Initial auth check — runs once on mount.
  useEffect(() => {
    void fetchMe();
  }, [fetchMe]);

  // ---- Auth guard for panel views -----------------------------------------
  // Gated on `mounted` so the guard never fires during the SSR/hydration
  // phase (when persisted store values may not yet be available).
  useEffect(() => {
    if (!mounted || !initialized) return;

    if (view.startsWith("client.") && (!user || user.role !== "CLIENT")) {
      reset("vitrine");
      openAuth("login", "CLIENT");
      return;
    }
    if (view.startsWith("provider.") && (!user || user.role !== "PROVIDER")) {
      reset("vitrine");
      openAuth("login", "PROVIDER");
      return;
    }
    if (view.startsWith("admin.") && (!user || user.role !== "ADMIN")) {
      reset("vitrine");
      openAuth("login", "CLIENT");
      return;
    }
  }, [mounted, view, user, initialized, reset, openAuth]);

  // ---- Join realtime room when authenticated ------------------------------
  useEffect(() => {
    if (!user) return;
    join({ userId: user.id, role: user.role });
  }, [user, join]);

  // ---- Pre-hydration / loading shell --------------------------------------
  if (!mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-sm">Carregando Severinno…</span>
        </div>
      </div>
    );
  }

  // ---- Route to the active surface ----------------------------------------
  let content: React.ReactNode;
  if (view.startsWith("client.")) {
    content = <ClientPanel />;
  } else if (view.startsWith("provider.")) {
    content = <ProviderPanel />;
  } else if (view.startsWith("admin.")) {
    content = <AdminPanel />;
  } else {
    content = <Vitrine />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {content}
      <ModalsHost />
    </div>
  );
}
