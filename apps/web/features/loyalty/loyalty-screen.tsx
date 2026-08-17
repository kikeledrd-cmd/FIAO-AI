"use client";

import { useEffect, useState } from "react";
import type { LoyaltyConfig, LoyaltyReward } from "@fiao/contracts/loyalty";
import { useAppShell } from "@/components/app-shell";
import { apiJson } from "@/lib/api/client";
import {
  listLoyaltyMovementsLocally,
  loadLoyaltyFromServer,
  saveLoyaltyConfigLocally,
  saveRewardsLocally,
  listRewardsLocally,
  computeBalanceLocally,
  type CustomerLoyalty
} from "@/lib/offline/loyalty";
import { listCustomersLocally, loadCustomersFromServer, type CustomerWithBalance } from "@/lib/offline/customers";
import { formatMoneyCents } from "../sales/sales-screen";

const REWARD_KIND_LABEL: Record<LoyaltyReward["kind"], string> = {
  FREE_PRODUCT: "Producto gratis",
  FIXED_DISCOUNT: "Descuento fijo"
};

export function LoyaltyScreen() {
  const { user, activeBranchId } = useAppShell();
  const [config, setConfig] = useState<LoyaltyConfig>({ enabled: true, pointsPerHundredCents: 100, expiryDays: 180 });
  const [rewards, setRewards] = useState<LoyaltyReward[]>([]);
  const [customers, setCustomers] = useState<CustomerWithBalance[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [loyalty, setLoyalty] = useState<CustomerLoyalty | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadError(null);
      try {
        if (navigator.onLine) {
          const [freshRewards, freshCustomers] = await Promise.all([
            loadRewards(),
            loadCustomersFromServer(activeBranchId)
          ]);
          const freshConfig = await loadConfig();
          if (cancelled) return;
          setConfig(freshConfig);
          setRewards(freshRewards);
          setCustomers(freshCustomers);
          await Promise.all([
            saveLoyaltyConfigLocally(user.ownerId, freshConfig).catch(() => undefined),
            saveRewardsLocally(freshRewards).catch(() => undefined)
          ]);
        } else {
          const [localRewards, localCustomers] = await Promise.all([
            listRewardsLocally(user.ownerId),
            listCustomersLocally(activeBranchId)
          ]);
          if (cancelled) return;
          setRewards(localRewards);
          setCustomers(localCustomers);
          if (localRewards.length === 0) setLoadError("Sin conexión y sin recompensas guardadas en este dispositivo.");
        }
      } catch {
        if (cancelled) return;
        const local = await listRewardsLocally(user.ownerId).catch(() => []);
        setRewards(local);
        if (local.length === 0) setLoadError("No se pudieron cargar las recompensas.");
      }
    }
    async function loadConfig(): Promise<LoyaltyConfig> {
      const response = await loadLoyaltyFromServer(activeBranchId);
      return response.config;
    }
    async function loadRewards(): Promise<LoyaltyReward[]> {
      const response = await loadRewardsFromServer(activeBranchId);
      return response.rewards;
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [activeBranchId, user.ownerId]);

  useEffect(() => {
    let cancelled = false;
    async function loadCustomerLoyalty() {
      if (!selectedCustomerId) {
        setLoyalty(null);
        return;
      }
      try {
        if (navigator.onLine) {
          const response = await loadLoyaltyFromServer(activeBranchId, selectedCustomerId);
          if (cancelled) return;
          setLoyalty(response.loyalty);
        } else {
          const movements = await listLoyaltyMovementsLocally(activeBranchId, selectedCustomerId);
          if (cancelled) return;
          setLoyalty({
            customerId: selectedCustomerId,
            balance: computeBalanceLocally(movements, config.expiryDays),
            movements
          });
        }
      } catch {
        if (cancelled) return;
        setLoyalty(null);
      }
    }
    void loadCustomerLoyalty();
    return () => {
      cancelled = true;
    };
  }, [selectedCustomerId, activeBranchId, config.expiryDays]);

  const selectedCustomer = customers.find((customer) => customer.customerId === selectedCustomerId);

  return (
    <div className="customers-screen">
      <section className="home-summary">
        <p>
          Programa de lealtad: <strong>{config.enabled ? "Activo" : "Inactivo"}</strong>
        </p>
        <p>
          {config.pointsPerHundredCents === 100
            ? "1 punto por cada RD$100 de compra"
            : `1 punto por cada RD$${(config.pointsPerHundredCents / 100).toFixed(2)}`}{" "}
          · Vencimiento a {config.expiryDays} días
        </p>
      </section>

      <label className="pos-field">
        Ver puntos de un cliente
        <select value={selectedCustomerId} onChange={(event) => setSelectedCustomerId(event.target.value)}>
          <option value="">Seleccionar cliente…</option>
          {customers.map((customer) => (
            <option key={customer.customerId} value={customer.customerId}>{customer.name}</option>
          ))}
        </select>
      </label>

      {loyalty && selectedCustomer ? (
        <section className="home-summary" aria-label="Puntos del cliente">
          <p>
            <strong>{selectedCustomer.name}</strong>: <strong>{loyalty.balance}</strong> punto{loyalty.balance === 1 ? "" : "s"}
          </p>
          <ul className="customers-list" aria-label="Historial de puntos">
            {loyalty.movements.slice().reverse().map((movement) => (
              <li key={movement.movementId} className="customers-item">
                <div className="customers-info">
                  <strong>{movement.type === "EARN" ? "Ganó" : movement.type === "REDEEM" ? "Canjeó" : movement.type === "REVERSAL" ? "Reversó" : "Venció"} {Math.abs(movement.pointsDelta)} pts</strong>
                  <small>{new Date(movement.occurredAt).toLocaleDateString("es-DO")}</small>
                </div>
                <div className="customers-balance">
                  <strong className={movement.pointsDelta >= 0 ? "" : "debt"}>{movement.pointsDelta >= 0 ? "+" : ""}{movement.pointsDelta}</strong>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <h2 className="section-title">Recompensas</h2>
      {loadError ? <p className="pos-error" role="alert">{loadError}</p> : null}
      {rewards.length === 0 ? <p className="pos-empty">No hay recompensas configuradas.</p> : null}
      <ul className="customers-list" aria-label="Recompensas">
        {rewards.map((reward) => (
          <li key={reward.rewardId} className="customers-item">
            <div className="customers-info">
              <strong>{reward.name}</strong>
              <span>
                {REWARD_KIND_LABEL[reward.kind]}
                {reward.kind === "FIXED_DISCOUNT" && reward.discountCents ? ` de ${formatMoneyCents(reward.discountCents)}` : ""}
              </span>
            </div>
            <div className="customers-balance">
              <span>Cuesta</span>
              <strong>{reward.pointsCost} pts</strong>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

async function loadRewardsFromServer(branchId: string): Promise<{ rewards: LoyaltyReward[] }> {
  return apiJson<{ rewards: LoyaltyReward[] }>(`/api/rewards?branchId=${encodeURIComponent(branchId)}`);
}
