# SoukCart React transition plan

## Goal

Move the current vanilla TypeScript application to **React + TanStack Router + Tailwind CSS + shadcn/ui** without changing its visual identity, Supabase contracts, URLs, or user-visible behavior. The app must remain deployable and usable after every migration slice; this is a route-by-route transition, not a big-bang rewrite.

## Migration rules

1. **Keep one application root.** React owns `#app`; an unmigrated route may mount one legacy renderer inside a fresh isolated element. Never mount a legacy and React version of the same screen together.
2. **Migrate by exact route.** A route stays entirely legacy until its React replacement passes its parity gate. If a gate fails, point only that route back to the legacy bridge.
3. **Preserve backend contracts first.** Reuse `src/supabase.ts`, current table/RPC/storage/Edge Function payloads, callback URLs, query parameters, and `sessionStorage` keys. Backend redesigns must be separate changes.
4. **Preserve the current design system first.** `src/theme.css` remains the source of truth. Keep `src/style.css` while any selector still has a consumer. Tailwind and shadcn must adopt the SoukCart tokens—not replace them with default styling.
5. **Add only what a migrated slice needs.** Do not add TanStack Query, a global state library, a form library, a replacement icon set, or extra shadcn components unless a concrete migrated feature requires one.
6. **Keep interactions stable during parity work.** Preserve native validation, inline notices, browser confirmations, horizontal table scrolling, external payment navigation, and print behavior before considering UX changes.
7. **Run a gate after every slice.** A slice is complete only when formatting/lint/type checks, tests, build, route refresh, behavior, responsive layout, keyboard use, and visual comparison pass.
8. **Do not mix unrelated fixes into a route conversion.** Confirmed security or data-integrity defects are blockers and should be fixed in a small standalone change before the affected React slice.

## Current application contract

### Route inventory

| Route                                | Current behavior that must survive                                                                                                             |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                  | Login/register, role selection, signed-in role redirect, or global payment result when `status` is present or `soukcart:payment-return` exists |
| `/admin`                             | Admin login when signed out; account statistics when authorized                                                                                |
| `/admin/users`                       | Search, create, inspect, and delete users                                                                                                      |
| `/admin/activity`                    | Search and expand orders, summaries, status changes, cancellation approval/rejection                                                           |
| `/admin/complaints`                  | Search complaints, inspect attachments, resolve complaints                                                                                     |
| `/retailer`                          | Order/cart statistics and recent orders                                                                                                        |
| `/retailer/catalog`                  | Search/category filtering, quantity selection, stock checks, add-to-cart feedback                                                              |
| `/retailer/cart`                     | Persistent quantities, removal, contact/address fields, notes, online/COD selection, checkout initiation                                       |
| `/retailer/orders`                   | Order history, details, payment verification, invoices, cancellation/request rules                                                             |
| `/retailer/orders/$orderId/invoice`  | Paid-order invoice states and browser print/PDF flow                                                                                           |
| `/retailer/complaints`               | Complaint history and image/PDF upload up to 5 MB                                                                                              |
| `/retailer/checkout/success`         | Legacy payment completion route                                                                                                                |
| `/retailer/checkout/failed`          | Legacy failed-payment result                                                                                                                   |
| `/retailer/checkout/cancelled`       | Legacy cancelled-payment result                                                                                                                |
| `/supplier`                          | Product statistics and recent listings                                                                                                         |
| `/supplier/orders`                   | Search/expand supplier orders and confirm/ship actions                                                                                         |
| `/supplier/products`                 | Search, show/hide, edit, and delete products                                                                                                   |
| `/supplier/products/new`             | Product creation and optional image upload                                                                                                     |
| `/supplier/products/$productId/edit` | Product editing, image replacement, and missing-product redirect                                                                               |
| `/supplier/stock`                    | Search active products and save nonnegative integer stock, including Enter-to-save                                                             |

TanStack Router should use exact routes plus role-family not-found handling. Unknown paths under `/admin/*`, `/retailer/*`, and `/supplier/*` should redirect to that role's overview during the transition. A malformed prefix such as `/adminfoo` does not need to preserve the current accidental `startsWith` match.

### Authentication and navigation contract

- Session and profile source: `supabase.auth.getSession()` plus the caller's `users` row.
- Roles: `admin`, `retailer`, and database role `seller` (displayed as Supplier).
- `/` redirects authorized users to their role workspace; a user without a role sees role selection.
- Role selection may set only `seller` or `retailer` through the current profile policy.
- Admin signed-out behavior is an embedded admin login, not an automatic redirect.
- Retailer/supplier routes redirect a missing or wrong role according to their current behavior.
- Registration preserves the current sign-up, immediate sign-in attempt, email-confirmation message, and role dispatch.
- “Keep me signed in” remains present but has no custom behavior. Forgot-password and terms remain current “coming soon” actions unless separately scoped.
- Preserve full-page payment redirects with `window.location.assign`; router links must not intercept navigation to SSLCommerz.
- Preserve flash keys exactly:
  - `soukcart:notice`
  - `soukcart:supplier-notice`
  - `soukcart:payment-return`
- Preserve payment search keys exactly: `status`, `tran_id`, and `val_id`.

### Supabase contract inventory

- Browser tables: `users`, `products`, `cart_items`, `orders`, `order_items`, and `complaints`.
- RPCs: `supplier_orders`, `seller_set_order_status`, and `request_order_cancellation`.
- Storage buckets: `product-images` and `complaint-files`; current objects are public URLs scoped by user-folder policies.
- Admin Edge Functions: `admin-user-management`, `admin-order-overview`, and `admin-complaints`.
- Payment Edge Functions: `sslcommerz-checkout`, `sslcommerz-return`, and `sslcommerz-ipn`.
- Payment callbacks must continue landing through `sslcommerz-return`; a browser SPA route cannot receive the gateway's form POST directly.
- Do not alter stock timing: pending order items are checked against stock, while stock is applied/restored through the existing order-status trigger.
- Do not silently change multi-supplier behavior: the current supplier status RPC changes the whole order.
- Do not silently change current upload cleanup: replaced/deleted product images are removed best-effort; a failed complaint insert may leave an uploaded orphan.

### Design-system contract

- Keep `src/theme.css` variable names and both `:root`/`.dark` values.
- Keep Space Grotesk, JetBrains Mono, current type sizes/line heights/tracking, warm cream/ink/terracotta colors, hairlines, and restrained shadows.
- shadcn radius tokens must resolve to `0`; only intentionally circular controls/avatars remain circular.
- Keep `public/soukcart-logo.png`, the current wordmark treatment, hand-authored SVG icons, and auth illustration. Do not substitute Lucide paths during parity work.
- Keep current breakpoints and behavior at 62rem, 45rem, and 35rem.
- Keep table minimum widths and native horizontal overflow rather than converting tables to cards.
- Keep `prefers-reduced-motion` handling and invoice `@media print` rules.
- Keep inline notices/form feedback; do not replace them with toasts.
- Keep the create-user form as an in-flow panel; do not turn it into a modal during migration.
- Keep native selects and the current stacked mobile sidebar; shadcn Select/Sidebar/Sheet are not initial replacements.

## Definition of done

The transition is complete only when all of the following are true:

- [ ] Every route in the inventory renders through React and TanStack Router after direct navigation, client navigation, reload, and browser back/forward.
- [ ] Every role guard and redirect matches the authentication contract, including the admin embedded login and payment-result precedence at `/`.
- [ ] Every listed read, mutation, upload, RPC, Edge Function call, payment flow, error state, empty state, and loading state works against a non-production Supabase environment.
- [ ] Online payment passes in the SSLCommerz sandbox for success, failure, cancellation, delayed IPN/query reconciliation, manual verification, and invoice redirect.
- [ ] COD checkout creates the correct unpaid COD order, clears the cart, and displays the existing success notice.
- [ ] The design matches the baseline at desktop and the three current responsive boundaries, in light and latent `.dark` themes.
- [ ] Keyboard focus, labels, live feedback, disabled states, reduced motion, and invoice print output are verified.
- [ ] `vp check`, `vp test`, and `vp run build` pass from a clean install.
- [ ] No legacy renderer, delegated legacy event listener, legacy bridge, or unused selector remains.
- [ ] No production secret, service-role key, real customer data, or payment credential is added to source or test fixtures.

## Target architecture (minimum needed)

- A React `createRoot` entry in `src/main.tsx`.
- A code-based TanStack route tree. File-based generation is unnecessary during this migration and would add another moving part.
- A temporary `LegacyRoute` adapter for unmigrated routes. It receives one existing renderer, mounts it once into a fresh element, clears that element on unmount, and is keyed by the current route.
- No React `StrictMode` while the temporary adapter calls renderers that attach listeners and start async work without cleanup. Re-enable it only after the bridge is gone or the renderers become cleanup-safe.
- A small session/profile context supplied to TanStack Router for route guards. Admin keeps a route-specific signed-out state.
- Feature-local React state and TanStack route loaders/invalidation. Keep Supabase as server authority; do not introduce a second cache or persistence model.
- shadcn source components in `src/components/ui` customized to SoukCart tokens and dimensions.
- Shared React components only where current duplication proves the need: app shell/navigation, page header, stats, search toolbar, inline notice, status/payment badges, empty/error/loading state, table shell, product thumbnail/card, quantity stepper, and order disclosure rows.

---

## Phase 0 — Freeze and characterize the vanilla baseline

### 0.1 Establish a trustworthy baseline

- [ ] Protect or commit unrelated working-tree changes before migration work; do not mix them into framework commits.
- [ ] Run `vp install --frozen-lockfile`.
- [ ] Run `vp check`, `vp test`, and `vp run build`; record existing failures rather than attributing them to React later.
- [ ] Record the deployed/local environment used for parity without copying `.env` values or secrets into documentation.
- [ ] Confirm direct refresh fallback serves `index.html` for every current browser route in the actual hosting environment.

### 0.2 Confirm database reproducibility and security blockers

- [ ] Compare the connected non-production schema with checked-in migrations. The repository currently lacks the foundational schema and auth-to-profile trigger, so document or restore a reproducible source of truth before relying on fresh environments.
- [ ] Confirm RLS is enabled on `complaints`; its checked-in migration creates policies but does not show `ENABLE ROW LEVEL SECURITY`. If disabled, fix it in a standalone migration before complaint UI work.
- [ ] Confirm baseline product/order/user RLS policies exist in the target environment.
- [ ] Confirm `product-images` and `complaint-files` ownership policies with two distinct test users.
- [ ] Verify admin order and complaint function response shapes. Their source maps `retailer_id` without selecting it, which may make distinct-retailer summaries incorrect; fix separately if reproduced.
- [ ] Confirm the auth profile creation trigger and role-update policy with a new test signup.
- [ ] Record current multi-supplier order-status behavior and payment/cart-clearing behavior as explicit contracts or approve separate hardening work.

### 0.3 Prepare safe parity data

- [ ] Create non-production accounts for admin, retailer, supplier A, and supplier B.
- [ ] Prepare products covering active, hidden, no-image, image, in-stock, out-of-stock, and every category state.
- [ ] Prepare orders covering online/COD; unpaid/paid/failed/cancelled; pending/confirmed/shipped/delivered/cancelled; cancellation requested; and multiple suppliers.
- [ ] Prepare open/resolved complaints with no attachment, image attachment, and PDF attachment.
- [ ] Never use production customer records in screenshots, fixtures, or automated checks.

### 0.4 Capture the visual and behavior baseline

- [ ] Capture every route at representative desktop, 62rem, 45rem, and 35rem widths.
- [ ] Capture empty, populated, loading, validation-error, server-error, disabled, hover, focus, expanded-row, and success states where applicable.
- [ ] Capture `.dark` output even though no current UI toggles it.
- [ ] Capture reduced-motion behavior and a printed invoice/PDF preview.
- [ ] Record current visible copy, currency/date formatting, sort order, result counts, status labels, and confirmation messages.
- [ ] Create a parity checklist from the final matrix at the bottom of this document and link each baseline artifact.

**Phase 0 gate:** Current behavior is reproducible, known backend blockers are resolved or explicitly accepted, and the vanilla build is deployable.

---

## Phase 1 — Add React, TanStack Router, Tailwind, and the legacy bridge

### 1.1 Add only required pinned packages

- [ ] Add exact compatible versions of `react`, `react-dom`, and `@tanstack/react-router`.
- [ ] Add exact compatible dev versions of React DOM types, Tailwind CSS, and the Tailwind Vite integration required by the installed version.
- [ ] Initialize shadcn with a pinned CLI version and commit `components.json`; reject its default palette/radius values.
- [ ] Let shadcn add only dependencies required by components that are actually introduced. Review every generated dependency and pin it exactly.
- [ ] Do not add TanStack Query, React Hook Form, a state store, an icon package, a toast package, or a testing browser until a task below proves it is needed.

### 1.2 Configure TypeScript, Vite+, Tailwind, and aliases

- [ ] Rename the JSX entry to `src/main.tsx` and enable the React JSX transform in TypeScript.
- [ ] Add a consistent `@/* -> src/*` alias to TypeScript and Vite only if required by shadcn generation.
- [ ] Add the Tailwind Vite integration without replacing Vite+ commands or tasks.
- [ ] Load Tailwind theme/utilities before compatibility CSS. Prevent Tailwind Preflight from changing legacy button, heading, form, table, and link rendering during coexistence.
- [ ] Keep import order deterministic: Tailwind layer, `theme.css`, then legacy compatibility/component CSS as required for the installed Tailwind version.
- [ ] Verify a production build contains Tailwind utilities used from `.tsx` files.

### 1.3 Create the one-root bridge

- [ ] Render `<RouterProvider>` from one React root.
- [ ] Implement `LegacyRoute` with a fresh child element per pathname and one renderer invocation.
- [ ] Clear the child on unmount and guard late async completion from touching the active React route where possible.
- [ ] Do not wrap a legacy app in a React app shell; each legacy renderer already owns its complete shell and global selectors.
- [ ] Keep React `StrictMode` off only for the documented bridge lifetime.
- [ ] Keep legacy ordinary anchors/full reloads initially; introduce router links only inside migrated React routes.

### 1.4 Define the complete route tree before converting screens

- [ ] Add every route from the route inventory, including `$orderId` and `$productId` parameters.
- [ ] Preserve `/` payment precedence using `status` and `soukcart:payment-return` before rendering auth.
- [ ] Preserve `status`, `tran_id`, and `val_id` through initial route parsing.
- [ ] Add role-family catchalls that redirect to the appropriate overview and a safe global not-found route.
- [ ] Point every route to its current legacy renderer through the bridge.
- [ ] Confirm direct loads and full reloads still work before any React screen is introduced.

### 1.5 Add a bridge-level routing check

- [ ] Add the smallest runnable route-table check that fails when a required path is removed or mapped to the wrong legacy renderer.
- [ ] Verify legacy delegated listeners fire once after repeated navigation/reload.
- [ ] Verify payment query strings and the three session keys survive unchanged.

**Phase 1 gate:** The application is React/TanStack Router-hosted, but every route still behaves and looks like the vanilla baseline. Reverting `main.tsx` and the router files is a complete rollback.

---

## Phase 2 — Map Tailwind and shadcn to the existing design system

### 2.1 Make current tokens authoritative

- [ ] Alias Tailwind/shadcn semantic colors to existing `--color-*` variables rather than duplicating hex values.
- [ ] Map background, foreground, card, muted, border, input, primary, accent, destructive, and ring roles for both `:root` and `.dark`.
- [ ] Map font families to `--font-sans` and `--font-mono`.
- [ ] Map radius to zero and preserve explicit circles with a dedicated full-radius utility/class.
- [ ] Preserve current shadows instead of shadcn defaults.
- [ ] Preserve exact display sizes, line heights, weight 600 headings, and tracking; do not assume Tailwind typography defaults match.

### 2.2 Port leaf primitives on demand

- [ ] Port the hand-authored icon renderer to a typed React `Icon` component without changing SVG paths, view boxes, strokes, or `aria-hidden` behavior.
- [ ] Port `Brand` with the existing raster logo, live wordmark, dimensions, and light/dark class behavior.
- [ ] Add/customize shadcn `Button` first, with current primary, secondary, subtle, text, destructive, icon, block, size, active, and disabled behavior.
- [ ] Add/customize `Input`, `Textarea`, `Label`, `Checkbox`, `RadioGroup`, `Card`, `Badge`, and `Table` only when their first migrated route needs them.
- [ ] Preserve auth input-group DOM requirements until icon/input/password-action focus styles are reproduced.
- [ ] Keep inline `Alert`/notice rendering. Do not introduce toast behavior.
- [ ] Keep native confirmation dialogs for initial parity. A shadcn `AlertDialog` conversion is a separate accessibility/UX task after mutation parity.

### 2.3 Build shared layout pieces only from proven duplication

- [ ] Build `AppShell`/`SidebarNav` with the current 16rem sticky desktop sidebar and stacked mobile behavior.
- [ ] Build page header/actions, stat card, search toolbar/result count, table shell, empty state, error state, loading state, and inline notice.
- [ ] Preserve existing class names while they are the cheapest way to guarantee parity; replace classes with utilities only after the owning component passes comparison.
- [ ] Preserve exact `hidden`, `is-*`, focus, hover, active, disabled, animation, and reduced-motion states.

### 2.4 Validate the design foundation

- [ ] Render a private development gallery containing only primitives already needed by migrated routes.
- [ ] Compare light and `.dark` tokens, keyboard focus, pointer states, disabled states, long text, and reduced motion.
- [ ] Confirm Tailwind/shadcn introduces no rounded cards/buttons, new shadows, font shifts, body background changes, or control resets.

**Phase 2 gate:** New React primitives can reproduce the current visual system exactly while all production routes remain rollback-safe.

---

## Phase 3 — Migrate authentication and role dispatch

### 3.1 Centralize session/profile loading

- [ ] Create one session/profile context for React routes using the existing Supabase client.
- [ ] Represent loading, signed-out, missing-profile, roleless, admin, retailer, seller, and unknown-role states explicitly.
- [ ] Add role-specific TanStack `beforeLoad`/guard behavior without creating redirect loops.
- [ ] Preserve the admin exception: signed-out `/admin*` routes render admin login; a signed-in non-admin is signed out and shown the current error.
- [ ] Decide and test auth-state subscription cleanup; do not allow duplicate subscriptions during navigation.

### 3.2 Port auth presentation and interactions

- [ ] Convert AuthStory, AuthShell, Field, LoginForm, and RegisterForm to React while preserving markup semantics and design.
- [ ] Preserve login, native form validity, password show/hide state/labels, mode switching, heading focus, and inline feedback.
- [ ] Preserve registration password matching, sign-up metadata `{ name }`, immediate sign-in attempt, and email-confirmation fallback.
- [ ] Preserve role chooser updates and redirect destinations.
- [ ] Preserve current placeholder behavior for keep-signed-in, forgot-password, and terms rather than inventing functionality.
- [ ] Keep the admin login variant shared with the public auth components.

### 3.3 Auth parity checks

- [ ] Check invalid/valid login, unconfirmed registration, confirmed registration, duplicate email, roleless account, each role, unknown role, logout, expired session, direct protected-route load, and browser back.
- [ ] Verify feedback live regions, label associations, password `aria-pressed`, focus movement, and no flash of the wrong role screen.
- [ ] Switch `/` and admin signed-out routes from legacy to React only after all checks pass.

**Phase 3 gate:** Auth and role dispatch are fully React-owned; reverting those route mappings restores the legacy auth flow.

---

## Phase 4 — Migrate shared shells and low-risk overview routes

### 4.1 Admin overview

- [ ] Reuse `admin-user-management` list output for total, 30-day active, seven-day new, and roleless counts.
- [ ] Preserve refresh, loading, full-page retry/logout error, user identity, and logout behavior.
- [ ] Match stat layout at all breakpoints.

### 4.2 Supplier overview

- [ ] Load only the signed-in seller's products using the current select/order contract.
- [ ] Preserve total, active, out-of-stock, and unit counts plus four recent listings.
- [ ] Preserve product thumbnails/fallback icons, empty CTA, links, loading, and retry/logout error.

### 4.3 Shell/navigation checks

- [ ] Replace internal anchors with TanStack `Link` only in React shells; preserve external/full-page navigation elsewhere.
- [ ] Add `aria-current="page"` without changing appearance.
- [ ] Verify active navigation, logout, direct refresh, back/forward, narrow sidebar stacking, long names/emails, and no duplicate IDs/global selector collisions.

**Phase 4 gate:** `/admin` and `/supplier` are React routes with shared shell primitives; all other dashboard routes still work through isolated legacy mounts.

---

## Phase 5 — Migrate supplier products and stock

### 5.1 Product list

- [ ] Port own-product loading and normalization without changing select/order semantics.
- [ ] Port local search across name, description, unit, and category; preserve counts and empty/no-match states.
- [ ] Preserve active/hidden/out-of-stock cards, image crops, show/hide rules, and disabled hide action at zero stock.
- [ ] Preserve delete confirmation, seller ownership filter, error recovery, best-effort image deletion, and success notice.

### 5.2 Product create/edit

- [ ] Port exact `/new` and `/$productId/edit` routes and missing-product redirect.
- [ ] Preserve native constraints, category options, defaults, integer stock normalization, and feedback text.
- [ ] Preserve image type/5 MB validation, object-URL preview, object-URL cleanup, upload path, public URL, replacement cleanup, and failed-save behavior.
- [ ] Preserve `soukcart:supplier-notice` across the post-save redirect.
- [ ] Verify cancel navigation does not write or delete data.

### 5.3 Stock management

- [ ] Load/show only active listings while preserving current search count semantics.
- [ ] Require a whole number `>= 0`, save immediately through the current update, refresh chip/value, and show current notices.
- [ ] Preserve Enter-to-save and prevent duplicate saves while pending.

### 5.4 Supplier parity checks

- [ ] Check create/edit with and without image; replace/remove image; invalid file; upload failure; insert/update failure; hide/show; delete cancel/confirm/failure; empty/no-match; zero/restocked stock; Enter save; and cross-account ownership rejection.

**Phase 5 gate:** Supplier overview/products/new/edit/stock are React-owned; supplier orders remain legacy until the order-lifecycle slice.

---

## Phase 6 — Migrate admin user management

### 6.1 Directory and statistics

- [ ] Reuse the current `admin-user-management` list contract and structured error extraction.
- [ ] Preserve search across ID/email/name, sort/order from the function, verified/pending labels, role labels, joined/last-active formatting, empty/no-match states, and summary counts.

### 6.2 Create/delete mutations

- [ ] Keep create-user as an in-flow hidden panel with focus on the name field, native validation, current role choices, loading feedback, reset, and close behavior.
- [ ] Preserve Edge Function create rollback behavior by leaving it server-side.
- [ ] Preserve self-delete suppression, native delete confirmation, disabled state, reload, success notice, and server error display.
- [ ] Check that non-admin tokens cannot list/create/delete users.

### 6.3 Accessibility check

- [ ] Add `aria-expanded`/`aria-controls` to the create-panel trigger and restore focus on close without changing layout.
- [ ] Verify keyboard-only create/cancel/delete paths and live feedback.

**Phase 6 gate:** `/admin/users` is React-owned and all account mutations match the legacy and server contracts.

---

## Phase 7 — Migrate the cross-role order lifecycle as one vertical slice

These screens share one order status and the same stock trigger. Do not call the slice complete after converting only one role.

### 7.1 Shared order model/presentation

- [ ] Define one frontend status/payment label mapping while preserving all existing labels, badges, date/price formatting, item totals, and cancellation flags.
- [ ] Build valid table disclosure controls. Keep the paired detail-row visual design, but use a real keyboard-focusable button rather than a clickable `<tr>`.
- [ ] Preserve horizontal scrolling and current minimum table widths.

### 7.2 Retailer orders

- [ ] Load only the retailer's orders and nested items in descending creation order.
- [ ] Preserve expandable details, notes, paid invoice links, unpaid online verification, payment/COD badges, empty state, and catalog CTA.
- [ ] Preserve cancellation rules exactly: pending cancels immediately; confirmed requests admin review; requested/ shipped/delivered states show the current messages; paid copy mentions refund handling.
- [ ] Preserve current RPC result handling (`requested` versus immediate cancellation) and all confirmation/error notices.
- [ ] Preserve manual payment query behavior and current cart clearing when a payment becomes paid; payment hardening is a separate task.

### 7.3 Supplier orders

- [ ] Reuse `supplier_orders()` output, number normalization, supplier-only lines/total, search fields, counts, empty/no-match states, notes, and cancellation-request block.
- [ ] Preserve pending-to-confirmed and confirmed-to-shipped confirmations and `seller_set_order_status` payloads.
- [ ] Exercise multi-supplier orders and document that one supplier currently changes the whole order; do not accidentally implement per-supplier status only in the UI.

### 7.4 Admin order activity

- [ ] Reuse `admin-order-overview` list/summary output and error parsing.
- [ ] Preserve search, paid-revenue/order/retailer/supplier summaries, retailer/supplier attribution, expanded lines, status select, cancellation approval/rejection, refresh, and empty/no-match states.
- [ ] Preserve arbitrary admin status transitions and server rejection when stock is insufficient.

### 7.5 Cross-role order checks

- [ ] In one test sequence, place/prepare an order, confirm as supplier, inspect as retailer/admin, request cancellation, reject it, ship it, and complete the remaining status transitions.
- [ ] Verify stock changes/restoration at each server-controlled status transition and verify insufficient/concurrent-stock errors surface without stale optimistic state.
- [ ] Verify paid, unpaid, failed, cancelled, and COD displays for all three roles.

**Phase 7 gate:** `/retailer/orders`, `/supplier/orders`, and `/admin/activity` are React-owned and one connected lifecycle passes across all roles.

---

## Phase 8 — Migrate complaints as one retailer/admin vertical slice

### 8.1 Retailer Help Center

- [ ] Load complaints only on the Help Center route and only for the current retailer.
- [ ] Preserve order, open/resolved cards, filed timestamps, attachment links, empty state, and filed count.
- [ ] Preserve subject/details limits, native validity, image/PDF MIME checks, 5 MB limit, upload path, public URL insertion, progress/error feedback, and success rerender.
- [ ] Preserve current upload-before-insert/orphan behavior unless cleanup is approved as a separate backend-safe fix.

### 8.2 Admin disputes and claims

- [ ] Reuse `admin-complaints` list/update contracts.
- [ ] Preserve summaries, search, retailer identity, truncated complaint cells, attachment/new-tab safety, open/resolved badges, resolve pending state, and notices.
- [ ] Verify distinct-retailer count after any standalone response-shape fix from Phase 0.

### 8.3 Complaint security/behavior checks

- [ ] Verify retailer A cannot read retailer B complaints through the browser client.
- [ ] Verify only the owner folder can upload and an unauthorized user cannot replace/delete another user's object.
- [ ] Verify non-admin callers cannot invoke admin complaint list/update.
- [ ] Check no file, wrong MIME, oversized file, upload failure, insert failure, no attachment, image, PDF, resolve success/failure, empty/no-match, and external attachment navigation.

**Phase 8 gate:** `/retailer/complaints` and `/admin/complaints` are React-owned with confirmed RLS/authorization behavior.

---

## Phase 9 — Migrate retailer overview and catalog

### 9.1 Retailer data foundation and overview

- [ ] Load active products, own orders/items, and own cart with the current relation normalization and ordering.
- [ ] Preserve sequential unpaid-order reconciliation and current paid-result cart clearing before rendering; do not silently change this behavior in the UI conversion.
- [ ] Preserve order/pending/delivered/cart counts, four recent orders, empty CTA, loading, and retry/logout errors.

### 9.2 Catalog

- [ ] Preserve text search over product name/description/seller, sorted category pills/counts, local quantity state, and result count.
- [ ] Add `aria-pressed` to category filters without changing appearance.
- [ ] Preserve image/fallback art, seller, description, price/unit/stock copy, out-of-stock state, per-card min/max stepper behavior, and in-cart stock ceiling.
- [ ] Preserve cart upsert conflict key, server error notice, reset-to-one behavior, sidebar badge update, and added/badge animations with reduced-motion handling.
- [ ] Ensure multiple rapid add clicks cannot exceed stock or submit duplicate pending mutations.

### 9.3 Catalog checks

- [ ] Check empty/no-match/category-only/search+category, long content, image failure fallback decision, stock 0/1/many, existing cart quantity, exact stock limit, concurrent stock change, add failure, animation, and cart badge across navigation.

**Phase 9 gate:** `/retailer` and `/retailer/catalog` are React-owned; the cart/payment routes remain on the legacy bridge.

---

## Phase 10 — Migrate cart, checkout, payment results, and invoice last

This is the highest-risk slice because it crosses browser state, three Edge Functions, SSLCommerz, anonymous callbacks, order creation, cart deletion, polling, and print.

### 10.1 Cart editing and checkout form

- [ ] Preserve persisted cart loading, line filtering, totals, stock-limited quantity update, remove, empty state, and catalog links.
- [ ] Preserve phone/address/city/postcode required checks, notes, autocomplete/input modes, online default, COD option, dynamic button/icon/hint copy, and pending/disabled states.
- [ ] Preserve the current fact that contact/address data goes to SSLCommerz but only notes are stored on `orders`; changing persistence requires a separate schema/API task.

### 10.2 COD initiation

- [ ] Call `sslcommerz-checkout` with the unchanged `initiate` body and current `baseUrl`/IPN values.
- [ ] Preserve backend price authority, minimum total, order/item creation, payment method, cart deletion, `soukcart:notice`, and redirect to orders.
- [ ] Test stock rejection, empty cart, incomplete contact, function failure, order/item failure, and successful COD.

### 10.3 Online initiation and external navigation

- [ ] Preserve the same function payload and validate the returned gateway URL.
- [ ] Set `soukcart:payment-return` before leaving the app.
- [ ] Use full-page `window.location.assign` for the gateway; never use a TanStack `Link` or client navigation.
- [ ] Keep SSLCommerz success/fail/cancel/IPN URLs unchanged until Edge Functions and gateway configuration are coordinated in a separate deployment.

### 10.4 Payment return/result handling

- [ ] Port all three legacy retailer result routes and the global `/` fallback.
- [ ] Preserve `complete` handling with `tran_id`, `val_id`, and `status`.
- [ ] Preserve fallback latest-order lookup from the last hour, six polling attempts, 2.5-second interval, paid cart clearing, result copy, and invoice/orders redirects.
- [ ] Preserve manual/query reconciliation for delayed IPN results and clear the payment-return flag at the same lifecycle point.
- [ ] Cancel timers and ignore async completion after route unmount to prevent post-navigation state updates.
- [ ] Keep callback pages usable when no authenticated session is available.

### 10.5 Invoice

- [ ] Preserve UUID route parsing, loading state, not-found state, unpaid state, paid order/item mapping, bill-to identity, timestamps, references, totals, and back links.
- [ ] Preserve `window.print()` as “Download PDF”.
- [ ] Keep or extract the current A4 print stylesheet; compare print preview and generated PDF before deleting any legacy invoice selector.

### 10.6 Payment end-to-end checks

- [ ] Use SSLCommerz sandbox/test credentials only.
- [ ] Check online success with immediate return validation and invoice redirect.
- [ ] Check delayed IPN/query reconciliation, manual Verify payment, failure, cancellation, missing query values, unknown transaction, amount mismatch, and unauthenticated callback.
- [ ] Check COD separately from online failure/cancellation.
- [ ] Check refresh/back/duplicate callback safety and ensure no duplicate order is created by UI resubmission.
- [ ] Compare cart-clearing behavior for a cart changed after payment initiation; preserve the accepted contract or fix it as a separate server-coordinated hardening change before declaring payment complete.

**Phase 10 gate:** Cart, COD, online payment, callbacks, reconciliation, and invoice/print all pass against the sandbox. No payment route uses the legacy bridge.

---

## Phase 11 — Remove the bridge and legacy implementation safely

### 11.1 Remove only proven-dead code

- [ ] Confirm the route table has no `LegacyRoute` target.
- [ ] Remove the legacy bridge and re-enable React `StrictMode`; fix every duplicate-effect/subscription/timer issue it exposes.
- [ ] Delete vanilla renderers only after searching every import/caller and confirming no route or helper still depends on them.
- [ ] Consolidate duplicated formatters/status mappings only when all callers are visible and tests protect the shared behavior.
- [ ] Remove `data-*` hooks used only by delegated legacy handlers.

### 11.2 Reduce CSS without rewriting it for its own sake

- [ ] Build a selector-to-component usage list before deleting CSS.
- [ ] Delete selectors only after their final React/legacy consumer is gone and visual comparison passes.
- [ ] Keep `theme.css` as the design-token source and keep a small global layer for reset, focus, fonts, reduced motion, and print where utilities are not clearer.
- [ ] Do not convert stable CSS to `@apply` merely to claim a Tailwind migration; Tailwind utilities and shadcn components may coexist with purposeful global CSS.
- [ ] Confirm no Tailwind class is generated dynamically in a way the production scanner misses.

### 11.3 Optional post-parity accessibility/UX changes (separate review)

- [ ] Consider replacing native confirmations with a customized shadcn `AlertDialog` after delete/status/cancellation behavior is already protected.
- [ ] Fix the interactive terms control nested in the checkbox label.
- [ ] Ensure dynamic payment results announce changes through an appropriate live region.
- [ ] Add focus restoration to any remaining expandable/in-flow panels.
- [ ] Add `textarea:focus-visible` parity if not already covered by React form primitives.

**Phase 11 gate:** The runtime contains only React routes, no legacy listeners/renderers, no dead compatibility CSS, and StrictMode/check/test/build all pass.

---

## Per-slice quality gate

Run this gate before changing the next route mapping:

- [ ] `vp check`
- [ ] `vp test`
- [ ] `vp run build`
- [ ] Direct-load and refresh the migrated route.
- [ ] Navigate into/out of it and use browser back/forward.
- [ ] Verify signed-out, correct-role, wrong-role, expired-session, loading, empty, populated, mutation-pending, server-error, retry, and logout states that apply.
- [ ] Compare desktop, 62rem, 45rem, and 35rem layouts with the baseline.
- [ ] Check keyboard order, visible focus, labels, live feedback, disabled state, and reduced motion.
- [ ] Check light and `.dark` token output.
- [ ] Confirm network requests, payloads, query count/order, RPC names, Edge Function names, and storage paths match the accepted contract.
- [ ] Confirm the previous route can be restored by changing only its route component back to `LegacyRoute`.

## Final feature-parity matrix

### Authentication

- [ ] Login, logout, registration, email-confirmation fallback, password visibility, auth mode switch, role selection, all role redirects, roleless/unknown-role state, admin embedded login, wrong-role handling, and expired session.

### Admin

- [ ] Overview stats/refresh.
- [ ] User list/search/create/delete/self-protection.
- [ ] Order list/search/expand/summaries/status/cancellation approve/reject.
- [ ] Complaint list/search/attachment/resolve/summaries.
- [ ] All admin Edge Functions reject non-admin callers.

### Supplier

- [ ] Overview stats/recent products.
- [ ] Product list/search/active-hidden-out-of-stock states.
- [ ] Product create/edit/delete/show/hide and image upload/replacement/cleanup.
- [ ] Stock validation/save/Enter-to-save.
- [ ] Order list/search/expand/confirm/ship/cancellation block and supplier-only totals.

### Retailer

- [ ] Overview stats/recent orders/payment reconciliation.
- [ ] Catalog search/category/quantity/stock/add animation/cart badge.
- [ ] Cart quantity/remove/totals/contact/notes/payment-method UI.
- [ ] COD and online checkout initiation.
- [ ] Orders/expand/payment verify/cancel/request/invoice link.
- [ ] Complaints list/upload/file validation/status.
- [ ] Invoice loading/not-found/unpaid/paid/print.

### Payment and cross-cutting

- [ ] SSLCommerz success/failure/cancellation/IPN/query/manual verification/global fallback.
- [ ] Payment query keys and session keys.
- [ ] Stock trigger behavior and multi-supplier behavior.
- [ ] Loading/error/empty/retry/disabled/success states.
- [ ] Currency/date/ID formatting and visible copy.
- [ ] Responsive layouts, horizontal tables, custom icons/logo, animations, reduced motion, `.dark`, and A4 print.
- [ ] No regression in RLS, storage ownership, admin authorization, or secret handling.

## Known concerns that must not be hidden by the UI migration

Track these separately and resolve confirmed blockers before their affected phase:

- Foundational schema/profile-trigger migrations are not fully represented in the repository.
- Complaint RLS enablement is not visible in the checked-in complaint migration.
- Admin order/complaint functions appear to map `retailer_id` without selecting it.
- Checkout order and order-item creation are not one database transaction.
- A failed complaint insert can orphan an uploaded attachment; image cleanup is best-effort.
- Reconciliation may clear the retailer's whole current cart after an older order becomes paid.
- Supplier status changes apply to the whole order even when multiple suppliers are present.
- Pending orders do not reserve/decrement stock until a later status transition.
- Payment `complete`/`query` actions are callable without the browser user's JWT because gateway reconciliation is public; gateway validation is the payment authority.

Do not “fix” these incidentally in React component code. Confirm each concern, then use a dedicated SQL/Edge Function/domain change with its own rollback and end-to-end validation.
