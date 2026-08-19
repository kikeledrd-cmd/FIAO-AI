# Task 19 — Reportes, Onboarding, Configuración, Demo y Exportaciones (Plan 5)

> Plan de implementación del Plan 5 del roadmap MVP V1 (`2026-08-13-fiao-mvp-v1-master-roadmap.md`).
> Spec: `docs/superpowers/specs/2026-08-13-fiao-mvp-v1-design-part-1.md` §4.1 (dashboard) y §2 (principio de explicabilidad).

## Objetivo

El dueño puede dar de alta un colmado con onboarding guiado, entender su desempeño con reportes que **reconcilian contra los ledgers**, configurar reglas de operación, gestionar dispositivos y exportar datos esenciales.

## Alcance (V1)

- **Reportes core (7)**: ventas, ganancia estimada, fiado/cobranzas, inventario, caja, clientes y pedidos. Cada uno es una agregación determinística que reconcilia contra los movimientos append-only (nunca contra proyecciones sueltas).
- **Dashboard**: proyecciones del día + comparación vs período anterior, con labels CONFIRMED/ESTIMATED/RECOMMENDATION.
- **Exports**: CSV de ventas, clientes y productos con campos money/quantity verificados por round-trip.
- **Settings**: configuración por sucursal (días de promesa de crédito default, umbral de stock bajo, límite de descuento del cajero, recordatorio de WhatsApp activo/inactivo).
- **Onboarding**: milestones de activación (sucursal → productos → clientes → caja → primera venta) mostrados en el home.
- **Gestión de dispositivos**: listar dispositivos y revocar (revocar invalida sesiones del dispositivo → el acceso al servidor muere).
- **Demo tenant reseteable**: el seed determinista ya es idempotente; se documenta + se cubre con un test de reset seguro.
- **UI**: `/reportes` (dashboard + reportes + export), `/configuracion` (settings + dispositivos), banner de onboarding en home.

## Fuera de alcance (V1)

- XLSX real (solo CSV V1); PDF-friendly es texto/CSV listo para imprimir.
- Import de productos por CSV/XLSX (solo export V1; import → Plan 5.5/6 si se confirma).
- Categorías de producto, alertas configurables complejas y resúmenes multi-sucursal completos.
- Notificaciones proactivas (Plan 6).

## Invariantes

1. Los reportes se computan desde los ledgers append-only (Sale, CreditMovement, StockMovement, CashMovement, Order) y **nunca** desde saldos/proyecciones persistidas.
2. La ganancia se etiqueta **ESTIMATED** (usa `costCents` de promedio móvil, no costo real de cada línea).
3. El CSV de export preserva money en centavos y quantity como string decimal (sin redondeo ni locale).
4. Revocar un dispositivo invalida sus sesiones (el servidor rechaza el acceso).
5. El demo tenant se puede resetear sin borrar la estructura (seed idempotente).

## Pasos

- [x] **Step 1: Dominio + contratos** — `domain/reports/report-policy.ts` (proyecciones/comparación, labels) + `contracts/reports.ts` y `contracts/settings.ts` (settings por sucursal, milestones).
- [x] **Step 2: Migración + repos** — `BusinessSettings` y `OnboardingState`; `ReportRepository` (agregaciones reconciliadas).
- [x] **Step 3: API de reportes + export** — `GET /api/reports/*` (7 reportes + dashboard) y `GET /api/reports/export` (CSV round-trip).
- [x] **Step 4: Settings + onboarding + devices** — `GET/PUT /api/settings`, `GET /api/onboarding`, `GET /api/devices`, `POST /api/devices/revoke`.
- [x] **Step 5: UI** — `/reportes` (dashboard + reportes + export), `/configuracion` (settings + dispositivos), banner de onboarding en home.
- [x] **Step 6: Tests** — reconciliación de reportes, round-trip de export, revocación de dispositivo, reset de demo.
- [x] **Step 7: Verificación full** — lint → typecheck → test → test:integration → db:seed → build → test:e2e.
- [x] **Step 8: Docs + commit + push** — plan, AI_HANDOFF.md, README.md, memoria; commits de feature y docs.
