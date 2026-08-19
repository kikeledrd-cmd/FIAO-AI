"use client";

import { useEffect, useState } from "react";
import type { DeviceRecord } from "@fiao/contracts/settings";
import { useAppShell } from "@/components/app-shell";

export function SettingsScreen() {
  const { user, activeBranchId } = useAppShell();
  const isOwner = user.role === "OWNER";
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({ defaultPromiseDays: 7, lowStockThreshold: 3, cashierDiscountLimitCents: 1000, whatsappRemindersEnabled: false });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/settings?branchId=${activeBranchId}`)
      .then((response) => response.json())
      .then((json) => {
        if (cancelled || !json.settings) return;
        setForm({
          defaultPromiseDays: json.settings.defaultPromiseDays,
          lowStockThreshold: json.settings.lowStockThreshold,
          cashierDiscountLimitCents: json.settings.cashierDiscountLimitCents,
          whatsappRemindersEnabled: json.settings.whatsappRemindersEnabled
        });
      })
      .catch(() => {
        if (!cancelled) setError("No se pudieron cargar los ajustes.");
      });
    if (isOwner) {
      fetch("/api/devices")
        .then((response) => response.json())
        .then((json) => {
          if (!cancelled && json.devices) setDevices(json.devices);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [activeBranchId, isOwner]);

  async function save() {
    setSaved(false);
    setError(null);
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId: activeBranchId, ...form })
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "ERROR");
      setSaved(true);
    } catch {
      setError("No se pudieron guardar los ajustes.");
    }
  }

  async function revoke(deviceId: string) {
    setError(null);
    try {
      const response = await fetch("/api/devices/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId: activeBranchId, deviceId })
      });
      if (!response.ok) {
        const json = await response.json();
        setError(json.error ?? "No se pudo revocar.");
        return;
      }
      setDevices((current) => current.map((device) => (device.id === deviceId ? { ...device, active: false } : device)));
    } catch {
      setError("No se pudo revocar el dispositivo.");
    }
  }

  return (
    <div className="customers-screen">
      <h2 className="section-title">Configuración</h2>
      <section className="report-card">
        <label className="pos-field">
          <span>Días de promesa por defecto</span>
          <input
            type="number"
            min={0}
            max={365}
            value={form.defaultPromiseDays}
            onChange={(event) => setForm((current) => ({ ...current, defaultPromiseDays: Number(event.target.value) }))}
            disabled={!isOwner}
          />
        </label>
        <label className="pos-field">
          <span>Umbral de stock bajo</span>
          <input
            type="number"
            min={0}
            value={form.lowStockThreshold}
            onChange={(event) => setForm((current) => ({ ...current, lowStockThreshold: Number(event.target.value) }))}
            disabled={!isOwner}
          />
        </label>
        <label className="pos-field">
          <span>Límite de descuento del cajero (centavos)</span>
          <input
            type="number"
            min={0}
            value={form.cashierDiscountLimitCents}
            onChange={(event) => setForm((current) => ({ ...current, cashierDiscountLimitCents: Number(event.target.value) }))}
            disabled={!isOwner}
          />
        </label>
        <label className="pos-field">
          <span>Recordatorios de WhatsApp</span>
          <input
            type="checkbox"
            checked={form.whatsappRemindersEnabled}
            onChange={(event) => setForm((current) => ({ ...current, whatsappRemindersEnabled: event.target.checked }))}
            disabled={!isOwner}
          />
        </label>
        {isOwner ? (
          <button type="button" className="pos-pay" onClick={() => void save()}>
            Guardar
          </button>
        ) : (
          <p className="report-note">Solo el dueño puede cambiar la configuración.</p>
        )}
        {saved ? <p className="pos-empty">Guardado.</p> : null}
        {error ? (
          <p className="pos-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      {isOwner ? (
        <>
          <h2 className="section-title">Dispositivos</h2>
          <ul className="customers-list" aria-label="Dispositivos">
            {devices.map((device) => (
              <li key={device.id} className="customers-item">
                <div className="customers-info">
                  <strong>{device.label}</strong>
                  <span>{device.active ? "Activo" : "Revocado"}</span>
                  <span>Visto: {new Date(device.lastSeenAt).toLocaleString("es-DO")}</span>
                </div>
                {device.active ? (
                  <button type="button" className="pos-secondary" onClick={() => void revoke(device.id)}>
                    Revocar
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
