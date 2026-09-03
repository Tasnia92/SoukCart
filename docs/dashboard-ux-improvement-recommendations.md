# Dashboard UX Improvement Recommendations

## Executive summary

The admin, buyer/retailer, and seller dashboards already have a strong foundation: their visual hierarchy is clean, role-specific, accessible, and consistent. Another broad visual redesign is not necessary.

The next iteration should focus on making each dashboard faster to act from and more trustworthy. The most important question is no longer only **“What changed?”** It is now **“What exactly should I do, and can I do it here?”**

## Highest-priority shared improvements

### 1. Take users directly to the relevant record

Actions such as **Settle**, **Review order**, **Confirm delivery**, and **Process order** currently open generic list pages. Users then have to find the same record again.

Recommended changes:

- Open the exact order, dispute, refund, product, or account.
- Use either a dedicated detail route or a contextual side sheet.
- Preserve filters and scroll position when the user returns to the dashboard.
- Include the record ID in every queue and table action.

This is likely the single highest-impact improvement across all three dashboards.

### 2. Allow common actions inside the dashboard

Users should be able to complete frequent, low-complexity tasks without leaving the overview.

Examples:

- **Admin:** approve a cancellation, settle a refund, or assign a dispute.
- **Buyer/Retailer:** retry payment, switch payment method, confirm delivery, or reorder.
- **Seller:** accept an order, review a cancellation request, or update stock.

Use confirmation dialogs for consequential actions and provide clear loading, success, and error feedback.

### 3. Make metric definitions trustworthy

The financial metrics need precise, consistent semantics.

- Admin **Revenue**, buyer **Spend**, and seller **Sales** currently behave more like non-cancelled order value than confirmed financial totals.
- Rename these metrics to **Order value** if that is intentional, or calculate them from paid/settled orders.
- Buyer **Delivered in the last 30 days** should use the delivery date rather than the order creation date.
- Add concise definition tooltips for financial and date-based KPIs.
- Ensure chart totals and KPI totals use the same time-window and timezone rules.

### 4. Show data freshness consistently

Freshness currently differs by role: admin has manual refresh, retailer has neither refresh nor order realtime, and seller only receives realtime product changes.

Recommended changes:

- Show **Updated 2 minutes ago** near the page header.
- Give every role a refresh action.
- Subscribe to relevant order changes.
- Distinguish between **Up to date**, **Refreshing**, and **Couldn’t refresh—showing older data**.
- Keep existing data visible during a refresh instead of replacing the dashboard with a loading state.

### 5. Make sections adaptive

Cards should receive space according to their current importance.

For example, the seller stock-health card occupies a large part of the primary row even when every item is healthy, while 14 orders are awaiting fulfillment.

Recommended behavior:

- Collapse healthy or empty sections into compact success strips.
- Expand sections automatically when they contain warnings or required actions.
- Replace low-value zero-state KPIs with more useful contextual information.
- Give urgent queues more space when their counts increase.

### 6. Improve mobile behavior

The collapsible navigation is effective, but wide tables currently depend on horizontal scrolling.

Below tablet width:

- Convert table rows into task-oriented cards.
- Show the three most important fields first.
- Keep one clear primary action visible.
- Put secondary metadata in an expandable section.
- Consider sticky access to the most important role-specific action.

## Admin dashboard

The admin dashboard should optimize for **risk, SLA, and exceptions**, not only marketplace reporting.

### Recommended changes

- Move the **Urgent queue** before or above the trend chart.
- Add age or SLA groupings:
  - Overdue
  - Due today
  - Due soon
- Show monetary exposure, such as **3 refunds · ৳12,400 at risk**.
- Split **Orders awaiting action** into directly selectable subcounts:
  - Awaiting confirmation
  - Cancellation requests
  - Refunds due
- Add queue filtering, ownership, and batch operations.
- Make recent-order rows clickable and open the exact order.
- Add **Pending supplier verifications** to the overview. It is an important admin workflow in the sidebar but is not represented on the dashboard.
- When **Accounts needing setup** is zero, consider replacing it with a verification or system-health metric that currently requires attention.
- Consolidate **System activity** with the notification bell, or give the card a distinct purpose such as an audit log.
- Clearly label financial totals as GMV, paid order value, or settled revenue.

### Recommended admin hierarchy

1. Urgent SLA summary
2. Action queue
3. Operational KPIs
4. Marketplace trend
5. Recent activity or audit log

## Buyer/Retailer dashboard

The existing **one next step** concept is excellent. It should become more specific and directly executable.

### Recommended changes

For failed payments, show:

- Order ID and amount
- What happened
- **Retry payment**
- **Switch to cash on delivery**, when permitted
- **Contact support** as a secondary action

Additional improvements:

- Avoid sending **Review order** to the full order list.
- Separate orders into:
  - **Needs your action**
  - **Arriving soon**
  - **Being prepared**
- Show an expected delivery date or latest shipment event, rather than only status totals.
- Replace the generic **Active** label in fulfillment stage cards with status-specific language such as **19 waiting**, **1 in transit**, and **8 cancelled**.
- Rename **Weekly spend** because the current chart displays 30 daily buckets. Either use **Spend over the last 30 days** or genuinely aggregate the data by week.
- Make the KPI row adaptive. When the cart is empty, replace the zero card with **Reorder suggestions**, **Deliveries this week**, or **Orders needing confirmation**.
- Add **Buy again** to delivered and recent orders.
- Add a compact **Frequently ordered** or saved purchasing list for repeat procurement.
- Surface invoice and download actions directly from recent orders.
- Show payment-reconciliation progress rather than silently correcting payment state in the background.
- Choose one user-facing term—**Buyer** or **Retailer**—and use it consistently.

### Recommended buyer hierarchy

1. One direct next action
2. Deliveries and orders needing buyer input
3. Quick reorder or frequent products
4. Spend and order metrics
5. History and support

## Seller dashboard

The seller’s most important task is processing incoming orders, but the fulfillment queue currently appears below the analytics and may start below the fold.

### Recommended changes

- Move the **Fulfillment queue** immediately below the KPI row.
- Add direct row actions:
  - Accept
  - Review cancellation
  - View details
- Support batch acceptance where business rules permit it.
- Sort the queue by urgency and expose waiting time prominently.
- Use escalating language and treatment for overdue orders, rather than relying only on a red card outline.
- Collapse stock health into a compact success state when inventory is healthy. Expand it when products are low or out of stock.
- Add order changes to realtime updates, or provide refresh with a last-updated timestamp.
- Clarify whether **Sales** means paid earnings or order value.
- Consider payout information:
  - Available balance
  - Pending settlement
  - Next payout
- For low-stock products, provide inline quantity editing or product-specific restock links instead of opening the generic stock page.
- When enough history exists, add a demand cue such as **3 days of stock remaining**.
- Normalize **Seller** and **Supplier** terminology across labels, routes, accessibility text, and error messages.

### Recommended seller hierarchy

1. Orders requiring action
2. Fulfillment and cancellation queue
3. Stock risks
4. Sales and payout metrics
5. Trends and product insights

## Suggested implementation sequence

### Phase 1 — High impact

1. Add record-specific order, dispute, and refund navigation.
2. Correct financial and date-based metric semantics.
3. Add visible freshness, refresh controls, and mutation feedback.
4. Move seller fulfillment and admin urgent work above analytics.
5. Fix retailer fulfillment wording and the **Weekly spend** mismatch.

### Phase 2 — Workflow efficiency

1. Add inline or side-sheet actions.
2. Add admin SLA grouping and batch operations.
3. Add buyer retry-payment, delivery-confirmation, and reorder flows.
4. Add seller accept-order and inline-restock flows.
5. Collapse healthy and zero-value cards conditionally.

### Phase 3 — Responsive and advanced improvements

1. Add mobile task cards as alternatives to wide tables.
2. Add selectable 7-, 30-, and 90-day reporting ranges.
3. Add admin verification visibility, buyer purchasing shortcuts, and seller payout visibility.
4. Add saved filters or views for users handling larger workloads.

## Expected outcome

These changes preserve the existing SoukCart visual system while making the dashboards more practical:

- Users reach the relevant record without searching twice.
- Common tasks can be completed directly from the overview.
- Financial metrics communicate exactly what they represent.
- Urgent work appears before secondary analytics.
- Healthy and empty states stop consuming disproportionate space.
- Mobile users receive focused task cards instead of wide scrolling tables.

The dashboards already explain **what changed**. This next iteration should make the required action obvious and immediately available.