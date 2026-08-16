# FIAO Foundation, Identity, Audit, and Offline Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build FIAO's production-grade foundation: monorepo, PWA shell, Owner/Cashier authentication, owner/branch isolation, immutable operation/audit envelope, Dexie offline queue, idempotent push/pull synchronization, and conflict surfacing.

**Architecture:** A Next.js 16 PWA is the only app in the first phase. Shared TypeScript packages keep contracts, domain rules, database access, and sync mechanics isolated. PostgreSQL 18 is durable truth; Prisma 7 manages schema/migrations. Offline writes are commands with globally unique `operationId`s stored in Dexie; the server processes each command exactly once and publishes ordered branch changes for client pull.

**Tech Stack:** Node.js 24 LTS, pnpm workspaces, Next.js 16.2.11+ / React 19.2, TypeScript 5.x, PostgreSQL 18.x, Prisma ORM 7.x, Dexie 4.x, Serwist, Zod, Argon2id, Vitest, Playwright.

## Global Constraints

- Mobile-first Android/web app; responsive later.
- Formal roles are exactly `OWNER` and `CASHIER`.
- Login uses E.164-normalized phone + 4–6 digit PIN.
- Protected actions use owner PIN re-entry; this phase establishes the authorization primitive but does not implement every protected business action.
- Money representation helper uses integer centavos (`bigint`).
- Server timestamps are UTC; branch timezone defaults to `America/Santo_Domingo`.
- Financial/stock/credit history will be immutable; this phase establishes generic operation/audit infrastructure.
- Cloud is durable truth; Dexie is an operational replica and pending-operation queue.
- Duplicate network retries must never duplicate accepted operations.
- Offline conflicts preserve legitimate operations and produce explicit conflict records.
- UI/API/domain layers never trust a client-supplied owner/role without verifying session membership.

---

## Target file map for this plan

```text
apps/web/
├── app/
│   ├── (auth)/login/page.tsx
│   ├── (app)/layout.tsx
│   ├── (app)/page.tsx
│   ├── api/auth/login/route.ts
│   ├── api/auth/logout/route.ts
│   ├── api/auth/authorize-owner/route.ts
│   ├── api/sync/push/route.ts
│   ├── api/sync/pull/route.ts
│   ├── manifest.ts
│   └── sw.ts
├── components/app-shell.tsx
├── components/branch-switcher.tsx
├── components/sync-status.tsx
├── features/auth/login-form.tsx
├── features/sync/sync-provider.tsx
├── lib/api/client.ts
├── lib/offline/db.ts
├── lib/offline/queue.ts
├── lib/offline/sync-client.ts
├── lib/session/current-session.ts
└── e2e/auth-and-offline.spec.ts

packages/contracts/src/
├── auth.ts
├── common.ts
└── sync.ts

packages/domain/src/
├── auth/pin-policy.ts
├── auth/permissions.ts
├── auth/authorize-owner.ts
├── context.ts
└── index.ts

packages/database/src/
├── client.ts
├── repositories/auth-repository.ts
├── repositories/sync-repository.ts
└── transactions/process-operation.ts

packages/sync/src/
├── operation.ts
├── conflict.ts
├── local-reducer.ts
└── index.ts

packages/testkit/src/
├── factories.ts
├── db.ts
└── fake-clock.ts

prisma/schema.prisma
prisma/seed.ts
vitest.workspace.ts
playwright.config.ts
docker-compose.yml
pnpm-workspace.yaml
package.json
tsconfig.base.json
```

### Task 1: Bootstrap the monorepo and test harness

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.workspace.ts`
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `apps/web/*` via Next.js scaffold, then normalize config
- Create: `packages/contracts/package.json`
- Create: `packages/domain/package.json`
- Create: `packages/database/package.json`
- Create: `packages/sync/package.json`
- Create: `packages/testkit/package.json`
- Create: `playwright.config.ts`
- Test: `packages/domain/src/smoke.test.ts`

**Interfaces:**
- Produces workspace packages `@fiao/contracts`, `@fiao/domain`, `@fiao/database`, `@fiao/sync`, `@fiao/testkit`.
- Produces scripts `dev`, `build`, `typecheck`, `lint`, `test`, `test:integration`, `test:e2e` at repository root.

- [ ] **Step 1: Write the first failing workspace test**

```ts
// packages/domain/src/smoke.test.ts
import { describe, expect, it } from "vitest";
import { FIAO_DOMAIN_VERSION } from "./index";

describe("domain package", () => {
  it("exports a version marker", () => {
    expect(FIAO_DOMAIN_VERSION).toBe("v1");
  });
});
```

- [ ] **Step 2: Run the test before implementation**

Run: `pnpm vitest run packages/domain/src/smoke.test.ts`
Expected: FAIL because workspace/package/module does not exist yet.

- [ ] **Step 3: Scaffold workspace and minimal package exports**

Root `package.json` must contain at least:

```json
{
  "name": "fiao",
  "private": true,
  "packageManager": "pnpm@10",
  "engines": { "node": ">=24 <25" },
  "scripts": {
    "dev": "pnpm --filter @fiao/web dev",
    "build": "pnpm --filter @fiao/web build",
    "typecheck": "pnpm -r --if-present typecheck",
    "lint": "pnpm --filter @fiao/web lint",
    "test": "vitest run",
    "test:integration": "vitest run --project integration",
    "test:e2e": "playwright test"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - apps/*
  - packages/*
```

Create each `packages/*/package.json` before running filtered installs. Example for `packages/domain/package.json`:

```json
{
  "name": "@fiao/domain",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit" }
}
```

Use the same shape with names `@fiao/contracts`, `@fiao/database`, `@fiao/sync`, and `@fiao/testkit`, changing the export entry if needed. Each package gets a `tsconfig.json` extending `../../tsconfig.base.json`. Normalize `apps/web/package.json` after scaffolding so its name is `@fiao/web`.

`packages/domain/src/index.ts`:

```ts
export const FIAO_DOMAIN_VERSION = "v1" as const;
```

Run these bootstrap/install commands from the repository root after the workspace/package manifests exist:

```bash
pnpm dlx create-next-app@16.2.11 apps/web --ts --tailwind --eslint --app --use-pnpm --import-alias "@/*"
pnpm add -Dw typescript vitest @vitest/coverage-v8 @playwright/test prisma@7 tsx dotenv @types/node
pnpm --dir apps/web add next@16.2.11 react@19.2 react-dom@19.2 dexie@4 @serwist/next serwist zod argon2
pnpm --dir apps/web add -D fake-indexeddb @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom
pnpm --filter @fiao/database add @prisma/client@7 @prisma/adapter-pg pg
pnpm --filter @fiao/database add -D @types/pg
pnpm --filter @fiao/contracts add zod
```

If a newer patched Next.js 16.x security release exists at execution time, use that patched 16.x version consistently instead of `16.2.11` and record the exact version in the lockfile. Keep React on the version required by that Next.js release.

Create `.env.example` with no secrets:

```dotenv
DATABASE_URL=postgresql://fiao:fiao_dev@localhost:5432/fiao_dev
SESSION_COOKIE_NAME=fiao_session
APP_ORIGIN=http://localhost:3000
```

- [ ] **Step 4: Add PostgreSQL development service**

`docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:18
    environment:
      POSTGRES_USER: fiao
      POSTGRES_PASSWORD: fiao_dev
      POSTGRES_DB: fiao_dev
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U fiao -d fiao_dev"]
      interval: 2s
      timeout: 2s
      retries: 20
    volumes:
      - fiao_pg:/var/lib/postgresql/data

volumes:
  fiao_pg:
```

- [ ] **Step 5: Run all base checks**

Run:

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm --filter @fiao/web build
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json vitest.workspace.ts docker-compose.yml playwright.config.ts apps packages
git commit -m "chore: bootstrap FIAO monorepo"
```

### Task 2: Define common contracts, money, IDs, and command context

**Files:**
- Create: `packages/contracts/src/common.ts`
- Create: `packages/contracts/src/auth.ts`
- Create: `packages/domain/src/context.ts`
- Create: `packages/domain/src/auth/pin-policy.ts`
- Test: `packages/domain/src/auth/pin-policy.test.ts`
- Test: `packages/contracts/src/common.test.ts`

**Interfaces:**
- Produces `MoneyCents = bigint` helper functions `pesosToCents(string): bigint` and `centsToPesos(bigint): string`.
- Produces `Role = "OWNER" | "CASHIER"`.
- Produces `CommandContext { ownerId; branchId; userId; role; deviceId; now }`.
- Produces `normalizePhoneDO(raw): string` returning E.164-like `+1...` representation for Dominican numbers.
- Produces `validatePin(pin): boolean` for exactly 4–6 numeric digits.

- [ ] **Step 1: Write failing money and PIN tests**

```ts
import { describe, expect, it } from "vitest";
import { centsToPesos, pesosToCents } from "@fiao/contracts/common";
import { validatePin } from "./pin-policy";

describe("money", () => {
  it("converts pesos without floating point", () => {
    expect(pesosToCents("530.50")).toBe(53050n);
    expect(centsToPesos(53050n)).toBe("530.50");
  });
});

describe("PIN policy", () => {
  it.each(["1234", "12345", "123456"])("accepts %s", (pin) => {
    expect(validatePin(pin)).toBe(true);
  });
  it.each(["123", "1234567", "12a4", ""])("rejects %s", (pin) => {
    expect(validatePin(pin)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm vitest run packages/contracts/src/common.test.ts packages/domain/src/auth/pin-policy.test.ts`
Expected: FAIL due missing modules/functions.

- [ ] **Step 3: Implement exact helpers**

Use string parsing for pesos; reject more than two fractional digits rather than calling `Number(value) * 100`.

```ts
export type MoneyCents = bigint;

export function pesosToCents(input: string): MoneyCents {
  if (!/^\d+(\.\d{1,2})?$/.test(input)) throw new Error("INVALID_MONEY");
  const [whole, fraction = ""] = input.split(".");
  return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
}

export function centsToPesos(value: MoneyCents): string {
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}
```

`CommandContext.now` is a `Date` injected by the caller so domain tests can use a fake clock.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run packages/contracts/src/common.test.ts packages/domain/src/auth/pin-policy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts packages/domain/src/context.ts packages/domain/src/auth
git commit -m "feat: add FIAO common domain contracts"
```

### Task 3: Create tenant, branch, user, device, session, and authorization schema

**Files:**
- Create: `prisma/schema.prisma`
- Create: `packages/database/src/client.ts`
- Create: `packages/database/src/repositories/auth-repository.ts`
- Create: `packages/testkit/src/db.ts`
- Create: `packages/testkit/src/factories.ts`
- Test: `packages/database/src/repositories/auth-repository.integration.test.ts`

**Interfaces:**
- Produces Prisma models `OwnerAccount`, `Branch`, `User`, `UserBranch`, `Device`, `Session`, `OwnerAuthorization`, `AuditEvent`, `ClientOperation`, `SyncChange`, `SyncConflict`.
- `AuthRepository.findActiveUserByPhone(phone)` returns user + owner memberships needed for login.
- `AuthRepository.createSession(input)` returns opaque session ID and expiry.
- `AuthRepository.verifyBranchAccess(userId, branchId)` returns role/owner scope or throws `FORBIDDEN`.

- [ ] **Step 1: Write failing repository integration test**

```ts
it("prevents a cashier from accessing a branch outside the assignment", async () => {
  const { owner, branchA, branchB, cashier } = await factory.ownerWithTwoBranchesAndCashier();
  await factory.assignUserToBranch(cashier.id, branchA.id);

  await expect(repo.verifyBranchAccess(cashier.id, branchB.id)).rejects.toThrow("FORBIDDEN");
  await expect(repo.verifyBranchAccess(cashier.id, branchA.id)).resolves.toMatchObject({
    ownerId: owner.id,
    branchId: branchA.id,
    role: "CASHIER",
  });
});
```

- [ ] **Step 2: Start PostgreSQL and verify the test fails before schema exists**

Run:

```bash
docker compose up -d postgres
pnpm prisma migrate dev --name init_identity
pnpm test:integration -- packages/database/src/repositories/auth-repository.integration.test.ts
```

Expected: migration/test setup initially FAIL until models/repository are implemented.

- [ ] **Step 3: Implement schema constraints**

Required schema rules:
- IDs are UUID strings generated server-side/client-side where needed.
- `User.phoneE164` is unique per platform user.
- `User.pinHash` stores Argon2id hash only.
- `User.role` enum only `OWNER | CASHIER`.
- `UserBranch(userId, branchId)` unique pair.
- `Session.tokenHash` stores SHA-256 hash of opaque cookie token; raw token never persisted.
- `Session.revokedAt` nullable.
- `OwnerAuthorization` stores authorizer user, branch, operation kind, target operation ID, issued/expires timestamps; never stores PIN.
- `AuditEvent` is append-only by application policy.
- `ClientOperation(ownerId, operationId)` has unique composite constraint.
- `SyncChange` has auto-incrementing `seq BigInt` and owner/branch scope.
- `SyncConflict` links to `ClientOperation` and has status `OPEN | RESOLVED`.

- [ ] **Step 4: Implement repository and factories**

Use Prisma transactions for user/branch setup. Normalize all repository methods to require explicit owner/branch scope; do not expose a generic `prisma` client to React components or route handlers.

- [ ] **Step 5: Run integration test and migration check**

Run:

```bash
pnpm prisma migrate dev
pnpm test:integration -- packages/database/src/repositories/auth-repository.integration.test.ts
pnpm prisma validate
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add prisma packages/database packages/testkit
git commit -m "feat: add identity and sync persistence schema"
```

### Task 4: Implement phone + PIN authentication and secure sessions

**Files:**
- Create: `packages/domain/src/auth/permissions.ts`
- Create: `packages/domain/src/auth/authorize-owner.ts`
- Create: `apps/web/lib/session/current-session.ts`
- Create: `apps/web/app/api/auth/login/route.ts`
- Create: `apps/web/app/api/auth/logout/route.ts`
- Create: `apps/web/app/api/auth/authorize-owner/route.ts`
- Create: `apps/web/features/auth/login-form.tsx`
- Create: `apps/web/app/(auth)/login/page.tsx`
- Test: `apps/web/app/api/auth/login/route.test.ts`
- Test: `packages/domain/src/auth/permissions.test.ts`

**Interfaces:**
- `POST /api/auth/login { phone, pin, deviceLabel } -> { user, branches, activeBranchId }` plus HttpOnly session cookie.
- `POST /api/auth/logout -> 204` revokes current session.
- `POST /api/auth/authorize-owner { pin, purpose, targetOperationId } -> { authorizationId, expiresAt }`.
- `requireSession()` returns `{ sessionId, userId, ownerId, role, deviceId }`.
- `requireBranchContext(branchId)` verifies assignment and returns `CommandContext` basis.

- [ ] **Step 1: Write failing login tests**

```ts
it("rejects an incorrect PIN without revealing whether the phone exists", async () => {
  const response = await POST(request({ phone: "+18095550123", pin: "9999" }));
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "INVALID_CREDENTIALS" });
});

it("creates a session for a valid active user", async () => {
  // seed user with Argon2id PIN hash for 1234
  const response = await POST(request({ phone: "+18095550123", pin: "1234" }));
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toContain("fiao_session=");
});
```

- [ ] **Step 2: Run and confirm failures**

Run: `pnpm vitest run apps/web/app/api/auth/login/route.test.ts packages/domain/src/auth/permissions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement PIN hashing/session behavior**

- Use Argon2id for PIN verification.
- Add generic failed-login throttling storage fields or a dedicated `LoginAttempt` model if needed; in this phase implement a deterministic backoff after repeated failures, with detailed hardening expanded in Plan 6.
- Generate 32 random bytes for session cookie, store only SHA-256 hash.
- Cookie flags: `HttpOnly`, `Secure` in production, `SameSite=Lax`, `Path=/`.
- Expired/revoked sessions fail closed.
- Re-entry owner PIN creates a short-lived `OwnerAuthorization` scoped to purpose + target operation; default expiry 5 minutes.

- [ ] **Step 4: Implement permissions**

```ts
export type Permission =
  | "APP_READ"
  | "SYNC_PUSH"
  | "SYNC_PULL"
  | "OWNER_PROTECTED";

export function can(role: Role, permission: Permission): boolean {
  if (permission === "OWNER_PROTECTED") return role === "OWNER";
  return role === "OWNER" || role === "CASHIER";
}
```

Keep the permission API extensible because Plan 2 will add business permissions.

- [ ] **Step 5: Run tests**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/auth apps/web/app/\(auth\) apps/web/features/auth apps/web/lib/session packages/domain/src/auth
git commit -m "feat: add phone pin authentication"
```

### Task 5: Define the offline operation envelope and server processor

**Files:**
- Create: `packages/contracts/src/sync.ts`
- Create: `packages/sync/src/operation.ts`
- Create: `packages/sync/src/conflict.ts`
- Create: `packages/database/src/transactions/process-operation.ts`
- Create: `packages/database/src/repositories/sync-repository.ts`
- Test: `packages/database/src/transactions/process-operation.integration.test.ts`

**Interfaces:**

```ts
export type OperationStatus = "ACCEPTED" | "ACCEPTED_WITH_CONFLICT" | "REJECTED";

export interface ClientOperationEnvelope<TType extends string = string, TPayload = unknown> {
  operationId: string;
  type: TType;
  ownerId: string;
  branchId: string;
  actorUserId: string;
  deviceId: string;
  occurredAt: string;
  baseCursor: string | null;
  payload: TPayload;
}

export interface OperationResult {
  operationId: string;
  status: OperationStatus;
  conflictId?: string;
  errorCode?: string;
  latestCursor: string;
}
```

`processOperation(sessionContext, envelope)` never trusts envelope owner/user values; it compares them to session/branch access and persists the authenticated actor values.

- [ ] **Step 1: Write failing idempotency test**

```ts
it("accepts the same operation only once", async () => {
  const op = fixture.noopOperation({ operationId: crypto.randomUUID() });

  const first = await processOperation(ctx, op);
  const second = await processOperation(ctx, op);

  expect(first.status).toBe("ACCEPTED");
  expect(second.status).toBe("ACCEPTED");
  expect(await db.clientOperation.count({ where: { operationId: op.operationId } })).toBe(1);
});
```

- [ ] **Step 2: Write failing cross-tenant spoof test**

```ts
it("rejects an envelope that spoofs another owner", async () => {
  const op = fixture.noopOperation({ ownerId: otherOwner.id });
  await expect(processOperation(ctx, op)).rejects.toThrow("FORBIDDEN_OWNER_SCOPE");
});
```

- [ ] **Step 3: Run tests and confirm failure**

Run: `pnpm test:integration -- packages/database/src/transactions/process-operation.integration.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement transaction algorithm**

Within one Prisma transaction:
1. derive authenticated owner/branch/user from `CommandContext`;
2. lookup `ClientOperation(ownerId, operationId)`; return stored result if present;
3. validate operation type through a registry (`NOOP` only in this task);
4. insert `ClientOperation`;
5. append `AuditEvent` with source `OFFLINE_SYNC | UI | API`;
6. append `SyncChange` containing minimal change payload;
7. persist result/cursor on operation;
8. commit.

Do not add full sales/credit handlers yet; Plan 2 will register them.

- [ ] **Step 5: Run tests**

Run: `pnpm test:integration -- packages/database/src/transactions/process-operation.integration.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/sync.ts packages/sync packages/database/src/transactions packages/database/src/repositories/sync-repository.ts
git commit -m "feat: add idempotent operation processor"
```

### Task 6: Implement push/pull synchronization API

**Files:**
- Create: `apps/web/app/api/sync/push/route.ts`
- Create: `apps/web/app/api/sync/pull/route.ts`
- Create: `apps/web/lib/api/client.ts`
- Test: `apps/web/app/api/sync/sync-api.integration.test.ts`

**Interfaces:**
- `POST /api/sync/push { branchId, operations: ClientOperationEnvelope[] } -> { results, cursor }`.
- Batch limit: 100 operations per request in V1 foundation.
- `GET /api/sync/pull?branchId=<id>&after=<cursor>&limit=500 -> { changes, nextCursor, hasMore }`.
- Pull only returns authenticated owner's assigned branch data.

- [ ] **Step 1: Write failing push/pull test**

```ts
it("pushes an operation then pulls its change exactly once", async () => {
  const push = await authedPost("/api/sync/push", {
    branchId,
    operations: [fixture.noopOperation({ branchId })],
  });
  expect(push.status).toBe(200);

  const firstPull = await authedGet(`/api/sync/pull?branchId=${branchId}&after=0`);
  expect(firstPull.body.changes).toHaveLength(1);

  const secondPull = await authedGet(
    `/api/sync/pull?branchId=${branchId}&after=${firstPull.body.nextCursor}`,
  );
  expect(secondPull.body.changes).toHaveLength(0);
});
```

- [ ] **Step 2: Verify failure**

Run: `pnpm test:integration -- apps/web/app/api/sync/sync-api.integration.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement schemas and routes**

Use Zod to reject:
- >100 operations;
- malformed UUID IDs;
- branch not assigned to user;
- unknown operation type;
- invalid cursor/limit.

The route must continue processing a batch when one operation is a business-level rejection; each operation gets its own result. Authentication/scope failure rejects the whole request.

- [ ] **Step 4: Add idempotent retry assertion**

Push the exact same batch twice and assert only one `ClientOperation` and one corresponding `SyncChange` exist per operation.

- [ ] **Step 5: Run tests**

Run: `pnpm test:integration -- apps/web/app/api/sync/sync-api.integration.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/sync apps/web/lib/api packages/contracts
git commit -m "feat: add push pull sync API"
```

### Task 7: Build Dexie local replica and pending-operation queue

**Files:**
- Create: `apps/web/lib/offline/db.ts`
- Create: `apps/web/lib/offline/queue.ts`
- Create: `packages/sync/src/local-reducer.ts`
- Test: `apps/web/lib/offline/queue.test.ts`
- Test: `packages/sync/src/local-reducer.test.ts`

**Interfaces:**
- Dexie tables: `pendingOperations`, `syncMeta`, `syncConflicts`, `branches`, `users`, plus generic `projectionRows` for foundation smoke data.
- `enqueueOperation(input): Promise<ClientOperationEnvelope>` assigns `crypto.randomUUID()` and current branch/device/actor context.
- `markOperationResult(result)` removes accepted operation, retains rejected record in conflict/error store where user action is needed.
- `applySyncChanges(changes)` is transactional in Dexie.

- [ ] **Step 1: Write failing queue test**

```ts
it("keeps an operation pending until server acceptance", async () => {
  const op = await enqueueOperation(fixture.noopLocalCommand());
  expect(await db.pendingOperations.get(op.operationId)).toBeTruthy();

  await markOperationResult({
    operationId: op.operationId,
    status: "ACCEPTED",
    latestCursor: "10",
  });

  expect(await db.pendingOperations.get(op.operationId)).toBeUndefined();
});
```

Use `fake-indexeddb` in Vitest for browser DB tests.

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm vitest run apps/web/lib/offline/queue.test.ts packages/sync/src/local-reducer.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement Dexie schema**

`syncMeta` key must include branch and store `cursor`, `lastSyncAt`, `lastError`.

Never store raw PIN or session cookie in Dexie/localStorage.

- [ ] **Step 4: Implement transactional change application**

If a pull response contains several changes, apply all and cursor update in one Dexie transaction. If reducer throws, leave old cursor untouched so the batch is retried.

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run apps/web/lib/offline/queue.test.ts packages/sync/src/local-reducer.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/offline packages/sync/src/local-reducer.ts
git commit -m "feat: add offline operation queue"
```

### Task 8: Implement synchronization client and explicit conflict handling

**Files:**
- Create: `apps/web/lib/offline/sync-client.ts`
- Create: `apps/web/features/sync/sync-provider.tsx`
- Create: `apps/web/components/sync-status.tsx`
- Create: `packages/sync/src/conflict.ts`
- Test: `apps/web/lib/offline/sync-client.test.ts`
- Test: `apps/web/features/sync/sync-provider.test.tsx`

**Interfaces:**
- `syncNow(branchId): Promise<SyncSummary>` pushes up to 100 pending ops, pulls until `hasMore=false`, then returns counts.
- `SyncSummary { pushed; accepted; conflicts; rejected; pulled; cursor }`.
- UI status: `SYNCED | PENDING | ERROR | CONFLICT`.
- `SyncConflictKind` starts with `GENERIC_REVIEW`; Plan 2 extends with `NEGATIVE_STOCK`, `CREDIT_LIMIT`, `CASH_RECONCILIATION`.

- [ ] **Step 1: Write failing retry test**

```ts
it("does not drop pending operations when network fails", async () => {
  server.use(pushEndpoint.networkError());
  const op = await enqueueOperation(fixture.noopLocalCommand());

  await expect(syncNow(branchId)).rejects.toThrow();
  expect(await db.pendingOperations.get(op.operationId)).toBeTruthy();
});
```

- [ ] **Step 2: Write failing conflict preservation test**

Mock a server result `ACCEPTED_WITH_CONFLICT` and assert:
- pending op is removed (server accepted it);
- conflict is stored locally;
- sync status becomes `CONFLICT`.

- [ ] **Step 3: Implement push → pull loop**

Rules:
- never mark pending as accepted before server response;
- use exponential retry only for transient network/server errors, max one automatic retry per user-triggered sync in this phase;
- rejected operations remain visible with error code;
- `online` event triggers a debounced sync, but manual sync remains available.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run apps/web/lib/offline/sync-client.test.ts apps/web/features/sync/sync-provider.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/offline/sync-client.ts apps/web/features/sync apps/web/components/sync-status.tsx packages/sync/src/conflict.ts
git commit -m "feat: synchronize offline operations safely"
```

### Task 9: Add PWA shell, service worker, branch context, and offline UX

**Files:**
- Create: `apps/web/app/manifest.ts`
- Create: `apps/web/app/sw.ts`
- Create/Modify: `apps/web/next.config.ts`
- Create: `apps/web/components/app-shell.tsx`
- Create: `apps/web/components/branch-switcher.tsx`
- Create: `apps/web/app/(app)/layout.tsx`
- Create: `apps/web/app/(app)/page.tsx`
- Test: `apps/web/components/branch-switcher.test.tsx`
- E2E: `apps/web/e2e/auth-and-offline.spec.ts`

**Interfaces:**
- Installed PWA name `FIAO` (branding string isolated in app metadata/config).
- App shell shows active branch and sync status on every protected page.
- Branch switch changes local data namespace/context before allowing writes.

- [x] **Step 1: Write failing branch switch component test**

```tsx
it("shows the active branch and changes context only after selection", async () => {
  render(<BranchSwitcher branches={branches} activeBranchId="los-mina" />);
  expect(screen.getByText("Los Mina")).toBeVisible();
  await user.click(screen.getByRole("button", { name: /Los Mina/ }));
  await user.click(screen.getByText("Invivienda"));
  expect(mockSetBranch).toHaveBeenCalledWith("invivienda");
});
```

- [x] **Step 2: Configure Serwist**

Use `@serwist/next` with an explicit `app/sw.ts`, app manifest, offline fallback, and runtime caching for static/app-shell assets. Do **not** cache authenticated API mutation responses as a substitute for Dexie sync.

- [x] **Step 3: Implement app shell**

Initial Home is intentionally a foundation screen, not the final dashboard:
- current user/role;
- active branch;
- network state;
- pending operation count;
- sync button;
- conflict count;
- placeholder cards for Plan 2 modules.

- [x] **Step 4: Write E2E offline shell test**

Playwright flow:
1. login online;
2. load app shell;
3. set browser context offline;
4. navigate within cached app shell;
5. confirm `Sin conexión` status and branch name still render;
6. return online and confirm sync status recovers.

- [x] **Step 5: Run E2E in Chromium mobile viewport**

> Estado: spec E2E escrito y build de producción validado; la ejecución de Playwright requiere PostgreSQL 18 + seed (ver `docs/runbooks/local-development.md`).

Run: `pnpm test:e2e -- apps/web/e2e/auth-and-offline.spec.ts`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add apps/web/app apps/web/components apps/web/next.config.ts apps/web/e2e
git commit -m "feat: add FIAO mobile PWA shell"
```

> Ejecutado el 2026-08-16 como `feat: add FIAO mobile PWA shell (Task 9)` junto con docs y seed.

### Task 10: Seed a Demo foundation tenant and add end-to-end foundation verification

**Files:**
- Create: `prisma/seed.ts`
- Create: `apps/web/e2e/foundation-flow.spec.ts`
- Create: `docs/runbooks/local-development.md`
- Modify: `package.json`

**Interfaces:**
- Seed creates deterministic fixture owner, two branches, one owner user, one cashier assigned to one branch, and registered demo devices.
- No real phone numbers or credentials appear in production seed path.

- [ ] **Step 1: Write E2E acceptance flow**

```ts
test("foundation flow: login, scope, offline queue, reconnect", async ({ page, context }) => {
  await loginAsSeedCashier(page);
  await expect(page.getByText("Los Mina")).toBeVisible();
  await expect(page.getByText("Invivienda")).not.toBeVisible();

  await context.setOffline(true);
  await createNoopDebugOperation(page);
  await expect(page.getByText(/1 movimiento pendiente/)).toBeVisible();

  await context.setOffline(false);
  await page.getByRole("button", { name: /Sincronizar/ }).click();
  await expect(page.getByText(/Todo sincronizado/)).toBeVisible();
});
```

The debug/noop operation UI exists only in development/test builds and must be excluded from production navigation.

- [ ] **Step 2: Implement deterministic seed**

Seed PINs only from environment variables or development defaults guarded by `NODE_ENV !== "production"`.

- [ ] **Step 3: Document local start sequence**

`docs/runbooks/local-development.md` must include exact commands:

```bash
corepack enable || true
pnpm install
docker compose up -d postgres
cp .env.example .env
pnpm prisma migrate dev
pnpm prisma db seed
pnpm dev
```

Also document test commands and how to clear local Dexie data for development.

- [ ] **Step 4: Run full verification**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm --filter @fiao/web build
pnpm test:e2e
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add prisma/seed.ts apps/web/e2e/foundation-flow.spec.ts docs/runbooks/local-development.md package.json
git commit -m "test: verify FIAO foundation flow"
```

## Plan 1 completion checklist

- [ ] Next.js mobile PWA installs/loads and has a working offline shell.
- [ ] Owner/Cashier phone + PIN login works with secure server session.
- [ ] Cashier cannot access an unassigned branch.
- [ ] Owner PIN re-entry produces scoped, expiring authorization record.
- [ ] Duplicate operation retry is idempotent.
- [ ] Push/pull sync maintains branch cursor and applies changes transactionally.
- [ ] Dexie retains operations during network failures.
- [ ] Accepted conflicts are surfaced rather than silently discarded.
- [ ] No raw PIN/session token is persisted in IndexedDB or audit rows.
- [ ] Full lint/type/unit/integration/build/E2E verification passes.

## Self-review notes

- Spec coverage for this plan: Design §§2–4, 16–17, 18.1, 19, 21, and the identity/sync foundation of §20.
- Deliberately deferred: sales, fiado, customer score, inventory, cash business ledgers, WhatsApp, AI, reports, final settings. Those depend on this foundation and are assigned to Plans 2–5 in the master roadmap.
- Protected actions while offline are not generally enabled in Plan 1; the approved spec requires offline continuity for core safe operations, not offline bypass of protected authorization. Plan 2 will classify which business commands are safe to queue offline.
