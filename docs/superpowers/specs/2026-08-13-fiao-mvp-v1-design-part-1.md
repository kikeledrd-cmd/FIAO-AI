# FIAO MVP V1 — Product Design Specification

**Status:** Approved functional design  
**Date:** 2026-08-13  
**Product:** FIAO  
**Positioning:** El sistema inteligente de tu colmado.  
**Primary market:** Colmados in the Dominican Republic  
**Primary experience:** Mobile-first Android/web app, responsive for later tablet/desktop use.

## 1. Product thesis

FIAO is a mobile-first operating platform for Dominican colmados. Its entry wedge is the informal credit workflow ("fiado"), but the product connects sales, credit, collections, customers, inventory, cash, suppliers, WhatsApp orders, basic delivery, loyalty, reporting, and AI-assisted operations.

FIAO is not positioned as a generic POS or accounting package. Its core promise is **"Tu colmado, bajo control"**, with the commercial action line **"Vende. Fía. Cobra. Controla."** FIAO AI adds the interaction promise **"Pregúntale a tu negocio."**

The UX must feel simpler than a traditional ERP: frequent operations should be reachable in one or two taps, a normal cash sale should target completion in under ten seconds, and the user should not need accounting terminology to understand the business.

## 2. Design principles

1. **Mobile first.** Android/cellphone is the primary device for the pilot.
2. **Colmado-native UX.** FIAO adapts to the way a colmado works instead of forcing formal ERP workflows.
3. **AI as an interface, not a decoration.** FIAO AI can query and prepare/execute supported actions through the same business rules as the UI.
4. **Human control over sensitive actions.** Money, debt, inventory corrections, protected data, and exceptional authorizations require confirmation and/or owner PIN.
5. **Auditability.** Sensitive financial/stock records are never physically deleted. Corrections are represented as reversals, annulments, or compensating movements linked to the original event.
6. **Offline continuity.** Core selling, fiado, and collections continue during connectivity loss; synchronization preserves all events and surfaces conflicts for review.
7. **Explainability.** FIAO distinguishes confirmed facts, estimates, patterns, and recommendations.
8. **Progressive complexity.** The first-day experience remains simple even though the platform can grow into multi-branch operations.

## 3. Users and access model

### 3.1 Roles

FIAO MVP V1 has exactly two formal roles:

- **Owner:** complete operational access, reports, sensitive financial details, configuration, users, authorizations, annulments, limits, and protected actions.
- **Cashier:** daily operations with controlled permissions.

Delivery personnel are not formal users in V1. A delivery can be assigned using a stored/free-form name such as "Miguel" or "Delivery 1".

### 3.2 Authentication

- Login: phone number + 4–6 digit PIN.
- Owner PIN doubles as an authorization mechanism for protected operations.
- Sensitive owner-only screens (detailed margins, profits, cash differences, critical settings) require PIN re-entry.
- Devices are registered to the business and can be remotely logged out by the owner.

### 3.3 Cashier permissions

Cashier can:
- sell and collect payments;
- create/search customers;
- create fiado within customer limits;
- register payments/abonos;
- manage basic orders;
- see operational inventory;
- register allowed expenses;
- open cash and initiate closing;
- send receipts and approved WhatsApp messages.

Cashier cannot:
- delete or freely edit historical operations;
- change base prices or costs;
- change customer credit limits;
- bypass fiado limits;
- see protected profit/margin details;
- confirm sensitive inventory corrections;
- close cash with unexplained differences;
- alter FIAO Score;
- change critical configuration.

Protected exceptions require owner PIN and are audited.

## 4. Information architecture

Primary mobile navigation:

1. **Inicio**
2. **Vender**
3. **Fiao**
4. **Pedidos**
5. **Más**
   - Clientes
   - Inventario
   - Caja
   - Suplidores
   - Reportes
   - FIAO AI
   - Configuración

### 4.1 Owner dashboard

The dashboard shows at a glance:
- sales today and simple comparison;
- estimated profit (protected detail);
- total fiado;
- collections due;
- stock warnings;
- cash status;
- active orders;
- actionable alerts;
- quick actions: Vender, Fiar, Cobrar, Pedidos;
- FIAO AI entry.

The dashboard answers: what happened, what needs attention, and what can I do now?

## 5. Sales / POS

### 5.1 Product selection

- Visual catalog with large cards and search.
- Frequent products appear first based on usage.
- Barcode scanning is secondary, not required.
- Customer is optional for cash/card/transfer sales; unassigned sales use **Consumidor final**.
- A customer is mandatory for fiado and optional when individual history is desired.

### 5.2 Product presentations and measurement

A product can have multiple presentations tied to one base inventory unit, e.g. unit, six-pack, box/package. Selling a presentation deducts the equivalent base quantity.

Products can also be sold by weight/measure (lb, kg, liter, custom quantity). FIAO can convert a fixed currency amount (e.g. RD$100 of cheese) into the corresponding quantity and deduct stock accurately.

A product may disable stock control for services, recargas, delivery charges, or other non-stock items.

### 5.3 Cart and discounts

Cart shows line items, quantities, subtotal, discounts, and total. Cashier can apply discounts up to a configured limit. Higher discounts require owner PIN and remain in audit history.

### 5.4 Payment methods

Supported in V1:
- cash;
- bank transfer;
- card (recorded as payment method; no card processor integration required in V1);
- fiado;
- **mixed payment**, e.g. cash + transfer, transfer + cash, or cash + fiado.

Cash flow treats each component separately.

### 5.5 Fiado in a sale

When fiado is selected, FIAO shows customer balance, new purchase, new balance, branch-specific limit, remaining availability, FIAO Score, and optional promised payment date.

If the new balance exceeds the branch limit, the sale is blocked until owner PIN authorizes the exception. Authorization is recorded.

### 5.6 Receipts and returns

Every completed sale generates an internal FIAO receipt with business data, products, totals, payment method(s), customer when applicable, date/time, and user.

Returns are controlled: cashier may initiate; owner PIN confirms. FIAO reverses the corresponding sale, cash/payment effect, inventory effect, loyalty effect when applicable, and records the reason.

V1 receipts are internal. Architecture must allow later DGII/e-CF integration without redefining the sale domain model.

## 6. FIAO / credit and collections

### 6.1 Credit entry methods

FIAO supports both:
1. **Detailed fiado:** generated from a sale with product lines.
2. **Fiado rápido:** customer + amount + optional description + optional promised date.

Both create immutable credit movements and update the computed customer balance.

### 6.2 Promised dates and aging

Promised date is optional. Quick choices can include today, tomorrow, Friday, quincena, end of month, or selected date. Natural-language dates may be interpreted by FIAO AI.

Example status model:
- green: current;
- yellow: payment approaching;
- orange: overdue;
- red: significantly late.

The owner can configure the number of days used for the strongest overdue status.

### 6.3 Collections / abonos

Collection flow: customer -> amount -> payment method -> new computed balance -> receipt.

Supported collection payment methods: cash, transfer, card. A **Saldar** shortcut pays the full balance.

Receipts show previous balance, amount paid, new balance, method, date/time and business. They can be shared by WhatsApp.

### 6.4 WhatsApp collection rules

Owner can configure automatic reminders such as:
