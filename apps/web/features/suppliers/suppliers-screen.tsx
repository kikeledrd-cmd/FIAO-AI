"use client";

import { useAppShell } from "@/components/app-shell";
import { useSync } from "@/features/sync/sync-provider";
import { enqueueOperation } from "@/lib/offline/queue";
import { listSuppliersLocally, loadSuppliersFromServer, saveSuppliersLocally, type LocalSupplier } from "@/lib/offline/suppliers";
import { syncNow } from "@/lib/offline/sync-client";
import { useEffect, useMemo, useState } from "react";

export function SuppliersScreen() {
  const { user, activeBranchId, online } = useAppShell();
  const { sync } = useSync();
  const [suppliers, setSuppliers] = useState<LocalSupplier[]>([]);
  const [query, setQuery] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadSuppliers() {
      setLoadError(null);
      try {
        if (navigator.onLine) {
          const fresh = await loadSuppliersFromServer(activeBranchId);
          if (cancelled) return;
          setSuppliers(fresh);
          await saveSuppliersLocally(fresh).catch(() => undefined);
        } else {
          const local = await listSuppliersLocally(activeBranchId);
          if (cancelled) return;
          if (local.length > 0) setSuppliers(local);
          else setLoadError("Sin conexión y sin proveedores guardados en este dispositivo.");
        }
      } catch {
        if (cancelled) return;
        const local = await listSuppliersLocally(activeBranchId).catch(() => []);
        if (local.length > 0) setSuppliers(local);
        else setLoadError("No se pudieron cargar los proveedores.");
      }
    }
    void loadSuppliers();
    return () => {
      cancelled = true;
    };
  }, [activeBranchId]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return suppliers;
    return suppliers.filter((supplier) => supplier.name.toLowerCase().includes(needle));
  }, [suppliers, query]);

  return (
    <div className="customers-screen">
      <div className="pos-search">
        <input
          type="search"
          placeholder="Buscar proveedor…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Buscar proveedor"
        />
      </div>

      <div className="customers-actions">
        <button type="button" className="pos-pay" onClick={() => setCreating(true)}>
          + Nuevo proveedor
        </button>
      </div>

      {loadError ? <p className="pos-error" role="alert">{loadError}</p> : null}

      <ul className="customer-list" aria-label="Proveedores">
        {filtered.map((supplier) => (
          <li key={supplier.supplierId} className="customer-item">
            <div className="customer-info">
              <strong>{supplier.name}</strong>
              <span>{supplier.phoneE164 ?? "Sin teléfono"}</span>
            </div>
          </li>
        ))}
      </ul>

      {creating ? (
        <CreateSupplierSheet
          ownerId={user.ownerId}
          branchId={activeBranchId}
          actorUserId={user.id}
          deviceId={user.deviceId}
          online={online}
          onCancel={() => setCreating(false)}
          onCreated={(supplier) => {
            setSuppliers((current) => [...current, supplier].sort((a, b) => a.name.localeCompare(b.name)));
            setCreating(false);
            void sync();
          }}
        />
      ) : null}
    </div>
  );
}

function CreateSupplierSheet({
  ownerId,
  branchId,
  actorUserId,
  deviceId,
  online,
  onCancel,
  onCreated
}: {
  ownerId: string;
  branchId: string;
  actorUserId: string;
  deviceId: string;
  online: boolean;
  onCancel: () => void;
  onCreated: (supplier: LocalSupplier) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = name.trim().length > 0;

  async function submit() {
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const supplierId = crypto.randomUUID();
      await enqueueOperation({
        type: "SUPPLIER_UPSERT",
        payload: {
          supplierId,
          ownerId,
          branchId,
          name: name.trim(),
          phoneE164: phone.trim() || null,
          active: true
        },
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
      onCreated({ supplierId, ownerId, branchId, name: name.trim(), phoneE164: phone.trim() || null, active: true });
    } catch {
      setError("No se pudo guardar el proveedor.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="pos-modal-backdrop" role="presentation">
      <div className="pos-modal" role="dialog" aria-modal="true" aria-label="Nuevo proveedor">
        <h2>Nuevo proveedor</h2>
        <label className="pos-field">
          Nombre
          <input type="text" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </label>
        <label className="pos-field">
          Teléfono (opcional)
          <input type="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+18095551111" />
        </label>
        {error ? <p className="pos-error" role="alert">{error}</p> : null}
        <div className="pos-modal-actions">
          <button type="button" className="pos-cancel" onClick={onCancel} disabled={submitting}>Cancelar</button>
          <button type="button" className="pos-confirm" disabled={!valid || submitting} onClick={() => void submit()}>
            {submitting ? "Guardando…" : online ? "Guardar proveedor" : "Guardar offline"}
          </button>
        </div>
      </div>
    </div>
  );
}
