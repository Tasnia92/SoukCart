/* -----------------------------------------------------------------------------
 * Dashboard primitives — the shared layout, metric, queue, table and state parts
 * every role overview composes. Semantically named (`db-*`) rather than borrowing
 * the `admin-*` / `rt-*` page classes, but styled from the same theme tokens.
 * -------------------------------------------------------------------------- */

import { useId, type ReactNode } from "react";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { RouterLink } from "../ui/RouterLink.tsx";
import type { DashboardSeverity, MetricDelta, SizedSegment } from "./dashboard-model.ts";

export type DashboardSplit = "8-4" | "7-5" | "6-6" | "full";

/** Asymmetric two-column band. Collapses to one column on narrow viewports. */
export function DashboardRow({
  split = "8-4",
  children,
}: {
  split?: DashboardSplit;
  children: ReactNode;
}) {
  return <div className={`db-row db-row-${split}`}>{children}</div>;
}

type DashboardCardProps = {
  eyebrow?: ReactNode;
  title: ReactNode;
  /** Period, range or scope for the card's content. Always state it. */
  meta?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  severity?: DashboardSeverity;
  className?: string;
  children: ReactNode;
};

/** A titled panel. The heading is wired to the section with `aria-labelledby`. */
export function DashboardCard({
  eyebrow,
  title,
  meta,
  action,
  footer,
  severity = "neutral",
  className,
  children,
}: DashboardCardProps) {
  const headingId = useId();
  return (
    <section
      className={["db-card", `is-${severity}`, className].filter(Boolean).join(" ")}
      aria-labelledby={headingId}
    >
      <header className="db-card-head">
        <div className="db-card-heading">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h2 className="db-card-title" id={headingId}>
            {title}
          </h2>
          {meta ? <p className="db-card-meta">{meta}</p> : null}
        </div>
        {action ? <div className="db-card-action">{action}</div> : null}
      </header>
      <div className="db-card-body">{children}</div>
      {footer ? <footer className="db-card-foot">{footer}</footer> : null}
    </section>
  );
}

/** Text link that carries a card or metric to its full workflow. */
export function DashboardLink({
  to,
  params,
  children,
}: {
  to: string;
  params?: Record<string, string>;
  children: ReactNode;
}) {
  return (
    <RouterLink className="db-link" to={to} params={params}>
      <span>{children}</span>
      <Icon name="arrow-right" />
    </RouterLink>
  );
}

/* -----------------------------------------------------------------------------
 * Metrics
 * -------------------------------------------------------------------------- */

export function MetricRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="db-metrics" aria-label={label}>
      {children}
    </section>
  );
}

export type MetricCardProps = {
  icon: IconName;
  label: string;
  value: ReactNode;
  /** The window the value covers, e.g. "Last 30 days". Required so no total is period-less. */
  period: string;
  delta?: MetricDelta;
  /** One line of decision context: what the number means or what to do about it. */
  context?: ReactNode;
  severity?: DashboardSeverity;
  to: string;
  linkLabel: string;
};

export function MetricCard({
  icon,
  label,
  value,
  period,
  delta,
  context,
  severity = "neutral",
  to,
  linkLabel,
}: MetricCardProps) {
  return (
    <article className={`db-metric is-${severity}`}>
      <div className="db-metric-top">
        <p className="db-metric-label">{label}</p>
        <span className="db-metric-icon">
          <Icon name={icon} />
        </span>
      </div>
      <strong className="db-metric-value">{value}</strong>
      <p className="db-metric-period">{period}</p>
      {delta ? (
        <p className={`db-delta is-${delta.direction}`}>
          <Icon name={delta.direction === "down" ? "arrow-right" : "arrow-up-right"} />
          <span>{delta.label}</span>
        </p>
      ) : null}
      {context ? <p className="db-metric-context">{context}</p> : null}
      <DashboardLink to={to}>{linkLabel}</DashboardLink>
    </article>
  );
}

/* -----------------------------------------------------------------------------
 * Action queue — what needs attention, newest or most urgent first.
 * -------------------------------------------------------------------------- */

export type ActionQueueEntry = {
  id: string;
  icon: IconName;
  title: string;
  detail: string;
  severity: DashboardSeverity;
  /** Short right-aligned marker: an age, an amount or a count. */
  marker?: string;
  to: string;
  params?: Record<string, string>;
  actionLabel: string;
};

export function ActionQueue({
  label,
  items,
}: {
  label: string;
  items: readonly ActionQueueEntry[];
}) {
  return (
    <ul className="db-queue" aria-label={label}>
      {items.map((item) => (
        <li className={`db-queue-item is-${item.severity}`} key={item.id}>
          <span className="db-queue-icon">
            <Icon name={item.icon} />
          </span>
          <span className="db-queue-body">
            <strong>{item.title}</strong>
            <small>{item.detail}</small>
          </span>
          {item.marker ? <span className="db-queue-marker">{item.marker}</span> : null}
          <RouterLink className="db-queue-action" to={item.to} params={item.params}>
            <span>{item.actionLabel}</span>
            <Icon name="arrow-right" />
          </RouterLink>
        </li>
      ))}
    </ul>
  );
}

/* -----------------------------------------------------------------------------
 * Health widget — a distribution bar plus the individual items at risk.
 * -------------------------------------------------------------------------- */

export type HealthItem = {
  id: string;
  title: string;
  detail: string;
  marker: string;
  severity: DashboardSeverity;
  to: string;
  params?: Record<string, string>;
  actionLabel: string;
};

export function HealthWidget({
  label,
  total,
  totalLabel,
  segments,
  items,
  emptyCopy,
}: {
  label: string;
  total: number;
  totalLabel: string;
  segments: readonly SizedSegment[];
  items: readonly HealthItem[];
  emptyCopy: string;
}) {
  const summary = segments
    .map((segment) => `${segment.count} ${segment.label.toLowerCase()}`)
    .join(", ");

  return (
    <div className="db-health">
      <p className="db-health-summary">
        <strong>{total}</strong> <span>{totalLabel}</span>
      </p>
      <div
        className="db-health-bar"
        role="img"
        aria-label={total ? `${label}: ${summary}.` : `${label}: nothing listed yet.`}
      >
        {segments.map((segment) => (
          <span
            className={`db-health-slice is-${segment.severity}`}
            key={segment.key}
            style={{ width: `${segment.percent}%` }}
          />
        ))}
      </div>
      <ul className="db-health-legend">
        {segments.map((segment) => (
          <li key={segment.key}>
            <span className={`db-dot is-${segment.severity}`} />
            <span>{segment.label}</span>
            <strong>{segment.count}</strong>
          </li>
        ))}
      </ul>
      {items.length ? (
        <ul className="db-health-items">
          {items.map((item) => (
            <li className={`db-health-item is-${item.severity}`} key={item.id}>
              <span className="db-health-item-body">
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </span>
              <span className="db-health-item-marker">{item.marker}</span>
              <RouterLink className="db-queue-action" to={item.to} params={item.params}>
                <span>{item.actionLabel}</span>
                <Icon name="arrow-right" />
              </RouterLink>
            </li>
          ))}
        </ul>
      ) : (
        <p className="db-note">{emptyCopy}</p>
      )}
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * Compact data table. One DOM tree: at narrow widths CSS reflows the rows into
 * stacked cards and reveals each cell's `data-label`, so the table semantics and
 * the reading order survive on mobile.
 * -------------------------------------------------------------------------- */

export type DashboardColumn<Row> = {
  key: string;
  header: string;
  /** Right-align numeric columns. */
  numeric?: boolean;
  cell: (row: Row) => ReactNode;
};

export function DashboardTable<Row>({
  label,
  columns,
  rows,
  rowKey,
}: {
  label: string;
  columns: readonly DashboardColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
}) {
  return (
    <div className="db-table-wrap">
      <table className="db-table">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                className={column.numeric ? "is-numeric" : undefined}
                key={column.key}
                scope="col"
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td
                  className={column.numeric ? "is-numeric" : undefined}
                  data-label={column.header}
                  key={column.key}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * Section states — loading, failed and empty, all scoped to one card.
 * -------------------------------------------------------------------------- */

/**
 * Placeholder blocks sized like the real dashboard. The shimmer is a CSS animation,
 * which the global `prefers-reduced-motion` rule already reduces to a static tint.
 */
export function DashboardSkeleton({ label = "Loading the dashboard" }: { label?: string }) {
  return (
    <div className="db-skeleton" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="db-metrics" aria-hidden="true">
        {[0, 1, 2, 3].map((slot) => (
          <div className="db-skeleton-metric" key={slot}>
            <span className="db-shimmer db-shimmer-label" />
            <span className="db-shimmer db-shimmer-value" />
            <span className="db-shimmer db-shimmer-line" />
          </div>
        ))}
      </div>
      <div className="db-row db-row-8-4" aria-hidden="true">
        <div className="db-skeleton-card db-skeleton-chart">
          <span className="db-shimmer db-shimmer-line" />
          <span className="db-shimmer db-shimmer-plot" />
        </div>
        <div className="db-skeleton-card">
          <span className="db-shimmer db-shimmer-line" />
          <span className="db-shimmer db-shimmer-row" />
          <span className="db-shimmer db-shimmer-row" />
          <span className="db-shimmer db-shimmer-row" />
        </div>
      </div>
    </div>
  );
}

/** A failure that only takes down one section; the rest of the dashboard stays usable. */
export function SectionError({
  message,
  onRetry,
  retryLabel = "Try again",
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="db-section-error" role="status" aria-live="polite">
      <span className="db-section-error-icon">
        <Icon name="refresh" />
      </span>
      <p>{message}</p>
      {onRetry ? (
        <button className="text-button" type="button" onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

export function SectionEmpty({
  icon,
  title,
  copy,
  action,
}: {
  icon: IconName;
  title: ReactNode;
  copy?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="db-empty">
      <span className="db-empty-icon">
        <Icon name={icon} />
      </span>
      <strong>{title}</strong>
      {copy ? <span>{copy}</span> : null}
      {action}
    </div>
  );
}

/** Small labelled chip. Pairs a severity tone with words so tone is never the only cue. */
export function DashboardBadge({
  severity = "neutral",
  children,
}: {
  severity?: DashboardSeverity;
  children: ReactNode;
}) {
  return <span className={`db-badge is-${severity}`}>{children}</span>;
}
