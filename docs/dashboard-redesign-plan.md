# Dashboard overview redesign plan

## Goal

Replace the repeated header + four generic stat cards + recent-list layout with role-specific, decision-oriented dashboards for `/admin`, `/retailer`, and `/supplier`. Preserve SoukCart's warm editorial palette, sharp geometry, typography, and semantic theme tokens; use external blocks as composition references rather than importing a foreign visual identity.

## Reference and licensing policy

| Need                 | Reference                                                                                                                             | Intended use                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| KPI composition      | [Pace UI dashboard stats](https://paceui.com/blocks/dashboard/stats)                                                                  | Metrics with period, delta, context, and a drill-down action.                           |
| Trend-card layout    | [Pace UI dashboard charts](https://paceui.com/blocks/dashboard/charts)                                                                | Card header, date range, legend, chart, and summary.                                    |
| Action/health cards  | [Pace UI dashboard widgets](https://paceui.com/blocks/dashboard/widgets)                                                              | Operational queues, inventory health, cart, and notifications.                          |
| Compact data lists   | [Pace UI dashboard tables](https://paceui.com/blocks/dashboard/tables)                                                                | Recent orders and fulfillment queues with status badges and row actions.                |
| Notifications        | [Pace UI notification blocks](https://paceui.com/blocks/layout/notifications)                                                         | Admin alerts and urgent-item feed.                                                      |
| Free baseline        | [Pace UI free blocks](https://paceui.com/blocks/free) · [free dashboard preview](https://paceui.com/preview/templates/free-dashboard) | Direct reuse only when the selected item is explicitly free and its license permits it. |
| Area trend chart     | [bklit Area Chart](https://ui.bklit.com/docs/components/area-chart)                                                                   | Revenue, spend, or order-volume trends.                                                 |
| Ranked comparison    | [bklit Bar Chart](https://ui.bklit.com/docs/components/bar-chart)                                                                     | Top products or status totals.                                                          |
| Health distribution  | [bklit Ring Chart](https://ui.bklit.com/docs/components/ring-chart)                                                                   | Supplier stock health only when it adds information beyond the KPI row.                 |
| Future conversations | [Pace UI chat blocks](https://paceui.com/blocks/app/chats)                                                                            | Inspiration only after a real threaded-message model exists.                            |

**License gate:** Pace Pro blocks are visual inspiration only; do not copy their source without a valid project license. Confirm that a Pace item is marked free before direct reuse. bklit chart components are MIT-licensed, while bklit Studio is proprietary; use Studio only to configure/export permitted chart code. Content from these references is summarized, not reproduced.

## Proposed role dashboards

### Admin — operations command center

1. **KPI row:** 30-day revenue, orders awaiting action, open disputes, and accounts needing setup. Every card shows its period and links to the relevant page.
2. **Primary grid (8/4 columns):** bklit area chart for order volume/revenue; urgent action queue for refunds, cancellations, and disputes.
3. **Secondary grid (8/4 columns):** compact recent-orders table; notifications/system activity widget.
4. Reuse data already represented by `AdminActivity`, notifications, complaints, and user-management contracts instead of keeping the overview account-only.

### Retailer — ordering and delivery workspace

1. **Priority widget:** show one next action—checkout the current cart, track the nearest active delivery, retry a failed payment, or browse the catalog.
2. **KPI row:** 30-day spend, active orders, delivered orders, and cart units; avoid lifetime totals without context.
3. **Primary grid (7/5 columns):** fulfillment timeline/status widget; optional bklit area chart for weekly spend/order count.
4. **Recent orders table:** order ID, placed date, units, total, payment, fulfillment, and one row action.
5. **Help widget:** show open/resolved complaint tickets. Do not call this live chat until replies, participants, unread state, and realtime delivery exist.

### Supplier — fulfillment and inventory workspace

1. **KPI row:** 30-day sales, orders awaiting fulfillment, low/out-of-stock products, and active listings.
2. **Primary grid (8/4 columns):** bklit area chart for sales/orders; stock-health widget with low-stock items and restock actions.
3. **Fulfillment table:** newest actionable orders with retailer, units, value, status, age, and a process-order action.
4. **Secondary insight:** a horizontal bklit bar chart for top products. Use the ring chart only as a compact stock distribution alternative—not alongside every other chart.
5. Keep recent listings as a small secondary widget; incoming orders and stock risk have higher priority.

## Shared implementation design

Create reusable, semantically named dashboard components rather than extending `admin-*` and `rt-*` classes:

- `DashboardGrid` / `DashboardSection`
- `MetricCard` with value, period, delta, severity, icon, and link
- `TrendChartCard` with accessible summary and date range
- `ActionQueue` and `HealthWidget`
- `DashboardTable` with mobile card fallback
- `DashboardSkeleton`, section error, and empty state

Compose these from shadcn-style `Card`, `Badge`, `Table`, `Skeleton`, and accessible controls. Map bklit chart variables to SoukCart semantic tokens; avoid raw vendor colors, excessive gradients, rounded SaaS styling, 3D effects, or animation that ignores `prefers-reduced-motion`.

## Data changes

- Return purpose-built dashboard responses (`summary`, `series`, `queue`, `recent`) instead of downloading full user/product/order collections for client aggregation.
- **Admin:** combine activity summary, urgent operations, notifications, and account setup totals.
- **Retailer:** provide limited recent orders plus date buckets; move payment reconciliation out of the critical render path.
- **Supplier:** combine supplier orders and products; add sales buckets, fulfillment queue, stock-risk items, and top-product totals.
- Keep stale data visible during refresh, use section-level failures, and coalesce supplier realtime invalidations.

## Recorded reference decision

Checked before implementation:

- The referenced Pace UI dashboard catalogs (`/blocks/dashboard/stats`, `/charts`, `/widgets`, `/tables`, `/blocks/layout/notifications`) sit behind [PaceUI Pro](https://paceui.com/), a paid lifetime licence. This project holds no such licence, so **no Pace block was selected for reuse**. They informed composition only: what a metric states (period, delta, context, drill-down), and what a card header carries (range, legend, summary).
- [bklit UI](https://github.com/bklit/bklit-ui) is an open-source React charts library, but it is distributed as shadcn/ui + charting-runtime copy-paste source. SoukCart has neither shadcn/ui primitives nor a charting runtime installed, and its sharp-geometry token system would need every vendor colour remapped anyway.

**Chosen implementation:** hand-authored inline SVG charts (`DashboardCharts.tsx`) driven by pure geometry helpers, plus dashboard primitives composed from SoukCart's own `Card`/`Badge`/`Table` styling in `style.css`. No paid source is copied, no vendor chart dependency is added, and every colour resolves to a `--color-*` theme token. Content from the references above is summarized, not reproduced.

## Delivery plan

- [x] Confirm the license/availability of each selected Pace block; record the exact chosen block before implementation.
- [ ] Add shared dashboard primitives and semantic styles without changing the workspace shell.
- [ ] Define and implement role-specific aggregate API contracts.
- [ ] Build admin overview first to establish KPI, chart, queue, table, and notification patterns.
- [ ] Build supplier overview next, adding fulfillment and stock-health patterns.
- [ ] Build retailer overview last, emphasizing next action and delivery state.
- [ ] Add skeleton/error/empty states, responsive layouts, keyboard access, chart text summaries, and reduced-motion behavior.
- [ ] Validate all three roles at desktop, tablet, and mobile widths with `vp check`, `vp test`, and `vp build`.

## Acceptance criteria

Each overview must answer **what changed**, **what needs attention**, and **what action comes next**. The three roles must have visibly different information hierarchies while sharing one design system. Every chart must have a decision-making purpose and accessible text equivalent; every table/widget must link to its full workflow. No paid source is copied without a license, and no ticket UI is presented as chat without supporting backend behavior.
