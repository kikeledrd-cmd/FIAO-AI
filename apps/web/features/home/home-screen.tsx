"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import type { OnboardingState } from "@fiao/contracts/settings";
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
  { key: "pedidos", label: "Pedidos", hint: "WhatsApp y entrega", href: "/pedidos" },
  { key: "loyalty", label: "Puntos", hint: "Lealtad y recompensas", href: "/loyalty" },
  { key: "suppliers", label: "Proveedores", hint: "Compras y costos", href: "/suppliers" },
  { key: "inventory", label: "Inventario", hint: "Productos y stock", href: "/inventory" },
  { key: "cash", label: "Caja", hint: "Apertura y arqueo", href: "/cash" },
  { key: "ai", label: "FIAO AI", hint: "Pregúntale a tu negocio", href: "/ai" },
  { key: "reportes", label: "Reportes", hint: "Resumen y exportación", href: "/reportes" },
  { key: "configuracion", label: "Configuración", hint: "Ajustes y dispositivos", href: "/configuracion" }
] as const;

export function HomeScreen() {
  const { user, branches, activeBranchId, online } = useAppShell();
  const { status, pending, conflicts, syncing, sync } = useSync();
  const activeBranch = branches.find((branch) => branch.id === activeBranchId);

  return (
    <div className="home-screen">
      <OnboardingBanner branchId={activeBranchId} isOwner={user.role === "OWNER"} />
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

const MILESTONE_LABEL: Record<string, string> = {
  BRANCH_CREATED: "Sucursal creada",
  CATALOG_LOADED: "Catálogo cargado",
  CUSTOMER_CREATED: "Primer cliente",
  CASH_OPENED: "Caja abierta",
  FIRST_SALE: "Primera venta"
};

function OnboardingBanner({ branchId, isOwner }: { branchId: string; isOwner: boolean }) {
  const [state, setState] = useState<OnboardingState | null>(null);

  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    fetch(`/api/onboarding?branchId=${branchId}`)
      .then((response) => response.json())
      .then((json) => {
        if (!cancelled && json.state) setState(json.state);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [branchId, isOwner]);

  if (!isOwner || !state || state.next === null) return null;
  return (
    <section className="onboarding-banner" aria-label="Progreso de configuración">
      <strong>
        Configuración: {state.completedCount}/{state.total}
      </strong>
      <span>Siguiente: {MILESTONE_LABEL[state.next] ?? state.next}</span>
    </section>
  );
}
