"use client";

import { useSync } from "@/features/sync/sync-provider";

const label = {
  SYNCED: "Sincronizado",
  PENDING: "Pendientes",
  ERROR: "Error",
  CONFLICT: "Revisar"
} as const;

export function SyncStatus() {
  const { status, pending, conflicts, syncing, sync } = useSync();
  const tone =
    status === "CONFLICT" ? "sync-conflict" : status === "PENDING" || status === "ERROR" ? "sync-pending" : "";
  return (
    <div className={`sync-status ${tone} ${syncing ? "sync-busy" : ""}`} aria-live="polite">
      <span className="sync-dot" aria-hidden="true" />
      <span>{syncing ? "Sincronizando…" : label[status]}</span>
      {pending > 0 ? <span>{pending}</span> : null}
      {conflicts > 0 ? <span>{conflicts} ⚠</span> : null}
      <button type="button" className="sync-resync" onClick={() => void sync()} disabled={syncing}>
        Sync
      </button>
    </div>
  );
}
