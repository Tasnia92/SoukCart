# Plan: TanStack file-based routing

## Goal

Replace the flat, code-based route table in `src/router.tsx` with TanStack Router **file-based routing** under `src/routes/`, while preserving auth guards, payment-return handling, SupplierGate, legacy inbox redirects, and splat fallbacks.

## Approach

**Thin route wrappers** — keep UI in `src/features/`; `src/routes/` owns `createFileRoute`, layout `beforeLoad`, and param wiring. Do not relocate page components into the routes tree.

---

## Phases

### Phase 0 — Tooling foundation

**Outcome:** File-route generation works; app still boots on the old router until Phase 1 cuts over.

| Task           | Detail                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Install plugin | `pnpm add -D @tanstack/router-plugin` (peer `@tanstack/react-router` `^1.170.32`)                                                     |
| Wire Vite      | Add `tanstackRouter({ target: "react", autoCodeSplitting: true, quoteStyle: "double" })` **before** other plugins in `vite.config.ts` |
| Scaffold root  | Create `src/routes/__root.tsx` with session context typing + `Outlet`                                                                 |
| Generate tree  | Produce and commit `src/routeTree.gen.ts`                                                                                             |
| Smoke          | Confirm `vp dev` / plugin generate succeeds (old `router.tsx` can still be the mounted tree until Phase 1)                            |

**Exit criteria:** Plugin generates without errors; no behavior change required yet.

---

### Phase 1 — Shared guards + router cutover shell

**Outcome:** Helpers extracted; `src/router.tsx` becomes a thin `createRouter` over the generated tree; root route works.

| Task           | Detail                                                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Extract guards | Move `guardAuthArea`, payment-location helpers into `src/lib/route-guards.ts` (reuse `PAYMENT_RETURN_KEY` from payment-return-api) |
| Root route     | `src/routes/index.tsx` — root auth + payment-return (`PaymentReturn` vs `RootAuthRoute`)                                           |
| Catch-all      | `src/routes/$.tsx` → redirect `/`                                                                                                  |
| Slim router    | `src/router.tsx` imports `routeTree` from `./routeTree.gen.ts`; keep `Register` module augmentation                                |
| Point app      | `main.tsx` keeps importing `./router.tsx` (session invalidate unchanged)                                                           |

**Exit criteria:** `/` renders landing/auth or payment return correctly; unknown top-level paths redirect home.

**Risk:** Root payment detection must skip signed-in redirects when `?status=` or flash key is present.

**Note:** Cutting over with only `/` + `/$` drops area paths from the typed route tree and breaks `tsc` (feature code navigates to `/admin/*`, `/retailer/*`, `/supplier/*`). Phase 1 therefore also scaffolds the full `src/routes/` tree and mounts temporary pathname mega-components from `src/lib/route-area-pages.tsx`. Phases 2–4 replace those megas with real leaf wrappers (and remove `route-area-pages.tsx`). Phase 5 finishes remaining cleanup (`routeContract` leftovers, optional `as never` polish, full smoke).

---

### Phase 2 — Admin area

**Outcome:** All `/admin/*` URLs are file routes; pathname mega-component gone for admin.

| Task   | Detail                                                                                                   |
| ------ | -------------------------------------------------------------------------------------------------------- |
| Layout | `admin.tsx` — `beforeLoad` admin guard; signed-out → `AdminAuthRoute`, else `<Outlet />`                 |
| Leaves | `index`, `inbox`, `users`, `activity`, `payouts`, `complaints`, `verifications`, `verifications.$userId` |
| Legacy | `inbox.urgent.tsx` / `inbox.queue.tsx` redirect → `/admin/inbox` (or keep AdminInbox canonicalize)       |
| Splat  | `admin/$.tsx` → `/admin`                                                                                 |
| Params | `$userId` via `Route.useParams()` → `<AdminSupplierVerificationDetail userId={…} />`                     |

**Exit criteria:** Admin overview, inbox (incl. legacy URLs), users, activity, payouts, complaints, verifications list + detail, and unknown `/admin/foo` all behave as today.

---

### Phase 3 — Retailer area

**Outcome:** All `/retailer/*` URLs are file routes; public checkout results stay unauthenticated.

| Task             | Detail                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Layout           | `retailer.tsx` — retailer `beforeLoad` that **skips** `/retailer/checkout/{success,failed,cancelled}`                  |
| Protected leaves | `index`, `catalog`, `cart`, `checkout`, `orders`, `orders.$orderId.invoice`, `complaints`, `notifications`, `settings` |
| Public leaves    | `checkout.success` / `failed` / `cancelled` → `CheckoutResult` (no auth)                                               |
| Splat            | `retailer/$.tsx` → `/retailer`                                                                                         |
| Params           | `$orderId` → `<RetailerInvoice orderId={…} />`                                                                         |

**Exit criteria:** Catalog/cart/checkout/orders/settings work when signed in as retailer; payment result pages render without forcing login; invoice param route works; unknown `/retailer/foo` redirects.

**Risk:** Forgetting to skip public payment paths in layout `beforeLoad` breaks SSLCommerz returns.

---

### Phase 4 — Supplier area

**Outcome:** All `/supplier/*` URLs are file routes; SupplierGate wraps the layout.

| Task   | Detail                                                                                                                                              |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout | `supplier.tsx` — supplier `beforeLoad` + `<SupplierGate><Outlet /></SupplierGate>`                                                                  |
| Leaves | `index`, `orders`, `products`, `products.new`, `products.$productId.edit`, `stock`, `earnings`, `returns`, `customers`, `notifications`, `settings` |
| Splat  | `supplier/$.tsx` → `/supplier`                                                                                                                      |
| Params | `$productId` → `<SupplierProductForm productId={…} />`; `/new` has no id                                                                            |

**Exit criteria:** Gate still blocks unverified sellers; approved sellers reach all pages; product create/edit routes work; unknown `/supplier/foo` redirects.

---

### Phase 5 — Cleanup + verification ✅

**Outcome:** Old code-based table removed; types/build green; browser smoke passes.

| Task              | Detail                                                                                                                                               | Status            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Delete dead code  | Slim `router.tsx` over `routeTree.gen.ts`; no `routeContract` / `createRoute` map; trimmed unused exports from `route-guards.ts`; megas already gone | Done              |
| Optional polish   | Dropped `as never` casts in `RouterLink` (typed tree allows plain `to`/`params`/`search`)                                                            | Done              |
| Typecheck / build | `tsc --noEmit` + `vp build` green (route code-splitting chunks present)                                                                              | Done              |
| Browser smoke     | Root auth, admin gate, retailer/supplier guards, checkout results, payment-return `/?status=`, splats, param paths, legacy inbox, link click         | Done (signed-out) |

**Exit criteria:** No references to flat `createRoute` map; build passes; smoke checklist green.

---

## Target filesystem (all phases combined)

```
src/routes/
  __root.tsx
  index.tsx
  $.tsx
  admin.tsx
  admin/
    index.tsx
    inbox.tsx
    inbox.urgent.tsx
    inbox.queue.tsx
    users.tsx
    activity.tsx
    payouts.tsx
    complaints.tsx
    verifications.tsx
    verifications.$userId.tsx
    $.tsx
  retailer.tsx
  retailer/
    index.tsx
    catalog.tsx
    cart.tsx
    checkout.tsx
    checkout.success.tsx
    checkout.failed.tsx
    checkout.cancelled.tsx
    orders.tsx
    orders.$orderId.invoice.tsx
    complaints.tsx
    notifications.tsx
    settings.tsx
    $.tsx
  supplier.tsx
  supplier/
    index.tsx
    orders.tsx
    products.tsx
    products.new.tsx
    products.$productId.edit.tsx
    stock.tsx
    earnings.tsx
    returns.tsx
    customers.tsx
    notifications.tsx
    settings.tsx
    $.tsx
```

---

## Out of scope

- Moving feature UI into `src/routes/`
- Rewriting pages to use `getRouteApi` / loaders
- New router unit tests (nice-to-have after Phase 5)

## Dependency graph

```
Phase 0  →  Phase 1  →  Phase 2
                      ↘ Phase 3
                      ↘ Phase 4
                              → Phase 5
```

Phases 2–4 can proceed in parallel after Phase 1, but sequential (admin → retailer → supplier) is safer for smoke testing.
