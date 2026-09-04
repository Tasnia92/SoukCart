# SoukCart — Retailer UX Plan: Buy & Track

The retailer's job is two things: **buy products** and **track shipments**. Everything
else is secondary. This plan reworks the retailer experience around those two jobs,
using data that already exists in the database.

---

## 1. Where we are today

### Context (from task.md)

SoukCart is a Daraz-style B2B marketplace: sellers fulfill their own orders, the
platform takes one commission rate, and the admin is governance/finance only.
Phase 1 (stock/checkout integrity) is done; Phase 2 (seller-driven fulfillment,
per-supplier packages via `order_supplier_acceptances`) is in progress. The
retailer is a **buyer**: they restock from supplier catalogs, pay (online or COD),
wait for delivery, and confirm receipt.

### Current retailer experience

| Route                                   | What it does                                                                                                                                                                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/retailer` Overview                    | Next-action widget, 4 metric cards (spend, active, delivered, cart), 5 fulfillment-stage count cards, weekly spend trend chart, recent-orders table, Help Center tickets card                                                       |
| `/retailer/catalog` "Place order"       | Product grid, search, category filter, quantity stepper, add to cart                                                                                                                                                                |
| `/retailer/cart` + `/retailer/checkout` | Cart lines, saved shipping addresses, COD/online payment                                                                                                                                                                            |
| `/retailer/orders` "My orders"          | Filter tabs (Needs action / Active / Delivered / Cancelled / All), expandable rows with items, totals, address, a static 4-step status card, and action buttons (verify payment / verify delivery / request cancellation / invoice) |
| Account group                           | Notifications, Help Center, Settings                                                                                                                                                                                                |

The good parts worth keeping: the **next-action widget** (one clear next step),
**"Needs action" filter**, saved **shipping addresses**, background **payment
reconciliation** after first paint, and the per-supplier **package** data model.

---

## 2. Gaps, measured against "buy + track"

### Tracking is the weakest part (and it's the retailer's #1 job)

1. **Tracking data exists but is never shown.** The `order_shipments` table
   (written by `seller_ship_order`) carries `carrier`, `tracking_number`,
   `tracking_url`, granular `status` (`shipped | in_transit | out_for_delivery |
delivered | exception`) plus a `shipment_events` history. `retailer-orders-api.ts`
   does not select it and no frontend file references it. The retailer "tracks"
   via a bare status badge.
2. **Track lives behind a +/− row toggle.** To answer "where is my stuff?" the
   retailer must expand a row and scan items, totals, address, and a static
   stepper. No timeline, no carrier, no tracking number, no link.
3. **Copy contradicts the fulfillment model.** `deliveryStatusCopy` (retailer,
   `confirmed`) still says "Admin ships confirmed items" — Phase 2 moved shipping
   to sellers. The overview copy "See delivery status as admin updates it" is
   equally stale.
4. **Multi-supplier orders are flattened.** Packages each have their own status,
   but the UI shows one order-level badge plus "3 of 5 suppliers confirmed". The
   retailer can't tell _which_ package is where.
5. **No live updates on Orders.** The catalog re-fetches on product changes
   (`useProductChanges`); Orders does not. A status change while the page is open
   is invisible.
6. **Delivery verification is buried.** It is the retailer's only required
   post-delivery action (and it gates supplier payouts), yet it is a small row
   button behind a native `window.confirm`.

### Buying flow

7. **Overview is a seller-style analytics dashboard.** Spend trend chart, deltas,
   stage counts, help tickets — none of it answers "what should I buy next?" or
   "where is my stuff?". Active shipments get one small metric card.
8. **No reorder path.** Restocking is the most common buying behavior; today the
   retailer must re-find every product in the catalog by hand.
9. **Payment truth is manual on Orders.** Gateway reconciliation only runs
   automatically on the Overview. Elsewhere, an order can sit "unpaid" until the
   retailer thinks to press "Verify payment".

### Micro-frictions

10. Native `window.confirm` dialogs for delivery verification / cancellation —
    off-design-system, and cancellation explains refund policy in a dialog string.
11. The recent-orders table on Overview duplicates Orders minus its most useful
    column (tracking).

---

## 3. Design principles

1. **Two jobs first.** Every screen leads with "what should I buy next?" or
   "where is my stuff?".
2. **Status in one second.** A shipment's state must be readable without
   expanding anything.
3. **Build on the next-action pattern** — it is already the right idea; make it
   inline-actionable where possible.
4. **The retailer never wonders about payment.** Reconcile automatically,
   everywhere, and show the outcome.
5. **Use the data that already exists** (`order_shipments`, `shipment_events`,
   packages) before proposing new backend work.

---

## 4. The redesigned experience

### 4.1 Landing → storefront first (supersedes the "Today cockpit")

**Direction change (user decision):** when a retailer logs in they land on the
**product listing**, like a real ecommerce site. The cockpit ideas survive as:

- `/retailer` = `RetailerStorefront` — banners (next action, in-transit count),
  search, category chips, sort, product grid, sticky mobile cart bar.
- The full active-shipments strip moved to the top of the **Orders** page.
- The Overview page and the old catalog page were retired; `/retailer/catalog`
  redirects to `/retailer`. Nav: **Products · Cart · Orders · Account**.

### 4.2 Orders → "Shipments first"

- **Row summary carries a mini timeline** (4 dots + step label + age, e.g.
  "Shipped · 2d") instead of a badge stack. Answer "where is it?" without
  expanding.
- **Expanded detail shows a real ShipmentTimeline** fed by
  `order_shipments` + `shipment_events`: timestamped steps, carrier, tracking
  number (copy + link), and — for multi-supplier orders — one mini-stepper per
  package with its own status/decline reason.
- **Promote actions.** "Verify delivery" becomes the row's primary CTA when
  delivered-but-unconfirmed; replace `window.confirm` with a design-system
  AlertDialog that states consequences ("closes the order; later changes go
  through Support").
- **Auto-reconcile payments.** Run the existing `reconcileRetailerPayments`
  pass on Orders too (it is already safe and non-blocking), so "Verify payment"
  becomes a fallback button instead of a required step.
- **Live status.** Subscribe to order/shipment changes (same realtime pattern as
  `useProductChanges`) and update rows/timelines in place.
- **Fix copy** per §2.3: sellers ship; admin is governance only.

### 4.3 Buying flow

- **Catalog (keep, small fixes):** sticky cart summary bar on mobile showing
  unit count + "Review order"; "in cart" state keeps its current behavior.
- **Reorder:** an `order → cart` helper (new API function + button on Overview
  and on delivered order rows) that skips the catalog for repeat purchases.
- **Checkout (keep):** saved addresses are the right pattern; no structural
  change needed.

### 4.4 Navigation

- Rename "My orders" → "Orders" (it already covers everything order-related) and
  keep "Place order" as the catalog entry point. Account group unchanged.

---

## 5. Backend / data work (small)

| Change                                                                                                                                                                                      | Why                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Add `order_shipments(*, shipment_events(*))` to `ORDERS_SELECT` in `retailer-orders-api.ts` (read-only; RLS on shipments must allow the order's retailer — verify, add a policy if missing) | Surfaces existing tracking data                               |
| Pure mappers in `retailer-orders-api.ts`: `shipmentForOrder`, `packageTimelines(order)`, `deliveryAge(order)`                                                                               | Keep presentation derived and testable                        |
| Reuse `confirm_order_delivery`, `request_order_cancellation`, existing reconciliation                                                                                                       | No RPC changes                                                |
| Reorder helper: select last delivered order's items and upsert cart lines (respect `stock`, `min_order_qty`)                                                                                | One function, client-side orchestration of existing endpoints |
| Realtime: reuse the notifications/product realtime pattern for `orders` + `order_shipments` on the retailer session                                                                         | Live tracking                                                 |

---

## 6. Build order

- [x] 1. **Track (highest value, cheapest):** fetch shipments in
      `retailer-orders-api.ts` → ShipmentTimeline + per-package steppers on Orders →
      mini timeline in row summary → copy fixes.
- [x] 2. **Overview cockpit:** active-shipments strip + quiet stat line; drop trend
      chart and stage counts; keep next-action.
- [x] 3. **Reorder** (button + helper, Overview and delivered rows).
- [x] 4. **Automate payment reconciliation on Orders** and make "Verify payment" a
      fallback.
- [x] 5. **Live updates + dialog polish** (AlertDialog for delivery/cancel; realtime
      via `useRetailerOrderChanges`).

Steps 1–2 alone deliver the two core jobs; the rest is refinement.

### Shipped (implementation notes)

- `src/features/retailer/retailer-orders-api.ts` — `ORDERS_SELECT` now embeds
  `order_shipments(+ shipment_events)`; new types `RetailerShipment` /
  `RetailerShipmentEvent`; pure helpers `primaryShipment`, `shipmentStatusLabel`,
  `deliveryAgeDays`. No migration needed: retailer read policies already exist.
- `src/features/retailer/Shipments.tsx` (new) — `MiniTimeline` (4-dot ladder),
  `TrackingLine` (carrier + number + copy + link), `ShipmentTracker` (per-package
  steppers + tracking card + event history, falls back to the status explainer).
- `src/features/retailer/retailer-dashboard-api.ts` — cockpit model: `nextAction`
  (track branch removed; the strip owns tracking), `summary`, `shipments` strip
  cards, `reorderOrderId`. Trend/stages/recent/help removed.
- `src/features/retailer/RetailerStorefront.tsx` (new) — the `/retailer` landing:
  product listing with next-action + in-transit banners, prominent search,
  category chips, sort select, ecommerce product cards (image hover, prominent
  price, stock/MOQ/in-cart badges), sticky mobile cart bar, reorder shortcut,
  background payment reconciliation and realtime refresh.
- `src/routes/retailer/index.tsx` renders the storefront; `/retailer/catalog`
  redirects to `/retailer`; `RetailerOverview.tsx` and `RetailerCatalog.tsx` were
  retired; nav is now **Products · Cart · Orders · Account**.
- `src/features/retailer/RetailerOrders.tsx` — active-shipments strip on top
  (`buildShipmentCards`), mini timeline + status + age in
  row summary, inline "Verify delivery" CTA, `ShipmentTracker` in detail,
  AlertDialogs for verify/cancel, background payment reconciliation, realtime
  refresh, "Reorder items" on delivered rows, neutral copy ("Orders.").
- `src/features/retailer/retailer-cart-api.ts` — `reorderPlan` + `reorderOrderItems`
  (stock clamp, MOQ floor, unavailable dropped).
- `src/features/retailer/retailer-realtime.ts` (new) — orders + order_shipments
  realtime hook (both tables are in the `supabase_realtime` publication).
- `src/features/orders/DeliveryStatus.tsx` — exported `deliveryStepIndex`; neutral
  confirmed copy (sellers confirm, admin ships).
- `src/features/retailer/retailer-shared.tsx` — nav "My orders" → "Orders".
- `src/features/retailer/RetailerCatalog.tsx` — sticky mobile cart bar.
- `src/features/retailer/retailer-dashboard.test.ts` (new) — 18 unit tests for the
  mappers, next-action precedence, strip ordering, reorder clamping.

## 7. Verify

- `vp check` clean and `vp test` green (add tests for the new pure mappers and
  next-action/timeline edge cases: multi-package, declined package, exception
  shipment, delivered-unconfirmed).
- Security advisors show no new findings (especially the new shipment read
  policy).
- Manual pass: multi-supplier order, COD order, failed-payment order,
  delivered-but-unconfirmed order.
