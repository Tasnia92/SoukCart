import { useId, type ReactNode } from "react";
import { ArrowRight, RotateCcw, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Progress } from "@/components/ui/progress";
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
import { RouterLink } from "../ui/RouterLink.tsx";
import type { DashboardSeverity, MetricDelta, SizedSegment } from "./dashboard-model.ts";

export type DashboardSplit = "8-4" | "7-5" | "6-6" | "full";

const splitClasses: Record<DashboardSplit, string> = {
  "8-4": "lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]",
  "7-5": "lg:grid-cols-[minmax(0,7fr)_minmax(18rem,5fr)]",
  "6-6": "lg:grid-cols-2",
  full: "grid-cols-1",
};

export function DashboardRow({
  split = "8-4",
  children,
}: {
  split?: DashboardSplit;
  children: ReactNode;
}) {
  return <div className={cn("grid items-start gap-4", splitClasses[split])}>{children}</div>;
}

type DashboardCardProps = {
  eyebrow?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  severity?: DashboardSeverity;
  className?: string;
  children: ReactNode;
};

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
      className={cn(
        severity === "critical" && "ring-destructive/40",
        severity === "attention" && "ring-primary/30",
        className,
      )}
      aria-labelledby={headingId}
    >
      <CardHeader>
        <div className="flex min-w-0 flex-col gap-1">
          {eyebrow ? (
            <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
              {eyebrow}
            </p>
          ) : null}
          <CardTitle id={headingId} className="text-lg">
            {title}
          </CardTitle>
          {meta ? <CardDescription>{meta}</CardDescription> : null}
        </div>
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
      {footer ? <CardFooter className="border-t text-muted-foreground">{footer}</CardFooter> : null}
    </Card>
  );
}

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
    <Button variant="link" size="sm" asChild className="h-auto justify-start px-0">
      <RouterLink to={to} params={params}>
        <span>{children}</span>
        <ArrowRight data-icon="inline-end" />
      </RouterLink>
    </Button>
  );
}

export function MetricRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label={label}>
      {children}
    </section>
  );
}

export type MetricCardProps = {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  period: string;
  delta?: MetricDelta;
  context?: ReactNode;
  severity?: DashboardSeverity;
  to: string;
  linkLabel: string;
};

export function MetricCard({
  icon: MetricIcon,
  label,
  value,
  period,
  delta,
  context,
  severity = "neutral",
  to,
  linkLabel,
}: MetricCardProps) {
  const DeltaIcon = delta?.direction === "down" ? TrendingDown : TrendingUp;
  return (
    <Card
      size="sm"
      className={cn(
        severity === "critical" && "ring-destructive/40",
        severity === "attention" && "ring-primary/30",
      )}
    >
      <CardHeader>
        <CardDescription className="text-xs font-medium tracking-widest uppercase">
          {label}
        </CardDescription>
        <CardAction>
          <span className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <MetricIcon />
          </span>
        </CardAction>
        <CardTitle className="text-3xl font-semibold tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">{period}</p>
        {delta ? (
          <p className="flex items-center gap-1 text-xs font-medium">
            <DeltaIcon />
            <span>{delta.label}</span>
          </p>
        ) : null}
        {context ? <p className="text-xs text-muted-foreground">{context}</p> : null}
        <DashboardLink to={to}>{linkLabel}</DashboardLink>
      </CardContent>
    </Card>
  );
}

export type ActionQueueEntry = {
  id: string;
  icon: LucideIcon;
  title: string;
  detail: string;
  severity: DashboardSeverity;
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
    <ItemGroup aria-label={label}>
      {items.map((item) => {
        const ItemIcon = item.icon;
        return (
          <Item key={item.id} variant={item.severity === "critical" ? "outline" : "default"}>
            <ItemMedia variant="icon">
              <ItemIcon />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{item.title}</ItemTitle>
              <ItemDescription>{item.detail}</ItemDescription>
            </ItemContent>
            <ItemActions>
              {item.marker ? <Badge variant="outline">{item.marker}</Badge> : null}
              <Button variant="ghost" size="sm" asChild>
                <RouterLink to={item.to} params={item.params}>
                  {item.actionLabel}
                  <ArrowRight data-icon="inline-end" />
                </RouterLink>
              </Button>
            </ItemActions>
          </Item>
        );
      })}
    </ItemGroup>
  );
}

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
  return (
    <div className="flex flex-col gap-5">
      <p className="flex items-baseline gap-2">
        <strong className="text-2xl font-semibold tabular-nums">{total}</strong>
        <span className="text-sm text-muted-foreground">{totalLabel}</span>
      </p>
      <div className="grid gap-3" aria-label={label}>
        {segments.map((segment) => (
          <div className="grid gap-1.5" key={segment.key}>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-muted-foreground">{segment.label}</span>
              <strong className="tabular-nums">{segment.count}</strong>
            </div>
            <Progress value={segment.percent} aria-label={`${segment.label}: ${segment.count}`} />
          </div>
        ))}
      </div>
      {items.length ? (
        <ItemGroup>
          {items.map((item) => (
            <Item key={item.id} size="sm">
              <ItemContent>
                <ItemTitle>{item.title}</ItemTitle>
                <ItemDescription>{item.detail}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Badge variant={item.severity === "critical" ? "destructive" : "outline"}>
                  {item.marker}
                </Badge>
                <Button variant="ghost" size="sm" asChild>
                  <RouterLink to={item.to} params={item.params}>
                    {item.actionLabel}
                  </RouterLink>
                </Button>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      ) : (
        <p className="text-sm text-muted-foreground">{emptyCopy}</p>
      )}
    </div>
  );
}

export type DashboardColumn<Row> = {
  key: string;
  header: string;
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
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableCaption className="sr-only">{label}</TableCaption>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead
                className={column.numeric ? "text-right" : undefined}
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
                  className={column.numeric ? "text-right tabular-nums" : undefined}
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

export function DashboardSkeleton({ label = "Loading the dashboard" }: { label?: string }) {
  return (
    <div className="flex flex-col gap-4" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-hidden="true">
        {[0, 1, 2, 3].map((slot) => (
          <Card size="sm" key={slot}>
            <CardHeader>
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-8 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-3 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]" aria-hidden="true">
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-36" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-28" />
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

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
    <Alert variant="destructive" role="status" aria-live="polite">
      <RotateCcw />
      <AlertTitle>Couldn&apos;t load this section</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </Alert>
  );
}

export function SectionEmpty({
  icon: EmptyIcon,
  title,
  copy,
  action,
}: {
  icon: LucideIcon;
  title: ReactNode;
  copy?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <EmptyIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {copy ? <EmptyDescription>{copy}</EmptyDescription> : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}

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
