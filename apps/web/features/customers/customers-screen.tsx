"use client";

import type { AbonoPayload } from "@fiao/contracts/credit";
import { useAppShell } from "@/components/app-shell";
import { useSync } from "@/features/sync/sync-provider";
import { enqueueOperation } from "@/lib/offline/queue";
import { listCustomersLocally, loadCustomersFromServer, saveCustomersLocally, type CustomerWithBalance } from "@/lib/offline/customers";
import { syncNow } from "@/lib/offline/sync-client";
import { useEffect, useMemo, useState } from "react";
import { formatMoneyCents } from "../sales/sales-screen";

export function CustomersScreen() {
  const { user, activeBranchId, online } = useAppShell();
  const { sync } = useSync();
  const [customers, setCustomers] = useState<CustomerWithBalance[]>([]);
  const [query, setQuery] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [abonoTarget, setAbonoTarget] = useState<CustomerWithBalance | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadCustomers() {
      setLoadError(null);
      try {
        if (navigator.onLine) {
          const fresh = await loadCustomersFromServer(activeBranchId);
          if (cancelled) return;
          setCustomers(fresh);
          await saveCustomersLocally(fresh).catch(() => undefined);
        } else {
          const local = await listCustomersLocally(activeBranchId);
          if (cancelled) return;
          if (local.length > 0) setCustomers(local);
          else setLoadError("Sin conexión y sin clientes guardados en este dispositivo.");
        }
      } catch {
        if (cancelled) return;
        const local = await listCustomersLocally(activeBranchId).catch(() => []);
        if (local.length > 0) setCustomers(local);
        else setLoadError("No se pudieron cargar los clientes.");
      }
    }
    void loadCustomers();
    return () => {
      cancelled = true;
    };
  }, [activeBranchId]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return customers;
    return customers.filter((customer) => customer.name.toLowerCase().includes(needle));
  }, [customers, query]);

  return (
    <div className="customers-screen">
      <div className="pos-search">
        <input
          type="search"
          placeholder="Buscar cliente…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Buscar cliente"
        />
      </div>

      <div className="customers-actions">
        <button type="button" className="pos-pay" onClick={() => setCreating(true)}>
          + Nuevo cliente
        </button>
      </div>

      {loadError ? <p className="pos-error" role="alert">{loadError}</p> : null}

      <ul className="customers-list" aria-label="Clientes">
        {filtered.map((customer) => (
          <li key={customer.customerId} className="customers-item">
            <div className="customers-info">
              <strong>{customer.name}</strong>
              {customer.phoneE164 ? <span>{customer.phoneE164}</span> : null}
              <small>
                Límite {formatMoneyCents(customer.creditLimitCents)}
              </small>
            </div>
            <div className="customers-balance">
              <span>Saldo</span>
              <strong className={customer.balanceCents > 0 ? "debt" : ""}>
                {formatMoneyCents(customer.balanceCents)}
              </strong>
            </div>
            <button
              type="button"
              className="customers-abono"
              disabled={customer.balanceCents <= 0}
              onClick={() => setAbonoTarget(customer)}
            >
              Abonar
            </button>
          </li>
        ))}
      </ul>

      {creating ? (
        <CreateCustomerSheet
          ownerId={user.ownerId}
          branchId={activeBranchId}
          actorUserId={user.id}
          deviceId={user.deviceId}
          onCancel={() => setCreating(false)}
          onCreated={(customer) => {
            setCustomers((current) => [...current, customer]);
            setCreating(false);
            void sync();
          }}
        />
      ) : null}

      {abonoTarget ? (
        <AbonoSheet
          customer={abonoTarget}
          ownerId={user.ownerId}
          branchId={activeBranchId}
          actorUserId={user.id}
          deviceId={user.deviceId}
          online={online}
          onCancel={() => setAbonoTarget(null)}
          onDone={(abono, payload) => {
            setCustomers((current) =>
              current.map((customer) =>
                customer.customerId === abono.customerId
                  ? { ...customer, balanceCents: Math.max(0, customer.balanceCents - payload.amountCents) }
                  : customer
              )
            );
            setAbonoTarget(null);
            void sync();
          }}
        />
      ) : null}
    </div>
  );
}

function CreateCustomerSheet({
  ownerId,
  branchId,
  actorUserId,
  deviceId,
  onCancel,
  onCreated
}: {
  ownerId: string;
  branchId: string;
  actorUserId: string;
  deviceId: string;
  onCancel: () => void;
  onCreated: (customer: CustomerWithBalance) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [limit, setLimit] = useState("10000");
  const [submitting, setSubmitting] = useState(false);

  const limitCents = Math.round(Number(limit) * 100);
  const valid = name.trim().length > 0 && Number.isFinite(limitCents) && limitCents >= 0;

  async function submit() {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      const customerId = crypto.randomUUID();
      await enqueueOperation({
        type: "CUSTOMER_UPSERT",
        payload: {
          customerId,
          ownerId,
          branchId,
          name: name.trim(),
          phoneE164: phone.trim() || null,
          creditLimitCents: limitCents,
          defaultPromiseDays: 7,
          active: true
        },
        ownerId,
        branchId,
        actorUserId,
        deviceId
      });
      onCreated({ customerId, ownerId, branchId, name: name.trim(), phoneE164: phone.trim() || null, creditLimitCents: limitCents, defaultPromiseDays: 7, active: true, balanceCents: 0 });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="pos-modal-backdrop" role="presentation">
      <div className="pos-modal" role="dialog" aria-modal="true" aria-label="Nuevo cliente">
        <h2>Nuevo cliente</h2>
        <label className="pos-field">
          Nombre
          <input type="text" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </label>
        <label className="pos-field">
          Teléfono (opcional)
          <input type="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+18095550123" />
        </label>
        <label className="pos-field">
          Límite de crédito (RD$)
          <input type="number" inputMode="decimal" min="0" step="0.01" value={limit} onChange={(event) => setLimit(event.target.value)} />
        </label>
        <div className="pos-modal-actions">
          <button type="button" className="pos-cancel" onClick={onCancel} disabled={submitting}>Cancelar</button>
          <button type="button" className="pos-confirm" disabled={!valid || submitting} onClick={() => void submit()}>
            {submitting ? "Guardando…" : "Guardar cliente"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AbonoSheet({
  customer,
  ownerId,
  branchId,
  actorUserId,
  deviceId,
  online,
  onCancel,
  onDone
}: {
  customer: CustomerWithBalance;
  ownerId: string;
  branchId: string;
  actorUserId: string;
  deviceId: string;
  online: boolean;
  onCancel: () => void;
  onDone: (abono: CustomerWithBalance, payload: AbonoPayload) => void;
}) {
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const amountCents = Math.round(Number(amount) * 100);
  const valid = amount.trim() !== "" && Number.isFinite(amountCents) && amountCents > 0 && amountCents <= customer.balanceCents;

  async function submit() {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      const payload: AbonoPayload = {
        abonoId: crypto.randomUUID(),
        customerId: customer.customerId,
        amountCents,
        occurredAt: new Date().toISOString()
      };
      await enqueueOperation({
        type: "ABONO",
        payload,
        ownerId,
        branchId,
        actorUserId,
        deviceId
      });
      if (navigator.onLine) {
        try {
          await syncNow(branchId);
        } catch {
          // Queda en la cola; el SyncProvider lo reintentará.
        }
      }
      onDone(customer, payload);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="pos-modal-backdrop" role="presentation">
      <div className="pos-modal" role="dialog" aria-modal="true" aria-label="Abonar a cliente">
        <h2>Abonar a {customer.name}</h2>
        <p className="pos-change">
          Saldo actual: <strong>{formatMoneyCents(customer.balanceCents)}</strong>
        </p>
        <label className="pos-field">
          Monto del abono (RD$)
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
            autoFocus
          />
        </label>
        <div className="pos-modal-actions">
          <button type="button" className="pos-cancel" onClick={onCancel} disabled={submitting}>Cancelar</button>
          <button type="button" className="pos-confirm" disabled={!valid || submitting} onClick={() => void submit()}>
            {submitting ? "Registrando…" : online ? "Registrar abono" : "Guardar offline"}
          </button>
        </div>
      </div>
    </div>
  );
}
