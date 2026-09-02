/* -----------------------------------------------------------------------------
 * Dashboard charts — hand-authored inline SVG on SoukCart's own tokens.
 * -----------------------------------------------------------------------------
 * No vendor chart source is copied and no charting runtime is added; the geometry
 * comes from `dashboard-model.ts`. Every chart carries a written summary and a
 * real data table, so the picture is never the only way to read the numbers.
 * -------------------------------------------------------------------------- */

import type { ReactNode } from "react";
import { areaGeometry, barShare } from "./dashboard-model.ts";
import { DashboardCard, SectionEmpty } from "./Dashboard.tsx";

export type TrendSeries = {
  key: string;
  label: string;
  values: readonly number[];
  format: (value: number) => string;
  /** `area` fills under the line; `line` is the dashed comparison series. */
  kind?: "area" | "line";
};

const VIEW_WIDTH = 600;
const VIEW_HEIGHT = 160;

function axisTicks(labels: readonly string[]): string[] {
  if (labels.length <= 3) return [...labels];
  const middle = Math.floor((labels.length - 1) / 2);
  return [labels[0] ?? "", labels[middle] ?? "", labels[labels.length - 1] ?? ""];
}

function seriesPath(series: TrendSeries) {
  return areaGeometry(series.values, VIEW_WIDTH, VIEW_HEIGHT);
}

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
  /** The period the chart covers, e.g. "01 Aug – 30 Aug · daily". */
  rangeLabel: string;
  labels: readonly string[];
  series: readonly TrendSeries[];
  /** One sentence stating what the trend means for a decision. */
  summary: ReactNode;
  action?: ReactNode;
  emptyCopy: string;
};

/**
 * Trend card: header, range, legend, plot, written summary, and a collapsible table.
 * The plot is `aria-hidden` because the summary and table already carry every value.
 */
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
  const primary = series[0];

  return (
    <DashboardCard eyebrow={eyebrow} title={title} meta={rangeLabel} action={action}>
      {primary && hasData ? (
        <figure className="db-chart">
          <ul className="db-legend">
            {series.map((entry) => (
              <li key={entry.key}>
                <span className={`db-legend-mark is-${entry.kind ?? "area"}`} />
                <span>{entry.label}</span>
                <strong>{entry.format(peakOf(entry, labels).value)}</strong>
                <small>peak</small>
              </li>
            ))}
          </ul>

          <svg
            className="db-plot"
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
          >
            {[0.25, 0.5, 0.75].map((fraction) => (
              <line
                className="db-plot-grid"
                key={fraction}
                x1="0"
                x2={VIEW_WIDTH}
                y1={VIEW_HEIGHT * fraction}
                y2={VIEW_HEIGHT * fraction}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {series.map((entry) => {
              const geometry = seriesPath(entry);
              const kind = entry.kind ?? "area";
              return (
                <g key={entry.key}>
                  {kind === "area" ? <path className="db-plot-fill" d={geometry.areaPath} /> : null}
                  <path
                    className={`db-plot-line is-${kind}`}
                    d={geometry.linePath}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              );
            })}
            <line
              className="db-plot-axis"
              x1="0"
              x2={VIEW_WIDTH}
              y1={VIEW_HEIGHT}
              y2={VIEW_HEIGHT}
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          <ul className="db-plot-ticks" aria-hidden="true">
            {axisTicks(labels).map((tick, index) => (
              <li key={`${tick}-${index}`}>{tick}</li>
            ))}
          </ul>

          <figcaption className="db-chart-summary">{summary}</figcaption>

          <details className="db-chart-data">
            <summary>View the {labels.length}-day figures</summary>
            <div className="db-table-wrap">
              <table className="db-table">
                <caption className="sr-only">{rangeLabel}</caption>
                <thead>
                  <tr>
                    <th scope="col">Day</th>
                    {series.map((entry) => (
                      <th className="is-numeric" key={entry.key} scope="col">
                        {entry.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {labels.map((dayLabel, index) => (
                    <tr key={`${dayLabel}-${index}`}>
                      <td data-label="Day">{dayLabel}</td>
                      {series.map((entry) => (
                        <td className="is-numeric" data-label={entry.label} key={entry.key}>
                          {entry.format(entry.values[index] ?? 0)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </figure>
      ) : (
        <SectionEmpty icon="activity" title="No activity in this period" copy={emptyCopy} />
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

/**
 * Ranked comparison. The bars are decoration over a plain list: every label, value
 * and rank is readable text, so no separate text equivalent is needed.
 */
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
        <ol className="db-bars" aria-label={`Ranked by ${valueLabel}`}>
          {items.map((item) => (
            <li className="db-bar" key={item.id}>
              <span className="db-bar-head">
                <strong className="db-bar-label">{item.label}</strong>
                <span className="db-bar-value">{format(item.value)}</span>
              </span>
              <span className="db-bar-track">
                <span className="db-bar-fill" style={{ width: `${barShare(item.value, max)}%` }} />
              </span>
              {item.meta ? <small className="db-bar-meta">{item.meta}</small> : null}
            </li>
          ))}
        </ol>
      ) : (
        <SectionEmpty icon="layers" title="Nothing to rank yet" copy={emptyCopy} />
      )}
    </DashboardCard>
  );
}
