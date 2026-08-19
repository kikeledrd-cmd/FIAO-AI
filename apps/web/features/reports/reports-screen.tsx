"use client";

import { useEffect, useState } from "react";
import type {
  CashReport,
  CustomersReport,
  DashboardReport,
  FiaoReport,
  InventoryReport,
  OrdersReport,
  ProfitReport,
  SalesReport
} from "@fiao/contracts/reports";
import { useAppShell } from "@/components/app-shell";
import { formatMoneyCents } from "../sales/sales-screen";

type ReportType = "DASHBOARD" | "SALES" | "PROFIT" | "FIAO" | "INVENTORY" | "CASH" | "CUSTOMERS" | "ORDERS";

const REPORT_OPTIONS: Array<{ key: ReportType; label: string; ownerOnly?: boolean }> = [
  { key: "DASHBOARD", label: "Resumen", ownerOnly: true },
  { key: "SALES", label: "Ventas" },
  { key: "PROFIT", label: "Ganancia", ownerOnly: true },
  { key: "FIAO", label: "Fiado" },
  { key: "INVENTORY", label: "Inventario" },
  { key: "CASH", label: "Caja" },
  { key: "CUSTOMERS", label: "Clientes" },
  { key: "ORDERS", label: "Pedidos" }
];

const LABEL_TEXT: Record<string, string> = {
  CONFIRMED: "Confirmado",
  ESTIMATED: "Estimado",
  RECOMMENDATION: "Recomendación"
};

export function ReportsScreen() {
  const { user, activeBranchId } = useAppShell();
  const isOwner = user.role === "OWNER";
  const options = REPORT_OPTIONS.filter((option) => !option.ownerOnly || isOwner);
  const [type, setType] = useState<ReportType>(isOwner ? "DASHBOARD" : "SALES");
  const [report, setReport] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      setReport(null);
      try {
        const response = await fetch(`/api/reports?type=${type}&branchId=${activeBranchId}`);
        const json = await response.json();
        if (!response.ok) throw new Error(json.error ?? "ERROR");
        if (!cancelled) setReport(json.report);
      } catch {
        if (!cancelled) setError("No se pudo cargar el reporte.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [type, activeBranchId]);

  function downloadCsv(dataset: string) {
    window.location.href = `/api/reports/export?dataset=${dataset}&branchId=${activeBranchId}`;
  }

  return (
    <div className="customers-screen">
      <div className="report-tabs" role="tablist" aria-label="Reportes">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            role="tab"
            aria-selected={type === option.key}
            className={type === option.key ? "report-tab active" : "report-tab"}
            onClick={() => setType(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="report-actions">
        <button type="button" className="pos-secondary" onClick={() => downloadCsv("SALES")}>
          Exportar ventas (CSV)
        </button>
        <button type="button" className="pos-secondary" onClick={() => downloadCsv("CUSTOMERS")}>
          Exportar clientes (CSV)
        </button>
        {isOwner ? (
          <button type="button" className="pos-secondary" onClick={() => downloadCsv("PRODUCTS")}>
            Exportar productos (CSV)
          </button>
        ) : null}
      </div>

      {loading ? <p className="pos-empty">Cargando…</p> : null}
      {error ? (
        <p className="pos-error" role="alert">
          {error}
        </p>
      ) : null}

      {report ? <ReportView type={type} report={report} /> : null}
    </div>
  );
}

function Label({ value }: { value: string }) {
  return <span className="report-label">{LABEL_TEXT[value] ?? value}</span>;
}

function ReportView({ type, report }: { type: ReportType; report: unknown }) {
  switch (type) {
    case "DASHBOARD": {
      const data = report as DashboardReport;
      return (
        <section className="report-card">
          <h2>Resumen de hoy <Label value={data.label} /></h2>
          <dl className="report-rows">
            <Row label="Ventas de hoy" value={formatMoneyCents(data.salesTodayCents)} />
            <Row label="Ayer" value={formatMoneyCents(data.salesPreviousCents)} />
            <Row label="Variación" value={data.salesChangePct === null ? "—" : `${data.salesChangePct}%`} />
            <Row label="Ganancia estimada" value={formatMoneyCents(data.estimatedProfitCents)} />
            <Row label="Fiado pendiente" value={formatMoneyCents(data.totalFiadoCents)} />
            <Row label="Stock bajo" value={`${data.lowStockCount} producto(s)`} />
            <Row label="Pedidos activos" value={String(data.activeOrdersCount)} />
            <Row label="Caja" value={data.cashOpen ? "Abierta" : "Cerrada"} />
          </dl>
        </section>
      );
    }
    case "SALES": {
      const data = report as SalesReport;
      return (
        <section className="report-card">
          <h2>Ventas <Label value={data.label} /></h2>
          <dl className="report-rows">
            <Row label="Total" value={formatMoneyCents(data.totalCents)} />
            <Row label="Ventas" value={String(data.count)} />
            <Row label="Efectivo" value={formatMoneyCents(data.cashCents)} />
            <Row label="Transferencia" value={formatMoneyCents(data.transferCents)} />
            <Row label="Tarjeta" value={formatMoneyCents(data.cardCents)} />
            <Row label="Fiado" value={formatMoneyCents(data.fiadoCents)} />
            <Row label="Período anterior" value={formatMoneyCents(data.previousTotalCents)} />
            <Row label="Variación" value={data.changePct === null ? "—" : `${data.changePct}%`} />
          </dl>
        </section>
      );
    }
    case "PROFIT": {
      const data = report as ProfitReport;
      return (
        <section className="report-card">
          <h2>Ganancia estimada <Label value={data.label} /></h2>
          <dl className="report-rows">
            <Row label="Ingresos" value={formatMoneyCents(data.revenueCents)} />
            <Row label="Costo" value={formatMoneyCents(data.costCents)} />
            <Row label="Ganancia" value={formatMoneyCents(data.profitCents)} />
            <Row label="Ventas" value={String(data.count)} />
          </dl>
          <p className="report-note">Costo por promedio móvil; la ganancia es una estimación.</p>
        </section>
      );
    }
    case "FIAO": {
      const data = report as FiaoReport;
      return (
        <section className="report-card">
          <h2>Fiado <Label value={data.label} /></h2>
          <dl className="report-rows">
            <Row label="Total fiado" value={formatMoneyCents(data.totalFiadoCents)} />
            <Row label="Clientes con deuda" value={String(data.customersWithDebt)} />
            <Row label="Vencidos" value={String(data.overdueCustomers)} />
            <Row label="Cobrado hoy" value={formatMoneyCents(data.collectionsCents)} />
          </dl>
        </section>
      );
    }
    case "INVENTORY": {
      const data = report as InventoryReport;
      return (
        <section className="report-card">
          <h2>Inventario <Label value={data.label} /></h2>
          <dl className="report-rows">
            <Row label="Productos" value={String(data.totalProducts)} />
            <Row label="Stock bajo" value={String(data.lowStockCount)} />
            <Row label="Valor de inventario" value={formatMoneyCents(data.inventoryValueCents)} />
          </dl>
          {data.lowStockItems.length > 0 ? (
            <ul className="report-list">
              {data.lowStockItems.map((item) => (
                <li key={item.productId}>
                  {item.name} — disponible {item.available}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      );
    }
    case "CASH": {
      const data = report as CashReport;
      return (
        <section className="report-card">
          <h2>Caja <Label value={data.label} /></h2>
          <dl className="report-rows">
            <Row label="Estado" value={data.openSessionId ? "Abierta" : "Cerrada"} />
            <Row label="Fondo inicial" value={data.openingFloatCents === null ? "—" : formatMoneyCents(data.openingFloatCents)} />
            <Row label="Esperado" value={data.expectedCents === null ? "—" : formatMoneyCents(data.expectedCents)} />
            <Row label="Gastos" value={formatMoneyCents(data.expensesCents)} />
            <Row label="Retiros" value={formatMoneyCents(data.withdrawalsCents)} />
            <Row label="Inyecciones" value={formatMoneyCents(data.injectionsCents)} />
          </dl>
        </section>
      );
    }
    case "CUSTOMERS": {
      const data = report as CustomersReport;
      return (
        <section className="report-card">
          <h2>Clientes <Label value={data.label} /></h2>
          <dl className="report-rows">
            <Row label="Total" value={String(data.totalCustomers)} />
            <Row label="Activos" value={String(data.activeCustomers)} />
            <Row label="Con deuda" value={String(data.withDebt)} />
            <Row label="Fiado total" value={formatMoneyCents(data.totalFiadoCents)} />
          </dl>
          {data.topDebtors.length > 0 ? (
            <ul className="report-list">
              {data.topDebtors.map((debtor) => (
                <li key={debtor.name}>
                  {debtor.name} — {formatMoneyCents(debtor.balanceCents)}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      );
    }
    case "ORDERS": {
      const data = report as OrdersReport;
      return (
        <section className="report-card">
          <h2>Pedidos <Label value={data.label} /></h2>
          <dl className="report-rows">
            <Row label="Total" value={String(data.total)} />
            <Row label="Activos" value={String(data.active)} />
          </dl>
        </section>
      );
    }
    default:
      return null;
  }
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="report-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
