# FIAO — Deployment (staging y producción)

Configuración para desplegar el MVP V1 en un entorno similar a producción.

## Variables de entorno requeridas

```text
DATABASE_URL=postgresql://...        # PostgreSQL 18 gestionado (con SSL)
FIAO_SEED_MODE=prod                  # nunca "demo" en producción
FIAO_ALLOW_PROD_SEED=true            # solo para el seed inicial del tenant real
FIAO_SEED_OWNER_PHONE=+1809...
FIAO_SEED_OWNER_PIN=...              # PIN temporal; rotar tras el primer login
FIAO_SEED_CASHIER_PHONE=...
FIAO_SEED_CASHIER_PIN=...
FIAO_WHATSAPP_VERIFY_TOKEN=...       # token de verificación del webhook de Meta
FIAO_WHATSAPP_APP_SECRET=...         # secret para X-Hub-Signature-256
NODE_ENV=production
```

## Build

```bash
pnpm install --frozen-lockfile
pnpm --filter @fiao/web build
pnpm --filter @fiao/web start
```

## Consideraciones de seguridad activadas en producción

- Headers de seguridad (CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy,
  Permissions-Policy) se añaden automáticamente cuando `NODE_ENV=production`
  (ver `apps/web/next.config.ts`).
- Cookies de sesión `httpOnly` + `secure` + `sameSite=Lax`.
- Protección CSRF en el middleware para mutaciones `/api/*` (webhook de
  WhatsApp exento por HMAC).
- Lockout persistente de login (backoff exponencial en `User`).
- Logs estructurados JSON-lines con PII redactada (`apps/web/lib/observability`).

## Separación demo / producción

- `FIAO_SEED_MODE=demo` crea el tenant ficticio idempotente (para E2E/ventas);
  se bloquea con `NODE_ENV=production`.
- `FIAO_SEED_MODE=prod` crea un tenant mínimo (dueño + sucursales + settings)
  sin catálogo/clientes ficticios; exige `FIAO_ALLOW_PROD_SEED=true`.

## Notas operativas

- Respaldos: ver `docs/runbooks/database-backup-restore.md` (drill requerido).
- Recuperación de sync/WhatsApp/IA: ver los runbooks en `docs/runbooks/`.
- El PWA se sirve del build de producción (el SW offline se genera en `build`).
