- two days before promised date;
- promised date;
- every seven days after due date while still unpaid.

Automations stop when the balance is settled. Automatic collection can be paused per customer. Message hours are configurable.

### 6.5 Credit dashboard

Shows:
- total money "in the street";
- number of debtors;
- overdue customers;
- expected collections today/this week;
- amount collected in selected period;
- top debtors;
- filters by due status, amount, score, and name.

## 7. Customers and FIAO Score

### 7.1 Customer identity

Required creation fields:
- name;
- phone;
- sector/address.

Phone is the primary duplicate-detection key. FIAO warns when a phone already exists.

For multi-branch owners, a customer exists once per owner account but has branch-specific purchases, debt, credit limit, and FIAO Score.

### 7.2 Customer profile

Profile contains:
- identity/contact/location;
- current branch debt;
- branch credit limit and available credit;
- FIAO Score and explanation;
- purchases and ticket average;
- loyalty points;
- WhatsApp actions;
- tabs for summary, credit, purchases, points, and activity;
- product preferences and frequency when sufficient data exists.

### 7.3 FIAO Score V1

Score range: 0–100, computed only from the customer's history within the current branch/business relationship. No cross-owner shared blacklist or national score exists in V1.

Initial explainable factors:

| Factor | Weight |
|---|---:|
| Payments on time | 35% |
| Average days late | 25% |
| Credit-limit utilization | 15% |
| Payment/abono history | 15% |
| Relationship age / sufficient history | 10% |

Initial interpretation:
- 80–100: green, good payer;
- 60–79: yellow, lend carefully;
- 40–59: orange, elevated risk;
- 0–39: red, collect first.

Before at least three relevant credit/payment movements, show **Sin historial suficiente** rather than penalizing a new customer.

The score explains its main drivers and may suggest a limit review, but FIAO never changes credit limits automatically in V1.

## 8. Loyalty

- Owner configures earning rules such as 1 point per RD$100, double points on selected days, or extra points on selected products.
- Owner configures expiration (e.g. 90/180/365 days).
- Redemption uses an owner-defined reward catalog: free product, fixed discount, combo, selected benefit.
- Every earn/redeem movement is auditable.
- WhatsApp may notify customers about point balances and approaching expiration.
- No consumer app is required in V1.

## 9. Inventory and suppliers

### 9.1 Product stock model

Per branch, each stock-controlled product has:
- base unit;
- quantity on hand;
- reserved quantity;
- available quantity;
- moving average cost;
- sale price;
- configurable minimum stock;
- status: healthy / low / critical / out.

Catalog is shared at owner level; price, stock, minimums, and costs can vary by branch.

### 9.2 Replenishment

Purchase-to-supplier records:
- supplier;
- product;
- quantity;
- unit purchase cost;
- total;
- branch;
- date/time;
- user.

The event increases stock, updates moving average cost, and preserves cost history.

### 9.3 Cost and margin

Moving average cost is used to estimate margins and inventory value. FIAO can show cost history by product, branch, date, and supplier and identify price increases based on recorded history.

Profit/margin is explicitly **estimated**, not official accounting profit.

### 9.4 Stock alerts and recommendations

- Owner sets minimum stock per product.
- FIAO detects low/critical/out-of-stock states.
- FIAO may estimate depletion based on recent sales and recommend replenishment quantity.
- Recommendations never create purchases automatically.

### 9.5 Adjustments

Cashier can report a discrepancy. Sensitive inventory adjustment requires owner PIN and records before/after quantity, delta, reason, user, and authorizer.

Reasons can include breakage, expiration, internal consumption, loss, counting error, other.

### 9.6 Inventory movement history

All movements (sale, purchase, reservation, release, adjustment, return) are recorded as events so stock can be reconstructed and audited.

### 9.7 Reserved inventory

Accepted orders and apartados reserve inventory. FIAO distinguishes physical, reserved, and available stock. Cancellation/release removes the reservation.

### 9.8 Suppliers

Supplier directory is shared per owner. Purchase/cost history remains branch-specific. V1 can compare recorded recent costs, but it does not claim a supplier's current live price unless externally confirmed.

This model prepares future Mercao integration without coupling V1 to Mercao.

## 10. Cash management

### 10.1 Opening

Cash opening records branch, responsible cashier, initial float, date/time, and device.

### 10.2 Cash movement classification

- cash sale increases expected physical cash;
- transfer/card sale does not;
- fiado sale creates revenue/debt but no cash inflow;
- cash abono increases expected physical cash;
- transfer/card abono does not;
- cash expense reduces expected physical cash;
- cash withdrawal reduces expected physical cash without reducing estimated profit;
- extraordinary cash injection increases expected physical cash.

### 10.3 Expenses

Simple expense: amount, category, description, method, user, date/time. Cashier has configurable maximum; higher expense requires owner PIN.

### 10.4 Withdrawals

Withdrawal is distinct from expense. It records amount, reason, user, owner authorization, and reduces expected cash without being treated as operating expense.

### 10.5 Closing

FIAO computes:

`opening float + cash sales + cash collections + cash injections - cash expenses - withdrawals - cash refunds = expected cash`

Cashier enters counted cash. FIAO shows difference and allows recount, movement review, or owner-authorized close with difference.

Closing summary also includes transfer, card, fiado, collections, expenses, withdrawals, annulments/refunds, expected cash, counted cash, and difference.

### 10.6 Cash audit

Historical closes show differences and patterns. FIAO AI may surface recurring discrepancies but must present them as patterns requiring investigation, never accusations.

## 11. Orders, WhatsApp, and basic delivery

### 11.1 Order states

- **New** — pedido entrante (WhatsApp o manual), aún no aceptado; puede auto-aceptarse o quedar en la bandeja de excepciones.
- **Preparing** — aceptado, stock reservado, en preparación en el colmado.
- **Ready** — listo para entrega o retiro.
- **On the way** — asignado a un delivery y en camino.
- **Delivered** — entregado; finaliza venta/pago/lealtad exactamente una vez (idempotente).
- **Cancelled** — cancelado; libera la reserva si aún no se preparó.

### 11.2 Origen del pedido

- **WhatsApp**: un mensaje entrante se normaliza a un pedido estructurado (líneas, cantidades, cliente, entrega).
- **Manual**: el cajero/dueño crea el pedido desde la pantalla `/pedidos` (mismo modelo de dominio).
- **Repetir último pedido**: acción manual que clona las líneas del último pedido entregado del cliente.

### 11.3 Reservas de inventario

- Aceptar un pedido reserva stock (`ProductStock.reserved += qty`; disponible = onHand − reserved).
- Cancelar antes de `Preparing` libera la reserva.
- `Delivered` consume la reserva (`reserved −= qty` y `onHand −= qty`) al crear la venta real.

### 11.4 Webhook de Meta (verificación y normalización)

- `GET /api/whatsapp/webhook` responde al reto de verificación de Meta (`hub.mode`/`hub.verify_token`/`hub.challenge`).
- `POST /api/whatsapp/webhook` valida la firma (`X-Hub-Signature-256`) y normaliza mensajes entrantes a eventos de pedido.
- Los mensajes salientes usan una abstracción de plantilla/mensaje (`sendTemplate`/`sendText`) en `packages/whatsapp`; el envío real se mockea en V1.

### 11.5 Extracción de ítems en lenguaje natural

- Adaptador **puro** que convierte texto libre (“2 arroces, una leche y 5 libras de plátano”) en líneas estructuradas.
- Ambigüedad explícita: si un término no resuelve a un producto único, la orden no se auto-acepta y queda en la bandeja de excepciones con las alternativas.
- Sustituciones de stock agotado: propuestas que requieren aprobación del cliente (nunca se sustituyen en silencio).

### 11.6 Validación de pago

- El pedido puede pagarse en efectivo, transferencia, tarjeta o fiado (validando cliente y límite, igual que el POS).
- Los pagos mixtos se validan con las mismas reglas de dominio de venta.

### 11.7 Auto-aceptación y bandeja de excepciones

- Reglas determinísticas de auto-aceptación (p. ej. cliente conocido, ítems sin ambigüedad, stock suficiente, pago válido).
- Los pedidos que no cumplen entran a la **bandeja de excepciones** para revisión manual.

### 11.8 Entrega

- La entrega se asigna por nombre/etiqueta libre (“Miguel”, “Delivery 1”); el repartidor no es un usuario formal en V1.
- Línea de tiempo del pedido (`OrderTimelineEvent`) con cada cambio de estado y notificaciones de estado al cliente.

### 11.9 Reglas de cancelación

- Antes de `Preparing`: cancelar libera la reserva.
- Después de `Preparing`: cancelar exige motivo y, si el actor es cajero, autorización de OWNER.
