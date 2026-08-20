# FIAO — Modo degradado de FIAO AI (runbook)

Escenario: el provider de IA no responde o degrada su calidad, y el asistente
no puede responder consultas ni preparar acciones.

## Arquitectura V1 (importante)

En V1 el "modelo" es un **intérprete determinístico** (`DeterministicAiProvider`,
`apps/web/lib/ai/provider.ts`) que produce intents sin llamar a un LLM. El
orquestador (`apps/web/lib/ai/orchestrator.ts`) solo ejecuta consultas de solo
lectura o prepara acciones con confirmación humana.

Esto significa que en V1 no hay dependencia de un LLM externo para el core:
si el provider externo falla, el fallback determinístico sigue funcionando.

## Detección

- Errores en `POST /api/ai/message` o `POST /api/ai/confirm`.
- Métrica del piloto `aiQueryCount`/`aiActionCount` se estanca (ver
  `GET /api/analytics/summary`).

## Respuesta

1. Revisar los logs estructurados (JSON-lines con PII redactada) para el evento
   `ai.*` correspondiente.
2. Si se integra un LLM real en el futuro, mantener el fallback determinístico
   como proveedor por defecto ante `429`/timeout (`Retry-After` se respeta).
3. Acciones siempre pasan por `processOperation` + token de confirmación de un
   solo uso: ante cualquier fallo de ejecución, el token no se consume y la
   operación puede reintentarse de forma idempotente.

## Guardrails permanentes (no degradar)

- El modelo nunca ejecuta mutaciones directamente.
- Nombres ambiguos de clientes nunca se auto-resuelven (devuelven opciones).
- Acciones protegidas (ajuste de stock) exigen PIN del dueño.
