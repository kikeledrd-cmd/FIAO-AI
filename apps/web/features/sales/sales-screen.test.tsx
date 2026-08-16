import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogProduct } from "@fiao/contracts/sales";
import { loadCustomersFromServer } from "@/lib/offline/customers";
import { SalesScreen, formatMoneyCents } from "./sales-screen";

const hoisted = vi.hoisted(() => {
  const PRODUCTS: CatalogProduct[] = [
    {
      id: "10000000-0000-4000-8000-000000000001",
      ownerId: "30000000-0000-4000-8000-000000000001",
      branchId: "20000000-0000-4000-8000-000000000001",
      name: "Arroz La Garza 5lb",
      barcode: "7501003110031",
      priceCents: 27500,
      stockControl: true,
      unitLabel: "und",
      onHand: "40",
      active: true
    },
    {
      id: "10000000-0000-4000-8000-000000000002",
      ownerId: "30000000-0000-4000-8000-000000000001",
      branchId: "20000000-0000-4000-8000-000000000001",
      name: "Recarga RD$100",
      barcode: null,
      priceCents: 10000,
      stockControl: false,
      unitLabel: "recarga",
      onHand: null,
      active: true
    }
  ];
  return { PRODUCTS };
});

const { PRODUCTS } = hoisted;

const enqueueMock = vi.fn();
const syncNowMock = vi.fn();

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
  syncNow: (branchId: string) => syncNowMock(branchId)
}));

vi.mock("@/lib/offline/catalog", () => ({
  listCatalogLocally: vi.fn().mockResolvedValue([]),
  loadCatalogFromServer: vi.fn().mockResolvedValue(hoisted.PRODUCTS),
  saveCatalogLocally: vi.fn().mockResolvedValue(undefined),
  adjustLocalStock: vi.fn().mockResolvedValue(undefined),
  applySignedStockDeltas: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("@/lib/offline/owner-authorize", () => ({
  requestOwnerAuthorization: vi.fn().mockResolvedValue({ authorizationId: "auth-1", expiresAt: "2026-08-16T20:00:00.000Z" })
}));

vi.mock("@/lib/offline/customers", () => ({
  listCustomersLocally: vi.fn().mockResolvedValue([]),
  loadCustomersFromServer: vi.fn().mockResolvedValue([]),
  saveCustomersLocally: vi.fn().mockResolvedValue(undefined)
}));

describe("formatMoneyCents", () => {
  it("formats pesos dominicanos with cents", () => {
    expect(formatMoneyCents(27500)).toBe("RD$275.00");
    expect(formatMoneyCents(5)).toBe("RD$0.05");
    expect(formatMoneyCents(123456)).toBe("RD$1,234.56");
  });
});

describe("SalesScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ products: PRODUCTS })
    });
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });

  it("loads the catalog and shows products", async () => {
    render(<SalesScreen />);
    await waitFor(() => expect(screen.getByText("Arroz La Garza 5lb")).toBeInTheDocument());
    expect(screen.getByText("Recarga RD$100")).toBeInTheDocument();
    expect(screen.getByText("RD$275.00")).toBeInTheDocument();
  });

  it("adds a product to the cart and computes the total", async () => {
    render(<SalesScreen />);
    await waitFor(() => expect(screen.getByText("Arroz La Garza 5lb")).toBeInTheDocument());
    fireEvent.click(screen.getAllByText("Arroz La Garza 5lb")[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Agregar uno de Arroz La Garza 5lb" }));
    expect(screen.getAllByText("RD$550.00").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Cobrar" })).toBeInTheDocument();
  });

  it("enqueues a SALE operation with the expected payload", async () => {
    render(<SalesScreen />);
    await waitFor(() => expect(screen.getByText("Arroz La Garza 5lb")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Arroz La Garza 5lb"));
    fireEvent.click(screen.getByRole("button", { name: "Cobrar" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar venta" }));

    await waitFor(() => expect(enqueueMock).toHaveBeenCalledTimes(1));
    const input = enqueueMock.mock.calls[0]![0];
    expect(input.type).toBe("SALE");
    expect(input.payload.lines).toEqual([
      { productId: PRODUCTS[0]!.id, quantity: "1", priceCents: 27500 }
    ]);
    expect(input.payload.payments).toEqual([{ method: "CASH", amountCents: 27500 }]);
    expect(input.ownerId).toBe("o1");
    expect(input.branchId).toBe("20000000-0000-4000-8000-000000000001");
    expect(input.actorUserId).toBe("u1");
    expect(input.deviceId).toBe("d1");
  });

  it("shows the receipt after confirming", async () => {
    render(<SalesScreen />);
    await waitFor(() => expect(screen.getByText("Arroz La Garza 5lb")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Arroz La Garza 5lb"));
    fireEvent.click(screen.getByRole("button", { name: "Cobrar" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar venta" }));

    await waitFor(() => expect(screen.getByText("Venta registrada")).toBeInTheDocument());
    expect(screen.getByText("Efectivo")).toBeInTheDocument();
  });

  it("enqueues a SALE_REVERSAL with owner authorization when reversing from the receipt", async () => {
    render(<SalesScreen />);
    await waitFor(() => expect(screen.getByText("Arroz La Garza 5lb")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Arroz La Garza 5lb"));
    fireEvent.click(screen.getByRole("button", { name: "Cobrar" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar venta" }));
    await waitFor(() => expect(screen.getByText("Venta registrada")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Anular venta" }));
    const dialog = screen.getByRole("dialog", { name: "Anular venta" });
    fireEvent.change(within(dialog).getByLabelText("Motivo de la anulación"), {
      target: { value: "Cliente devolvió" }
    });
    fireEvent.change(within(dialog).getByLabelText("PIN del dueño"), {
      target: { value: "1234" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar anulación" }));

    await waitFor(() => expect(enqueueMock).toHaveBeenCalledTimes(2));
    const reversal = enqueueMock.mock.calls[1]![0];
    expect(reversal.type).toBe("SALE_REVERSAL");
    expect(reversal.payload.reason).toBe("Cliente devolvió");
    expect(reversal.payload.ownerAuthorizationId).toBe("auth-1");
    expect(reversal.payload.saleId).toBeTypeOf("string");
  });

  it("enqueues a FIADO sale with customerId when fiado is selected", async () => {
    vi.mocked(loadCustomersFromServer).mockResolvedValue([
      {
        customerId: "60000000-0000-4000-8000-000000000001",
        ownerId: "o1",
        branchId: "20000000-0000-4000-8000-000000000001",
        name: "Doña María",
        phoneE164: "+18095550001",
        creditLimitCents: 100000,
        defaultPromiseDays: 7,
        active: true,
        balanceCents: 0
      }
    ]);
    render(<SalesScreen />);
    await waitFor(() => expect(screen.getByText("Arroz La Garza 5lb")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Arroz La Garza 5lb"));
    fireEvent.click(screen.getByRole("button", { name: "Cobrar" }));

    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Fiado" }));
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Cliente a fiado" }), {
      target: { value: "60000000-0000-4000-8000-000000000001" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar venta" }));

    await waitFor(() => expect(enqueueMock).toHaveBeenCalledTimes(1));
    const input = enqueueMock.mock.calls[0]![0];
    expect(input.type).toBe("SALE");
    expect(input.payload.customerId).toBe("60000000-0000-4000-8000-000000000001");
    expect(input.payload.payments).toEqual([{ method: "FIADO", amountCents: 27500 }]);
  });
});
