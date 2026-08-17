import type { Apartado } from "@fiao/contracts/apartado";
import { apiJson } from "@/lib/api/client";
import { FiaoOfflineDatabase, offlineDb } from "./db";

export async function loadApartadosFromServer(branchId: string): Promise<Apartado[]> {
  const response = await apiJson<{ apartados: Apartado[] }>(
    `/api/apartados?branchId=${encodeURIComponent(branchId)}`
  );
  return response.apartados;
}

export async function saveApartadosLocally(
  apartados: Apartado[],
  database: FiaoOfflineDatabase = offlineDb
): Promise<void> {
  if (apartados.length === 0) return;
  await database.transaction("rw", database.apartados, async () => {
    const branchId = apartados[0]!.branchId;
    await database.apartados.where({ branchId }).delete();
    await database.apartados.bulkPut(
      apartados.map((apartado) => ({
        apartadoId: apartado.apartadoId,
        ownerId: apartado.ownerId,
        branchId: apartado.branchId,
        customerId: apartado.customerId,
        status: apartado.status,
        lines: apartado.lines,
        depositCents: apartado.depositCents,
        totalCents: apartado.totalCents,
        promiseDate: apartado.promiseDate,
        notes: apartado.notes,
        saleId: null,
        reason: null,
        occurredAt: apartado.createdAt
      }))
    );
  });
}

export async function listApartadosLocally(
  branchId: string,
  database: FiaoOfflineDatabase = offlineDb
): Promise<Apartado[]> {
  const rows = await database.apartados.where("branchId").equals(branchId).reverse().sortBy("occurredAt");
  return rows.map((row) => ({
    apartadoId: row.apartadoId,
    ownerId: row.ownerId,
    branchId: row.branchId,
    customerId: row.customerId,
    status: row.status,
    lines: row.lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      priceCents: line.priceCents,
      lineTotalCents: line.lineTotalCents
    })),
    depositCents: row.depositCents,
    totalCents: row.totalCents,
    promiseDate: row.promiseDate,
    notes: row.notes,
    actorUserId: "",
    completedAt: null,
    cancelledAt: null,
    createdAt: row.occurredAt
  }));
}
