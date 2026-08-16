"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { offlineDb } from "@/lib/offline/db";
import { syncNow as runSync, type SyncSummary } from "@/lib/offline/sync-client";

export type SyncUiStatus = "SYNCED" | "PENDING" | "ERROR" | "CONFLICT";

interface SyncContextValue {
  status: SyncUiStatus;
  pending: number;
  conflicts: number;
  syncing: boolean;
  lastSummary: SyncSummary | null;
  sync: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({
  branchId,
  children,
  syncRunner = runSync
}: {
  branchId: string;
  children: ReactNode;
  syncRunner?: (branchId: string) => Promise<SyncSummary>;
}) {
  const [status, setStatus] = useState<SyncUiStatus>("SYNCED");
  const [pending, setPending] = useState(0);
  const [conflicts, setConflicts] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastSummary, setLastSummary] = useState<SyncSummary | null>(null);

  const refreshLocalStatus = useCallback(async () => {
    const [pendingCount, conflictCount] = await Promise.all([
      offlineDb.pendingOperations.where("branchId").equals(branchId).count(),
      offlineDb.syncConflicts.where("branchId").equals(branchId).count()
    ]);
    setPending(pendingCount);
    setConflicts(conflictCount);
    setStatus(conflictCount > 0 ? "CONFLICT" : pendingCount > 0 ? "PENDING" : "SYNCED");
  }, [branchId]);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      const summary = await syncRunner(branchId);
      setLastSummary(summary);
      await refreshLocalStatus();
    } catch {
      setStatus("ERROR");
      await refreshCountsWithoutStatus(branchId, setPending, setConflicts);
    } finally {
      setSyncing(false);
    }
  }, [branchId, refreshLocalStatus, syncRunner]);

  useEffect(() => {
    // Async IndexedDB read (not a synchronous state update in the effect body);
    // refreshLocalStatus resolves after an await, so the rule's concern does not apply.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshLocalStatus();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onOnline = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void sync(), 500);
    };
    window.addEventListener("online", onOnline);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("online", onOnline);
    };
  }, [refreshLocalStatus, sync]);

  const value = useMemo(() => ({ status, pending, conflicts, syncing, lastSummary, sync }), [status, pending, conflicts, syncing, lastSummary, sync]);
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const value = useContext(SyncContext);
  if (!value) throw new Error("SYNC_PROVIDER_REQUIRED");
  return value;
}

async function refreshCountsWithoutStatus(
  branchId: string,
  setPending: (value: number) => void,
  setConflicts: (value: number) => void
) {
  const [pendingCount, conflictCount] = await Promise.all([
    offlineDb.pendingOperations.where("branchId").equals(branchId).count(),
    offlineDb.syncConflicts.where("branchId").equals(branchId).count()
  ]);
  setPending(pendingCount);
  setConflicts(conflictCount);
}
