import type { ClientOperationEnvelope } from "@fiao/contracts/sync";
import type { CommandContext } from "@fiao/domain/context";
import { extractOrderLines } from "@fiao/domain/orders/order-extraction";
import { databaseClient, type FiaoPrismaClient } from "@fiao/database/client";
import { processOrderAccept } from "@fiao/database/transactions/process-order-accept";
import { processOrderCreate } from "@fiao/database/transactions/process-order-create";

export interface IngestResult {
  status: "AUTO_ACCEPTED" | "EXCEPTION" | "NO_ITEMS";
  orderId: string | null;
  exceptionReason: string | null;
}

/**
 * Procesa un mensaje de WhatsApp y lo convierte en un pedido estructurado.
 *
 * - Extrae líneas con `extractOrderLines` (pura, determinística).
 * - Si no hay ítems reconocidos → NO_ITEMS (no crea pedido).
 * - Si hay ambigüedad → crea el pedido en NEW con `exceptionReason`
 *   (bandeja de excepciones; nunca se auto-acepta).
 * - Si todo resuelve → crea y auto-acepta (reserva stock); si el stock no
 *   alcanza, queda en NEW con excepción.
 *
 * El webhook actúa como el OWNER (usuario owner + device "whatsapp-bot"),
 * así que no necesita autorización adicional.
 */
export async function ingestWhatsAppMessage(
  text: string,
  fromPhoneE164: string,
  db: FiaoPrismaClient = databaseClient
): Promise<IngestResult> {
  const context = await resolveWebhookContext(db);

  const products = await db.product.findMany({
    where: { ownerId: context.ownerId, branchId: context.branchId, active: true },
    select: { id: true, name: true, priceCents: true }
  });
  const sellable = products.filter((product) => product.priceCents > 0);

  const extraction = extractOrderLines(
    text,
    sellable.map((product) => ({ productId: product.id, name: product.name }))
  );
  if (extraction.lines.length === 0) {
    return { status: "NO_ITEMS", orderId: null, exceptionReason: null };
  }

  const priceById = new Map(sellable.map((product) => [product.id, product.priceCents]));
  const lines = extraction.lines.map((line) => ({
    productId: line.productId,
    quantity: line.quantity,
    priceCents: priceById.get(line.productId) ?? 0
  }));

  const customer = fromPhoneE164
    ? await db.customer.findFirst({
        where: { phoneE164: fromPhoneE164, ownerId: context.ownerId, branchId: context.branchId },
        select: { customerId: true }
      })
    : null;

  const orderId = crypto.randomUUID();
  const branchId = context.branchId;
  const occurredAt = new Date().toISOString();

  const createResult = await processOrderCreate(
    context,
    buildEnvelope(context, "ORDER_CREATE", crypto.randomUUID(), {
      orderId,
      branchId,
      source: "WHATSAPP",
      customerId: customer?.customerId ?? null,
      lines,
      occurredAt
    }),
    db
  );
  if (createResult.status !== "ACCEPTED") {
    return { status: "EXCEPTION", orderId: null, exceptionReason: createResult.errorCode ?? "CREATE_FAILED" };
  }

  if (extraction.ambiguities.length > 0) {
    await db.order.update({
      where: { orderId },
      data: { exceptionReason: `Ambigüedad: ${extraction.ambiguities.join(", ")}` }
    });
    return { status: "EXCEPTION", orderId, exceptionReason: "AMBIGUOUS_ITEMS" };
  }

  const acceptResult = await processOrderAccept(
    context,
    buildEnvelope(context, "ORDER_ACCEPT", crypto.randomUUID(), { orderId, branchId, occurredAt }),
    db
  );
  if (acceptResult.status === "ACCEPTED") {
    return { status: "AUTO_ACCEPTED", orderId, exceptionReason: null };
  }

  await db.order.update({
    where: { orderId },
    data: { exceptionReason: acceptResult.errorCode ?? "NOT_ACCEPTED" }
  });
  return { status: "EXCEPTION", orderId, exceptionReason: acceptResult.errorCode ?? "NOT_ACCEPTED" };
}

/** Resuelve el actor del webhook: OWNER user + branch con productos + device bot. */
async function resolveWebhookContext(db: FiaoPrismaClient): Promise<CommandContext> {
  // Prefiere el owner mA�s reciente que tenga productos activos (en dev/test
  // puede haber owners residuales del testkit sin catA�logo).
  const owners = await db.ownerAccount.findMany({ orderBy: { createdAt: "desc" } });
  if (owners.length === 0) throw new Error("NO_OWNER");
  let owner = owners[0]!;
  for (const candidate of owners) {
    const count = await db.product.count({ where: { ownerId: candidate.id, active: true, priceCents: { gt: 0 } } });
    if (count > 0) {
      owner = candidate;
      break;
    }
  }
  const branch = await db.branch.findFirst({ where: { ownerId: owner.id }, orderBy: { createdAt: "asc" } });
  if (!branch) throw new Error("NO_BRANCH");
  const user = await db.user.findFirst({ where: { ownerId: owner.id, role: "OWNER" } });
  if (!user) throw new Error("NO_OWNER_USER");
  let device = await db.device.findFirst({
    where: { ownerId: owner.id, userId: user.id, label: "whatsapp-bot" }
  });
  if (!device) {
    device = await db.device.create({
      data: { ownerId: owner.id, userId: user.id, label: "whatsapp-bot" }
    });
  }
  return {
    ownerId: owner.id,
    branchId: branch.id,
    userId: user.id,
    role: "OWNER",
    deviceId: device.id,
    now: new Date()
  };
}

function buildEnvelope(
  context: CommandContext,
  type: string,
  operationId: string,
  payload: unknown
): ClientOperationEnvelope {
  return {
    operationId,
    type,
    ownerId: context.ownerId,
    branchId: context.branchId,
    actorUserId: context.userId,
    deviceId: context.deviceId,
    occurredAt: new Date().toISOString(),
    baseCursor: null,
    payload
  };
}
