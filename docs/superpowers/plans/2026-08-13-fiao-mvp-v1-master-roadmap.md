# FIAO MVP V1 Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each subsystem plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a pilot-ready FIAO MVP V1 for 5–10 Dominican colmados with fast mobile sales, fiado/collections, inventory, cash, WhatsApp orders, FIAO AI, reports, multi-branch support, and offline continuity.

**Architecture:** Build a TypeScript monorepo around a Next.js 16 mobile-first PWA. PostgreSQL 18 is the durable source of truth; Prisma ORM 7 owns schema/migrations; Dexie/IndexedDB stores the offline replica and pending operations. All channels call shared domain command handlers. Financial/credit/stock history is append-only and corrected by linked reversals, while current views are maintained as projections.

**Tech Stack:** Node.js 24 LTS, pnpm workspaces, Next.js 16.2.11+ / React 19.2, TypeScript 5.x, PostgreSQL 18.x, Prisma ORM 7.x, Dexie 4.x, Serwist PWA service worker, Zod, Vitest, Playwright, OpenAI Responses API/function tools, Meta WhatsApp Cloud API adapter.

## Global Constraints

- Primary experience: mobile-first Android/web app, responsive for later tablet/desktop use.
- Exactly two formal roles in V1: Owner and Cashier.
- Login: phone number + 4–6 digit PIN.
- Common cash sale target: under 10 seconds.
- Supported sale payments: cash, transfer, card, fiado, and mixed payments.
- Financial, credit, stock, and audit history is never physically deleted; corrections use reversal/adjustment records.
- Core sales, fiado, collections, core cash movements, and safe inventory movements continue offline.
- WhatsApp, incoming WhatsApp orders, and full generative FIAO AI require connectivity.
- Cloud is durable source of truth; local data is an operational replica plus pending-operation queue.
- Customer identity is shared per owner; debt, limits, stock, cash, price, cost, and FIAO Score are branch-specific where specified.
- FIAO Score is 0–100, branch-local, explainable, and unavailable until at least three relevant credit/payment movements.
- No cross-owner blacklist/shared score in V1.
- No full accounting, payroll, GPS delivery, Mercao integration, full DGII/e-CF production integration, or autonomous AI purchasing in V1.
- Money is stored in integer centavos (`bigint`); measured quantities use fixed-precision decimal values.
- Server timestamps are UTC; each branch stores an IANA timezone, defaulting to `America/Santo_Domingo` for the Dominican pilot.
- Every offline write carries a globally unique operation ID/idempotency key.
- AI/WhatsApp/UI must use the same domain commands and permission checks.

---

## System decomposition

The approved product is too broad for one safe implementation batch. Build it as six independently reviewable subsystems, each leaving FIAO in a runnable/testable state.

### Plan 1 — Foundation, Identity, Audit, and Offline Sync

**Deliverable:** installable mobile PWA with Owner/Cashier login, tenant/branch context, local Dexie replica, append-only operation/audit envelope, push/pull sync, conflict surfacing, and CI/test foundations.

**Plan:** `docs/superpowers/plans/2026-08-13-fiao-foundation-sync-auth.md`

Exit gate:
- user can log in with phone + PIN;
- branch context is explicit;
- app shell works offline after first load;
- locally queued operations synchronize idempotently;
- duplicate retries do not duplicate movements;
- a synthetic conflict is preserved and surfaced;
- unit/integration/E2E CI passes.

### Plan 2 — Core Commerce: POS, Fiao, Customers, Inventory, Cash

**Deliverable:** first complete operational vertical slice for a real counter.

Scope:
- catalog, categories, presentations, weight/measure, stock-control toggle;
- visual POS, quick search, frequent products, mixed payments, internal receipts;
- customer creation/deduplication and branch credit limits;
- detailed fiado, fiado rápido, abonos, promised dates, collections dashboard;
- explainable FIAO Score calculation;
- suppliers, replenishment, moving-average cost, stock movements/reservations/adjustments;
- cash opening, expected cash, expenses, withdrawals, cash injection, closing/differences;
- returns/reversals and apartados;
- loyalty points/reward ledger and deterministic promotions;
- mobile screens for Vender, Fiao, Clientes, Inventario, Caja.

Exit gate:
- seeded demo branch can execute the complete sale → inventory → cash → customer cycle;
- fiado and abono update computed balance only through movements;
- mixed payments reconcile correctly;
- moving-average cost is deterministic;
- offline sale/fiado/abono sync without duplication;
- owner-protected corrections require authorization and audit.

### Plan 3 — Orders, WhatsApp, and Basic Delivery

**Deliverable:** structured WhatsApp orders that enter the same commerce domain as POS.

Scope:
- order state machine: New → Preparing → Ready → On the way → Delivered / Cancelled;
- inventory reservation/release;
- manual orders and repeat-last-order;
- Meta webhook verification and inbound event normalization;
- outbound template/message abstraction;
- natural-language item extraction adapter with explicit ambiguity handling;
- stock substitution proposals requiring customer approval;
- fiado/mixed-payment order validation;
- auto-acceptance rules and exception inbox;
- delivery assignment by name/label;
- order timeline and status notifications;
- cancellation rules before/after Preparing.

Exit gate:
- mocked Meta webhook produces a real FIAO order;
- eligible order auto-accepts and reserves stock;
- ineligible order enters exception inbox;
- cancelling a New order releases stock;
- Delivered order finalizes sale/payment/loyalty exactly once.

### Plan 4 — FIAO AI Orchestrator and Voice

**Deliverable:** AI is a safe alternate interface to existing domain services, not a parallel business engine.

Scope:
- Responses API adapter and structured tool contracts;
- read-only queries across sales, credit, customers, inventory, cash, orders;
- prepared actions with human confirmation token;
- protected actions requiring owner PIN authorization;
- entity ambiguity resolution;
- anomalous amount warnings;
- Spanish/Dominican-language evaluation corpus;
- voice transcription entry;
- AI audit log storing command/transcription, parsed intent/tool, actor, confirmation, authorization, result;
- Confirmed / Estimated / Recommendation response labels;
- daily/weekly summary generation.

Exit gate:
- model cannot execute domain mutations directly;
- all writes pass through command handlers and confirmation;
- cashier cannot obtain owner-only data via prompt injection;
- ambiguous customer names never auto-resolve;
- AI action replay/idempotency test passes;
- eval suite covers at least the core approved query/action intents.

### Plan 5 — Reports, Onboarding, Settings, Demo, and Exports

**Deliverable:** owner can onboard a colmado, understand performance, configure operating rules, and export essential data.

Scope:
- dashboard projections and previous-period comparisons;
- seven core reports: sales, estimated profit, fiao/collections, inventory, cash, customers, orders;
- WhatsApp/loyalty/promotions/expenses/multi-branch supplemental views;
- FIAO Insights labeled as fact/pattern/recommendation;
- CSV/XLSX and PDF-friendly exports for essential datasets;
- progressive onboarding and product CSV/XLSX import;
- settings for credit, reminders, cash, discounts, loyalty, promotions, suppliers, categories, alerts;
- user/device management and revocation;
- multi-branch switcher and owner summaries;
- demo tenant with deterministic fictitious data;
- activation milestone tracking.

Exit gate:
- fresh owner reaches first sale with guided onboarding;
- reports reconcile to ledgers;
- export round-trip tests validate money/quantity fields;
- demo tenant can be reset safely;
- device revocation invalidates server access.

### Plan 6 — Security Hardening, Deployment, and Pilot Readiness

**Deliverable:** production-like pilot environment with monitoring, recovery, performance budgets, and measurable pilot instrumentation.

Scope:
- PIN hashing/rate limits/account lock/backoff and secure recovery flow;
- CSRF/session/cookie hardening and security headers;
- tenant/branch authorization fuzz tests;
- PWA/offline chaos tests and sync reconciliation runbook;
- database backup/restore drill;
- WhatsApp degraded-mode runbook;
- AI provider degraded-mode runbook;
- performance tests for common-sale flow and sync batches;
- observability and structured logs with PII redaction;
- pilot analytics for the metrics in Product Design §25;
- staging and production deployment configuration;
- seed/demo separation;
- pilot onboarding checklist for 5–10 colmados.

Exit gate:
- restore drill succeeds;
- cross-tenant test suite proves no data leakage;
- common-sale UX meets the approved speed target in pilot hardware testing;
- offline/reconnect scenario passes without lost operations;
- pilot dashboard captures activation, retention, sync, WhatsApp, AI, stock, and cash metrics.

---

## Repository target structure

```text
fiao/
├── apps/
│   └── web/
│       ├── app/
│       │   ├── (auth)/
│       │   ├── (app)/
│       │   ├── api/
│       │   │   ├── auth/
│       │   │   ├── sync/
│       │   │   ├── whatsapp/
│       │   │   ├── ai/
│       │   │   └── jobs/
│       │   └── sw.ts
│       ├── components/
│       ├── features/
│       ├── lib/
│       │   ├── offline/
│       │   ├── session/
│       │   └── api/
│       └── e2e/
├── packages/
│   ├── contracts/       # Zod schemas and API/domain command contracts
│   ├── domain/          # pure rules + command handlers/interfaces
│   ├── database/        # Prisma schema/client/repositories/migrations
│   ├── sync/            # operation envelope, reducers, conflict types
│   ├── whatsapp/        # Meta adapter; no domain rules
│   ├── ai/              # OpenAI adapter/tool registry; no direct DB writes
│   ├── reporting/       # metric calculations/export DTOs
│   └── testkit/         # factories, fixtures, fake clock, DB helpers
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── docs/
│   ├── superpowers/specs/
│   ├── superpowers/plans/
│   └── runbooks/
├── docker-compose.yml
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
└── vitest.workspace.ts
```

## Domain write rule

No route handler, React component, WhatsApp handler, or AI tool may write Prisma models directly. Writes must call a domain command service.

Canonical flow:

```text
channel input
  -> Zod command contract
  -> authenticated CommandContext
  -> domain handler
  -> permission + branch policy validation
  -> database transaction
       -> immutable movement(s)
       -> projection/current-state updates
       -> audit entry
       -> sync change row
  -> result DTO
```

Offline flow:

```text
local command
  -> local policy validation
  -> optimistic local reducer
  -> Dexie pendingOperations
  -> POST /api/sync/push
  -> idempotent server command
  -> accepted | accepted_with_conflict | rejected
  -> GET /api/sync/pull?cursor=N
  -> update local projections
  -> surface conflict if needed
```

## Data invariants

1. `operationId` is unique per owner and is the idempotency key for offline/network retry.
2. Money is integer centavos; never JavaScript floating-point pesos for persisted financial values.
3. Measured stock quantities use fixed-precision decimals.
4. Credit balance = sum of immutable credit movements for branch/customer, with a maintained projection for speed.
5. Stock on hand = sum of stock movements, with a maintained projection for speed.
6. Expected physical cash = opening float + qualifying cash movements, with a maintained projection for speed.
7. Returns/annulments link to the original record and create inverse movements.
8. Delivered order finalization is idempotent.
9. Owner authorization is an explicit audited record; knowledge of a PIN never gets stored in audit payloads.
10. Every business query is scoped by owner, and branch when the data is branch-specific.

## Testing strategy

- **Pure domain tests:** Vitest; no DB/network.
- **Repository/integration tests:** ephemeral PostgreSQL 18 test database.
- **Sync tests:** fake two-device Dexie stores + API integration; duplicate/reorder/conflict cases.
- **Component tests:** React Testing Library/Vitest where logic warrants it.
- **E2E:** Playwright Chromium with Android-sized viewport; critical counter journeys.
- **Contract tests:** WhatsApp webhook fixtures and AI tool-schema fixtures.
- **Security tests:** role/branch/owner matrix, protected-action authorization, idempotency, mass-assignment checks.
- **Performance:** measure product tap → payment confirm journey, API p95, sync batch duration.

## Sequence / dependency graph

```text
Plan 1 Foundation/Sync/Auth
        |
        v
Plan 2 Core Commerce
      /   \
     v     v
Plan 3   Plan 5
Orders   Reports/Onboarding
     \     /
      v   v
      Plan 4 AI
         |
         v
Plan 6 Hardening/Pilot
```

AI comes after domain commands exist. Reports can begin after core ledgers exist. WhatsApp can progress in parallel with reporting once the sales/order primitives are stable.

## Release slices

### Internal Alpha A — Foundation
Login, branch selector, PWA install/offline shell, sync inspector.

### Internal Alpha B — Counter Core
Products, sales, mixed payments, customers, fiado, abonos, inventory, cash.

### Internal Alpha C — Remote Orders
WhatsApp sandbox, order reservations, delivery states, loyalty/promotions.

### Internal Alpha D — Intelligence
FIAO AI read queries/actions, voice, reports, summaries, insights.

### Pilot RC
Onboarding, exports, demo, security hardening, monitoring, pilot metrics, recovery runbooks.

## Completion definition for MVP V1

MVP V1 is not “done” when all screens exist. It is done when the pilot success criteria in the approved product spec are demonstrated with real operational data and no unresolved P0/P1 security or data-integrity defects.
