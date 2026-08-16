# Task 15 — Caja: apertura, movimientos, arqueo y cierre

> Plan de implementación de la Task 15 del roadmap MVP V1 (`2026-08-13-fiao-mvp-v1-master-roadmap.md`, Plan 2 — Core Commerce).
> Spec: `docs/superpowers/specs/2026-08-13-fiao-mvp-v1-design-part-2.md` §10 (Cash management).

## Objetivo

Que una sucursal demo pueda ejecutar el ciclo completo **venta → inventario → caja → cliente**: apertura de caja con float inicial, movimientos de efectivo (gastos, retiros, inyecciones) con autorización de OWNER según reglas, cierre con arqueo (efectivo contado vs. esperado) y diferencias auditablemente registradas.

## Alcance

- **Sesión de caja**: una sola sesión abierta por sucursal (`CashSession` con `status OPEN|CLOSED`, `openingFloatCents`, apertura/cierre con actor y fechas). Apertura la puede hacer cajero (spec §3.3: "open cash and initiate closing").
- **Movimientos de caja** append-only (`CashMovement`): `EXPENSE`, `WITHDRAWAL`, `INJECTION`, `DIFFERENCE` (este último solo lo emite el cierre para cuadrar el ledger).
- **Reglas de autorización** (spec §10.3–10.5):
  - Gasto cashier ≤ `CASHIER_EXPENSE_LIMIT_CENTS` (RD$ 1.000) sin autorización; mayor → `OwnerAuthorization` purpose `CASH_EXPENSE`.
  - Retiro e inyección: siempre con autorización de OWNER (purpose `CASH_WITHDRAWAL` / `CASH_INJECTION`). Rol OWNER pasa directo.
  - Cierre con diferencia ≠ 0: cajero requiere autorización (purpose `CASH_CLOSE`); OWNER pasa directo.
- **Cierre/arqueo**: `countedCents` del cajero; FIAO computa `expected = openingFloat + Σcash ventas no anuladas + Σcash abonos no anulados + ΣINJECTION − ΣEXPENSE − ΣWITHDRAWAL`; `difference = counted − expected`; si `difference ≠ 0` se registra un `CashMovement` tipo `DIFFERENCE` para que el ledger cuadre con lo contado.
- **Sync**: deltas `CASH_OPEN` / `CASH_EXPENSE` / `CASH_WITHDRAWAL` / `CASH_INJECTION` / `CASH_CLOSE`; Dexie v4 con `cashSessions` + `cashMovements`; proyección local del esperado.
- **API**: `GET /api/cash` (sesión actual + movimientos + esperado computado) y `GET /api/cash/history` (cierres históricos) — opcional si el tiempo alcanza.
- **UI**: pantalla `/cash` dentro de `AppShell` (`force-dynamic`): estado de sesión, abrir caja, registrar gasto/retiro/inyección (modales con PIN si aplica), botón cerrar caja con arqueo.
- **E2E**: abrir caja como cajero; gasto sin autorización; cierre cuadrando; cierre con diferencia y PIN del dueño.

## Fuera de alcance (V1)

- Límites configurables por settings (constante de dominio por ahora).
- Reportes históricos de diferencias (se deja el dato en `CashSession.differenceCents` para Reportes).
- FIAO AI sobre patrones de caja (Plan 4).

## Invariantes

1. Una sucursal tiene **como máximo una sesión abierta** (check de unicidad en el procesador + consulta previa en transacción).
2. Los movimientos se escriben **solo en sesión abierta** (salvo el `DIFFERENCE` del cierre, que se escribe antes de marcar cerrada).
3. Efectivo esperado **nunca es un campo**: se computa desde `openingFloatCents` + movimientos inmutables (ventas cash no anuladas, abonos cash, `CashMovement`). Proyección para velocidad donde haga falta.
4. `DIFFERENCE` es un movimiento auditado: `differenceCents` queda también en la sesión cerrada.
5. El PIN del dueño nunca viaja en la operación (mismo mecanismo de `OwnerAuthorization` de Tasks 13/14).

## Pasos

- [x] **Step 1: Tests de política de caja (domain) que fallan**
  - `cash-policy.ts`: `computeExpectedCash` (fórmula del spec §10.5, aritmética
    entera, nunca negativo), `assertExpenseAllowed` (límite cajero
    `CASHIER_EXPENSE_LIMIT_CENTS` = RD$ 1.000), `assertOwnerProtectedMovement`
    (retiros/inyecciones), `assertCanClose` (diferencia ≠ 0 exige autorización
    al cajero), validación de montos. **17/17 tests**.
- [x] **Step 2: Contratos Zod (`contracts/cash.ts`) + migración Prisma**
  - `cashOpenPayloadSchema`, `cashExpensePayloadSchema`,
    `cashWithdrawalPayloadSchema`, `cashInjectionPayloadSchema`,
    `cashClosePayloadSchema`, `cashSessionSchema`, `cashMovementSchema`;
    migración `20260816195948_commerce_cash`: `CashSession` (con
    `openUniqueKey` nullable → única sesión abierta por sucursal por
    constraint) + `CashMovement` (append-only).
- [x] **Step 3: Tests de integración que fallan** — 20 tests en
  `process-cash.integration.test.ts`: apertura como cajero con float; segunda
  apertura → `CASH_SESSION_ALREADY_OPEN`; gasto dentro del límite; gasto sobre
  el límite → `OWNER_AUTHORIZATION_REQUIRED` y con autorización OK;
  retiro/inyección con autorización; movimiento sin sesión →
  `CASH_SESSION_REQUIRED`; en sesión cerrada → `CASH_SESSION_CLOSED`; cierre
  cuadrando; esperado = float + ventas cash − gastos; ventas anuladas
  excluidas; abonos cuentan como efectivo (V1); cierre con diferencia cajero →
  rechazado y OWNER OK con movimiento DIFFERENCE; idempotencia.
  **Suite completa 74/74**.
- [x] **Step 4: Procesadores (`process-cash-open.ts`,
      `process-cash-movement.ts`, `process-cash-close.ts`) + despacho**
  - `cash-shared.ts` con `findOpenCashSession` y
    `computeExpectedCashForSession` (fuentes inmutables; el esperado nunca es
    un campo guardado). `CASH_OPEN`/`CASH_EXPENSE`/`CASH_WITHDRAWAL`/
    `CASH_INJECTION`/`CASH_CLOSE` en `COMMERCE_OPERATION_TYPES` y despacho en
    `process-operation.ts`. El cierre crea CashMovement DIFFERENCE y guarda
    `differenceCents` en la sesión. Gotcha: la FK `CashMovement.sessionId`
    apunta a la PK interna (mismo bug de Customer en Task 12).
- [x] **Step 5: Reducers + Dexie v4 (`cashSessions`/`cashMovements`) + sync client**
  - `reduceCashSessionChange` (CASH_OPEN/CASH_CLOSE) y
    `reduceCashMovementChange` (CASH_EXPENSE/WITHDRAWAL/INJECTION) con tests
    (22/22 reducers); Dexie v5 con tablas `cashSessions`/`cashMovements`;
    `applyCashDeltasLocally` en sync client (upsert sesión, update cierre,
    movimientos append-only) — test 8/8.
- [x] **Step 6: API `GET /api/cash` + pantalla `/cash` + modales + tests de componente**
  - `CashRepository.getState` (sesión más reciente + movimientos + esperado
    computado solo si está abierta); `CashRepository` exportado;
    `features/cash/cash-screen.tsx` (AppShell + force-dynamic): estado de
    sesión, apertura con float, gasto/retiro/inyección con PIN cuando aplica,
    cierre con arqueo y diferencia visible, esperado local parcial offline;
    card Caja en home; 3 tests de componente (abrir, gasto sin PIN, retiro
    con PIN → 122 unit+component en total).
- [x] **Step 7: E2E `cash-flow.spec.ts` + verificación full**
  - 5 tests: abrir caja como cajero; gasto dentro del límite; cierre
    cuadrando (esperado = float − gastos); cajero con diferencia exige PIN;
    OWNER cierra con diferencia y el movimiento DIFFERENCE queda auditado.
  - Verificación completa: lint 0 errores (1 warning preexistente postcss),
    typecheck OK, `pnpm test` **144**, `test:integration` **74**, build OK,
    `test:e2e` **18/18** (2 auth + 2 sales + 3 credit + 3 inventario +
    3 compras + 5 caja).
  - Gotchas de E2E resueltos: el seed no limpiaba `cashSession`/
    `cashMovement` → sesiones residuales entre corridas (reordenada la
    limpieza); el helper de apertura espera el estado estable (loading) y
    maneja sesión abierta/cerrada residual; `fill()` de un input number no
    acepta comas de miles; el botón Confirmar queda deshabilitado hasta
    escribir el PIN cuando hay diferencia; el esperado local debe
    recalcularse con cada movimiento (float ± delta).
- [x] **Step 8: Commit + push + docs** — pendiente de ejecutar al cerrar la Task.

## Criterio de salida

- La sucursal demo puede abrir caja, registrar gastos/retiros/inyecciones con las reglas de autorización, y cerrar con arqueo cuadrando o con diferencia auditada.
- El esperado cuadra con la fórmula del spec §10.5 en el test de integración.
- Verificación completa verde: lint 0 errores, typecheck, `pnpm test`, `pnpm test:integration`, build, `pnpm test:e2e`.
