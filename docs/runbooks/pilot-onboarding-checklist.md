# FIAO — Checklist de onboarding del piloto (5–10 colmados)

Plantilla para dar de alta un colmado real y medir activación.

## Antes del alta

- [ ] Verificar que el dueño tiene un teléfono con WhatsApp y Chromium móvil.
- [ ] Confirmar que el colmado NO comparte tenant con el demo (`FIAO_SEED_MODE=prod`).
- [ ] Registrar credenciales del dueño (PIN inicial temporal) y del cajero.
- [ ] Crear la sucursal con nombre/ubicación reales.

## Alta y primeros pasos (milestones de activación)

1. [ ] **Sucursal creada** (`BRANCH_CREATED`).
2. [ ] **Catálogo cargado** (`CATALOG_LOADED`): productos con precio/costo/stock.
3. [ ] **Primer cliente** (`CUSTOMER_CREATED`): alta de un cliente de fiado.
4. [ ] **Caja abierta** (`CASH_OPENED`): apertura con float inicial.
5. [ ] **Primera venta** (`FIRST_SALE`): venta de mostrador completada.

El banner de onboarding en el home muestra el progreso en vivo.

## Validación de flujo core

- [ ] Venta común en efectivo sin ralentizar el mostrador.
- [ ] Venta a fiado y registro de abono (reemplaza la libreta de papel).
- [ ] Ajuste/reverso de inventario con autorización cuando aplique.
- [ ] Cierre de caja con arqueo (diferencia 0 o auditada).
- [ ] Pedido por WhatsApp estructurado y entregado.
- [ ] Consulta de FIAO AI ("¿cuánto vendí hoy?", "¿cuánto me debe X?").

## Medición (métricas §25)

Revisar `GET /api/analytics/summary` (owner-only) para: tiempo a primera venta,
retención 7/30 días, uso diario, fiado vs papel, frecuencia de diferencia de
caja, auto-aceptación de WhatsApp, éxito de IA y conflictos de sync.

## Cierre del piloto

- [ ] Confirmar activación (todos los milestones completados).
- [ ] Registrar incidencias de sync/offline en el runbook de reconciliación.
- [ ] Documentar feedback cualitativo del dueño/cajero para iterar.
