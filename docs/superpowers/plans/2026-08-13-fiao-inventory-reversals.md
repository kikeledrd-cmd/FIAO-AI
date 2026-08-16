# FIAO Plan 2 — Task 13: Inventario y Reversos

> **Sigue:** Task 12 (fiado/clientes) completada.
> **Objetivo:** correcciones trazables protegidas por autorización de OWNER:
> ajuste de stock manual y anulación (reverso) de ventas — ambos append-only,
> con auditoría y sin reescritura de registros.

## Alcance (deliberadamente acotado)

- Operación `STOCK_ADJUSTMENT`: `{adjustmentId, productId, quantityDelta
  (decimal con signo, ej. "5" o "-2"), reason}`. Crea `StockMovement` tipo
  `ADJUSTMENT` y actualiza `ProductStock`; el onHand nunca baja de 0.
- Operación `SALE_REVERSAL`: `{reversalId, saleId, reason}`. Anula una venta
  existente: revierte stock (movimientos `REVERSAL` +cantidad por línea) y, si
  la venta tenía FIADO, revierte el cargo de crédito (movimiento `REVERSAL` en
  `CreditMovement`). Emite syncChange tipo `REVERSAL` con `{reversalId, saleId}`.
- **Autorización de OWNER obligatoria** para ambas: el payload debe incluir
  `ownerAuthorizationId` (emitida por el endpoint `POST /api/owner/authorize`
  que valida el PIN de un OWNER del mismo dueño, TTL 5 min) o el actor debe ser
  el OWNER. CASHIER sin autorización → REJECTED `OWNER_AUTHORIZATION_REQUIRED`.
- `OwnerAuthorization` reutiliza el modelo existente: `targetOperationId` =
  el `operationId` de la operación protegida (el cliente lo genera antes).
- Sync: tipos `STOCK_ADJUSTMENT`/`SALE_REVERSAL` en `COMMERCE_OPERATION_TYPES`;
  deltas `REVERSAL`/`STOCK_ADJUSTMENT` en el reducer local; el sync client
  aplica los deltas al catálogo local (stock restaurado offline tras pull).
- API: `POST /api/owner/authorize` (PIN → OwnerAuthorization).
- UI: `/inventory` (lista productos con stock, ajuste con modal que pide
  motivo y PIN de dueño si el rol es CASHIER); botón **Anular venta** en el
  recibo del POS (mismo flujo de autorización).
- E2E: ajuste de stock como OWNER; anulación de venta (stock y fiado
  revertidos); CASHIER sin PIN → rechazo visible como conflicto.

## Fuera de alcance (tareas siguientes)

- Compras/proveedores y costo promedio móvil (Task 14).
- Caja: apertura/cierre, gastos y arqueo (Task 15).
- Devoluciones parciales y apartados (Plan 3).

## Decisiones

- El reverso es un **evento nuevo**, nunca un UPDATE a la venta (append-only).
- La venta revertida se detecta por la existencia de un syncChange `REVERSAL`
  con ese `saleId` (idempotencia del reverso).
- `StockMovement.type` admite `ADJUSTMENT`/`REVERSAL`; `CreditMovement.type`
  admite `REVERSAL` (sin colisión con el `@@unique([saleId, type])` porque el
  cargo original es `FIAO_SALE`).
- El PIN del dueño **nunca viaja en la operación**: solo se usa en el endpoint
  de autorización (HTTPS, sesión activa); la operación lleva el id de la
  autorización emitida.
- Autorización de 5 minutos (TTL existente) ligada al `operationId` exacto.

## Pasos

- [x] **Step 1: Tests de política de inventario (domain) que fallan**
  - `parseAdjustmentDelta` ("5", "-2", "0.5", inválidos); `applyStockDelta`
    (suma, resta, no negativo, overflow). 6/6 tests.
- [x] **Step 2: Contratos Zod (`contracts/inventory.ts`)**
  - `stockAdjustmentPayloadSchema`, `saleReversalPayloadSchema`,
    `ownerAuthorizeRequestSchema` + exports en index.
- [x] **Step 3: Tests de integración que fallan**
  - 13 tests en `process-inventory.integration.test.ts`: ajuste OWNER
    (positivo/negativo), delta > stock → `STOCK_NEGATIVE`, producto
    desconocido, CASHIER sin autorización → `OWNER_AUTHORIZATION_REQUIRED`,
    CASHIER con autorización válida/expirada, idempotencia, reverso cash
    (stock restaurado), reverso con autorización de cajero, venta
    desconocida, reverso duplicado → `SALE_ALREADY_REVERSED`.
- [x] **Step 4: Procesadores (`process-stock-adjustment.ts`,
      `process-sale-reversal.ts`) + despacho + verificación de autorización**
  - `isOwnerAuthorized` compartido: rol OWNER pasa directo; CASHIER exige
    `OwnerAuthorization` válida (purpose + targetOperationId = operationId +
    no expirada). `shared.ts` con `persistRejectedOperation` reutilizado.
  - `SALE_REVERSAL` crea StockMovement `REVERSAL` (+cantidad por línea) y,
    si la venta fue a fiado, CreditMovement `REVERSAL` + delta CREDIT;
    emite syncChange `REVERSAL` con `{reversalId, saleId, lines}`.
  - Fix de tipos: `exactOptionalPropertyTypes` exige pasar
    `{ ownerAuthorizationId: payload.ownerAuthorizationId ?? null }` y
    castear el payload JSON a `as never`.
- [x] **Step 5: `POST /api/owner/authorize` (PIN → OwnerAuthorization) + tests**
  - Handler inyectable (repository/verifyPinHash/now/requireSession) con
    5 tests: PIN correcto emite (TTL 5 min ligado al operationId), PIN
    incorrecto 401, payload inválido 400, branch inaccesible 403, sin sesión
    401. `ownerAuthorizationExpiresAt` reutilizado.
- [x] **Step 6: Deltas `REVERSAL`/`STOCK_ADJUSTMENT` en reducer + sync client**
  - `reduceStockAdjustmentChange`/`reduceReversalChange` + tests (12/12);
    `applySignedStockDeltas` en catalog.ts; sync client aplica ambos tipos
    al catálogo local tras el pull (test 8−2+…: REVERSAL suma, ajuste con
    signo). Suite sync 17/17.
- [x] **Step 7: UI `/inventory` (ajuste) + botón Anular en recibo + tests**
  - `InventoryScreen` (lista con stock, modal Ajustar con delta + motivo +
    PIN del dueño si CASHIER), página con AppShell + force-dynamic (build
    exige session o redirect), card Inventario con href en home, botón
    Anular venta en el recibo con modal de motivo + PIN (rol OWNER no pide
    PIN). Test de componente: SALE_REVERSAL encolado con authorizationId.
- [x] **Step 8: E2E ajuste + anulación + rechazo CASHIER + verificación full**
  - `inventory-flow.spec.ts` (3 tests): ajuste +5 como OWNER (stock sube),
    reverso de venta cash restaura stock (medición dinámica del stock), el
    cajero no puede anular con PIN incorrecto (error visible).
  - Verificación completa: lint 0 errores (1 warning preexistente postcss),
    typecheck OK, `pnpm test` 101, `test:integration` 43, build OK,
    `test:e2e` **10/10** (2 auth + 2 sales + 3 credit + 3 inventario).
- [x] **Step 9: Commit** — pendiente de ejecutar al cerrar la Task.

## Archivos clave

```text
packages/contracts/src/inventory.ts            # schemas Zod
packages/domain/src/inventory/inventory-policy.ts
packages/domain/src/index.ts
packages/database/src/transactions/process-stock-adjustment.ts
packages/database/src/transactions/process-sale-reversal.ts
packages/database/src/transactions/process-operation.ts   # despacho
packages/database/src/repositories/authorization-repository.ts
packages/database/src/index.ts
packages/sync/src/operation.ts                 # + STOCK_ADJUSTMENT, SALE_REVERSAL
packages/sync/src/local-reducer.ts             # reduceReversalChange
apps/web/app/api/owner/authorize/route.ts      # PIN -> OwnerAuthorization
apps/web/lib/offline/sync-client.ts            # deltas de reverso/ajuste
apps/web/app/(app)/inventory/page.tsx
apps/web/features/inventory/inventory-screen.tsx
apps/web/features/sales/receipt.tsx            # botón Anular venta
apps/web/features/sales/sales-screen.tsx       # flujo de anulación
```
