# Seller operations center — redesign plan

**Project:** SoukCart (seller workspace under `/supplier`)  
**Hosted Supabase:** `hrtgeupyijugssrckohx` (BazarSync) — accessible via MCP  
**Audited:** 2026-09-04  
**Goal:** Turn the existing functional seller panel into a cohesive, real-time operations center—without treating UI gating as the authorization boundary.

---

## Problem statement

SoukCart already has a working seller workspace: verification, analytics, products, stock, and order fulfillment (confirm → ship → deliver → cancellation requests). COD cash collection is owned by SoukCart (delivery partner → platform), not the seller. The weakness is cohesion: screens behave like separate management pages rather than one live operations surface.

---

## Current implementation status

| Area                                     | Status             | Notes                                                                     |
| ---------------------------------------- | ------------------ | ------------------------------------------------------------------------- |
| Verification / onboarding                | Implemented        | `SupplierGate` + `supplier_profiles`                                      |
| Dashboard analytics and action queue     | Implemented        | Local edits already push action-first layout                              |
| Product CRUD, images, search, visibility | Implemented        | Edit still loads full catalog then `.find()`                              |
| Stock editing                            | Implemented, basic | Filters exist; no bulk / relative / save-all                              |
| Order fulfillment                        | Implemented        | Confirm → ship → deliver; COD owned by SoukCart admin                     |
| Earnings                                 | Implemented (P1)   | `/supplier/earnings` ledger + CSV; totals + rows from `seller_earnings()` |
| Notifications                            | Implemented (P2)   | Bell + `/supplier/notifications` center; unread nav badge                 |
| Customers                                | Implemented (P3)   | `/supplier/customers` order-centric insights (not a CRM)                  |
| Seller / shop settings                   | Implemented (P2)   | `/supplier/settings` shop, prefs, payout method, password                 |
| Shipping tracking                        | Implemented (P3)   | Carrier + tracking on ship; events via `order_shipments`                  |
| Returns / refunds                        | Implemented (P3)   | `/supplier/returns` queue + retailer request RPC                          |
| Reports / exports                        | Partial            | CSV on orders / earnings / inventory / customers                          |

### Main code anchors

- Routes: `src/router.tsx` (`routeContract` supplier entries)
- Dashboard: `src/features/supplier/SupplierOverview.tsx`
- Fulfillment: `src/features/supplier/SupplierOrders.tsx`
- Shared nav: `src/features/supplier/supplier-shared.tsx`
- Earnings API (partial): `src/features/supplier/supplier-dashboard-api.ts` → `loadSellerEarnings()`

### Current seller navigation

Overview · Orders (action badge) · Products · Inventory (low-stock badge) · Earnings · Returns (open badge) · Customers · Notifications (unread badge) · Settings

---

## P0 — Harden the backend before expanding the panel

**Status: implemented (2026-09-04)** in migrations:

- `20260904120000_seller_p0_auth_integrity_helpers.sql`
- `20260904120050_seller_p0_auth_integrity_submission.sql`
- `20260904120100_seller_p0_auth_integrity_checkout.sql`
- `20260904120200_seller_p0_auth_integrity_seller_rpcs.sql`
- Baseline dump: `supabase/baseline/core_public_tables.sql`

Correctness and authorization first. Do not expand the panel on a soft auth boundary.

### 1. Require approved verification on every seller RPC and mutation policy

**Finding (live):** `supplier_orders`, `seller_set_order_status`, `collect_cod_payment`, `seller_earnings`, `seller_accept_order` only check `users.role = 'seller'`. Product insert/update/delete RLS only checks `seller_id = auth.uid()`—no `is_approved_supplier()`.

**Work**

- Add an approved-supplier guard (reuse `private.is_approved_supplier`) to all seller SECURITY DEFINER RPCs and product write policies.
- Keep React `SupplierGate` as UX only—not the authorization boundary.

### 2. Restrict supplier verification writes

**Finding (live):** `supplier_profiles` update/insert policies do not column-restrict `review_note`, `reviewed_by`, `reviewed_at`. Client upsert explicitly writes those fields (cleared to null).

**Work**

- Replace broad upsert with a submission RPC, or column-restricted policies / triggers that block seller writes to review-owned fields.
- Only service role / admin path may set review metadata and status transitions to approved/rejected.

### 3. Validate document ownership server-side

**Finding (live):** Storage folder policies bind objects to `auth.uid()`, but profile path columns are not validated. `trade-licenses` bucket has `file_size_limit = null` and `allowed_mime_types = null`.

**Work**

- Enforce `nid_front_path` / `nid_back_path` begin with the submitting user’s storage folder.
- Set bucket MIME + size limits (align with client: images, ≤5 MB).
- Clean up replaced or partially uploaded NID objects.

### 4. COD is SoukCart-owned (resolved)

**Decision:** Cash on delivery is collected by the SoukCart delivery partner and
settled with the platform. Sellers only hand over the parcel; they do not record
COD. `collect_cod_payment` is admin-only. SoukCart withholds commission and pays
sellers weekly.

### 5. Preserve immutable order-line history

**Finding (live):** `order_items` = `id`, `order_id`, `product_id`, `quantity`, `unit_price`. `supplier_orders()` joins live `products` for names and seller ownership.

**Work**

- Snapshot `seller_id`, product name, SKU (if added), and unit onto order items at order creation.
- Point seller order history at snapshots so delete/rename of products cannot break historical visibility.

### 6. Restore a reproducible schema baseline

**Finding:** Hosted has early migrations (e.g. `20260809180923` create users) that are not in `supabase/migrations/`. Repo migrations reference `users`, `products`, `orders`, `order_items` without creating them.

**Work**

- Check in a baseline (or dump) that creates core tables and complete policies.
- Make hosted/local drift detectable and security review reproducible.

### Live advisor follow-ups

- RLS enabled, zero policies: `seller_payouts`, `platform_settings`, `commission_rate_history`, `order_supplier_acceptances` — [linter 0008](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
- Many SECURITY DEFINER RPCs callable by `authenticated` — expected if guards are correct; fix approval checks first

---

## P1 — Action-first, real-time dashboard

**Status: implemented (2026-09-04)** in migrations:

- `20260904130000_seller_p1_realtime_select_policies.sql`
- `20260904130100_seller_p1_nav_badges.sql`
- `20260904130200_seller_p1_dashboard_summary.sql`

### Recommended hierarchy

1. **Urgent action strip**
   - New paid orders
   - Orders to confirm
   - Orders to ship
   - Cancellation requests
   - Out-of-stock products
2. **Primary business KPIs**
   - Gross sales
   - Net earnings after commission
   - Available payout
   - Orders completed
3. **Operational widgets**
   - Fulfillment queue (oldest first)
   - Stock risks
   - Sales trend
   - Best-selling products

### Important changes

| Change                                                                  | Status                                                         |
| ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| Default dashboard to work that needs action                             | Done                                                           |
| “Last updated” + manual refresh                                         | Done                                                           |
| Subscribe to order, payment, cancellation, payout, notification changes | Done (`orders`, `seller_payouts`, `notifications`, `products`) |
| Metric links open pre-filtered destinations                             | Done (`?filter=` deep links)                                   |
| 7 / 30 / 90 day range selection                                         | Done                                                           |
| Collapse permanent “verified” chrome after onboarding                   | Done (shell checkmark only; page badge removed)                |
| Separate labels: gross sales / net earnings / available payout          | Done                                                           |
| Server-side dashboard summary RPC                                       | Done (`seller_dashboard_summary`)                              |
| Nav badges (Orders action / Inventory low-stock)                        | Done (`seller_nav_badges`)                                     |

UI building blocks: existing shadcn (`card`, `badge`, `tabs`, `table`, charts) + `@bklit` registry where useful.

---

## P1 — Orders as a fulfillment workbench

**Status: implemented (2026-09-04)** in `SupplierOrders.tsx`.

Improve `SupplierOrders` from a historical table into an operational queue.

| Change                                             | Status                                     |
| -------------------------------------------------- | ------------------------------------------ |
| Default to **Needs action**                        | Done                                       |
| Replace ambiguous Open with clear statuses         | Done — full taxonomy below                 |
| Explicit refresh + automatic new-order updates     | Done (realtime on `orders`)                |
| Sort: oldest waiting, newest, value, delivery city | Done                                       |
| Action deadline / age (“Waiting 6 hours”)          | Done                                       |
| Reload canonical order after mutations             | Done                                       |
| Compact mobile cards instead of 8-column table     | Done                                       |
| Packing-slip and order export                      | CSV export done; packing-slip PDF deferred |

### Target filter taxonomy

- Awaiting payment
- To confirm
- To ship
- In transit
- Delivered
- Cancellation requested
- Cancelled

### Shipment tracking (P3 — done)

Carrier, tracking number, tracking URL, shipment events, and status updates via `seller_ship_order` / `seller_update_shipment`. Partial fulfillment remains deferred.

---

## P1 — Earnings page from existing data

**Status: implemented (2026-09-04)** — `/supplier/earnings` + nav item.

Best low-to-medium effort win. Backend already returns ledger rows.

### Add `/supplier/earnings`

- Available balance
- Paid lifetime
- Commission withheld
- Current commission rate
- Per-order gross, commission, net
- Available / paid / reversed status
- Accrual and payment dates
- Filters and CSV export

### Later

Payout batches, payment references, seller payout method, estimated payout date, clawbacks after paid.

**Note:** Live `seller_payouts` may be empty until delivered+paid orders accrue; UI should handle empty ledger cleanly.

---

## P2 — Inventory stock workbench

**Status: implemented (2026-09-04)** in migrations `20260904140000`–`20260904140150` + `SupplierStock.tsx`.

| Change                                        | Status                                 |
| --------------------------------------------- | -------------------------------------- |
| Low-stock / out-of-stock / hidden filters     | Done (per-product `reorder_threshold`) |
| Bulk quantity updates + relative `+20` / `−5` | Done (`seller_bulk_adjust_stock`)      |
| Per-product reorder thresholds                | Done                                   |
| Unsaved-change indicators and Save all        | Done                                   |
| CSV import / export                           | Done                                   |
| Include hidden listings                       | Done                                   |
| Stock adjustment reasons and history          | Done (`stock_adjustments`)             |
| Optimistic concurrency (`stock_version`)      | Done                                   |
| Search-total vs visible-pool consistency      | Done                                   |

---

## P2 — Catalog management

**Status: implemented (2026-09-04)** in `SupplierProducts.tsx` + `seller_duplicate_product`.

| Change                                | Status                                                  |
| ------------------------------------- | ------------------------------------------------------- |
| Status, category, and stock filters   | Done                                                    |
| Sort by newest, name, stock, or price | Done (sales sort deferred)                              |
| Pagination                            | Done (client page size 12)                              |
| Bulk hide / show / delete             | Done                                                    |
| Duplicate product                     | Done (hidden copy RPC)                                  |
| Inline stock and price editing        | Deferred (inventory workbench covers stock)             |
| Image cleanup on delete               | Done (existing + bulk)                                  |
| Visibility undo                       | Done                                                    |
| Friendly domain errors                | Done                                                    |
| Query product by seller + product ID  | Done (`loadSupplierProduct` uses `.eq` + `maybeSingle`) |

---

## P2 — Settings and notifications

**Status: implemented (2026-09-04)** — `/supplier/settings`, `/supplier/notifications`.

### Settings

- Shop name, description, location, contact
- Verification status and documents (read-only)
- Notification preferences
- Delivery coverage and processing time
- Payout method
- Password / security
- Team access (later)

### Notifications

- Dedicated center + unread badge on nav
- Mark one / mark all read
- Header bell remains realtime (limit 10) with “View all”

---

## P3 — Tracking, returns, and customer insights

**Status: implemented (2026-09-04)** in migrations `20260904150000`–`20260904150200`.

| Change                                                 | Status   |
| ------------------------------------------------------ | -------- |
| Ship requires carrier + tracking (`seller_ship_order`) | Done     |
| Shipment events + status updates                       | Done     |
| Returns queue + approve/reject/receive/refund/close    | Done     |
| Retailer `request_order_return` RPC                    | Done     |
| Customer insights (order-centric, no CRM store)        | Done     |
| Nav badges include open returns                        | Done     |
| Partial fulfillment / packing-slip PDF                 | Deferred |

---

## Suggested rollout

1. Backend authorization and data-integrity fixes (P0) — **done**
2. Real-time order / dashboard / notification freshness — **done (P1)**
3. Action-first dashboard and mobile order experience — **done (P1)**
4. Earnings ledger page — **done (P1)**
5. Inventory bulk operations — **done (P2)**
6. Catalog filters, pagination, and direct product query — **done (P2)**
7. Settings and notifications center — **done (P2)**
8. Tracking, returns, and customer insights — **done (P3)**

---

## Verification constraints (updated)

| Item                                                 | Status                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| MCP access to `hrtgeupyijugssrckohx`                 | **Available** (project ACTIVE_HEALTHY)                                   |
| Checked-in migrations vs hosted                      | P0–P3 applied remotely; core table baseline dump in `supabase/baseline/` |
| Live policies / function bodies / advisors / buckets | Re-verify after P3 apply                                                 |
| shadcn                                               | `components.json` present; registries `@shadcn`, `@bklit`                |

---

## Implementation notes

- Prefer migrations applied through the normal Supabase workflow; verify with advisors after DDL.
- Match existing seller UI patterns (`SupplierWorkspaceShell`, `PageHeader`, `MetricCard`, shadcn tabs/tables).
- For any UI change, verify in the browser across desktop and mobile, and check shared state across Overview / Orders / Inventory / Products.
- Keep financial terminology consistent: **gross sales**, **net earnings**, **available payout**—never conflate chart sales with payouts.
  )
