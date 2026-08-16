# FIAO — Desarrollo local

Guía para levantar el entorno de desarrollo de FIAO en una máquina local.

## Requisitos

- Node.js 24 LTS (objetivo; se puede desarrollar en 22+ con advertencias)
- pnpm 10 (`corepack enable`)
- Docker Desktop (para PostgreSQL 18)
- Navegador Chromium para E2E (`pnpm exec playwright install chromium`)

## Arranque por primera vez

```bash
corepack enable || true
pnpm install
docker compose up -d postgres
cp .env.example .env
pnpm prisma migrate dev
pnpm db:seed
pnpm dev
```

La app queda en <http://localhost:3000>.

## Credenciales del seed de desarrollo

El seed crea un tenant demo determinista (solo con `NODE_ENV !== "production"`):

- Dueño: `+18095550123` / PIN `1234` (acceso a **Los Mina** e **Invivienda**)
- Cajero: `+18095550999` / PIN `5678` (acceso solo a **Los Mina**)

Se pueden sobreescribir con `FIAO_SEED_OWNER_PHONE`, `FIAO_SEED_OWNER_PIN`,
`FIAO_SEED_CASHIER_PHONE`, `FIAO_SEED_CASHIER_PIN`.

## Comandos de verificación

```bash
pnpm lint
pnpm typecheck
pnpm test          # unit + component (sin DB)
pnpm test:integration   # requiere PostgreSQL arriba
pnpm --filter @fiao/web build
pnpm test:e2e      # build de producción + Playwright (requiere DB + seed)
```

Los tests E2E corren contra `next build && next start` porque el service
worker de producción es el que permite el shell offline; en modo `dev` Serwist
usa `NetworkOnly` para todo.

## Base de datos

- Servicio: `docker compose up -d postgres` (PostgreSQL 18, puerto 5432)
- URL: `postgresql://fiao:***@localhost:5432/fiao_dev` (ver `.env.example`)
- Migraciones: `pnpm prisma migrate dev`
- Schema: `prisma/schema.prisma` (cliente generado en `packages/database/generated`)

## PWA / offline en desarrollo

- Manifest: `apps/web/app/manifest.ts`
- Service worker: `apps/web/app/sw.ts` (compilado a `public/sw.js` en build)
- Config: `apps/web/next.config.ts` (`@serwist/next`)
- El SW **nunca** cachea `/api/*`: las operaciones offline van por Dexie
  (`apps/web/lib/offline`) y el sync client (`POST /api/sync/push`).

### Limpiar datos locales de Dexie (desarrollo)

En la consola del navegador:

```js
await indexedDB.deleteDatabase("fiao-offline");
```

## Estructura relevante

```text
apps/web                 Web/PWA FIAO
packages/contracts       Tipos y contratos compartidos
packages/domain          Reglas de negocio y permisos
packages/database        Prisma client, repositorios y transacciones
packages/sync            Operaciones, reducers y sync
packages/testkit         Utilidades de prueba
prisma/                  Schema + seed
docs/                    Blueprint, roadmap y handoff
```
