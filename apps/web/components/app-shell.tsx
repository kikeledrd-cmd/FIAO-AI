"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BranchSwitcher, type BranchOption } from "@/components/branch-switcher";
import { SyncStatus } from "@/components/sync-status";
import { SyncProvider } from "@/features/sync/sync-provider";

export interface AppShellUser {
  id: string;
  name: string;
  role: "OWNER" | "CASHIER";
}

export interface AppShellBranch extends BranchOption {
  timezone: string;
}

interface AppShellContextValue {
  user: AppShellUser;
  branches: AppShellBranch[];
  activeBranchId: string;
  online: boolean;
}

const AppShellContext = createContext<AppShellContextValue | null>(null);

export function AppShell({
  user,
  branches,
  activeBranchId,
  children
}: {
  user: AppShellUser;
  branches: AppShellBranch[];
  activeBranchId: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [activeBranch, setActiveBranch] = useState(activeBranchId);
  const [online, setOnline] = useState(true);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    const syncOnlineState = () => setOnline(navigator.onLine);
    syncOnlineState();
    window.addEventListener("online", syncOnlineState);
    window.addEventListener("offline", syncOnlineState);
    return () => {
      window.removeEventListener("online", syncOnlineState);
      window.removeEventListener("offline", syncOnlineState);
    };
  }, []);

  const switchBranch = useCallback(
    async (branchId: string) => {
      if (branchId === activeBranch) return;
      setSwitching(true);
      try {
        const response = await fetch("/api/auth/branch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ branchId })
        });
        if (!response.ok) throw new Error("BRANCH_SWITCH_FAILED");
        setActiveBranch(branchId);
        router.refresh();
      } finally {
        setSwitching(false);
      }
    },
    [activeBranch, router]
  );

  const value = useMemo(
    () => ({ user, branches, activeBranchId: activeBranch, online }),
    [user, branches, activeBranch, online]
  );

  return (
    <AppShellContext.Provider value={value}>
      <SyncProvider branchId={activeBranch}>
        <div className="app-shell">
          <header className="app-header">
            <div className="app-brand">FIAO</div>
            <BranchSwitcher
              branches={branches}
              activeBranchId={activeBranch}
              onSwitch={(branchId) => void switchBranch(branchId)}
              disabled={switching}
            />
            <div className="app-header-right">
              <span role="status" className={online ? "net-online" : "net-offline"}>
                {online ? "En línea" : "Sin conexión"}
              </span>
              <SyncStatus />
            </div>
          </header>
          <main className="app-main">{children}</main>
        </div>
      </SyncProvider>
    </AppShellContext.Provider>
  );
}

export function useAppShell(): AppShellContextValue {
  const value = useContext(AppShellContext);
  if (!value) throw new Error("APP_SHELL_REQUIRED");
  return value;
}
