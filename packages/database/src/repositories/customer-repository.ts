import type { FiaoPrismaClient } from "../client";
import { databaseClient } from "../client";

export interface CustomerWithBalance {
  customerId: string;
  name: string;
  phoneE164: string | null;
  creditLimitCents: number;
  defaultPromiseDays: number;
  active: boolean;
  balanceCents: number;
}

/** Lista clientes de una sucursal con su saldo computado (Σ movimientos). */
export class CustomerRepository {
  constructor(private readonly db: FiaoPrismaClient = databaseClient) {}

  async listByBranch(ownerId: string, branchId: string): Promise<CustomerWithBalance[]> {
    const customers = await this.db.customer.findMany({
      where: { ownerId, branchId, active: true },
      orderBy: { name: "asc" },
      select: {
        customerId: true,
        name: true,
        phoneE164: true,
        creditLimitCents: true,
        defaultPromiseDays: true,
        active: true,
        movements: { select: { type: true, amountCents: true } }
      }
    });
    return customers.map((customer) => ({
      customerId: customer.customerId,
      name: customer.name,
      phoneE164: customer.phoneE164,
      creditLimitCents: customer.creditLimitCents,
      defaultPromiseDays: customer.defaultPromiseDays,
      active: customer.active,
      balanceCents: customer.movements.reduce(
        (sum, movement) => sum + (movement.type === "FIAO_SALE" ? movement.amountCents : -movement.amountCents),
        0
      )
    }));
  }
}
