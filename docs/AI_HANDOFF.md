# FIAO AI — AI Handoff

Fecha de corte: **2026-08-15**

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

**Task 11: POS — módulo de ventas (Vender).**

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
