# FIAO AI — AI Handoff

Fecha de corte: **2026-08-17**

## 1. Objetivo del proyecto

FIAO es el sistema operativo inteligente para colmados dominicanos. El MVP combina POS, fiado/cobranza, CRM, inventario, caja, pedidos por WhatsApp, delivery básico, fidelización, reportes y FIAO AI.

## 2. Fuente de verdad

La especificación funcional aprobada está en:

`docs/superpowers/specs/2026-08-13-fiao-mvp-v1-design.md`

El roadmap técnico está en:

`docs/superpowers/plans/2026-08-13-fiao-mvp-v1-master-roadmap.md`

El plan que se está ejecutando actualmente está en:

`docs/superpowers/plans/2026-08-13-fiao-apartado-loyalty.md`

> Plan 1 (foundation/sync/auth/PWA) completado; Tasks 11 (POS ventas), 12
> (fiado/clientes), 13 (inventario/reversos), 14 (compras/proveedores), 15
> (caja) y 16 (devoluciones/apartados y lealtad/promociones) completadas;
> la siguiente tarea es Plan 3 (pedidos por WhatsApp + delivery básico).

Si código y memoria conversacional difieren, primero revisar estos documentos y después el historial Git.

## 3. Estado de implementación

### Completado

1. **Foundation / monorepo**
   - workspace `apps/*` + `packages/*`
   - TypeScript estricto
   - Vitest/Playwright configurados
   - Docker Compose para PostgreSQL objetivo

2. **Contratos comunes**
   - dinero en centavos
   - roles
   - contexto de comando
   - normalización de teléfono
   - políticas de PIN

3. **Persistencia**
   - Prisma 7
   - PostgreSQL
   - tenant isolation dueño/sucursal
   - repositorios de autenticación y sync
   - procesamiento transaccional de operaciones

4. **Autenticación**
   - teléfono + PIN
   - hash/verificación Argon2id
   - sesiones expirables/revocables
   - throttling de intentos
   - autorización OWNER para acciones sensibles

5. **Operaciones idempotentes**
   - `operationId` único
   - resultado persistido
   - retry seguro
   - auditoría

6. **Sync API**
   - push por lotes
   - pull por cursor
   - validación de tenant/sucursal
   - límites de cursor y tamaño

7. **Offline local**
   - Dexie / IndexedDB
   - cola owner-scoped
   - proyecciones owner-scoped
   - metadata de cursor owner-scoped
   - apply de pull + cursor en transacción única

8. **Sync client**
   - push pendientes
   - manejo de respuestas incompletas
   - pull paginado
   - no retrocede cursor ante fallos
   - conflictos/rechazos visibles

9. **PWA shell + Serwist + selector de sucursal + UX offline**
   - manifest instalable (`app/manifest.ts`, nombre FIAO aislado)
   - service worker Serwist (`app/sw.ts` → `public/sw.js`), precache de shell/assets
   - `/api/*` SIEMPRE `NetworkOnly` en el SW (offline = Dexie + sync client, nunca cache de respuestas autenticadas)
   - app shell mobile-first (`components/app-shell.tsx`): sucursal activa, estado de red, sync status, contador de pendientes/conflictos en cada página protegida
   - selector de sucursal (`components/branch-switcher.tsx`) + `POST /api/auth/branch` con verificación de acceso y cookie `fiao_branch`
   - home foundation (`features/home/home-screen.tsx`) con usuario/rol, sucursal, red, sync y cards placeholder de Plan 2
   - `AuthRepository.findUserContext` para sesión → usuario + sucursales
   - E2E `apps/web/e2e/auth-and-offline.spec.ts` (login → offline shell → reconexión) y `branch-switcher.test.tsx`

### Siguiente tarea exacta

**Task 10: Seed demo oficial + verificación E2E completa del flujo foundation.**

Requisitos principales:

- formalizar `prisma/seed.ts` (ya existe un seed mínimo determinista: dueño +18095550123/1234, cajero +18095550999/5678, sucursales Los Mina e Invivienda);
- `apps/web/e2e/foundation-flow.spec.ts` con el flujo login → scope → cola offline → reconexión;
- `docs/runbooks/local-development.md` ya creado;
- ejecutar la verificación completa (`lint/typecheck/test/integration/build/E2E`) en un entorno Node 24 con PostgreSQL.

> ✅ **COMPLETADA 2026-08-16.** La verificación completa pasó en esta máquina
> (Node 22 + PostgreSQL 18 en Docker): `lint`, `typecheck`, `test` (45),
> `test:integration` (13), `build` y `test:e2e` (2/2 en Chromium móvil).
> Notas de ejecución:
>
> - migración inicial creada con `prisma migrate dev` (`prisma/migrations/*_init`);
> - el seed vive en `prisma.config.ts` (`migrations.seed`) — Prisma 7 ya no
>   lee el bloque `prisma` de `package.json`;
> - la suite de integración comparte la base y hace `TRUNCATE ... CASCADE`
>   (archivos en serie: `fileParallelism: false`); **hay que re-seedear después**
>   de `test:integration` y antes de `test:e2e`;
> - el SW sirve el shell offline (`fiao-shell` NetworkFirst) y el E2E valida
>   página viva + recarga offline;
> - en Windows con PostgreSQL nativo en 5432, el contenedor se publica en 5433.

### Siguiente tarea (Plan 2)

**Task 12: Fiado y clientes (Credit).**
> ✅ **COMPLETADA 2026-08-16.** Verificación completa pasó en esta máquina
> (Node 22 + PostgreSQL 18 en Docker): `lint` (0 errores), `typecheck`, `test` (84),
> `test:integration` (30), `build` y `test:e2e` (7/7 en Chromium móvil).
> Notas de ejecución:
>
> - dominio: `contracts/credit.ts` (Customer/Abono/movimientos Zod) +
>   `domain/credit/credit-policy.ts` (saldo Σ movimientos, límite, FIAO Score v1
>   explicable: base 100, penaliza abonos tardíos);
> - persistencia: modelos `Customer`/`CreditMovement` (append-only) + migración
>   `commerce_credit`; procesadores `process-customer.ts` (upsert idempotente),
>   `process-abono.ts` y extensión de `process-sale.ts` (método FIADO valida
>   cliente + límite, crea cargo FIAO_SALE); despacho en `process-operation.ts`;
> - sync: `CUSTOMER_UPSERT`/`ABONO` en `ALL_OPERATION_TYPES`;
>   `reduceCustomerChange`/`reduceCreditChange`; `GET /api/customers`
>   branch-scoped; Dexie v3 (`customers` + `creditMovements`); el sync client
>   aplica deltas CUSTOMER/CREDIT a la réplica local;
> - UI: `/customers` (lista con saldo, nuevo cliente, abono con modal),
>   `PaymentSheet` con botón **Fiado** (puro o mixto) y selector de cliente con
>   aviso de límite excedido, card Clientes en home;
> - seed: 3 clientes por sucursal (ids únicos por branch) + saldo inicial de
>   RD$800 para Doña María; el seed es ahora **totalmente idempotente**
>   (limpia el historial comercial del dueño demo entre corridas E2E);
> - bugs reales cazados por tests: FK de `Sale`/`CreditMovement` apuntan a la
>   PK interna de `Customer` (no al `customerId` público); `process-abono`
>   consultaba el saldo por el id público → `ABONO_EXCEEDS_BALANCE` falso;
> - E2E `credit-flow.spec.ts`: venta a fiado (saldo 800→825), abono (275→75),
>   creación de cliente con sync; el `Set-Content` de PowerShell corrompe
>   UTF-8 — reescribir specs E2E con la herramienta `write`.

### Siguiente tarea (Plan 2)

**Task 13: Inventario y reversos.**

> ✅ **COMPLETADA 2026-08-16.** Verificación completa pasó en esta máquina
> (Node 22 + PostgreSQL 18 en Docker): `lint` (0 errores, 1 warning
> preexistente postcss), `typecheck`, `test` (101), `test:integration` (43),
> `build` y `test:e2e` (10/10 en Chromium móvil).
> Notas de ejecución:
>
> - dominio: `contracts/inventory.ts` (ajuste/reverso/autorización Zod) +
>   `domain/inventory/inventory-policy.ts` (`parseAdjustmentDelta` con signo,
>   `applyStockDelta` nunca negativo);
> - persistencia: procesadores `process-stock-adjustment.ts` y
>   `process-sale-reversal.ts` (append-only: StockMovement `ADJUSTMENT`/
>   `REVERSAL`, CreditMovement `REVERSAL` si la venta fue a fiado), despacho
>   en `process-operation.ts`; `shared.ts` con `persistRejectedOperation`;
> - autorización: `POST /api/owner/authorize` valida el PIN de un OWNER del
>   dueño y emite `OwnerAuthorization` (TTL 5 min) ligada al `operationId`;
>   CASHIER sin autorización → `OWNER_AUTHORIZATION_REQUIRED`; rol OWNER pasa
>   directo (el PIN solo se usa en el endpoint, nunca viaja en la operación);
> - sync: `STOCK_ADJUSTMENT`/`SALE_REVERSAL` en `COMMERCE_OPERATION_TYPES`;
>   `reduceStockAdjustmentChange`/`reduceReversalChange`; `applySignedStockDeltas`
>   (REVERSAL suma, ajuste con signo) aplicado por el sync client al catálogo;
> - UI: `/inventory` (lista con stock + modal Ajustar con delta/motivo/PIN si
>   cajero; página con AppShell force-dynamic), card Inventario en home,
>   botón **Anular venta** en el recibo del POS (modal con motivo + PIN si
>   cajero; restaura stock y saldo de fiado localmente);
> - E2E `inventory-flow.spec.ts`: ajuste +5 como OWNER, reverso de venta cash
>   (stock restaurado, medición dinámica), cajero con PIN incorrecto → error;
> - gotchas: `exactOptionalPropertyTypes` exige spread condicional y castear
>   payloads JSON a `as never`; los payloads mínimos de los reducers exigen
>   los campos clave (adjustmentId+productId, reversalId+saleId); las páginas
>   protegidas nuevas deben renderizarse dentro de `AppShell` o el prerender
>   falla con `APP_SHELL_REQUIRED`.

### Siguiente tarea (Plan 2)

**Task 14: Compras y proveedores.**

> ✅ **COMPLETADA 2026-08-16.** Verificación completa pasó en esta máquina
> (Node 22 + PostgreSQL 18 en Docker): `lint` (0 errores), `typecheck`,
> `test` (117), `test:integration` (54), `build` y `test:e2e` (13/13 en
> Chromium móvil).
> Notas de ejecución:
>
> - dominio: `contracts/purchasing.ts` + `domain/purchasing/purchase-policy.ts`
>   — `computeMovingAverageCost` determinístico con aritmética entera
>   (cantidades en milésimas, costos en centavos, redondeo fijo
>   half-away-from-zero; sin stock previo o costo 0 → la compra fija el costo);
> - persistencia: migración `commerce_purchasing` con `Supplier`, `Purchase`,
>   `PurchaseLine` (append-only) y `Product.costCents` (proyección);
>   procesadores `process-supplier-upsert.ts` (datos maestros, sin
>   autorización) y `process-purchase.ts` (exige OWNER o OwnerAuthorization
>   purpose `PURCHASE`); `SupplierRepository.listByBranch` con estadísticas;
> - sync: `SUPPLIER_UPSERT`/`PURCHASE` en `COMMERCE_OPERATION_TYPES`;
>   `reduceSupplierChange`/`reducePurchaseChange`; Dexie v4 con `suppliers`;
>   el sync client aplica PURCHASE (stock + costCents local) y SUPPLIER;
> - UI: `/suppliers` (lista + crear con sync offline), modal **Registrar
>   compra** en `/inventory` (proveedor opcional, líneas dinámicas, PIN del
>   dueño si cajero), card Proveedores en home;
> - E2E `purchasing-flow.spec.ts`: crear proveedor, compra +5 actualiza stock,
>   cajero sin PIN rechazado;
> - gotchas: el seed debía limpiar `purchaseLine/purchase/supplier` antes de
>   `clientOperation` (nuevo FK Restrict); `parseSaleQuantity` rechaza "0" →
>   manejo explícito en sumas de stock; los keys de los reducers deben
>   incluir ownerId+branchId completos en los tests (sin elipsis).

### Siguiente tarea (Plan 2)

**Task 15: Caja (apertura/cierre, gastos, retiros, inyecciones y arqueo).**

> ✅ **COMPLETADA 2026-08-16.** Verificación completa pasó en esta máquina
> (Node 22 + PostgreSQL 18 en Docker): `lint` (0 errores), `typecheck`,
> `test` (144), `test:integration` (74), `build` y `test:e2e` (18/18 en
> Chromium móvil).
> Notas de ejecución:
>
> - dominio: `contracts/cash.ts` + `domain/cash/cash-policy.ts` —
>   `computeExpectedCash` (float + ventas cash no anuladas + abonos +
>   inyecciones − gastos − retiros, aritmética entera), límite de gasto del
>   cajero `CASHIER_EXPENSE_LIMIT_CENTS` (RD$ 1.000), retiros/inyecciones y
>   cierre con diferencia siempre con autorización de OWNER;
> - persistencia: migración `commerce_cash` — `CashSession` (con
>   `openUniqueKey` nullable → única sesión abierta por sucursal por
>   constraint) y `CashMovement` (EXPENSE/WITHDRAWAL/INJECTION/DIFFERENCE,
>   append-only); procesadores `process-cash-open.ts`,
>   `process-cash-movement.ts` y `process-cash-close.ts`; el cierre computa
>   el esperado en `cash-shared.ts` y registra el movimiento DIFFERENCE;
> - sync: `CASH_OPEN`/`CASH_EXPENSE`/`CASH_WITHDRAWAL`/
>   `CASH_INJECTION`/`CASH_CLOSE` en `COMMERCE_OPERATION_TYPES`;
>   `reduceCashSessionChange`/`reduceCashMovementChange`; Dexie v5 con
>   `cashSessions`/`cashMovements`; `applyCashDeltasLocally` en el sync
>   client;
> - API: `GET /api/cash` (sesión + movimientos + esperado computado solo
>   para sesión abierta);
> - UI: pantalla `/cash` (estado de sesión, abrir caja, gasto/retiro/
>   inyección con PIN cuando aplica, cierre con arqueo y diferencia, esperado
>   local recalculado con cada movimiento); card Caja en home;
> - E2E `cash-flow.spec.ts`: abrir caja, gasto, cierre cuadrando, cajero con
>   diferencia exige PIN, OWNER cierra con diferencia auditada;
> - gotchas: el seed ahora limpia `cashMovement/cashSession` (FK Restrict
>   nuevo) antes de `syncChange`; la pantalla necesita estado `loading` para
>   que los tests no clickeen botones que se desmontan; `fill()` de inputs
>   number rechaza comas; el botón Confirmar se deshabilita hasta escribir el
>   PIN cuando hay diferencia; `exactOptionalPropertyTypes` exige spreads
>   condicionales en los patches de la UI.

### Siguiente tarea (Plan 2)

**Task 16: Devoluciones/apartados y lealtad/promociones.**

> ✅ **COMPLETADA 2026-08-17.** Verificación completa pasó en esta máquina
> (Node 22 + PostgreSQL 18 en Docker): `lint` (0 errores, 1 warning
> preexistente postcss), `typecheck`, `test` (172), `test:integration` (89),
> `build` y `test:e2e` (22/22 en Chromium móvil).
> Notas de ejecución:
>
> - Fase A (apartados, spec §9.7): dominio `domain/apartado/apartado-policy.ts`
>   (disponible = onHand − reserved, validación de líneas/anticipo/transiciones),
>   contratos `contracts/apartado.ts`, migración `commerce_apartado_loyalty`
>   (`Apartado`/`ApartadoLine`/`ProductStock.reserved`); procesadores
>   `process-apartado-create.ts` (reserva + anticipo INJECTION a caja, exige
>   sesión abierta), `process-apartado-complete.ts` (venta real con pago
>   `APARTADO_CREDIT` + resto, consume reserva) y `process-apartado-cancel.ts`
>   (libera reserva, crédito a favor `APARTADO_REFUND` + retiro de caja, PIN
>   del dueño si cajero); `GET /api/apartados` + pantalla `/apartados`
>   (crear/completar/cancelar).
> - Fase B (lealtad + promos, spec §8): `domain/loyalty/loyalty-policy.ts`
>   (1 punto por RD$1 con la tasa demo 100; saldo computado con vencimiento),
>   `domain/promotions/promotion-policy.ts` (`applyPromotions` pura
>   determinística: PERCENT_OFF/FIXED_OFF/BUNDLE, PRODUCT/TOTAL, no apilable);
>   `process-sale.ts` valida promos con recompute server-side
>   (`PROMOTION_MISMATCH`), redención (`INVALID_REWARD`) y earn/redeem de
>   puntos (`LOYALTY`); `process-sale-reversal.ts` revierte puntos (`REVERSAL`);
>   `GET /api/loyalty` (config + saldo por cliente), `GET /api/rewards`,
>   `GET /api/promotions`; pantalla `/loyalty` (config, recompensas, saldo e
>   historial de puntos por cliente).
> - POS: promos aplicadas en vivo (descuento determinístico + payload
>   `discountCents`/`promotionIds`); el recibo muestra el total pagado.
> - sync: `APARTADO_CREATE/COMPLETE/CANCEL` en `COMMERCE_OPERATION_TYPES`;
>   `reduceApartadoChange`/`reduceLoyaltyChange`; Dexie v6 (`apartados`,
>   `loyaltyMovements`, `loyaltyRewards`, `loyaltyConfig`, `promotions`); el
>   sync client ajusta reservas (reserved ±) y aplica movimientos LOYALTY;
>   `CatalogProduct.reserved` expuesto en `GET /api/catalog` y catálogo local.
> - E2E `apartado-loyalty.spec.ts`: crear/completar apartado, cancelar,
>   promo 10% en el POS y venta a fiado que genera puntos.
> - gotchas: `Sale.apartadoId` tiene FK `ON DELETE RESTRICT` → el seed debe
>   borrar `sale` antes que `apartado`; `test:integration` trunca la base de
>   desarrollo → re-seedear antes de `test:e2e`; los propósitos de autorización
>   OWNER se ampliaron (`PURCHASE`/`CASH_*`/`APARTADO_CANCEL`) en el schema del
>   endpoint `/api/owner/authorize`; `applyPromotions` es la única fuente de
>   descuento (el servidor recomputa y rechaza desajustes).

## 4. Reglas de arquitectura

### Escrituras

```text
UI / WhatsApp / FIAO AI
          ↓
     Domain Command
          ↓
 permissions + validation
          ↓
 operation processor
          ↓
      PostgreSQL
```

Ningún canal debe escribir directamente en tablas de negocio.

### Offline

```text
Acción offline
   ↓
OperationEnvelope
   ↓
Dexie pending queue
   ↓
POST /api/sync/push
   ↓
Idempotent processor
   ↓
Pull changes by cursor
   ↓
Local projections
```

No implementar last-write-wins para ventas, fiados, cobros o movimientos de inventario.

## 5. Seguridad

- OWNER y CASHIER son los únicos roles del MVP.
- CASHIER no puede ver ganancias detalladas ni modificar controles sensibles.
- Autorizaciones sensibles deben registrar dueño, propósito y contexto.
- Una sesión debe validar relación usuario ↔ dueño ↔ dispositivo ↔ sucursal.
- Nunca guardar PIN plano.
- Nunca guardar sesión/cookie en Dexie.
- Las operaciones sensibles no se eliminan físicamente; se anulan/revierten con trazabilidad.

## 6. Limitaciones del entorno de origen

Durante la implementación inicial:

- el contenedor local tenía Node 22;
- el objetivo del proyecto sigue siendo Node 24 LTS;
- `gh` CLI no estaba instalado;
- hubo acceso de red limitado para descargar dependencias;
- por ello algunas comprobaciones se hicieron con typecheck/validaciones estructurales disponibles y deben volver a ejecutarse en un entorno completo.

No interpretar esto como permiso para degradar versiones del proyecto.

## 7. Validación recomendada al retomar

En un entorno Node 24 con red:

```bash
corepack enable
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm exec playwright test
```

Levantar PostgreSQL 18 según `docker-compose.yml` y ejecutar las pruebas de integración de `packages/database` y `apps/web`.

## 8. Próximos bloques después de Foundation

Según el roadmap maestro:

1. Foundation + Auth + Offline Sync (en curso)
2. POS + Fiao + Clientes + Inventario + Caja
3. Pedidos + WhatsApp + Delivery
4. FIAO AI + voz
5. Reportes + onboarding + configuración
6. Seguridad + deployment + piloto

## 9. No ampliar scope accidentalmente

Fuera de V1:

- contabilidad completa;
- nómina;
- GPS/rutas de delivery;
- app separada para consumidores;
- score compartido entre dueños;
- integración Mercao activa;
- DGII/e-CF completo;
- compras autónomas de FIAO AI;
- permisos avanzados personalizados.

## 10. Criterio de continuidad

Antes de crear una función nueva, responder:

1. ¿Está en el Blueprint aprobado?
2. ¿Respeta multi-tenant y offline?
3. ¿Pasa por dominio/permisos?
4. ¿Tiene estrategia de prueba?
5. ¿Mantiene trazabilidad de dinero/deuda/inventario?

Si alguna respuesta es “no”, detenerse y revisar el diseño antes de programar.
