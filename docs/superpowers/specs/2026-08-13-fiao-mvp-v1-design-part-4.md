Example: an offline payment and an offline new fiado against the same customer both survive synchronization; the final balance is derived from both movements.

### 17.3 Sync status

UI clearly shows:
- all synchronized;
- N pending movements;
- synchronization error requiring attention.

## 18. High-level system architecture

This design implies the following bounded components. Implementation technology is intentionally not fixed in this product spec.

1. **Identity & Authorization** — users, roles, PIN verification, device sessions, protected-action authorization.
2. **Tenant/Branch Core** — owner accounts, branches, branch context, plan limits.
3. **Catalog & Inventory** — products, presentations, stock ledger, reservations, moving average costs, suppliers.
4. **Sales & Payments** — carts, sales, mixed payment allocation, receipts, returns/annulments.
5. **Credit & Collections** — fiado ledger, promised dates, branch limits, abonos, collection automation.
6. **Customer & Loyalty** — customer identity, purchase history, points/rewards, FIAO Score calculation.
7. **Cash Ledger** — openings, closings, expenses, withdrawals, cash injections, expected-vs-counted cash.
8. **Orders & Delivery** — order lifecycle, reservations, assignment labels, status timeline.
9. **WhatsApp Gateway** — inbound order messages, outbound receipts/status/collections/points, exception routing.
10. **FIAO AI Orchestrator** — intent extraction, read queries, action proposals, permission checks, confirmation requirements, tool execution, audit record.
11. **Reporting & Insights** — derived metrics, comparisons, summaries, exports.
12. **Sync Engine** — local event queue, idempotent cloud ingestion, conflict detection, reconciliation status.
13. **Audit Ledger** — append-only/security-relevant record linking actor, action, source, original movement, correction/reversal, authorization.

### 18.1 Data-flow rule

All channels (normal UI, WhatsApp, FIAO AI) must call the same domain services/business rules. No channel may bypass permissions, credit limits, stock rules, or audit requirements.

Example AI flow:

`voice/text -> intent -> entity resolution -> permission check -> business-rule validation -> action preview -> user confirmation -> owner PIN if needed -> domain service -> audit event -> derived balances/reports`

## 19. Error handling and recovery

- **Ambiguous customer/product:** present candidates; do not guess.
- **Insufficient stock:** block direct sale quantity, offer quantity reduction or approved substitution where applicable.
- **Fiado over limit:** block until owner PIN approval.
- **Sync conflict:** preserve events, recompute derived state, flag discrepancy; do not silently discard.
- **WhatsApp unavailable:** mark integration degraded; storefront sales continue.
- **AI unavailable:** normal UI flows remain usable.
- **Duplicate submission/retry:** server ingestion must be idempotent so network retries do not duplicate financial movements.
- **Invalid historical correction:** require reversal/correction workflow rather than direct mutation.
- **Open cash from previous day:** warn and allow controlled resolution; do not hard-block all operations.
- **Incomplete product setup:** quick-create product may be sold while nonessential metadata is completed later, subject to clearly marked defaults.

## 20. Onboarding and configuration

### 20.1 Progressive onboarding

Initial flow should require only:
- business name/contact/address;
- first branch;
- accepted payment methods;
- basic fiado usage choice;
- initial products or "add while selling";
- first sale/customer/credit/cash cycle.

Inventory can be added manually, imported from CSV/XLSX, or progressively created during sales.

### 20.2 Activation milestone

A colmado is considered activated after it:
1. creates a branch;
2. adds at least 10 products;
3. records a sale;
4. creates a customer;
5. records a fiado or collection;
6. opens and closes cash.

Connecting WhatsApp is an advanced activation milestone.

### 20.3 Configuration areas

Owner can configure:
- branch data;
- payment methods;
- default fiado limit and overdue threshold;
- collection reminder rules and send hours;
- cash rules and cashier expense ceiling;
- discount ceiling;
- loyalty earning/expiration/rewards;
- promotions;
- supplier directory;
- categories;
- owner alerts and daily/weekly summary schedule;
- users, devices, and branch assignments;
- WhatsApp connection and approved message templates.

FIAO Score weights are platform-controlled in V1; owners cannot modify the scoring formula.

## 21. Data ownership and security behavior

- The business can export essential data.
- Cloud is the durable source of truth; local offline storage is a temporary operational replica/event queue.
- Sensitive history is immutable at the record level and corrected by linked reversing/adjusting events.
- Permissions are enforced server/domain-side, not merely hidden in the UI.
- Device revocation and secure owner PIN recovery are required.

## 22. Demo mode

A separate FIAO Demo tenant with fictitious data should allow commercial staff to demonstrate sales, credit, collections, inventory, cash, orders, reporting, and FIAO AI without touching a real business.

## 23. Explicitly out of scope for MVP V1

- full accounting / general ledger;
- payroll;
- advanced accounts payable;
- automated bank reconciliation;
- full DGII/e-CF production integration;
- inventory transfers between branches;
- advanced consolidated procurement;
- Mercao marketplace integration;
- GPS delivery tracking and route optimization;
- consumer FIAO app;
- shared score/blacklist across independent owners;
- autonomous AI purchasing;
- unrestricted mass marketing campaigns;
- fully customizable permission builder;
- complex financial forecasting / enterprise BI;
- FIFO/LIFO accounting inventory valuation.

## 24. MVP success criteria

The first pilot should prove that FIAO can:
1. complete common cash sales without slowing the counter;
2. replace a paper fiado ledger for daily use;
3. make customer debt and collections understandable at a glance;
4. keep inventory and cash reasonably reconcilable through real operations;
5. preserve operation during short internet outages;
6. accept and structure real WhatsApp orders with limited human intervention;
7. allow the owner to ask natural-language questions and safely execute supported actions;
8. produce a useful daily/weekly business summary;
9. generate trust through clear authorization and audit history;
10. onboard a real colmado without requiring formal accounting knowledge.

## 25. Pilot measurement

For the first 5–10 colmados, track at minimum:
- time to first successful sale;
- time to first fiado/collection;
- median common-sale completion time;
- daily active owner/cashier usage;
- percentage of fiado recorded in FIAO vs paper fallback;
- collection reminders sent and resulting recorded payments;
- stock discrepancy frequency;
- cash-close difference frequency;
- WhatsApp order auto-acceptance rate;
- AI query/action success rate and correction rate;
- offline sync conflicts and resolution rate;
- 7-day and 30-day retention;
- onboarding completion / activation rate.

## 26. Commercial/brand boundary

Working brand: **FIAO**. Before final trademark deployment, perform formal Dominican Republic trademark clearance. Product design must not depend technically on the final trademark string so a brand rename remains possible without rewriting domain architecture.

---

## Design approval record

The functional sections approved for MVP V1 are:

1. Navigation + Dashboard
2. Vender / POS
3. FIAO + Cobrar
4. Customers + FIAO Score
5. Intelligent Inventory
6. Cash & Money Control
7. Orders + WhatsApp + Mixed Payments
8. FIAO AI
9. Reports
10. Configuration + Permissions + Onboarding

This specification consolidates those approved sections and adds only implementation-neutral architectural, error-handling, audit, synchronization, pilot-measurement, and scope-clarification rules required to make the design internally coherent.
