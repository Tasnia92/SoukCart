# SoukCart — Daraz-Style Flow Rework

A plan to move SoukCart from an admin-driven order pipeline to a Daraz-style
marketplace: sellers fulfill their own orders, stock stays honest, the platform
earns a commission, and the admin governs money and disputes instead of
confirming every order.

## Goal in one line

Seller adds product → buyer orders & pays → seller confirms and ships → buyer
receives and verifies → platform takes its commission and pays the seller.

## Guiding decisions (agreed)

- **Sellers**, not the admin, drive order fulfillment (confirm → ship).
- **One platform-wide commission rate**, set by the admin, applied to every
  product (no per-category rates).
- **Stock is reserved at checkout** (kept), but abandoned checkouts must
  auto-release.
- **Admin becomes a governance/finance role**: payouts, disputes, refunds,
  stuck-order intervention, seller verification.

## Open decisions (need a call before building the affected phase)

- [ ] **Multi-supplier orders**: fulfillment status is currently whole-order.
      Daraz tracks each seller's package separately. Do we move to a
      per-supplier fulfillment status? (Recommended, but bigger change —
      affects Phase 2.)
- [ ] **Return window length** after delivery before payout is released
      (e.g. 3 or 7 days).
- [x] **COD ownership & payout timing**: COD is handled by SoukCart, not the
      seller. The seller hands the parcel to the SoukCart delivery partner; the
      partner delivers, collects cash, and settles with SoukCart. SoukCart takes
      commission and pays the seller weekly. Seller UI no longer records COD;
      `collect_cod_payment` is admin-only.

---

## Phase 1 — Stock & checkout integrity (do first)

These protect money and inventory. They are contained and independent of the
bigger role changes.

- [x] **Auto-expire unpaid online orders.** Added a scheduled job (`pg_cron`,
      `expire-stale-unpaid-orders`, every 5 min) calling
      `expire_stale_unpaid_orders()`, which fails `online` orders still `unpaid`
      after ~30 minutes. The existing `orders_inventory_reservation` trigger then
      releases the reserved stock. Fixes the permanent stock leak.
- [x] **Release stock on payment failure in the IPN handler.**
      `supabase/functions/sslcommerz-ipn` now writes `failed`/`cancelled` on
      terminal gateway results (guarded to `unpaid` orders only), releasing stock
      without waiting for the buyer to return. Deployed (verify_jwt = false).
- [x] **Prevent duplicate stock reservations from repeated checkout.**
      Implemented as _supersede_ rather than clearing the cart:
      `create_order_from_cart` now fails any earlier unpaid online order for the
      retailer before reserving the new one, releasing its stock. Chosen over
      clearing the cart at creation so a buyer whose payment fails keeps their
      cart to retry.
- [x] **Allow stock = 0 for sellers.** `enforce_supplier_product_values` supplier
      guard relaxed from `< 1` to `< 0` (new products still require ≥ 1 on
      INSERT). Frontend (`saveProductStock`, `productValidationError`,
      `SupplierStock`, `SupplierProductForm`) updated to accept 0, using the
      shadcn `Input` component, with an "out of stock" hint/label.

**Verify:** `vp check` clean (130 files) and `vp test` green (144 tests);
security advisors show no new findings. _(Phase 1 complete.)_

---

## Phase 2 — Seller-driven fulfillment (the "RTS" model)

Move order status control from the admin to the seller. Admin keeps
cancellation/dispute powers only.

### Delivered flow (implemented 2026-09-05)

The full order progression, visible to every role:

    retailer places order → supplier(s) confirm → admin initiates delivery →
    supplier: dispatched → out for delivery → delivered → retailer verifies

- **Admin cannot confirm, change, or cancel orders.** Admin's only order
  action is **"Initiate delivery"** (once every supplier package is confirmed
  and the order is paid). Admin notifications on confirm/dispatch/deliver are
  informational; refund settlement and COD collection stay with admin.
- **Suppliers own the delivery ladder** via `seller_set_order_status`:
  `confirmed → dispatched → out_for_delivery → delivered`. Dispatch and later
  steps are blocked until `admin_initiate_delivery` sets
  `orders.delivery_initiated_at`. The order-level status stays
  `pending/confirmed/shipped/delivered/cancelled`; `shipped` displays as
  "Dispatched" and `out_for_delivery` is parcel-level (`order_shipments`).
- **Cancellations moved to the suppliers.** A retailer can request
  cancellation only before delivery; any supplier on the order approves or
  rejects it (`seller_respond_order_cancellation`). Suppliers cancel
  single-supplier orders directly (`seller_cancel_order`, e.g. out of stock).
  Delivered orders can never be cancelled or refunded by anyone — the refund
  window closes when the parcel is marked delivered.
- **Refund policy follows the delivery stage** (2026-09-05). Delivered orders
  are closed: the retailer cannot ask for a return or refund, only open a
  complaint (the retailer-facing `request_order_return` RPC was dropped).
  A supplier-confirmed cancellation — the supplier cancels directly or approves
  the retailer's request — refunds everything the retailer paid in advance:
  merchandise + delivery for online orders, the prepaid delivery charge for COD
  (queued automatically, no request step). Once any parcel is out for delivery
  the prepaid delivery charge is kept no matter who cancels; only merchandise
  is refunded.
- **Retailer visibility**: a 6-step tracker (Placed, Confirmed, Delivery
  initiated, Dispatched, Out for delivery, Delivered) on orders/tracking, plus
  realtime parcel events.

---

- [ ] **Decide multi-supplier model** (see open decisions). Assuming per-supplier
      fulfillment:
- [ ] Evolve `order_supplier_acceptances` into a per-supplier fulfillment record
      with a status: `pending → confirmed → shipped → delivered`.
- [ ] **New seller RPC** `seller_set_fulfillment_status(order_id, status)` that
      lets a seller advance only their own items, with valid-transition checks
      (mirror the guard logic in `admin_update_order_status`).
- [ ] **Order-level status becomes derived**: an order is `shipped` when all
      supplier packages are shipped, `delivered` when all are delivered, etc.
      (Or keep whole-order status if we reject the multi-supplier split.)
- [ ] **Keep retailer delivery verification** (`confirm_order_delivery`) — this
      is the trigger that later unlocks payout.
- [ ] **Repurpose `seller_accept_order`**: today it only records a timestamp and
      changes nothing. Either remove it or fold it into the new confirm step so
      the UI is honest about what "accept" does.
- [ ] **Trim the admin order controls** so the admin no longer does routine
      status advancement — only cancel/override.
- [ ] Frontend: update `SupplierOrders.tsx` to expose Confirm / Ship actions;
      update `AdminOverview`/order views to reflect the reduced admin role.

**Verify:** transition guards (can't skip states, can't act on another seller's
items), plus existing order tests still pass.

---

## Phase 3 — Commission & payouts (single admin-set rate)

This is the missing revenue model and the new core of the admin's job.

### Settings

- [ ] **`platform_settings` table** with a single commission rate row
      (e.g. `commission_rate numeric(5,4)`, 0–1). Admin-editable.
- [ ] **Admin RPC** `admin_set_commission_rate(rate)` (service_role / admin only)
      with validation (0 ≤ rate < 1). Keep a small history of rate changes so
      past payouts are auditable.
- [ ] Admin UI: a settings screen to view/update the current commission rate.

### Earnings & payouts

- [ ] **`seller_payouts` (or ledger) table**: per seller per settled order —
      gross (supplier_total), commission amount, net payable, the applied rate,
      status `accruing → available → paid`, and timestamps.
- [ ] **Accrue earnings on delivery verification.** When
      `confirm_order_delivery` fires, snapshot each seller's gross for that order,
      apply the _current_ commission rate, and record net payable as `accruing`.
- [ ] **Make earnings `available`** once the return window (Phase 4) has passed
      with no approved refund.
- [ ] **Exclude cancelled/refunded orders** from payouts; if a refund happens
      after accrual, reverse the accrual.
- [ ] **Admin payout RPC** `admin_mark_payout_paid(...)` (mirror the existing
      `admin_complete_manual_refund` pattern) to settle a seller's available
      balance and notify them.
- [ ] Admin UI: "Payouts" screen — per-seller available balance, history, and a
      "Mark paid" action. Seller UI: an earnings/payout summary.

**Verify:** commission math (gross, commission, net) on single and
multi-supplier orders; refund-after-accrual reversal; rate change does not
retroactively alter already-accrued payouts.

---

## Phase 4 — Returns & refund window

Complete the post-delivery step so payouts are safe to release.

- [ ] **Return/refund window** after delivery verification (length from open
      decisions). Buyer can raise a return/refund request within the window.
- [ ] Reuse the existing `complaints` (`cancellation_refund`) + manual refund
      machinery; extend it to the delivered-return case.
- [ ] Payout release (Phase 3) waits until the window closes with no open
      return.
- [ ] Buyer UI: show refund status clearly in the orders view (data already
      exists on the order: `manual_refund_status`, `refund_amount`).

---

## Phase 5 — Admin governance dashboard

Give the admin the oversight work that replaces per-order confirmation.

- [ ] **Stuck-order / SLA view**: orders a seller hasn't confirmed or shipped
      within a threshold, so the admin can nudge, reassign, or cancel.
- [ ] **Unified "needs a decision" queue**: cancellation requests, refund
      approvals, and support complaints in one place.
- [ ] **Platform health overview**: sales volume, pending payouts, platform
      commission earned, orders at risk, sellers awaiting verification.
- [ ] (Optional) **Product moderation**: review/approve new listings before they
      go live, alongside existing supplier verification.

---

## Suggested build order

1. **Phase 1** — stops the stock leak and duplicate orders (urgent, low risk).
2. **Phase 3 settings + accrual** — get the commission rate and earnings ledger
   in early, even before full seller fulfillment, since it hangs off delivery
   verification which already exists.
3. **Phase 2** — seller-driven fulfillment (needs the multi-supplier decision).
4. **Phase 4** — return window, which gates payout release.
5. **Phase 3 payout release + Phase 5** — finish payouts and the admin console.

## Notes / differences from Daraz

- Daraz owns a courier network (Daraz Express) so "shipped → delivered" is
  auto-tracked. SoukCart has no integrated courier, so these stay **manual
  statuses** the seller/retailer update. Fine, just different.
- Daraz uses **per-category** commission; per your decision SoukCart uses **one
  platform-wide rate**, which is simpler to run and reason about.
