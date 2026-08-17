# Task 16 — Devoluciones/apartados y lealtad/promociones

> Plan de implementación de la Task 16 del roadmap MVP V1 (`2026-08-13-fiao-mvp-v1-master-roadmap.md`, Plan 2 — Core Commerce).
> Spec: `docs/superpowers/specs/2026-08-13-fiao-mvp-v1-design-part-2.md` §8 (Loyalty), §9.6–9.7 (stock movements y reservas) y `2026-08-13-fiao-mvp-v1-design-part-1.md` §5.6 (returns).

## Objetivo

Cerrar el ciclo de Plan 2: (A) **apartados** con reserva de inventario (physical/reserved/available) y (B) **lealtad + promociones determinísticas** (ledger de puntos auditable, redención con catálogo de recompensas y promos puras aplicadas en el POS). Las devoluciones de venta ya existen desde Task 13 (`SALE_REVERSAL` con stock, fiado, motivo y autorización de OWNER); esta tarea les añade el **efecto lealtad** (reversión de puntos ganados/redimidos).

## Alcance

### Fase A — Apartados (spec §9.7)

- **Modelo**: `Apartado` (status `ACTIVE|COMPLETED|CANCELLED`, `depositCents` anticipo, `totalCents`, fecha prometida opcional, actor) + `ApartadoLine` (producto, cantidad, precio, total). Append-only; los cambios de estado son eventos (`APARTADO_CREATE`, `APARTADO_COMPLETE`, `APARTADO_CANCEL`).
- **Stock reservado**: `ProductStock.reserved` (String "0"); disponible = onHand − reserved. Movimientos `RESERVATION` (+reserved) y `RESERVATION_RELEASE` (−reserved).
- **Flujos**:
  - Crear: valida stock disponible ≥ cantidad, anticipo ≥ 0 y ≤ total; reserva stock; el anticipo entra a caja como `CashMovement` tipo `APARTADO_DEPOSIT` (+efectivo esperado).
  - Completar: libera la reserva consumiéndola y crea la **venta real** (reutiliza la lógica de `process-sale`); los pagos son `[APARTADO_CREDIT anticipo, método resto]` donde `APARTADO_CREDIT` es un método de pago que **no** cuenta como efectivo (el anticipo ya está en caja vía su movimiento). `onHand −= qty` y `reserved −= qty`.
  - Cancelar: libera reserva (`reserved −= qty`), el anticipo se devuelve como **crédito a favor del cliente** (`CreditMovement` CREDIT −anticipo) y sale de caja (`CashMovement APARTADO_DEPOSIT_REVERSAL −anticipo`).
- **Sync**: tipos `APARTADO_CREATE` / `APARTADO_COMPLETE` / `APARTADO_CANCEL`; reducers para apartados, líneas, reservas y el movement de caja; Dexie v4 (tablas `apartados` + `apartadoLines`) y proyección local de reservas en el catálogo.
- **UI**: sección Apartados en Clientes (o pantalla propia `/apartados` dentro de AppShell): crear apartado desde el perfil del cliente (o desde POS con cliente), listar activos, completar (cobrar resto) y cancelar con PIN del dueño si cajero.
- **API**: `GET /api/apartados` (branch-scoped, con cliente y estado), `POST /api/apartados/{id}/complete|cancel` vía sync push.

### Fase B — Lealtad y promociones (spec §8)

- **Config de lealtad por owner**: `pointsPerHundredCents` (1 punto por RD$100 por defecto), `expiryDays` (180 por defecto), habilitada. `LoyaltyConfig` singleton por owner (upsert).
- **Ledger de puntos**: `LoyaltyMovement` append-only (`EARN`, `REDEEM`, `EXPIRE`, `REVERSAL`) con `pointsDelta`; el saldo es **computado** (suma de deltas no vencidos), nunca campo. Ganancia: `floor(totalCents / pointsPerHundredCents)` sobre el total pagado en la venta (efectivo, transferencia, tarjeta, fiado). La venta genera `EARN`; el reverso de venta genera `REVERSAL` de los puntos (integración con Task 13).
- **Catálogo de recompensas**: `LoyaltyReward` (kind `FREE_PRODUCT` (producto gratis de catálogo) o `FIXED_DISCOUNT` (descuento fijo en RD$), `pointsCost`, activa). La redención ocurre dentro de una venta: el POS descuenta el producto/precio de forma determinística y el payload de venta incluye `reward` → el procesador valida saldo suficiente, crea `REDEEM` (−points) y audita.
- **Promociones determinísticas**: `Promotion` (kind `PERCENT_OFF` | `FIXED_OFF` | `BUNDLE_BUY_X_GET_Y`, scope `PRODUCT` | `TOTAL`, `percentOffCents`/`fixedOffCents`, `buyQty`/`getQty`, `productId?`, `active`, `startsAt?`, `endsAt?`). Función **pura** `applyPromotions(cart, promos, now)` en dominio: mismo input → mismo output (sin azar, sin hora local del cliente). El POS aplica la mejor promo por línea (no apilable en V1) y descuentos TOTAL sobre subtotal elegible. El payload de venta incluye `promotionIds` y `discountCents`; el procesador **recomputa con las promos del servidor** y rechaza si no coincide (`PROMOTION_MISMATCH`).
- **Sync**: tipo `LOYALTY` (movimiento de puntos) y `PROMOTION` (datos maestros, sin autorización); `LOAYALTY` deltas aplicados localmente; Dexie v4 (tablas `loyaltyMovements`, `loyaltyRewards`, `loyaltyConfig`, `promotions`).
- **UI**: pestaña **Puntos** en el perfil del cliente (saldo, historial, vencimientos); pantalla recompensas (catálogo + canjear en POS); selector de promo visible en el POS (descuento calculado en vivo); badge de puntos en la pantalla de venta.
- **API**: `GET /api/loyalty` (config + saldo por cliente), `GET /api/rewards`, `GET /api/promotions` (datos maestros branch-scoped por owner).

## Fuera de alcance (V1)

- Notificaciones WhatsApp de puntos/vencimientos (Plan 3).
- Combo como recompensa y promos apilables.
- Ajuste manual de puntos por el dueño (settings en Plan 5).
- Reserva de inventario por pedidos de WhatsApp (Plan 3, mismo mecanismo `reserved`).
- Expiración automática por job: se computa al consultar el saldo (los movimientos vencidos se ignoran y se proyectan `EXPIRE` en el reporte).

## Invariantes

1. Saldo de puntos y balance de crédito son **siempre computados** desde movimientos inmutables.
2. `APARTADO_CREDIT` y `TRANSFER`/`CARD` no cuentan como efectivo en el esperado de caja; el anticipo de apartado cuenta **una sola vez** (movimiento `APARTADO_DEPOSIT` en la creación; la venta de completación usa `APARTADO_CREDIT`).
3. Las promociones son **determinísticas**: la función pura es la única fuente de descuento; el servidor valida el resultado del cliente.
4. El PIN del dueño nunca viaja en la operación (mecanismo `OwnerAuthorization` existente); completar/cancelar apartados y reversos requieren autorización si el actor es cajero.
5. Toda mutación es idempotente por `operationId` (append-only + duplicados rechazados).

## Pasos

- [x] **Step 1: Dominio puro + tests** (`domain/apartado/apartado-policy.ts`, `domain/loyalty/loyalty-policy.ts`, `domain/promotions/promotion-policy.ts`)
  - Apartado: validar líneas (productos stock-control, cantidades > 0, stock disponible), anticipo en [0, total], transiciones de estado válidas.
  - Lealtad: `computePointsEarned(totalCents, pointsPerHundredCents)`, `computeLoyaltyBalance(movements, now, expiryDays)` (ignora vencidos), `assertRedemptionAllowed` (saldo suficiente, recompensa activa).
  - Promos: `applyPromotions(cart, promos, now)` pura — PERCENT_OFF/FIXED_OFF por producto, TOTAL, BUNDLE buy X get Y; mejor promo no apilable; mismas entradas → mismas salidas.
- [x] **Step 2: Contratos Zod + migración** (`contracts/apartado.ts`, `contracts/loyalty.ts`, `contracts/promotions.ts`)
  - Migración `commerce_apartado_loyalty`: `Apartado`, `ApartadoLine`, `ProductStock.reserved`, `LoyaltyConfig`, `LoyaltyMovement`, `LoyaltyReward`, `Promotion`; `Sale.payment` acepta `APARTADO_CREDIT`; `Sale.reward?` + `Sale.discountCents?` + `Sale.promotionIds?`.
- [x] **Step 3: Procesadores + integración**
  - `process-apartado-create.ts` (reserva + anticipo a caja), `process-apartado-complete.ts` (venta real vía lógica compartida con `process-sale`, libera reserva), `process-apartado-cancel.ts` (libera reserva, crédito a favor + salida de caja; autorización OWNER si cajero).
  - `process-sale.ts`: earn de puntos + validación de redención/promos (recompute server-side).
  - `process-sale-reversal.ts`: revierte puntos (EARN/REDEEM → REVERSAL).
  - Tests de integración: ciclo apartado completo (crear→completar), cancelación con crédito a favor, doble conteo de anticipo evitado (esperado de caja), puntos earn/redeem/reversal, promo mismatch rechazada.
- [x] **Step 4: Sync/Dexie** — tipos `APARTADO_*`, `LOYALTY`, `PROMOTION`; reducers (`reduceApartadoChange`, `reduceLoyaltyChange`, `reducePromotionChange`); Dexie v4/v5 (`apartados`, `apartadoLines`, `loyaltyMovements`, `loyaltyRewards`, `loyaltyConfig`, `promotions`); sync client aplica reservas (reserved ±) y saldo de puntos.
- [x] **Step 5: API + UI** — `GET /api/apartados`, `GET /api/loyalty`, `GET /api/rewards`, `GET /api/promotions`; pantalla `/apartados`; pestaña Puntos en cliente; catálogo de recompensas; promo en el POS (descuento en vivo); badge de puntos.
- [x] **Step 6: E2E** — crear apartado con anticipo y completarlo cobrando el resto (stock disponible baja); cancelar apartado → stock liberado y crédito a favor; venta genera puntos y redención descuenta; promo 2x1/porcentaje aplicada en el POS.
- [x] **Step 7: Verificación full** — lint → typecheck → test → test:integration → db:seed → build → test:e2e.
- [x] **Step 8: Docs + commit + push** — plan, AI_HANDOFF.md, README.md, memoria; dos commits (Fase A apartados, Fase B lealtad/promos).
