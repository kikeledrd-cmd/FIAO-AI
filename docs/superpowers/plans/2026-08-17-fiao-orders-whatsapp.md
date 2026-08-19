# Task 17 — Pedidos, WhatsApp y entrega básica (Plan 3)

> Plan de implementación del Plan 3 del roadmap MVP V1 (`2026-08-13-fiao-mvp-v1-master-roadmap.md`).
> Spec: `docs/superpowers/specs/2026-08-13-fiao-mvp-v1-design-part-2.md` §11 (completada en esta task, estaba truncada) y part-1 §3.3/§4 (permisos de cajero e IA).

## Objetivo

Añadir pedidos estructurados que entran al **mismo dominio de comercio que el POS**: máquina de estados New → Preparing → Ready → On the way → Delivered / Cancelled, reserva/liberación de inventario, pedidos manuales y por WhatsApp (webhook de Meta con firma y normalización), extracción de ítems en lenguaje natural con manejo explícito de ambigüedad, validación de fiado/pago mixto, reglas de auto-aceptación con bandeja de excepciones, asignación de entrega por nombre y línea de tiempo con notificaciones. La entrega finalizada cierra la venta/pago/lealtad **exactamente una vez** (idempotente).

## Alcance

- **Modelo**: `Order` (status `NEW|PREPARING|READY|ON_THE_WAY|DELIVERED|CANCELLED`, `source WhatsApp|MANUAL|REPEAT`, cliente opcional, entrega asignada por nombre/etiqueta libre, `deliveryName?`, `deliveryAddress?`, `deliveryFeeCents`) + `OrderLine` (producto, cantidad, precio, `lineTotalCents`, `substituteProductId?` pendiente de aprobación) + `OrderTimelineEvent` (append-only: estado, actor, timestamp, notas).
- **Reservas**: aceptar un pedido reserva `ProductStock.reserved` (mismo mecanismo que apartados §9.7); cancelar antes de Preparing libera; Delivered consume reserva y crea la venta.
- **Extracción NL**: función pura `extractOrderLines(texto, catalogo)` → líneas + lista de ambigüedades; si hay ambigüedad o stock insuficiente sin sustitución aprobada, el pedido no se auto-acepta.
- **Auto-aceptación**: reglas determinísticas (cliente conocido, ítems resueltos, stock disponible, pago válido) → `NEW→PREPARING` automático; si no, bandeja de excepciones (`NEW` pendiente de revisión).
- **Finalización**: `DELIVER` crea la venta real (reutiliza lógica de `process-sale`), consume reserva, registra pago/fiado y puntos de lealtad; idempotente por `operationId`.
- **WhatsApp**: `packages/whatsapp` con verificación de webhook (`hub.challenge`) y validación de firma `X-Hub-Signature-256`; normalización de eventos entrantes; abstracción de envío saliente (template/texto) mockeable. `GET/POST /api/whatsapp/webhook`.
- **UI**: pantalla `/pedidos` (lista por estado, crear pedido manual, repetir último, bandeja de excepciones, avanzar estados, asignar entrega, cancelar); card Pedidos en home.
- **API**: `GET /api/orders`, `GET /api/orders/{id}`, y mutaciones vía sync push (`ORDER_CREATE`, `ORDER_ACCEPT`, `ORDER_ADVANCE`, `ORDER_CANCEL`, `ORDER_DELIVER`).

## Fuera de alcance (V1)

- Envío real de mensajes por WhatsApp (Meta Cloud API) — se mockea el adapter.
- Repartidor como usuario formal (la entrega es un nombre libre).
- Sustituciones automáticas (siempre requieren aprobación del cliente).
- Notificaciones de puntos/vencimientos (Plan 4/5).
- Reglas de auto-aceptación configurables por UI (settings en Plan 5).

## Invariantes

1. Un pedido entregado finaliza venta/pago/lealtad **exactamente una vez** (idempotencia por `operationId` + `saleId` generado una sola vez).
2. La reserva se libera al cancelar antes de Preparing; Delivered consume reserva y stock físico.
3. La extracción NL es **pura y determinística**; la ambigüedad nunca se resuelve en silencio.
4. El PIN del dueño nunca viaja en la operación (mecanismo `OwnerAuthorization`); cancelar después de Preparing y anular requieren autorización si el actor es cajero.
5. Toda mutación es idempotente y scoped por owner/branch.

## Pasos

- [x] **Step 1: Dominio puro + tests** — `domain/orders/order-policy.ts` (estados, transiciones, `assertOrderTransitionValid`, reglas de cancelación antes/después de Preparing) y `domain/orders/order-extraction.ts` (`extractOrderLines` pura con ambigüedad explícita).
- [x] **Step 2: Contratos Zod + migración** — `contracts/orders.ts` (`Order`, `OrderLine`, `OrderTimelineEvent`, payloads de operaciones); migración `commerce_orders` (`Order`, `OrderLine`, `OrderTimelineEvent`).
- [x] **Step 3: Procesadores + integración** — `process-order-create`, `process-order-accept` (reserva), `process-order-advance`, `process-order-cancel` (libera reserva; autorización OWNER si después de Preparing), `process-order-deliver` (venta final + pago/fiado/lealtad idempotente).
- [x] **Step 4: WhatsApp adapter** — `apps/web/lib/whatsapp` (verificación `hub.challenge`, validación de firma, normalización de eventos, ingest que resuelve el actor OWNER + branch con productos); `GET/POST /api/whatsapp/webhook`. (Se implementó en `apps/web/lib/whatsapp` en lugar de un paquete separado para mantener la coherencia con el resto de `apps/web/lib`.)
- [x] **Step 5: API + UI** — `GET /api/orders`; pantalla `/pedidos` (estados, crear manual, excepciones, avanzar, entregar, cancelar); card Pedidos en home; Dexie v7 (`orders`) + `applyOrderDeltasLocally`.
- [x] **Step 6: E2E** — webhook mockeado produce una orden real; orden elegible auto-acepta y reserva; ineligible entra a excepciones; cancelar un pedido aceptado libera la reserva; Delivered finaliza venta/pago/lealtad exactamente una vez.
- [x] **Step 7: Verificación full** — lint → typecheck → test → test:integration → db:seed → build → test:e2e.
- [x] **Step 8: Docs + commit + push** — plan, AI_HANDOFF.md, README.md, memoria; commits de feature y docs.
