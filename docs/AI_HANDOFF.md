# FIAO AI — AI Handoff

Fecha de corte: **2026-08-13**

## 1. Objetivo del proyecto

FIAO es el sistema operativo inteligente para colmados dominicanos. El MVP combina POS, fiado/cobranza, CRM, inventario, caja, pedidos por WhatsApp, delivery básico, fidelización, reportes y FIAO AI.

## 2. Fuente de verdad

La especificación funcional aprobada está en:

`docs/superpowers/specs/2026-08-13-fiao-mvp-v1-design.md`

El roadmap técnico está en:

`docs/superpowers/plans/2026-08-13-fiao-mvp-v1-master-roadmap.md`

El plan que se está ejecutando actualmente está en:

`docs/superpowers/plans/2026-08-13-fiao-foundation-sync-auth.md`

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

### Siguiente tarea exacta

**Task 9: PWA shell + Serwist + selector de sucursal + UX offline.**

Requisitos principales:

- app shell navegable con conectividad intermitente;
- selector de sucursal visible;
- estado de sync visible;
- service worker para shell/assets, NO para reproducir mutaciones autenticadas;
- operaciones siguen pasando por Dexie + sync client;
- no cachear PIN, cookies ni respuestas sensibles como mecanismo de persistencia offline.

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
