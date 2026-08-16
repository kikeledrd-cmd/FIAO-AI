# FIAO Plan 2 — Task 11: POS Ventas (Sell)

> **Sigue:** Plan 1 foundation (sync/auth/PWA) completado.
> **Objetivo:** primer slice operativo real: vender productos con pagos mixtos,
> con continuidad offline total (cola de operaciones) y sin duplicación.

## Alcance (deliberadamente acotado)

- Catálogo por sucursal: `Product` (nombre, código?, precio centavos, control de
  stock, unidad) + proyección `ProductStock` (onHand decimal fijo) + movimientos
  append-only `StockMovement`.
- Venta `SALE` como operación idempotente del envelope de sync: líneas
  `{productId, quantity, priceCents}` + pagos `{method, amountCents}`.
- Métodos de pago V1: `CASH | TRANSFER | CARD` y **pago mixto**.
  FIADO se agrega en Task 12 junto con Customers/Credit.
- Validación de negocio en `packages/domain` (montos en centavos, totales
  cuadran, cantidades decimales fijas).
- `reduceSaleChange` para la réplica local (proyección de ventas + stock).
- `GET /api/catalog` branch-scoped; el catálogo se cachea en Dexie (`catalog`)
  para vender offline desde el primer uso.
- UI POS touch-first (`/sell`): búsqueda, carrito, cantidades, cobrar (efectivo /
  transferencia / tarjeta / mixto), confirmar → encolar `SALE` → sync inmediato;
  recibo interno tras completar.
- Seed demo con productos y stock iniciales.

## Fuera de alcance (tareas siguientes)

- Fiado en venta, límites de crédito y FIAO Score (Task 12).
- Clientes, descuentos con PIN, devoluciones/anulaciones con PIN (Task 12/13).
- Inventario admin, compras, costo promedio (Task 14).
- Caja, gastos, apertura/cierre (Task 15).

## Decisiones

- Dinero: `priceCents`/`amountCents` enteros (nunca floats).
- Cantidades: string decimal fijo (`"1"`, `"0.5"`) validado en dominio.
- La venta es **append-only** en `Sale` (JSONB de líneas/pagos/totales); el
  stock se reconstruye desde `StockMovement`; `ProductStock` es proyección.
- El recibo se deriva del payload aceptado (idempotente).

## Pasos

- [x] **Step 1: Tests de política de venta (domain) que fallan**
  - montos positivos, total = Σ líneas, pagos = total, mixto válido, cantidad inválida.
- [x] **Step 2: Implementar `sale-policy.ts` + contrato Zod en `contracts`**
- [x] **Step 3: Schema Prisma (Product/ProductStock/StockMovement/Sale) + migración**
- [x] **Step 4: Tests de integración `process-sale` que fallan**
  - venta aceptada + stock decrementado; retry idempotente; stock insuficiente → REJECTED;
  - scope foráneo → error; pagos que no cuadran → REJECTED.
- [x] **Step 5: Implementar `process-sale.ts` + despacho en `process-operation`**
- [x] **Step 6: `reduceSaleChange` (SALE) + tests**
- [x] **Step 7: `GET /api/catalog` + cache Dexie (`catalog`) + tests**
- [x] **Step 8: Componente POS `/sell` (carrito, cantidades, cobrar, recibo) + tests**
- [x] **Step 9: Seed demo (productos + stock)**
- [x] **Step 10: E2E venta completa offline→sync + verificación full**
- [x] **Step 11: Commit**

## Notas de implementación

- **Bug corregido en el camino:** el schema Zod del push (`apps/web/app/api/sync/push/handler.ts`)
  solo admitía `type: "NOOP"`; la operación `SALE` se rechazaba con `INVALID_REQUEST`.
  Ahora valida con `z.enum(ALL_OPERATION_TYPES)` desde `@fiao/sync/operation`.
- El E2E de venta mixta offline verifica: recibo offline, cola local, y reconexión
  con sync automático (el botón del header pasa de "Error 1" a "Sincronizado").
- Verificación full: `pnpm lint` (0 errores), `pnpm typecheck`, `pnpm test` (63),
  `pnpm test:integration` (20), `pnpm db:seed`, `pnpm --filter @fiao/web build`,
  `pnpm test:e2e` (4/4, Chromium móvil).

## Archivos clave

```text
packages/contracts/src/sales.ts            # schemas Zod + tipos
packages/domain/src/sales/sale-policy.ts   # reglas puras
packages/domain/src/index.ts
prisma/schema.prisma                       # Product, ProductStock, StockMovement, Sale
packages/database/src/transactions/process-sale.ts
packages/database/src/transactions/process-operation.ts   # despacho por tipo
packages/database/src/repositories/catalog-repository.ts
packages/database/src/index.ts
packages/sync/src/operation.ts             # + SALE
packages/sync/src/local-reducer.ts         # reduceSaleChange
apps/web/app/api/catalog/route.ts
apps/web/lib/offline/db.ts                 # + catalog table
apps/web/lib/offline/catalog.ts            # load/save catalog
apps/web/app/(app)/sell/page.tsx
apps/web/features/sales/sales-screen.tsx
apps/web/features/sales/receipt.tsx
apps/web/features/home/home-screen.tsx     # card Vender -> /sell
prisma/seed.ts                             # productos demo
```
