"use client";

import { useSync } from "@/features/sync/sync-provider";

const label = {
  SYNCED: "Todo sincronizado",
  PENDING: "Movimientos pendientes",
  ERROR: "Error de sincronización",
  CONFLICT: "Revisión requerida"
} as const;

export function SyncStatus() {
  const { status, pending, conflicts, syncing, sync } = useSync();
  return (
    <div aria-live="polite">
      <span>{syncing ? "Sincronizando…" : label[status]}</span>
      {pending > 0 ? <span>{pending} pendientes</span> : null}
      {conflicts > 0 ? <span>{conflicts} en revisión</span> : null}
      <button type="button" onClick={() => void sync()} disabled={syncing}>
        Sincronizar
      </button>
    </div>
  );
}
