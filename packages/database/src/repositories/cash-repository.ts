import type { CashMovement, CashSession } from "@fiao/contracts/cash";
import type { CommandContext } from "@fiao/domain/context";
import { databaseClient, type FiaoPrismaClient } from "../client";
import { computeExpectedCashForSession } from "../transactions/cash-shared";

export interface CashStateResult {
  session: CashSession | null;
  movements: CashMovement[];
  /** Efectivo esperado solo si hay sesión abierta (se computa, nunca se guarda). */
  expectedCents: number | null;
}

/**
 * Estado de caja de la sucursal para la UI: sesión más reciente (abierta o
 * la última cerrada), movimientos de esa sesión y esperado si está abierta.
 */
export class CashRepository {
  constructor(private readonly db: FiaoPrismaClient = databaseClient) {}

  async getState(context: CommandContext): Promise<CashStateResult> {
    const session = await this.db.cashSession.findFirst({
      where: { ownerId: context.ownerId, branchId: context.branchId },
      orderBy: { openedAt: "desc" }
    });

    if (!session) return { session: null, movements: [], expectedCents: null };

    const [movements, expectedCents] = await Promise.all([
      this.db.cashMovement.findMany({
        where: { sessionId: session.id },
        orderBy: { createdAt: "asc" }
      }),
      session.status === "OPEN"
        ? computeExpectedCashForSession(this.db, context, session)
        : Promise.resolve(null)
    ]);

    return {
      session: {
        sessionId: session.sessionId,
        ownerId: session.ownerId,
        branchId: session.branchId,
        status: session.status === "OPEN" ? "OPEN" : "CLOSED",
        openedById: session.openedById,
        openedAt: session.openedAt.toISOString(),
        openingFloatCents: session.openingFloatCents,
        closedById: session.closedById,
        closedAt: session.closedAt ? session.closedAt.toISOString() : null,
        countedCents: session.countedCents,
        differenceCents: session.differenceCents
      },
      movements: movements.map((movement) => ({
        movementId: movement.movementId,
        ownerId: movement.ownerId,
        branchId: movement.branchId,
        sessionId: session.sessionId,
        type: movement.type as CashMovement["type"],
        amountCents: movement.amountCents,
        category: movement.category,
        description: movement.description,
        reason: movement.reason,
        actorUserId: movement.actorUserId,
        occurredAt: movement.occurredAt.toISOString()
      })),
      expectedCents
    };
  }
}
