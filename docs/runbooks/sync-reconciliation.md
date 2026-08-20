# FIAO — Reconciliación de sync (runbook)

Escenario: un dispositivo estuvo offline y, al reconectar, hay que reconciliar
sus operaciones con el servidor sin perder ni duplicar nada.

## Modelo

- Cada operación offline es un `ClientOperationEnvelope` con `operationId`
  único, guardado en la cola de Dexie (`apps/web/lib/offline/queue.ts`).
- El cliente envía por lotes a `POST /api/sync/push`; el servidor procesa cada
  operación idempotentemente por `operationId` (resultado persistido, retry
  seguro).
- El servidor devuelve `pull` por cursor; el cliente aplica deltas a su réplica
  local (`packages/sync` + `apps/web/lib/offline/sync-client.ts`).

## Síntomas y causas

| Síntoma | Causa probable |
| --- | --- |
| Operación rechazada con `OWNER_AUTHORIZATION_REQUIRED` | Acción sensible sin PIN del dueño (retiro/reverso/cierre con diferencia/compra) |
| `ACCEPTED_WITH_CONFLICT` | El cursor del cliente va muy atrás y hubo cambios intermedios |
| La venta no aparece tras reconectar | La operación quedó en la cola y no se envió (red caída) |

## Pasos de reconciliación

1. Confirmar que el dispositivo muestra el estado de sync en el shell
   (pendientes + conflictos visibles).
2. Si hay conflictos, revisar `GET /api/sync/pull` con el cursor local y la
   tabla `SyncConflict` para ver el delta rechazado y la operación origen.
3. Resolver en la UI (reintentar el push) o, en último recurso, re-aplicar la
   operación desde el origen (venta/fiado/abono) con un `operationId` nuevo.
4. Nunca editar la réplica local a mano: el cursor solo avanza cuando el pull
   se aplica en la transacción única del sync client.

## Verificación

```bash
pnpm test:integration   # incluye sync-api.integration.test.ts
pnpm test:e2e           # auth-and-offline.spec.ts y sales-flow.spec.ts (offline)
```

> El SW **nunca** cachea `/api/*`: si el cliente está offline, las operaciones
> viven en Dexie hasta reconectar (no hay caché de respuestas autenticadas).
