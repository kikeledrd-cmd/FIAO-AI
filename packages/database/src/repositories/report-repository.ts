import type {
  CashReport,
  CustomersReport,
  CsvRow,
  DashboardReport,
  FiaoReport,
  InventoryReport,
  OrdersReport,
  ProfitReport,
  SalesReport
} from "@fiao/contracts/reports";
import { percentChange, previousPeriodStart, startOfDay } from "@fiao/domain/reports/report-policy";
import { databaseClient, type FiaoPrismaClient } from "../client";
import { computeExpectedCashForSession, type CashSessionRow } from "../transactions/cash-shared";

interface SalePayment {
  method?: string;
  amountCents?: number;
}

function paymentSum(payments: unknown, method: string): number {
  if (!Array.isArray(payments)) return 0;
  return payments.reduce((sum, payment) => {
    if (typeof payment !== "object" || payment === null) return sum;
    const candidate = payment as SalePayment;
    if (candidate.method === method && typeof candidate.amountCents === "number") return sum + candidate.amountCents;
    return sum;
  }, 0);
}

function parseQuantity(value: unknown): number {
  if (typeof value !== "string") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Reportes reconciliados desde ledgers append-only (nunca proyecciones sueltas). */
export class ReportRepository {
  constructor(private readonly db: FiaoPrismaClient = databaseClient) {}

  async dashboard(ownerId: string, branchId: string, threshold = 3): Promise<DashboardReport> {
    const today = startOfDay();
    const yesterday = previousPeriodStart(new Date(), 1);
    const [salesToday, salesYesterday, products, activeOrders, cashOpen, credit] = await Promise.all([
      this.db.sale.findMany({ where: { ownerId, branchId, occurredAt: { gte: today } }, select: { totalCents: true, lines: true } }),
      this.db.sale.findMany({ where: { ownerId, branchId, occurredAt: { gte: yesterday, lt: today } }, select: { totalCents: true } }),
      this.db.product.findMany({ where: { ownerId, branchId, active: true, stockControl: true }, select: { stock: { select: { onHand: true, reserved: true } } } }),
      this.db.order.count({ where: { ownerId, branchId, status: { notIn: ["DELIVERED", "CANCELLED"] } } }),
      this.db.cashSession.findFirst({ where: { ownerId, branchId, status: "OPEN" }, select: { id: true } }),
      this.db.creditMovement.findMany({ where: { ownerId, branchId }, select: { customerId: true, type: true, amountCents: true } })
    ]);

    const totalToday = salesToday.reduce((sum, sale) => sum + sale.totalCents, 0);
    const totalYesterday = salesYesterday.reduce((sum, sale) => sum + sale.totalCents, 0);
    const costToday = await this.costOfSales(salesToday.map((sale) => ({ lines: sale.lines })));
    const lowStockCount = products.filter((product) => {
      const onHand = Number(product.stock?.onHand ?? "0");
      const reserved = Number(product.stock?.reserved ?? "0");
      return onHand - reserved <= threshold;
    }).length;
    const totalFiadoCents = this.fiadoBalance(credit);

    return {
      label: "CONFIRMED",
      salesTodayCents: totalToday,
      salesPreviousCents: totalYesterday,
      salesChangePct: percentChange(totalToday, totalYesterday),
      estimatedProfitCents: totalToday - costToday,
      totalFiadoCents,
      lowStockCount,
      activeOrdersCount: activeOrders,
      cashOpen: cashOpen !== null
    };
  }

  async sales(ownerId: string, branchId: string, days = 1): Promise<SalesReport> {
    const periodStart = startOfDay();
    const previousStart = previousPeriodStart(new Date(), days);
    const [current, previous] = await Promise.all([
      this.db.sale.findMany({ where: { ownerId, branchId, occurredAt: { gte: periodStart } }, select: { totalCents: true, payments: true } }),
      this.db.sale.findMany({ where: { ownerId, branchId, occurredAt: { gte: previousStart, lt: periodStart } }, select: { totalCents: true } })
    ]);

    let totalCents = 0;
    let cashCents = 0;
    let transferCents = 0;
    let cardCents = 0;
    let fiadoCents = 0;
    for (const sale of current) {
      totalCents += sale.totalCents;
      cashCents += paymentSum(sale.payments, "CASH");
      transferCents += paymentSum(sale.payments, "TRANSFER");
      cardCents += paymentSum(sale.payments, "CARD");
      fiadoCents += paymentSum(sale.payments, "FIADO");
    }
    const previousTotalCents = previous.reduce((sum, sale) => sum + sale.totalCents, 0);

    return {
      label: "CONFIRMED",
      periodStart: periodStart.toISOString(),
      periodEnd: new Date().toISOString(),
      totalCents,
      count: current.length,
      cashCents,
      transferCents,
      cardCents,
      fiadoCents,
      previousTotalCents,
      changePct: percentChange(totalCents, previousTotalCents)
    };
  }

  async profit(ownerId: string, branchId: string): Promise<ProfitReport> {
    const periodStart = startOfDay();
    const [sales, products] = await Promise.all([
      this.db.sale.findMany({ where: { ownerId, branchId, occurredAt: { gte: periodStart } }, select: { subtotalCents: true, lines: true } }),
      this.db.product.findMany({ where: { ownerId, branchId }, select: { id: true, costCents: true } })
    ]);
    const costByProduct = new Map(products.map((product) => [product.id, product.costCents]));
    let revenueCents = 0;
    let costCents = 0;
    for (const sale of sales) {
      revenueCents += sale.subtotalCents;
      if (Array.isArray(sale.lines)) {
        for (const line of sale.lines as Array<{ productId?: string; quantity?: unknown }>) {
          const unitCost = line.productId ? (costByProduct.get(line.productId) ?? 0) : 0;
          costCents += Math.round(unitCost * parseQuantity(line.quantity));
        }
      }
    }
    return {
      label: "ESTIMATED",
      periodStart: periodStart.toISOString(),
      periodEnd: new Date().toISOString(),
      revenueCents,
      costCents,
      profitCents: revenueCents - costCents,
      count: sales.length
    };
  }

  async fiao(ownerId: string, branchId: string): Promise<FiaoReport> {
    const [movements, collectionsToday] = await Promise.all([
      this.db.creditMovement.findMany({ where: { ownerId, branchId }, select: { customerId: true, type: true, amountCents: true, occurredAt: true } }),
      this.db.creditMovement.findMany({ where: { ownerId, branchId, type: "ABONO", occurredAt: { gte: startOfDay() } }, select: { amountCents: true } })
    ]);
    const totalFiadoCents = this.fiadoBalance(movements);
    const balanceByCustomer = this.balanceByCustomer(movements);
    let customersWithDebt = 0;
    let overdueCustomers = 0;
    const overdueThreshold = Date.now() - 7 * 24 * 3600 * 1000;
    const overdueCustomerIds = new Set<string>();
    for (const movement of movements) {
      if (movement.type === "FIAO_SALE" && movement.occurredAt.getTime() < overdueThreshold) {
        overdueCustomerIds.add(movement.customerId);
      }
    }
    for (const [customerId, balance] of balanceByCustomer) {
      if (balance > 0) {
        customersWithDebt += 1;
        if (overdueCustomerIds.has(customerId)) overdueCustomers += 1;
      }
    }
    const collectionsCents = collectionsToday.reduce((sum, movement) => sum + movement.amountCents, 0);
    return { label: "CONFIRMED", totalFiadoCents, customersWithDebt, overdueCustomers, collectionsCents };
  }

  async inventory(ownerId: string, branchId: string, threshold = 3): Promise<InventoryReport> {
    const products = await this.db.product.findMany({
      where: { ownerId, branchId, active: true },
      select: { id: true, name: true, costCents: true, stockControl: true, stock: { select: { onHand: true, reserved: true } } }
    });
    let inventoryValueCents = 0;
    const lowStockItems: Array<{ productId: string; name: string; available: number }> = [];
    for (const product of products) {
      if (!product.stockControl) continue;
      const onHand = Number(product.stock?.onHand ?? "0");
      const reserved = Number(product.stock?.reserved ?? "0");
      const available = onHand - reserved;
      inventoryValueCents += Math.round(product.costCents * onHand);
      if (available <= threshold) {
        lowStockItems.push({ productId: product.id, name: product.name, available });
      }
    }
    return {
      label: "CONFIRMED",
      totalProducts: products.length,
      lowStockCount: lowStockItems.length,
      inventoryValueCents,
      lowStockItems
    };
  }

  async cash(ownerId: string, branchId: string): Promise<CashReport> {
    const session = await this.db.cashSession.findFirst({
      where: { ownerId, branchId, status: "OPEN" },
      orderBy: { openedAt: "desc" },
      select: { id: true, status: true, openingFloatCents: true }
    });
    let expectedCents: number | null = null;
    if (session) {
      expectedCents = await computeExpectedCashForSession(
        this.db,
        { ownerId, branchId, userId: "", role: "OWNER", deviceId: "", now: new Date() },
        session as CashSessionRow
      );
    }
    const movements = await this.db.cashMovement.findMany({
      where: session ? { sessionId: session.id } : { ownerId, branchId },
      select: { type: true, amountCents: true }
    });
    let expensesCents = 0;
    let withdrawalsCents = 0;
    let injectionsCents = 0;
    for (const movement of movements) {
      if (movement.type === "EXPENSE") expensesCents += movement.amountCents;
      else if (movement.type === "WITHDRAWAL") withdrawalsCents += movement.amountCents;
      else if (movement.type === "INJECTION") injectionsCents += movement.amountCents;
    }
    return {
      label: "CONFIRMED",
      openSessionId: session?.id ?? null,
      openingFloatCents: session?.openingFloatCents ?? null,
      expectedCents,
      expensesCents,
      withdrawalsCents,
      injectionsCents
    };
  }

  async customers(ownerId: string, branchId: string): Promise<CustomersReport> {
    const [customers, movements] = await Promise.all([
      this.db.customer.findMany({ where: { ownerId, branchId }, select: { id: true, name: true, active: true } }),
      this.db.creditMovement.findMany({ where: { ownerId, branchId }, select: { customerId: true, type: true, amountCents: true } })
    ]);
    const balanceByCustomer = this.balanceByCustomer(movements);
    const withDebt = [...balanceByCustomer.values()].filter((balance) => balance > 0).length;
    const totalFiadoCents = [...balanceByCustomer.values()].reduce((sum, balance) => (balance > 0 ? sum + balance : sum), 0);
    const topDebtors = customers
      .map((customer) => ({ name: customer.name, balanceCents: balanceByCustomer.get(customer.id) ?? 0 }))
      .filter((entry) => entry.balanceCents > 0)
      .sort((a, b) => b.balanceCents - a.balanceCents)
      .slice(0, 5);
    return {
      label: "CONFIRMED",
      totalCustomers: customers.length,
      activeCustomers: customers.filter((customer) => customer.active).length,
      withDebt,
      totalFiadoCents,
      topDebtors
    };
  }

  async orders(ownerId: string, branchId: string): Promise<OrdersReport> {
    const orders = await this.db.order.findMany({ where: { ownerId, branchId }, select: { status: true } });
    const byStatus: Record<string, number> = {};
    for (const order of orders) byStatus[order.status] = (byStatus[order.status] ?? 0) + 1;
    const active = orders.filter((order) => order.status !== "DELIVERED" && order.status !== "CANCELLED").length;
    return { label: "CONFIRMED", total: orders.length, active, byStatus };
  }

  async exportSales(ownerId: string, branchId: string): Promise<CsvRow[]> {
    const sales = await this.db.sale.findMany({
      where: { ownerId, branchId },
      orderBy: { occurredAt: "desc" },
      select: { saleId: true, occurredAt: true, subtotalCents: true, discountCents: true, totalCents: true, payments: true, customer: { select: { name: true } } }
    });
    return sales.map((sale) => ({
      saleId: sale.saleId,
      occurredAt: sale.occurredAt.toISOString(),
      subtotalCents: sale.subtotalCents,
      discountCents: sale.discountCents,
      totalCents: sale.totalCents,
      cashCents: paymentSum(sale.payments, "CASH"),
      transferCents: paymentSum(sale.payments, "TRANSFER"),
      cardCents: paymentSum(sale.payments, "CARD"),
      fiadoCents: paymentSum(sale.payments, "FIADO"),
      customerName: sale.customer?.name ?? ""
    }));
  }

  async exportCustomers(ownerId: string, branchId: string): Promise<CsvRow[]> {
    const [customers, movements] = await Promise.all([
      this.db.customer.findMany({ where: { ownerId, branchId }, orderBy: { name: "asc" }, select: { id: true, customerId: true, name: true, phoneE164: true, creditLimitCents: true, active: true } }),
      this.db.creditMovement.findMany({ where: { ownerId, branchId }, select: { customerId: true, type: true, amountCents: true } })
    ]);
    const balanceByCustomer = this.balanceByCustomer(movements);
    return customers.map((customer) => ({
      customerId: customer.customerId,
      name: customer.name,
      phoneE164: customer.phoneE164 ?? "",
      creditLimitCents: customer.creditLimitCents,
      balanceCents: balanceByCustomer.get(customer.id) ?? 0,
      active: customer.active ? 1 : 0
    }));
  }

  async exportProducts(ownerId: string, branchId: string): Promise<CsvRow[]> {
    const products = await this.db.product.findMany({
      where: { ownerId, branchId },
      orderBy: { name: "asc" },
      select: { name: true, barcode: true, priceCents: true, costCents: true, stockControl: true, unitLabel: true, stock: { select: { onHand: true, reserved: true } } }
    });
    return products.map((product) => ({
      name: product.name,
      barcode: product.barcode ?? "",
      priceCents: product.priceCents,
      costCents: product.costCents,
      stockControl: product.stockControl ? 1 : 0,
      unitLabel: product.unitLabel,
      onHand: product.stock?.onHand ?? "0",
      reserved: product.stock?.reserved ?? "0"
    }));
  }

  private async costOfSales(sales: Array<{ lines: unknown }>): Promise<number> {
    // Costo estimado desde Product.costCents (promedio móvil) por línea.
    const productIds = new Set<string>();
    for (const sale of sales) {
      if (Array.isArray(sale.lines)) {
        for (const line of sale.lines as Array<{ productId?: string }>) {
          if (line.productId) productIds.add(line.productId);
        }
      }
    }
    const products = await this.db.product.findMany({ where: { id: { in: [...productIds] } }, select: { id: true, costCents: true } });
    const costByProduct = new Map(products.map((product) => [product.id, product.costCents]));
    let costCents = 0;
    for (const sale of sales) {
      if (!Array.isArray(sale.lines)) continue;
      for (const line of sale.lines as Array<{ productId?: string; quantity?: unknown }>) {
        const unitCost = line.productId ? (costByProduct.get(line.productId) ?? 0) : 0;
        costCents += Math.round(unitCost * parseQuantity(line.quantity));
      }
    }
    return costCents;
  }

  private fiadoBalance(movements: Array<{ customerId: string; type: string; amountCents: number }>): number {
    let total = 0;
    for (const movement of movements) {
      if (movement.type === "FIAO_SALE") total += movement.amountCents;
      else if (movement.type === "ABONO") total -= movement.amountCents;
    }
    return total > 0 ? total : 0;
  }

  private balanceByCustomer(movements: Array<{ customerId: string; type: string; amountCents: number }>): Map<string, number> {
    const balances = new Map<string, number>();
    for (const movement of movements) {
      const current = balances.get(movement.customerId) ?? 0;
      balances.set(movement.customerId, movement.type === "FIAO_SALE" ? current + movement.amountCents : current - movement.amountCents);
    }
    return balances;
  }
}
