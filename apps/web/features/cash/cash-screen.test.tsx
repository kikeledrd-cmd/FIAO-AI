import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CashScreen } from "./cash-screen";

const enqueueMock = vi.fn();
const authorizeMock = vi.fn();

const HOISTED = vi.hoisted(() => {
  const openSession = {
    sessionId: "77777777-7777-4777-8777-777777777777",
    ownerId: "30000000-0000-4000-8000-000000000001",
    branchId: "20000000-0000-4000-8000-000000000001",
    status: "OPEN" as const,
    openedById: "u-cajero",
    openedAt: "2026-08-16T12:00:00.000Z",
    openingFloatCents: 200000,
    closedById: null,
    closedAt: null,
    countedCents: null,
    differenceCents: null
  };
  return { openSession };
});

vi.mock("@/components/app-shell", () => ({
  useAppShell: () => ({
    user: { id: "u1", ownerId: "o1", deviceId: "d1", name: "Cajero Demo", role: "CASHIER" },
    branches: [{ id: "20000000-0000-4000-8000-000000000001", name: "Los Mina", timezone: "America/Santo_Domingo" }],
    activeBranchId: "20000000-0000-4000-8000-000000000001",
    online: true
  })
}));

vi.mock("@/features/sync/sync-provider", () => ({
  useSync: () => ({ status: "SYNCED", pending: 0, conflicts: 0, syncing: false, sync: vi.fn() })
}));

vi.mock("@/lib/offline/queue", () => ({
  enqueueOperation: (input: unknown) => enqueueMock(input)
}));

vi.mock("@/lib/offline/sync-client", () => ({
  syncNow: vi.fn().mockResolvedValue({ pulled: 0, pushed: 1 })
}));

vi.mock("@/lib/offline/owner-authorize", () => ({
  requestOwnerAuthorization: (input: unknown) => authorizeMock(input)
}));

const loadCashStateMock = vi.fn();
vi.mock("@/lib/offline/cash", () => ({
  loadCashStateFromServer: (branchId: string) => loadCashStateMock(branchId),
  saveCashStateLocally: vi.fn().mockResolvedValue(undefined),
  listCashSessionsLocally: vi.fn().mockResolvedValue([]),
  listCashMovementsLocally: vi.fn().mockResolvedValue([]),
  computeLocalExpectedCash: vi.fn().mockReturnValue(200000)
}));

vi.mock("@/lib/offline/db", () => ({
  offlineDb: {
    creditMovements: { where: () => ({ equals: () => ({ toArray: async () => [] }) }) }
  }
}));

describe("CashScreen", () => {
  beforeEach(() => {
    enqueueMock.mockReset();
    authorizeMock.mockReset();
    authorizeMock.mockResolvedValue({ authorizationId: "auth-1", expiresAt: "2026-08-16T20:00:00.000Z" });
  });

  it("muestra el estado vacío y permite abrir caja", async () => {
    loadCashStateMock.mockResolvedValue({ session: null, movements: [], expectedCents: null });
    render(<CashScreen />);

    await waitFor(() => expect(screen.getByText("No hay sesión de caja para esta sucursal.")).toBeVisible());

    fireEvent.click(screen.getByRole("button", { name: "Abrir caja" }));
    const dialog = screen.getByRole("dialog", { name: "Abrir caja" });
    fireEvent.change(within(dialog).getByLabelText("Float inicial (RD$)"), { target: { value: "2000.00" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar" }));

    await waitFor(() => {
      expect(enqueueMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "CASH_OPEN",
          payload: expect.objectContaining({ openingFloatCents: 200000, branchId: "20000000-0000-4000-8000-000000000001" })
        })
      );
    });
    expect(await screen.findByText("Abierta")).toBeVisible();
  });

  it("registra un gasto dentro del límite del cajero sin PIN", async () => {
    loadCashStateMock.mockResolvedValue({
      session: HOISTED.openSession,
      movements: [],
      expectedCents: 200000
    });
    render(<CashScreen />);

    await waitFor(() => expect(screen.getByText("Abierta")).toBeVisible());

    fireEvent.click(screen.getByRole("button", { name: "Gasto" }));
    const dialog = screen.getByRole("dialog", { name: "Registrar gasto" });
    fireEvent.change(within(dialog).getByLabelText("Monto (RD$)"), { target: { value: "500.00" } });
    fireEvent.change(within(dialog).getByLabelText("Descripción (opcional)"), { target: { value: "Botellón de agua" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar" }));

    await waitFor(() => {
      expect(enqueueMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "CASH_EXPENSE",
          payload: expect.objectContaining({ amountCents: 50000, category: "Otro" })
        })
      );
    });
    expect(authorizeMock).not.toHaveBeenCalled();
  });

  it("pide PIN del dueño para un retiro de cajero y encola la autorización", async () => {
    loadCashStateMock.mockResolvedValue({
      session: HOISTED.openSession,
      movements: [],
      expectedCents: 200000
    });
    render(<CashScreen />);

    await waitFor(() => expect(screen.getByText("Abierta")).toBeVisible());

    fireEvent.click(screen.getByRole("button", { name: "Retiro" }));
    const dialog = screen.getByRole("dialog", { name: "Retiro de caja" });
    fireEvent.change(within(dialog).getByLabelText("Monto (RD$)"), { target: { value: "300.00" } });
    fireEvent.change(within(dialog).getByLabelText("Motivo"), { target: { value: "Compra personal" } });
    fireEvent.change(within(dialog).getByLabelText("PIN del dueño"), { target: { value: "1234" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar" }));

    await waitFor(() => {
      expect(authorizeMock).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: "CASH_WITHDRAWAL", pin: "1234" })
      );
      expect(enqueueMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "CASH_WITHDRAWAL",
          payload: expect.objectContaining({ amountCents: 30000, ownerAuthorizationId: "auth-1" })
        })
      );
    });
  });
});
