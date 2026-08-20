# Task 20 — Security Hardening, Deployment y Pilot Readiness (Plan 6)

> Plan de implementación del Plan 6 del roadmap MVP V1 (`2026-08-13-fiao-mvp-v1-master-roadmap.md`).
> Spec: `2026-08-13-fiao-mvp-v1-design-part-4.md` §21 (seguridad), §22 (demo mode), §25 (pilot measurement).

## Objetivo

Dejar el MVP listo para un piloto real de 5–10 colmados: endurecer seguridad, separar demo de producción, instrumentar métricas de piloto, y documentar recuperación/degradación y deployment.

## Alcance (V1)

- **Security headers + cookie hardening**: CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy; cookies de sesión `httpOnly`/`sameSite=Lax`/`secure` en prod.
- **CSRF hardening**: validación de `Origin`/`Sec-Fetch-Site` en mutaciones state-changing.
- **Account lockout persistente**: `failedLoginAttempts` + `lockedUntil` en `User` con backoff exponencial (capa DB, no solo memoria).
- **Seed/demo separation**: `FIAO_SEED_MODE=demo|prod` (demo idempotente con datos ficticios para E2E/ventas; prod mínimo: dueño + sucursales + settings sin catálogo/客户es ficticios).
- **Observability + PII redaction**: logger JSON-lines con redacción de teléfonos/PIN/emails, usado en rutas críticas.
- **Pilot analytics**: tabla `PilotEvent` append-only + emisión en rutas clave + `GET /api/analytics/summary` (owner-only) con métricas §25.
- **Runbooks + deployment**: docs de reconciliación de sync, backup/restore, degradación de WhatsApp y de IA, checklist de onboarding de piloto y deployment staging/prod.
- **Tests**: fuzz de autorización tenant/branch, lockout persistente, redacción de PII, CSRF/origin, y reconciliación offline (sin pérdida de operaciones).

## Fuera de alcance (V1)

- e-CF/DGII completo, MFA por OTP/SMS, WAF/rate-limit de infraestructura en producción real.
- Performance benchmarks con umbrales de CI rígidos (se documenta un script de medición del flujo de venta común).

## Invariantes

1. Permisos se aplican en servidor/dominio, no solo en UI (ya vigente; se refuerza con fuzz tests).
2. Nunca loguear PII cruda (teléfonos/PIN/tokens).
3. Demo y producción nunca comparten tenant ni datos.
4. Las métricas de piloto son append-only y owner-scoped.

## Pasos

- [x] **Step 1: Security headers + cookie hardening** — `next.config.ts` headers() + cookies de sesión/sucursal con atributos seguros.
- [x] **Step 2: CSRF hardening** — validación de origen en mutaciones (helper reutilizable + aplicación en rutas POST/PUT/DELETE).
- [x] **Step 3: Account lockout persistente** — migración `User.failedLoginAttempts/lockedUntil` + login handler con lockout/backoff en DB.
- [x] **Step 4: Seed/demo separation** — `FIAO_SEED_MODE` con seed demo idempotente y seed prod mínimo.
- [x] **Step 5: Observability + PII redaction** — logger JSON-lines + `redactPii` + uso en rutas críticas.
- [x] **Step 6: Pilot analytics** — `PilotEvent` + emisión en rutas + `GET /api/analytics/summary` (§25).
- [x] **Step 7: Runbooks + deployment** — docs de recuperación/degradación/checklist/deployment.
- [x] **Step 8: Tests** — fuzz tenant/branch, lockout, PII redaction, CSRF, reconciliación offline.
- [x] **Step 9: Verificación full** — lint → typecheck → test → test:integration → db:seed → build → test:e2e.
- [x] **Step 10: Docs + commit + push** — plan, AI_HANDOFF.md, README.md, memoria; commits de feature y docs.
