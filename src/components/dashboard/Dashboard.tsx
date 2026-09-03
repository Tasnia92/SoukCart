/* -----------------------------------------------------------------------------
 * Dashboard primitives — the shared layout, metric, queue, table and state parts
 * every role overview composes. Semantically named (`db-*`) rather than borrowing
 * the `admin-*` / `rt-*` page classes, but styled from the same theme tokens.
 * -------------------------------------------------------------------------- */

import { useId, type ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
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
    <Card
      className={cn("db-card gap-0 py-0", `is-${severity}`, className)}
      aria-labelledby={headingId}
    >
      <CardHeader className="db-card-head">
        <div className="db-card-heading">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <CardTitle>
            <h2 className="db-card-title" id={headingId}>
              {title}
            </h2>
          </CardTitle>
          {meta ? <CardDescription className="db-card-meta">{meta}</CardDescription> : null}
        </div>
        {action ? <CardAction className="db-card-action">{action}</CardAction> : null}
      </CardHeader>
      <CardContent className="db-card-body">{children}</CardContent>
      {footer ? <CardFooter className="db-card-foot">{footer}</CardFooter> : null}
    </Card>
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
      <Table className="db-table">
        <TableCaption className="sr-only">{label}</TableCaption>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead
                className={column.numeric ? "is-numeric" : undefined}
                key={column.key}
                scope="col"
              >
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={rowKey(row)}>
              {columns.map((column) => (
                <TableCell
                  className={column.numeric ? "is-numeric" : undefined}
                  data-label={column.header}
                  key={column.key}
                >
                  {column.cell(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
            <Skeleton className="db-shimmer-label" />
            <Skeleton className="db-shimmer-value" />
            <Skeleton className="db-shimmer-line" />
          </div>
        ))}
      </div>
      <div className="db-row db-row-8-4" aria-hidden="true">
        <div className="db-skeleton-card db-skeleton-chart">
          <Skeleton className="db-shimmer-line" />
          <Skeleton className="db-shimmer-plot" />
        </div>
        <div className="db-skeleton-card">
          <Skeleton className="db-shimmer-line" />
          <Skeleton className="db-shimmer-row" />
          <Skeleton className="db-shimmer-row" />
          <Skeleton className="db-shimmer-row" />
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
    <Alert className="db-section-error" role="status" aria-live="polite">
      <Icon name="refresh" />
      <AlertDescription>{message}</AlertDescription>
      {onRetry ? (
        <Button variant="link" className="h-auto justify-self-start p-0" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </Alert>
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
    <Empty className="db-empty">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon name={icon} />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {copy ? <EmptyDescription>{copy}</EmptyDescription> : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
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
  const variant =
    severity === "critical"
      ? "destructive"
      : severity === "attention"
        ? "default"
        : severity === "positive"
          ? "secondary"
          : "outline";

  return <Badge variant={variant}>{children}</Badge>;
}
