import type { ReactNode } from "react";
import { Area, CartesianGrid, ComposedChart, Line, XAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Activity, Layers } from "lucide-react";
import { barShare } from "./dashboard-model.ts";
import { DashboardCard, SectionEmpty } from "./Dashboard.tsx";

export type TrendSeries = {
  key: string;
  label: string;
  values: readonly number[];
  format: (value: number) => string;
  kind?: "area" | "line";
};

function peakOf(series: TrendSeries, labels: readonly string[]): { label: string; value: number } {
  let bestIndex = 0;
  series.values.forEach((value, index) => {
    if (value > (series.values[bestIndex] ?? 0)) bestIndex = index;
  });
  return { label: labels[bestIndex] ?? "", value: series.values[bestIndex] ?? 0 };
}

type TrendChartCardProps = {
  eyebrow: string;
  title: ReactNode;
  rangeLabel: string;
  labels: readonly string[];
  series: readonly TrendSeries[];
  summary: ReactNode;
  action?: ReactNode;
  emptyCopy: string;
};

export function TrendChartCard({
  eyebrow,
  title,
  rangeLabel,
  labels,
  series,
  summary,
  action,
  emptyCopy,
}: TrendChartCardProps) {
  const hasData = series.some((entry) => entry.values.some((value) => value > 0));
  const chartData = labels.map((label, index) => {
    const point: Record<string, string | number> = { label };
    for (const entry of series) point[entry.key] = entry.values[index] ?? 0;
    return point;
  });
  const config: ChartConfig = Object.fromEntries(
    series.map((entry, index) => [
      entry.key,
      { label: entry.label, color: `var(--chart-${(index % 5) + 1})` },
    ]),
  );

  return (
    <DashboardCard eyebrow={eyebrow} title={title} meta={rangeLabel} action={action}>
      {hasData ? (
        <figure className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {series.map((entry) => {
              const peak = peakOf(entry, labels);
              return (
                <div className="rounded-xl bg-muted px-3 py-2 text-xs" key={entry.key}>
                  <span className="text-muted-foreground">{entry.label} peak</span>{" "}
                  <strong>{entry.format(peak.value)}</strong>
                </div>
              );
            })}
          </div>
          <ChartContainer config={config} className="h-64 w-full">
            <ComposedChart accessibilityLayer data={chartData} margin={{ left: 4, right: 4 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tickMargin={10}
                minTickGap={24}
              />
              <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
              <ChartLegend content={<ChartLegendContent />} />
              {series.map((entry) =>
                entry.kind === "line" ? (
                  <Line
                    key={entry.key}
                    dataKey={entry.key}
                    type="monotone"
                    stroke={`var(--color-${entry.key})`}
                    strokeWidth={2}
                    dot={false}
                  />
                ) : (
                  <Area
                    key={entry.key}
                    dataKey={entry.key}
                    type="monotone"
                    fill={`var(--color-${entry.key})`}
                    fillOpacity={0.16}
                    stroke={`var(--color-${entry.key})`}
                    strokeWidth={2}
                  />
                ),
              )}
            </ComposedChart>
          </ChartContainer>
          <figcaption className="text-sm text-muted-foreground">{summary}</figcaption>
          <details className="rounded-xl border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              View the {labels.length}-day figures
            </summary>
            <div className="mt-3 overflow-x-auto">
              <Table>
                <TableCaption className="sr-only">{rangeLabel}</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Day</TableHead>
                    {series.map((entry) => (
                      <TableHead className="text-right" key={entry.key} scope="col">
                        {entry.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {labels.map((dayLabel, index) => (
                    <TableRow key={`${dayLabel}-${index}`}>
                      <TableCell>{dayLabel}</TableCell>
                      {series.map((entry) => (
                        <TableCell className="text-right tabular-nums" key={entry.key}>
                          {entry.format(entry.values[index] ?? 0)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </details>
        </figure>
      ) : (
        <SectionEmpty icon={Activity} title="No activity in this period" copy={emptyCopy} />
      )}
    </DashboardCard>
  );
}

export type RankedBar = {
  id: string;
  label: string;
  value: number;
  meta?: string;
};

export function RankedBarCard({
  eyebrow,
  title,
  rangeLabel,
  items,
  format,
  action,
  emptyCopy,
  valueLabel,
}: {
  eyebrow: string;
  title: ReactNode;
  rangeLabel: string;
  items: readonly RankedBar[];
  format: (value: number) => string;
  action?: ReactNode;
  emptyCopy: string;
  valueLabel: string;
}) {
  const max = items.reduce((peak, item) => Math.max(peak, item.value), 0);

  return (
    <DashboardCard eyebrow={eyebrow} title={title} meta={rangeLabel} action={action}>
      {items.length && max > 0 ? (
        <ol className="flex flex-col gap-4" aria-label={`Ranked by ${valueLabel}`}>
          {items.map((item) => (
            <li className="flex flex-col gap-2" key={item.id}>
              <div className="flex items-baseline justify-between gap-3">
                <strong className="truncate text-sm font-medium">{item.label}</strong>
                <span className="font-mono text-sm tabular-nums">{format(item.value)}</span>
              </div>
              <Progress
                value={barShare(item.value, max)}
                aria-label={`${item.label}: ${format(item.value)}`}
              />
              {item.meta ? (
                <small className="text-xs text-muted-foreground">{item.meta}</small>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <SectionEmpty icon={Layers} title="Nothing to rank yet" copy={emptyCopy} />
      )}
    </DashboardCard>
  );
}
