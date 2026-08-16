# FIAO Plan 2 — Task 12: Fiado y Clientes (Credit)

> **Sigue:** Task 11 (POS ventas con pagos mixtos) completada.
> **Objetivo:** primer slice de crédito real: clientes con límite por sucursal,
> venta a fiado (pura o mixta), abonos, saldo computado solo desde movimientos
> append-only y FIAO Score v1 explicable.

## Alcance (deliberadamente acotado)

- `Customer` (nombre, teléfono E164, límite de crédito en centavos, días
  prometidos por defecto, activo) por dueño+sucursal.
- `CreditMovement` append-only: `FIAO_SALE` (cargo) y `ABONO` (abono). El saldo
  del cliente **nunca se guarda como campo**: se computa Σ movimientos.
- Método de pago `FIADO` en ventas: requiere `customerId`; valida límite de
  crédito (balance actual + fiado de la venta ≤ límite); el monto a crédito es
  la suma de payments `FIADO` (permite mixto efectivo+fiado).
- Operación `ABONO`: pago de cliente contra su saldo (valida que no exceda el
  saldo actual ni el límite).
- Operación `CUSTOMER_UPSERT`: creación/actualización idempotente de cliente
  (dedup por `customerId` del dispositivo).
- FIAO Score v1 (explicable): base 100, penaliza abonos tardíos respecto a la
  fecha prometida; se calcula desde movimientos y se expone en el detalle.
- Sync: tipos nuevos en `COMMERCE_OPERATION_TYPES`; deltas `CUSTOMER`/`CREDIT`
  en el reducer local; tabla Dexie `customers` (v3) para fiar offline; el saldo
  local se deriva de deltas aplicados.
- API: `GET /api/customers` branch-scoped (idéntico patrón al catálogo).
- UI: pantalla `/customers` (lista con saldo, crear cliente, abonar con modal);
  `PaymentSheet` con botón **Fiado** (puro o mixto) seleccionando cliente local;
  card "Clientes" en home.
- Seed demo: 3 clientes con límites y un abono inicial.

## Fuera de alcance (tareas siguientes)

- Dashboard de cobranza completo con fechas prometidas y recordatorios (Task 16+).
- Dedup automática por teléfono entre sucursales (solo upsert por id por ahora).
- Correcciones/anulaciones de abonos con PIN de OWNER (Task 13 reversals).
- Puntos de fidelización y promociones.

## Decisiones

- Montos en centavos; saldo siempre `BigInt`/string decimal en el dominio.
- El cliente se identifica por `customerId` uuid generado en el dispositivo
  (mismo patrón idempotente que `saleId`).
- `CreditMovement` es append-only; el balance se computa Σ `FIAO_SALE` − Σ `ABONO`.
- Score v1: `100 − round(100 × tardíos / total)` con piso 0; un cliente sin
  movimientos puntúa 100 (neutral). Se explica con `(total, onTime, late)`.
- El límite se valida en el procesador (con saldo real de la base), nunca en el
  cliente (el offline encola y el servidor decide; rechazos → conflictos).

## Pasos

- [x] **Step 1: Tests de política de crédito (domain) que fallan**
  - saldo desde movimientos; validar límite (ok/excede); abono > saldo → error;
  - score (sin movimientos=100, todos a tiempo=100, tardíos penalizan, piso 0).
- [x] **Step 2: Implementar `credit-policy.ts` + contratos Zod (`contracts/credit.ts`)**
- [x] **Step 3: Schema Prisma (Customer, CreditMovement) + migración + client**
- [x] **Step 4: Tests de integración que fallan**
  - `CUSTOMER_UPSERT` crea y actualiza idempotente;
  - venta FIADO aceptada → cargo; límite excedido → REJECTED (`CREDIT_LIMIT_EXCEEDED`);
  - venta FIADO sin customerId → REJECTED;
  - `ABONO` aceptado → descargo; abono > saldo → REJECTED (`ABONO_EXCEEDS_BALANCE`).
- [x] **Step 5: Implementar `process-customer.ts`, `process-abono.ts`, extender `process-sale.ts`**
- [x] **Step 6: Deltas `CUSTOMER`/`CREDIT` en `local-reducer` + tests**
- [x] **Step 7: `GET /api/customers` + tabla Dexie `customers` v3 + tests**
- [x] **Step 8: UI Clientes (`/customers`) + Fiado en PaymentSheet + tests**
- [x] **Step 9: Seed demo (clientes + abono inicial)**
- [x] **Step 10: E2E fiado offline→sync + abono + verificación full**
- [x] **Step 11: Commit**

## Notas de implementación

- **Saldo computado, nunca persistido:** `Customer` no tiene campo de saldo;
  se deriva Σ `FIAO_SALE` − Σ `ABONO` en `CreditMovement` (append-only).
- **FK a PK interna:** `Sale.customerId` y `CreditMovement.customerId` apuntan
  a la PK interna de `Customer`, no al `customerId` público del payload; el
  procesador resuelve la PK dentro de la transacción (dos bugs reales
  encontrados por los tests de integración).
- **`process-abono.ts` consultaba movimientos por el id público** en vez de la
  PK interna → todo abono fallaba con `ABONO_EXCEEDS_BALANCE`; corregido.
- **Seed idempotente:** ahora limpia el historial comercial del dueño demo
  (syncChange → stockMovement → creditMovement → sale → auditEvent →
  clientOperation → customer → productStock → product) para que las corridas
  E2E repetidas no acumulen stock/saldo. Los `customerId` demo son únicos por
  sucursal (`...-100000000001` Los Mina, `...-200000000001` Invivienda).
- **`exactOptionalPropertyTypes`** del monorepo: campos opcionales con `null`
  explícito fallan en `sale.create` → se usa spread condicional; el `tx` de
  Prisma se tipa con `Parameters<Parameters<FiaoPrismaClient["$transaction"]>[0]>[0]`.
- Verificación full: `pnpm lint` (0 errores), `pnpm typecheck`, `pnpm test`
  (84), `pnpm test:integration` (30), `pnpm db:seed`, build producción,
  `pnpm test:e2e` (7/7 Chromium móvil).

## Archivos clave

```text
packages/contracts/src/credit.ts            # schemas Zod + tipos
packages/domain/src/credit/credit-policy.ts # reglas puras (saldo, límite, score)
packages/domain/src/index.ts
prisma/schema.prisma                        # Customer, CreditMovement
packages/database/src/transactions/process-customer.ts
packages/database/src/transactions/process-abono.ts
packages/database/src/transactions/process-sale.ts   # + FIADO
packages/database/src/transactions/process-operation.ts
packages/database/src/repositories/customer-repository.ts
packages/database/src/index.ts
packages/sync/src/operation.ts              # + CUSTOMER_UPSERT, ABONO
packages/sync/src/local-reducer.ts          # reduceCustomerChange/reduceCreditChange
apps/web/app/api/customers/route.ts         # branch-scoped
apps/web/lib/offline/db.ts                  # + customers (v3)
apps/web/lib/offline/customers.ts           # load/save/abonar
apps/web/app/(app)/customers/page.tsx
apps/web/features/customers/customers-screen.tsx
apps/web/features/sales/sales-screen.tsx    # + Fiado en PaymentSheet
apps/web/features/home/home-screen.tsx      # card Clientes
prisma/seed.ts                              # clientes demo
```
