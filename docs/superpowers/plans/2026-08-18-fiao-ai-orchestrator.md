# Task 18 — FIAO AI Orchestrator and Voice (Plan 4)

> Plan de implementación del Plan 4 del roadmap MVP V1 (`2026-08-13-fiao-mvp-v1-master-roadmap.md`).
> Spec: `docs/superpowers/specs/2026-08-13-fiao-mvp-v1-design-part-1.md` §2 (principio "AI as an interface"), §3.3 (permisos de cajero) y §4.1 (dashboard).

## Objetivo

FIAO AI es una **interfaz alternativa segura** sobre los servicios de dominio ya existentes, no un motor de negocio paralelo. Responde consultas de solo lectura, prepara acciones que requieren confirmación humana, y ejecuta acciones protegidas solo con PIN del dueño — todo pasando por los mismos command handlers y reglas que la UI. La interacción admite texto y voz (transcripción), y toda interacción queda en un audit log.

## Alcance

- **Intents determinísticos**: parser puro `parseAiIntent` (español/dominicano) que clasifica consulta vs acción y extrae entidades (cliente, producto, monto, fecha, sucursal). La ambigüedad de entidades **nunca se auto-resuelve** (devuelve opciones).
- **Tool contracts**: catálogo tipado de herramientas `QUERY` (solo lectura) y `ACTION` (mutación con confirmación); `ACTION_PROTECTED` requiere PIN del dueño.
- **Queries de solo lectura**: resumen de ventas, fiado/cartera, clientes, inventario, caja y pedidos (agregaciones por sucursal).
- **Acciones preparadas**: token de confirmación humana de un solo uso (`AiActionToken`) ligado al intent + actor + sucursal; la ejecución pasa por `processOperation`/command handlers existentes.
- **Acciones protegidas**: PIN del dueño vía `OwnerAuthorization` (mismo mecanismo que el resto del sistema).
- **Seguridad**: el modelo no ejecuta mutaciones directamente; el cajero no puede obtener datos owner-only (margen/ganancia/diferencias de caja) ni vía prompt injection; filtro de intents por rol.
- **Advertencias de montos anómalos**: heurística determinística que marca montos fuera de rango típico como "revisar".
- **Labels**: `CONFIRMED` / `ESTIMATED` / `RECOMMENDATION` en toda respuesta.
- **Voz**: transcripción de audio (Web Speech API en el cliente; adapter mockeable en el servidor).
- **Audit log**: `AiAuditLog` (comando/transcripción, intent parseado, tool, actor, confirmación, autorización, resultado, timestamp).
- **Resúmenes**: generación diaria/semanal de ventas, fiado y alertas (texto determinístico).
- **Adapter de modelo**: `AiProvider` (Responses API) con implementación mockeable; el orquestador es agnóstico al proveedor.
- **UI**: pantalla `/ai` (chat con FIAO AI, botón de voz, confirmación de acciones, PIN para protegidas).
- **Eval corpus**: suite de evaluación con intents core de consulta/acción.

## Fuera de alcance (V1)

- Conexión a un LLM real de producción (se usa adapter mockeable + parser determinístico).
- Generación de voz (TTS) en el servidor; solo transcripción de entrada.
- Acciones de configuración avanzadas (settings) — Plan 5.
- Notificaciones proactivas de IA (Plan 5/6).

## Invariantes

1. El modelo **nunca** ejecuta mutaciones de dominio directamente; toda escritura pasa por `processOperation` (o command handler) y exige confirmación.
2. El cajero no puede leer datos owner-only (margen/ganancia, diferencias de caja) ni siquiera vía prompt injection: el filtro de intents es por rol, no por prompt.
3. Nombres/entidades ambiguas nunca se auto-resuelven: se devuelven opciones al usuario.
4. Toda interacción queda en `AiAuditLog` (append-only).
5. Las respuestas distinguen `CONFIRMED` / `ESTIMATED` / `RECOMMENDATION`.

## Pasos

- [x] **Step 1: Dominio puro + tests** — `domain/ai/ai-intent.ts` (`AiIntent`, `parseAiIntent`, resolución de ambigüedad, `detectAnomalousAmount`, `ResponseLabel`) + tests.
- [x] **Step 2: Contratos** — `contracts/ai.ts` (`AiIntent`, `AiToolCall`, `AiAuditLogEntry`, request/response schemas, `AiActionToken`).
- [x] **Step 3: Migración + repositorios** — `AiAuditLog`/`AiActionToken`; `AiQueryRepository` (agregaciones read-only por sucursal).
- [x] **Step 4: Tool registry + ejecución** — `tools.ts` (QUERY/ACTION/ACTION_PROTECTED), `executeAiTool` con filtro por rol y delegación a `processOperation`.
- [x] **Step 5: Orquestador + adapter** — `apps/web/lib/ai/provider.ts` (adapter mockeable) + `orchestrator.ts` (intent → tool, seguridad, audit, labels).
- [x] **Step 6: API + UI** — `POST /api/ai/message`, `POST /api/ai/confirm`, `POST /api/owner/authorize` (reutilizado); pantalla `/ai` (chat + voz + confirmación + PIN).
- [x] **Step 7: E2E + eval corpus** — consulta de solo lectura, acción con confirmación, acción protegida con PIN, cajero no lee datos owner-only, replay/idempotencia.
- [x] **Step 8: Verificación full** — lint → typecheck → test → test:integration → db:seed → build → test:e2e.
- [x] **Step 9: Docs + commit + push** — plan, AI_HANDOFF.md, README.md, memoria; commits de feature y docs.
