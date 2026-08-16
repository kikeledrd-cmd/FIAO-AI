"use client";

import { useAppShell } from "@/components/app-shell";
import { useSync } from "@/features/sync/sync-provider";

const ROLE_LABEL = {
  OWNER: "Dueño",
  CASHIER: "Cajero"
} as const;

const PLAN2_MODULES = [
  { key: "sell", label: "Vender", hint: "POS rápido" },
  { key: "fiao", label: "Fiao", hint: "Fiado y abonos" },
  { key: "customers", label: "Clientes", hint: "Cuentas y límites" },
  { key: "inventory", label: "Inventario", hint: "Productos y stock" },
  { key: "cash", label: "Caja", hint: "Apertura y cierre" }
] as const;

export function HomeScreen() {
  const { user, branches, activeBranchId, online } = useAppShell();
  const { status, pending, conflicts, syncing, sync } = useSync();
  const activeBranch = branches.find((branch) => branch.id === activeBranchId);

  return (
    <div className="home-screen">
      <section className="home-summary">
        <p className="home-greeting">
          Hola, <strong>{user.name}</strong> ({ROLE_LABEL[user.role]})
        </p>
        <p>
          Sucursal activa: <strong>{activeBranch?.name}</strong>
        </p>
        <p role="status" className={online ? "net-online" : "net-offline"}>
          {online ? "En línea" : "Sin conexión"}
        </p>
        <p aria-live="polite">
          {syncing
            ? "Sincronizando…"
            : status === "SYNCED"
              ? "Todo sincronizado"
              : status === "PENDING"
                ? `${pending} movimiento${pending === 1 ? "" : "s"} pendiente${pending === 1 ? "" : "s"} de sincronizar`
                : status === "CONFLICT"
                  ? `${conflicts} movimiento${conflicts === 1 ? "" : "s"} requieren revisión`
                  : "Error de sincronización"}
        </p>
        <button type="button" onClick={() => void sync()} disabled={syncing}>
          Sincronizar
        </button>
      </section>

      <section aria-label="Módulos">
        <ul className="module-grid">
          {PLAN2_MODULES.map((module) => (
            <li key={module.key} className="module-card">
              <h2>{module.label}</h2>
              <p>{module.hint}</p>
              <span>Próximamente</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
