- On the way
- Delivered
- Cancelled

### 11.2 WhatsApp order understanding

Customer can write naturally. FIAO extracts products/quantities, checks available stock, builds cart, calculates current prices/promotions, confirms total and payment method, and creates the order.

When a product is unavailable, FIAO suggests available substitutes, but the customer must approve substitution.

### 11.3 Auto-acceptance

FIAO auto-accepts when:
- all required stock is available;
- customer identity is sufficient;
- payment method is valid;
- fiado is within limit if used;
- delivery address is available;
- no business-rule inconsistency exists.

Human attention is required for stock problems, ambiguous customers/addresses, excessive credit, unusual requests, price negotiation, or explicit request for a person.

### 11.4 Fiado and mixed payment in orders

WhatsApp orders use the same branch credit rules as POS. If a requested fiado exceeds the limit, the order requires owner authorization. Mixed payment can split an order into cash/transfer/card/fiado components.

### 11.5 Delivery

Delivery in V1 is intentionally basic. Order is assigned a name/label, not a formal user. No GPS or route optimization. Status transitions produce customer notifications when connected.

### 11.6 Cancellation

If order is still New, customer cancellation can be automatic. From Preparing onward, cancellation becomes a request requiring store approval.

### 11.7 Order timeline

Every state change stores timestamp, actor/source, and relevant notes. Delivered orders finalize sale/cash/inventory/customer/loyalty/reporting effects.

### 11.8 WhatsApp exception inbox

FIAO does not clone a full messaging app. It provides an operational inbox emphasizing conversations/orders requiring human action.

## 12. Apartados / pending sales

V1 supports reserving merchandise to a customer, recording an initial payment, maintaining remaining balance, and completing payment later. Reserved stock is removed from available stock while the apartado remains active.

## 13. FIAO AI

### 13.1 Interaction modes

FIAO AI accepts text and voice. It has three action levels:
1. **Query:** read-only response, no confirmation needed.
2. **Prepared action:** proposes a supported operation and requires explicit confirmation.
3. **Protected action:** requires explicit confirmation plus owner PIN when business rules demand authorization.

### 13.2 Supported V1 queries

Examples include sales, fiado, overdue accounts, collections, stock, replenishment needs, recorded supplier costs, cash status, expenses, orders, customer behavior, loyalty, and branch comparisons.

### 13.3 Supported V1 actions

After confirmation and subject to permissions:
- register fiado;
- register abono;
- register quick sale;
- register inventory receipt;
- register expense;
- register withdrawal;
- update order state;
- create customer;
- update customer address;
- send payment reminder;
- send receipt;
- query/redeem loyalty points;
- create simple promotion.

### 13.4 AI guardrails

FIAO AI cannot in V1:
- permanently erase financial history;
- manually override FIAO Score;
- rewrite historical records to hide movements;
- autonomously purchase from suppliers;
- bypass fiado authorization rules;
- alter sensitive configuration without verification;
- close cash with differences without required authorization;
- substitute order products without customer approval;
- send uncontrolled mass campaigns.

### 13.5 Ambiguity and anomaly checks

FIAO never guesses when customer/product identity is ambiguous. It presents candidate matches.

Unusually large amounts or improbable operations generate a warning before confirmation to reduce speech/transcription errors.

### 13.6 AI auditability

AI-originated actions record original user command/transcription, parsed action, user, confirmation actor, authorizer when relevant, timestamps, and resulting business movement.

### 13.7 Confidence language

UI distinguishes:
- **Confirmed:** direct FIAO data;
- **Estimated:** calculated from historical FIAO data;
- **Recommendation:** suggested action or interpretation.

FIAO must not invent live supplier prices or other external facts it does not possess.

### 13.8 Proactive summaries

Owner can receive configurable daily/weekly summaries containing sales, estimated profit, collections, new fiado, cash differences, stock risks, orders, and attention items. Proactive suggestions do not execute actions unless an existing automation rule authorizes them.

## 14. Reports

Period filters: Today, Week, Month, Custom Range. Each core metric can show a simple comparison against the equivalent previous period.

### 14.1 Core reports

1. Sales
2. Estimated profit
3. Fiao and collections
4. Inventory
5. Cash
6. Customers
7. Orders

Additional V1 views may cover WhatsApp, loyalty, promotions, expenses, and multi-branch comparison.

### 14.2 Reporting principles

Every report should answer:
- What happened?
- Is it better/worse than the previous comparable period?
- What needs attention?
- What can the owner do next?

Avoid decorative BI. Use one clear sales-over-time chart rather than dense dashboards.

### 14.3 FIAO Insights

Insights can identify patterns such as higher Friday sales, products likely to run out, concentration of fiado in a few customers, inactive stock, dormant customers, cash-difference patterns, or higher WhatsApp ticket averages. Insights must label facts, patterns, and recommendations separately.

### 14.4 Export/share

V1 supports useful exports for sales, inventory, fiado, customers, and cash in PDF and/or spreadsheet-friendly CSV/XLSX formats. Reports can be shared through supported channels such as WhatsApp/email/download.

## 15. Promotions

Owner can create simple rules:
- 2x1;
- combos;
- quantity discounts;
- special price by day/time;
- temporary offers.

Pricing is deterministic and owner-configured. AI-driven dynamic pricing is out of scope for V1.

## 16. Multi-branch model

- One owner account can manage multiple colmados/branches.
- Branch switching is explicit in the UI.
- Catalog and supplier directory are shared per owner.
- Stock, price, costs, cash, debt, limits, FIAO Score, and operational history are branch-specific.
- Customer identity is shared per owner, but debt and score remain branch-specific.
- V1 supports summary comparisons but not advanced inventory transfers or centralized procurement.

## 17. Offline-first operational continuity

### 17.1 Offline-supported core actions

- sales;
- fiado;
- collections;
- locally available customer/balance lookup;
- core cash movements;
- basic inventory movements that can be safely queued.

Cloud-dependent capabilities such as WhatsApp messaging, new incoming WhatsApp orders, and full generative FIAO AI are not guaranteed offline.

### 17.2 Synchronization model

Business operations are event/movement based. Offline devices create locally unique events. On reconnection, FIAO uploads all events rather than overwriting aggregate balances.

If two devices conflict, FIAO preserves both legitimate events, recomputes derived balances/stock, and flags material discrepancies for owner review.
