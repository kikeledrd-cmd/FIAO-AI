# FIAO Plan 2 — Task 14: Compras y Proveedores

> **Sigue:** Task 13 (inventario/reversos) completada.
> **Objetivo:** proveedores + registro de compras con **costo promedio móvil
> determinístico** (exit gate del Plan 2), append-only y offline-first.

## Alcance (deliberadamente acotado)

- Modelo `Supplier` (branch-scoped, `supplierId` público único) + operación
  `SUPPLIER_UPSERT` idempotente (alta/edición de nombre y teléfono).
- Operación `PURCHASE` append-only: `{purchaseId, supplierId?, lines:
  [{productId, quantity, unitCostCents}], note?, occurredAt}`. Crea
  `StockMovement` tipo `PURCHASE` (+cantidad por línea) y actualiza
  `Product.costCents` con costo promedio móvil.
- **Costo promedio móvil determinístico** (dominio puro, aritmética entera):
  `newCost = round((oldCost·oldQty + unitCost·qty) / (oldQty + qty))`,
  cantidades en milésimas, costos en centavos; sin stock previo → el costo de
  la compra. Regla de redondeo fija (half away from zero) y testeada.
- Migración `commerce_purchasing`: `Supplier` + `Product.costCents` (default 0).
- Sync: `SUPPLIER_UPSERT`/`PURCHASE` en `COMMERCE_OPERATION_TYPES`; reducers
  `reduceSupplierChange`/`reducePurchaseChange`; deltas locales: PURCHASE suma
  stock al catálogo local (y guarda `costCents`), SUPPLIER hace upsert en
  Dexie v4 (`suppliers`).
- API: `GET /api/suppliers` branch-scoped + `GET /api/purchases` (historial,
  para verificación); ambas via repositorio.
- UI: `/suppliers` (lista + crear/editar proveedor, offline), botón
  **Registrar compra** en `/inventory` (modal: proveedor opcional, líneas con
  cantidad y costo unitario; muestra el costo promedio resultante).
- E2E: crear proveedor; registrar compra → stock y costo actualizados;
  verificación full (lint/typecheck/test/integration/build/E2E).

## Fuera de alcance

- Facturas/CF del proveedor y cuentas por pagar (contabilidad, fuera de V1).
- Pedidos de reposición automáticos (requieren stock mínimo + sugerencias).
- Apartados y puntos de fidelización (Plan 2 posterior / Plan 3).
- Precios de venta sugeridos por margen.

## Decisiones

- El costo vive en `Product.costCents` (proyección) y es auditado por los
  `StockMovement` de tipo `PURCHASE`; nunca se reescribe historia.
- `PURCHASE` no toca saldos de crédito ni caja (las cuentas por pagar quedan
  fuera del MVP).
- El proveedor es opcional en la compra (compra directa al mayorista).
- `SUPPLIER_UPSERT` no requiere autorización de OWNER (es datos maestros,
  como CUSTOMER_UPSERT), pero `PURCHASE` sí exige rol OWNER (cambia costo) —
  el cajero puede comprar solo con `ownerAuthorizationId` (mismo mecanismo de
  Task 13). El dueño pasa directo.
- `GET /api/suppliers` devuelve proveedores activos de la sucursal con
  orden por nombre.

## Pasos

- [x] **Step 1: Tests de política de compras (domain) que fallan**
  - `computeMovingAverageCost` (11 tests): sin stock previo / costo 0 → el
    costo de compra fija el costo; promedio ponderado entero y decimal;
    redondeo fijo half-away-from-zero ((10000·1+1·1)/2 → 5001);
    `assertPurchaseLineValid` (costo/cantidad > 0, stockControl).
- [x] **Step 2: Contratos Zod (`contracts/purchasing.ts`) + migración Prisma**
  - `supplierUpsertPayloadSchema`, `purchasePayloadSchema` (líneas con
    cantidad decimal + unitCostCents), `supplierWithStatsSchema`;
    migración `20260816194608_commerce_purchasing`: `Supplier`,
    `Purchase`, `PurchaseLine` (append-only) y `Product.costCents` (proyección
    del costo promedio móvil).
- [x] **Step 3: Tests de integración que fallan** — 11 tests en
  `process-purchasing.integration.test.ts`: upsert proveedor idempotente y
  edición; compra OWNER (stock + costCents + StockMovement PURCHASE +qty);
  promedio ponderado entre compras ((8000·15+7000·5)/20 = 7750); CASHIER sin
  autorización → `OWNER_AUTHORIZATION_REQUIRED`; CASHIER con autorización;
  producto sin stockControl / desconocido / proveedor desconocido → REJECTED;
  retry idempotente; referencia al proveedor por PK interna.
- [x] **Step 4: Procesadores (`process-supplier-upsert.ts`,
      `process-purchase.ts`) + despacho + repositorio suppliers**
  - `SUPPLIER_UPSERT` sin autorización especial (datos maestros); `PURCHASE`
    exige OWNER o OwnerAuthorization (purpose `PURCHASE`, mismo mecanismo de
    Task 13). `SupplierRepository.listByBranch` con estadísticas de compras.
- [x] **Step 5: Deltas PURCHASE/SUPPLIER en reducer + sync client + Dexie v4**
  - `reduceSupplierChange`/`reducePurchaseChange` (16/16 tests); Dexie v4 con
    tabla `suppliers`; sync client: PURCHASE suma stock y actualiza
    `costCents` local (7/7 tests); SUPPLIER hace upsert local.
- [x] **Step 6: API `GET /api/suppliers` + UI `/suppliers` + modal compra
      en `/inventory` + tests de componente**
  - Pantalla proveedores (lista + crear con sync offline); modal
    **Registrar compra** (proveedor opcional, líneas dinámicas con cantidad y
    costo unitario, PIN del dueño si cajero, costo promedio local); card
    Proveedores en home; `CatalogProduct.costCents` opcional expuesto por el
    catálogo y replicado en Dexie.
- [x] **Step 7: E2E (crear proveedor, compra actualiza stock y costo) +
      verificación full**
  - `purchasing-flow.spec.ts` (3 tests): crear proveedor; compra +5 como
    OWNER (stock local sube, medición dinámica); cajero sin PIN → alert.
  - Verificación completa: lint 0 errores (1 warning preexistente postcss),
    typecheck OK, `pnpm test` **117**, `test:integration` **54**, build OK,
    `test:e2e` **13/13** (2 auth + 2 sales + 3 credit + 3 inventario +
    3 compras). Fix de seed: limpieza ahora borra purchaseLine/purchase/
    supplier antes de clientOperation (FK Restrict nuevo).
- [x] **Step 8: Commit + push + docs** — pendiente de ejecutar al cerrar la Task.

## Archivos clave

```text
packages/contracts/src/purchasing.ts
packages/domain/src/purchasing/purchase-policy.ts
packages/domain/src/purchasing/purchase-policy.test.ts
prisma/schema.prisma + prisma/migrations/*_commerce_purchasing
packages/database/src/transactions/process-supplier-upsert.ts
packages/database/src/transactions/process-purchase.ts
packages/database/src/transactions/process-operation.ts
packages/database/src/repositories/supplier-repository.ts
packages/sync/src/operation.ts
packages/sync/src/local-reducer.ts + test
apps/web/lib/offline/db.ts (v4 + suppliers)
apps/web/lib/offline/suppliers.ts
apps/web/lib/offline/sync-client.ts (deltas PURCHASE/SUPPLIER)
apps/web/app/api/suppliers/route.ts
apps/web/app/(app)/suppliers/page.tsx
apps/web/features/suppliers/suppliers-screen.tsx
apps/web/features/inventory/inventory-screen.tsx (modal compra)
apps/web/e2e/purchasing-flow.spec.ts
```
