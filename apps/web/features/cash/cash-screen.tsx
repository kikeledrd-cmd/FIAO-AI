"use client";

import { useAppShell } from "@/components/app-shell";
import { useSync } from "@/features/sync/sync-provider";
import { formatMoneyCents } from "@/features/sales/sales-screen";
import { enqueueOperation } from "@/lib/offline/queue";
import { requestOwnerAuthorization } from "@/lib/offline/owner-authorize";
import { syncNow } from "@/lib/offline/sync-client";
import {
  computeLocalExpectedCash,
  listCashMovementsLocally,
  listCashSessionsLocally,
  loadCashStateFromServer,
  saveCashStateLocally
} from "@/lib/offline/cash";
import { offlineDb } from "@/lib/offline/db";
import { useEffect, useMemo, useState } from "react";
import type { CashMovement, CashSession } from "@fiao/contracts/cash";
import { CASHIER_EXPENSE_LIMIT_CENTS } from "@fiao/domain/cash/cash-policy";

type SheetKind = "EXPENSE" | "WITHDRAWAL" | "INJECTION" | "CLOSE" | "OPEN" | null;

export function CashScreen() {
  const { user, activeBranchId, online } = useAppShell();
  const { sync } = useSync();
  const [session, setSession] = useState<CashSession | null>(null);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [expectedCents, setExpectedCents] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetKind>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadState() {
      setLoadError(null);
      try {
        if (navigator.onLine) {
          const fresh = await loadCashStateFromServer(activeBranchId);
          if (cancelled) return;
          setSession(fresh.session);
          setMovements(fresh.movements);
          setExpectedCents(fresh.expectedCents);
          await saveCashStateLocally(fresh).catch(() => undefined);
        } else {
          const localSessions = await listCashSessionsLocally(activeBranchId);
          if (cancelled) return;
          const open = localSessions.find((candidate) => candidate.status === "OPEN");
          const latest = open ?? localSessions[0];
          if (!latest) return;
          const localMovements = await listCashMovementsLocally(latest.sessionId);
          if (cancelled) return;
          const abonos = await offlineDb.creditMovements.where("branchId").equals(activeBranchId).toArray();
          const abonosCents = abonos.reduce((sum, abono) => (abono.type === "ABONO" ? sum + abono.amountCents : sum), 0);
          setSession({
            sessionId: latest.sessionId,
            ownerId: latest.ownerId,
            branchId: latest.branchId,
            status: latest.status,
            openedById: latest.ownerId,
            openedAt: latest.openedAt,
            openingFloatCents: latest.openingFloatCents,
            closedById: null,
            closedAt: latest.closedAt,
            countedCents: latest.countedCents,
            differenceCents: latest.differenceCents
          });
          setMovements(localMovements.map(toCashMovement));
          setExpectedCents(latest.status === "OPEN" ? computeLocalExpectedCash(latest, localMovements, abonosCents) : null);
        }
      } catch {
        if (cancelled) return;
        const localSessions = await listCashSessionsLocally(activeBranchId).catch(() => []);
        if (localSessions.length > 0) {
          const open = localSessions.find((candidate) => candidate.status === "OPEN") ?? localSessions[0]!;
          const localMovements = await listCashMovementsLocally(open.sessionId).catch(() => []);
          setSession({
            sessionId: open.sessionId,
            ownerId: open.ownerId,
            branchId: open.branchId,
            status: open.status,
            openedById: open.ownerId,
            openedAt: open.openedAt,
            openingFloatCents: open.openingFloatCents,
            closedById: null,
            closedAt: open.closedAt,
            countedCents: open.countedCents,
            differenceCents: open.differenceCents
          });
          setMovements(localMovements.map(toCashMovement));
        } else {
          setLoadError("No se pudo cargar el estado de caja.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadState();
    return () => {
      cancelled = true;
    };
  }, [activeBranchId]);

  const totals = useMemo(() => {
    let expenses = 0;
    let withdrawals = 0;
    let injections = 0;
    for (const movement of movements) {
      if (movement.type === "EXPENSE") expenses += movement.amountCents;
      if (movement.type === "WITHDRAWAL") withdrawals += movement.amountCents;
      if (movement.type === "INJECTION") injections += movement.amountCents;
    }
    return { expenses, withdrawals, injections };
  }, [movements]);

  const isOpen = session?.status === "OPEN";

  return (
    <div className="customers-screen">
      <h1 className="pos-title">Caja</h1>

      {loading ? <p>Cargando caja…</p> : null}

      {loadError ? <p className="pos-error" role="alert">{loadError}</p> : null}

      {!loading && !session ? (
        <div className="cash-empty">
          <p>No hay sesión de caja para esta sucursal.</p>
          <button type="button" className="pos-pay" onClick={() => setSheet("OPEN")}>
            Abrir caja
          </button>
        </div>
      ) : session ? (
        <>
          <div className="cash-summary">
            <div className="cash-summary-row">
              <span>Estado</span>
              <strong className={isOpen ? "cash-open-badge" : "cash-closed-badge"}>
                {isOpen ? "Abierta" : "Cerrada"}
              </strong>
            </div>
            <div className="cash-summary-row">
              <span>Float inicial</span>
              <strong>{formatMoneyCents(session.openingFloatCents)}</strong>
            </div>
            {isOpen ? (
              <div className="cash-summary-row">
                <span>Efectivo esperado</span>
                <strong>{expectedCents !== null ? formatMoneyCents(expectedCents) : "—"}</strong>
              </div>
            ) : (
              <>
                <div className="cash-summary-row">
                  <span>Contado al cierre</span>
                  <strong>{formatMoneyCents(session.countedCents ?? 0)}</strong>
                </div>
                <div className="cash-summary-row">
                  <span>Diferencia</span>
                  <strong className={session.differenceCents ? "cash-diff" : ""}>
                    {formatMoneyCents(session.differenceCents ?? 0)}
                  </strong>
                </div>
              </>
            )}
            <div className="cash-summary-row">
              <span>Gastos · Retiros · Inyecciones</span>
              <strong>
                {formatMoneyCents(totals.expenses)} · {formatMoneyCents(totals.withdrawals)} ·{" "}
                {formatMoneyCents(totals.injections)}
              </strong>
            </div>
          </div>

          {isOpen ? (
            <div className="customers-actions cash-actions">
              <button type="button" className="pos-pay" onClick={() => setSheet("EXPENSE")}>Gasto</button>
              <button type="button" className="pos-secondary" onClick={() => setSheet("WITHDRAWAL")}>Retiro</button>
              <button type="button" className="pos-secondary" onClick={() => setSheet("INJECTION")}>Inyección</button>
              <button type="button" className="pos-clear" onClick={() => setSheet("CLOSE")}>Cerrar caja</button>
            </div>
          ) : (
            <button type="button" className="pos-pay" onClick={() => setSheet("OPEN")}>Abrir nueva caja</button>
          )}

          <h2 className="cash-subtitle">Movimientos</h2>
          <ul className="customer-list" aria-label="Movimientos de caja">
            {movements.map((movement) => (
              <li key={movement.movementId} className="customer-item">
                <div className="customer-info">
                  <strong>{movementLabel(movement)}</strong>
                  <span>{movement.description ?? movement.reason ?? movement.category ?? "—"}</span>
                </div>
                <div className="customers-balance">
                  <strong className={movement.amountCents < 0 ? "cash-diff" : ""}>
                    {movement.amountCents < 0 ? "−" : "+"}{formatMoneyCents(Math.abs(movement.amountCents))}
                  </strong>
                  <span>{formatTime(movement.occurredAt)}</span>
                </div>
              </li>
            ))}
            {movements.length === 0 ? <li className="customer-item"><span>Sin movimientos.</span></li> : null}
          </ul>
        </>
      ) : null}

      {sheet ? (
        <CashSheet
          kind={sheet}
          session={session}
          expectedCents={expectedCents}
          ownerId={user.ownerId}
          branchId={activeBranchId}
          actorUserId={user.id}
          deviceId={user.deviceId}
          role={user.role}
          online={online}
          onCancel={() => setSheet(null)}
          onDone={(patch) => {
            applyLocalPatch(session, movements, patch, setSession, setMovements, setExpectedCents);
            setSheet(null);
            void sync();
          }}
        />
      ) : null}
    </div>
  );
}

interface LocalPatch {
  session?: CashSession;
  movements?: CashMovement[];
  expectedCents?: number | null;
}

function applyLocalPatch(
  currentSession: CashSession | null,
  currentMovements: CashMovement[],
  patch: LocalPatch,
  setSession: (session: CashSession | null) => void,
  setMovements: (movements: CashMovement[]) => void,
  setExpectedCents: (cents: number | null) => void
): void {
  if (patch.session) setSession(patch.session);
  if (patch.movements) setMovements([...currentMovements, ...patch.movements]);
  if (patch.expectedCents !== undefined) setExpectedCents(patch.expectedCents);
  void currentSession;
  void currentMovements;
}

function CashSheet({
  kind,
  session,
  expectedCents,
  ownerId,
  branchId,
  actorUserId,
  deviceId,
  role,
  online,
  onCancel,
  onDone
}: {
  kind: "EXPENSE" | "WITHDRAWAL" | "INJECTION" | "CLOSE" | "OPEN";
  session: CashSession | null;
  expectedCents: number | null;
  ownerId: string;
  branchId: string;
  actorUserId: string;
  deviceId: string;
  role: "OWNER" | "CASHIER";
  online: boolean;
  onCancel: () => void;
  onDone: (patch: LocalPatch) => void;
}) {
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Otro");
  const [description, setDescription] = useState("");
  const [counted, setCounted] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const amountCents = Math.round(Number(amount) * 100);
  const countedCents = Math.round(Number(counted) * 100);
  const needsPin =
    role !== "OWNER" &&
    (kind === "WITHDRAWAL" ||
      kind === "INJECTION" ||
      (kind === "EXPENSE" && amountCents > CASHIER_EXPENSE_LIMIT_CENTS) ||
      (kind === "CLOSE" && expectedCents !== null && countedCents !== expectedCents));

  const valid =
    kind === "OPEN"
      ? amountCents >= 0 && amount !== ""
      : kind === "CLOSE"
        ? counted !== "" && countedCents >= 0 && (!needsPin || pin.length >= 4)
        : amountCents > 0 && amount !== "" && (!needsPin || pin.length >= 4);

  async function submit() {
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      if (kind === "OPEN") {
        const sessionId = crypto.randomUUID();
        await enqueueOperation({
          type: "CASH_OPEN",
          payload: { sessionId, branchId, openingFloatCents: amountCents, occurredAt: new Date().toISOString() },
          ownerId,
          branchId,
          actorUserId,
          deviceId
        });
        onDone({
          session: {
            sessionId,
            ownerId,
            branchId,
            status: "OPEN",
            openedById: actorUserId,
            openedAt: new Date().toISOString(),
            openingFloatCents: amountCents,
            closedById: null,
            closedAt: null,
            countedCents: null,
            differenceCents: null
          },
          movements: [],
          expectedCents: amountCents
        });
      } else if (kind === "CLOSE") {
        if (!session) return;
        const difference = countedCents - (expectedCents ?? countedCents);
        let ownerAuthorizationId: string | null = null;
        if (needsPin) {
          if (!online) {
            setError("El cierre con diferencia requiere conexión para validar el PIN del dueño.");
            return;
          }
          const authorization = await requestOwnerAuthorization({
            branchId,
            purpose: "CASH_CLOSE",
            targetOperationId: crypto.randomUUID(),
            pin
          });
          ownerAuthorizationId = authorization.authorizationId;
        }
        await enqueueOperation({
          type: "CASH_CLOSE",
          payload: { sessionId: session.sessionId, countedCents, ownerAuthorizationId, occurredAt: new Date().toISOString() },
          ownerId,
          branchId,
          actorUserId,
          deviceId
        });
        const differenceMovement = difference !== 0
          ? [
              {
                movementId: crypto.randomUUID(),
                ownerId,
                branchId,
                sessionId: session.sessionId,
                type: "DIFFERENCE" as const,
                amountCents: difference,
                category: "Arqueo",
                description: "Diferencia de cierre registrada para cuadrar el ledger",
                reason: null,
                actorUserId,
                occurredAt: new Date().toISOString()
              }
            ]
          : undefined;
        onDone({
          session: { ...session, status: "CLOSED", countedCents, differenceCents: difference, closedAt: new Date().toISOString() },
          ...(differenceMovement ? { movements: differenceMovement } : {}),
          expectedCents: null
        });
      } else {
        if (!session) return;
        const movementId = crypto.randomUUID();
        const operationId = crypto.randomUUID();
        let ownerAuthorizationId: string | null = null;
        if (needsPin) {
          if (!online) {
            setError("Esta operación requiere conexión para validar el PIN del dueño.");
            return;
          }
          const authorization = await requestOwnerAuthorization({
            branchId,
            purpose: kind === "EXPENSE" ? "CASH_EXPENSE" : kind === "WITHDRAWAL" ? "CASH_WITHDRAWAL" : "CASH_INJECTION",
            targetOperationId: operationId,
            pin
          });
          ownerAuthorizationId = authorization.authorizationId;
        }
        const base = { movementId, sessionId: session.sessionId, occurredAt: new Date().toISOString(), ownerAuthorizationId };
        const payload =
          kind === "EXPENSE"
            ? { ...base, amountCents, category, description: description.trim() || null }
            : { ...base, amountCents, reason: description.trim() || "Sin motivo" };
        await enqueueOperation({
          type: kind === "EXPENSE" ? "CASH_EXPENSE" : kind === "WITHDRAWAL" ? "CASH_WITHDRAWAL" : "CASH_INJECTION",
          payload,
          ownerId,
          branchId,
          actorUserId,
          deviceId
        });
        onDone({
          movements: [
            {
              movementId,
              ownerId,
              branchId,
              sessionId: session.sessionId,
              type: kind === "EXPENSE" ? "EXPENSE" : kind === "WITHDRAWAL" ? "WITHDRAWAL" : "INJECTION",
              amountCents,
              category: kind === "EXPENSE" ? category : null,
              description: kind === "EXPENSE" ? description.trim() || null : null,
              reason: kind !== "EXPENSE" ? description.trim() || null : null,
              actorUserId,
              occurredAt: new Date().toISOString()
            }
          ],
          expectedCents:
            expectedCents !== null
              ? expectedCents + (kind === "INJECTION" ? amountCents : -amountCents)
              : null
        });
      }
      if (navigator.onLine) {
        try {
          await syncNow(branchId);
        } catch {
          // Queda en la cola; el SyncProvider lo reintentará.
        }
      }
    } catch {
      setError("No se pudo completar: PIN incorrecto o autorización rechazada.");
    } finally {
      setSubmitting(false);
    }
  }

  const title =
    kind === "OPEN" ? "Abrir caja" :
    kind === "EXPENSE" ? "Registrar gasto" :
    kind === "WITHDRAWAL" ? "Retiro de caja" :
    kind === "INJECTION" ? "Inyección de efectivo" : "Cerrar caja";

  return (
    <div className="pos-modal-backdrop" role="presentation">
      <div className="pos-modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>

        {kind === "OPEN" ? (
          <label className="pos-field">
            Float inicial (RD$)
            <input
              type="number" inputMode="decimal" min="0" step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="2000.00"
            />
          </label>
        ) : null}

        {kind === "EXPENSE" ? (
          <>
            <label className="pos-field">
              Monto (RD$)
              <input
                type="number" inputMode="decimal" min="0" step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
            <label className="pos-field">
              Categoría
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                {["Agua", "Luz", "Alquiler", "Mercancía", "Transporte", "Otro"].map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <label className="pos-field">
              Descripción (opcional)
              <input type="text" value={description} onChange={(event) => setDescription(event.target.value)} />
            </label>
          </>
        ) : null}

        {kind === "WITHDRAWAL" || kind === "INJECTION" ? (
          <>
            <label className="pos-field">
              Monto (RD$)
              <input
                type="number" inputMode="decimal" min="0" step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
            <label className="pos-field">
              Motivo
              <input type="text" value={description} onChange={(event) => setDescription(event.target.value)} />
            </label>
          </>
        ) : null}

        {kind === "CLOSE" ? (
          <>
            <label className="pos-field">
              Efectivo contado (RD$)
              <input
                type="number" inputMode="decimal" min="0" step="0.01"
                value={counted}
                onChange={(event) => setCounted(event.target.value)}
              />
            </label>
            <p className="pos-change">
              Esperado: <strong>{expectedCents !== null ? formatMoneyCents(expectedCents) : "—"}</strong>
              {countedCents >= 0 && expectedCents !== null && countedCents !== expectedCents ? (
                <span className="cash-diff"> · Diferencia: {formatMoneyCents(countedCents - expectedCents)}</span>
              ) : null}
            </p>
          </>
        ) : null}

        {needsPin ? (
          <label className="pos-field">
            PIN del dueño
            <input type="password" inputMode="numeric" value={pin} onChange={(event) => setPin(event.target.value)} placeholder="••••" />
          </label>
        ) : null}

        {error ? <p className="pos-error" role="alert">{error}</p> : null}

        <div className="pos-modal-actions">
          <button type="button" className="pos-cancel" onClick={onCancel} disabled={submitting}>Cancelar</button>
          <button type="button" className="pos-confirm" disabled={!valid || submitting} onClick={() => void submit()}>
            {submitting ? "Guardando…" : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function movementLabel(movement: CashMovement): string {
  switch (movement.type) {
    case "EXPENSE": return "Gasto";
    case "WITHDRAWAL": return "Retiro";
    case "INJECTION": return "Inyección";
    case "DIFFERENCE": return "Diferencia de arqueo";
    default: return movement.type;
  }
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

function toCashMovement(row: {
  movementId: string; ownerId: string; branchId: string; sessionId: string;
  type: "EXPENSE" | "WITHDRAWAL" | "INJECTION" | "DIFFERENCE"; amountCents: number;
  category: string | null; description: string | null; reason: string | null; occurredAt: string;
}): CashMovement {
  return {
    movementId: row.movementId,
    ownerId: row.ownerId,
    branchId: row.branchId,
    sessionId: row.sessionId,
    type: row.type,
    amountCents: row.amountCents,
    category: row.category,
    description: row.description,
    reason: row.reason,
    actorUserId: row.ownerId,
    occurredAt: row.occurredAt
  };
}
