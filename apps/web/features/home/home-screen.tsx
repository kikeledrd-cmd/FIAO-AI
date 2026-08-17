"use client";

import Link from "next/link";
import type { Route } from "next";
import { useAppShell } from "@/components/app-shell";
import { useSync } from "@/features/sync/sync-provider";

const ROLE_LABEL = {
  OWNER: "Dueño",
  CASHIER: "Cajero"
} as const;

const PLAN2_MODULES: { key: string; label: string; hint: string; href?: string }[] = [
  { key: "sell", label: "Vender", hint: "POS rápido", href: "/sell" },
  { key: "customers", label: "Clientes", hint: "Fiado y abonos", href: "/customers" },
  { key: "apartados", label: "Apartados", hint: "Reserva y anticipos", href: "/apartados" },
  { key: "loyalty", label: "Puntos", hint: "Lealtad y recompensas", href: "/loyalty" },
  { key: "suppliers", label: "Proveedores", hint: "Compras y costos", href: "/suppliers" },
  { key: "inventory", label: "Inventario", hint: "Productos y stock", href: "/inventory" },
  { key: "cash", label: "Caja", hint: "Apertura y arqueo", href: "/cash" }
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
        <div className="home-sync-row">
          <button type="button" className="home-resync" onClick={() => void sync()} disabled={syncing}>
            {syncing ? "Sincronizando…" : "Sincronizar ahora"}
          </button>
        </div>
      </section>

      <section aria-label="Módulos">
        <ul className="module-grid">
          {PLAN2_MODULES.map((module) => {
            const content = (
              <>
                <h2>{module.label}</h2>
                <p>{module.hint}</p>
                <span>{module.href ? "Listo" : "Próximamente"}</span>
              </>
            );
            return (
              <li key={module.key} className="module-card">
                {module.href ? <Link href={module.href as Route}>{content}</Link> : content}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
