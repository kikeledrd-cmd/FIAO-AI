# FIAO AI

**FIAO** es un SaaS mobile-first para colmados de República Dominicana. Digitaliza ventas, fiado, cobranza, clientes, inventario, caja, pedidos por WhatsApp, delivery básico, fidelización y analítica, con FIAO AI como interfaz operativa.

## Estado actual

El producto funcional **FIAO MVP V1** está definido y la implementación técnica ya comenzó.

### Implementado hasta ahora

- Monorepo base con `apps/` y `packages/`.
- Contratos compartidos de dominio, auth y sincronización.
- Modelo de persistencia Prisma/PostgreSQL con aislamiento multi-tenant.
- Login por teléfono + PIN y sesiones revocables.
- Autorización sensible mediante PIN de OWNER.
- Procesador de operaciones idempotentes.
- API de sincronización `push/pull`.
- Réplica offline con Dexie/IndexedDB.
- Cola de operaciones offline owner-scoped.
- Sync client con conflictos explícitos y cursores seguros.
- **PWA shell (Task 9)**: manifest instalable, service worker Serwist, app shell mobile-first con selector de sucursal, estado de red, estado de sync, contador de pendientes/conflictos y home foundation con módulos de Plan 2.
- **Seed demo (Task 10)**: tenant determinista (dueño/cajero + sucursales Los Mina/Invivienda), migración inicial versionada y verificación E2E completa en Chromium móvil (login, offline shell, reconexión).
- **Branding oficial**: tokens `--fiao-*` (verde #123D32, lima #B8F23D, crema #F6F1E7), logo SVG (símbolo F + wordmark con A sin travesaño), Montserrat Variable self-hosted, tagline "Vende. Fía. Cobra. Controla.".
- **POS ventas (Task 11)**: `/sell` touch-first con carrito, búsqueda, cantidades decimales, cobro en efectivo/transferencia/tarjeta/mixto, recibo interno; catálogo por sucursal (`GET /api/catalog`) cachead en Dexie para vender offline; `SALE` como operación idempotente del sync (append-only, stock reconstruido desde `StockMovement`); seed con 10 productos demo por sucursal.
- Documentación completa del Blueprint, roadmap, handoff y runbook local.

### Próxima tarea

**Task 12 — Fiado y clientes (Plan 2):** clientes con crédito, ventas a fiado, FIAO Score y cobranza. Ver `docs/AI_HANDOFF.md`.

## Documentación obligatoria

Antes de modificar código, leer en este orden:

1. `docs/superpowers/specs/2026-08-13-fiao-mvp-v1-design.md`
2. `docs/superpowers/plans/2026-08-13-fiao-mvp-v1-master-roadmap.md`
3. `docs/superpowers/plans/2026-08-13-fiao-foundation-sync-auth.md`
4. `docs/AI_HANDOFF.md`

## Principios que NO deben romperse

- Mobile-first.
- Roles V1: `OWNER` y `CASHIER`.
- Datos multi-tenant aislados por dueño y sucursal.
- UI, WhatsApp y FIAO AI deben pasar por las mismas reglas de dominio.
- Operaciones financieras y de inventario son movimientos auditables; no se borra historia sensible.
- Offline conserva operaciones; nunca usa “último cambio gana”.
- Reintentos de sync deben ser idempotentes.
- Acciones sensibles requieren confirmación/autorización.
- FIAO AI no escribe directamente en PostgreSQL.
- PIN y cookies de sesión nunca se guardan en IndexedDB.
- El scoring de V1 es interno al negocio/sucursal, no compartido entre dueños.

## Stack objetivo

- Node.js 24 LTS
- Next.js 16
- TypeScript estricto
- PostgreSQL 18
- Prisma 7
- Dexie / IndexedDB
- Vitest
- Playwright
- PWA / Serwist

> El entorno en el que se inició la implementación tenía Node 22 y acceso de red limitado, por lo que algunas instalaciones/pruebas de dependencias externas pueden requerir ejecutarse en Codex o un entorno de desarrollo con Node 24 y red.

## Estructura

```text
apps/web                 Web/PWA FIAO
packages/contracts       Tipos y contratos compartidos
packages/domain          Reglas de negocio y permisos
packages/database        Prisma client, repositorios y transacciones
packages/sync            Operaciones, reducers y sync
packages/testkit         Utilidades de prueba
docs/                    Blueprint, roadmap y handoff
prisma/                  Schema de persistencia
```

## Continuar desarrollo

La rama de implementación publicada contiene el estado más avanzado. Leer `docs/AI_HANDOFF.md` antes de ejecutar el siguiente task.
