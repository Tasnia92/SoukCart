/* -----------------------------------------------------------------------------
 * Dashboard model — the pure vocabulary every role dashboard shares.
 * -----------------------------------------------------------------------------
 * Severity, period deltas, daily bucketing and chart geometry live here as plain
 * functions so the role aggregates (`*-dashboard-api.ts`) and the presentation
 * primitives (`Dashboard.tsx`, `DashboardCharts.tsx`) agree on one shape and can
 * both be unit tested without a DOM.
 * -------------------------------------------------------------------------- */

export const DAY_MS = 86_400_000;

/** Default reporting window. Every metric states its period, so nothing reads as a lifetime total. */
export const DEFAULT_WINDOW_DAYS = 30;

/**
 * How urgently an item wants attention. Drives tone only — never the sole signal,
 * because each severity is paired with words in the UI.
 */
export type DashboardSeverity = "neutral" | "positive" | "attention" | "critical";

export type MetricDeltaDirection = "up" | "down" | "flat" | "new";

export type MetricDelta = {
  direction: MetricDeltaDirection;
  /** Rounded whole percent. `null` when there is no comparable previous period. */
  percent: number | null;
  /** Ready-to-render text, e.g. "+12% vs previous 30 days". */
  label: string;
};

/** One point of a daily series: `value` is the money/amount axis, `count` the event axis. */
export type DashboardBucket = {
  /** Sortable `YYYY-MM-DD` local day key. */
  key: string;
  /** Short human label, e.g. "02 Sep". */
  label: string;
  startsAt: number;
  value: number;
  count: number;
};

export type WindowedItem = {
  at: string;
  value: number;
};

function startOfLocalDay(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function dayKey(time: number): string {
  const date = new Date(time);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function dayLabel(time: number): string {
  return new Date(time).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

/** Whole days between `iso` and `now`, floored at 0. Used for order age. */
export function ageInDays(iso: string, now: number): number {
  const elapsed = now - new Date(iso).getTime();
  return elapsed <= 0 ? 0 : Math.floor(elapsed / DAY_MS);
}

/**
 * True when `iso` falls inside the trailing window ending at `now`.
 * The boundary is inclusive, matching the legacy overview windows.
 */
export function isWithinWindow(iso: string, now: number, days = DEFAULT_WINDOW_DAYS): boolean {
  const elapsed = now - new Date(iso).getTime();
  return elapsed >= 0 && elapsed <= days * DAY_MS;
}

/** True when `iso` falls inside the window immediately before the trailing one. */
export function isWithinPreviousWindow(
  iso: string,
  now: number,
  days = DEFAULT_WINDOW_DAYS,
): boolean {
  const elapsed = now - new Date(iso).getTime();
  return elapsed > days * DAY_MS && elapsed <= days * 2 * DAY_MS;
}

export function sumWindow(
  items: readonly WindowedItem[],
  now: number,
  days = DEFAULT_WINDOW_DAYS,
): number {
  return items.reduce(
    (sum, item) => (isWithinWindow(item.at, now, days) ? sum + item.value : sum),
    0,
  );
}

export function sumPreviousWindow(
  items: readonly WindowedItem[],
  now: number,
  days = DEFAULT_WINDOW_DAYS,
): number {
  return items.reduce(
    (sum, item) => (isWithinPreviousWindow(item.at, now, days) ? sum + item.value : sum),
    0,
  );
}

/**
 * Compares a period against the one before it. Returns wording rather than a bare
 * number so a card never shows a percentage without saying what it is measured against.
 */
export function periodDelta(
  current: number,
  previous: number,
  days = DEFAULT_WINDOW_DAYS,
): MetricDelta {
  const against = `vs previous ${days} days`;
  if (previous === 0) {
    if (current === 0) return { direction: "flat", percent: null, label: `No change ${against}` };
    return { direction: "new", percent: null, label: `First activity in ${days * 2} days` };
  }

  const percent = Math.round(((current - previous) / previous) * 100);
  if (percent === 0) return { direction: "flat", percent: 0, label: `No change ${against}` };
  const sign = percent > 0 ? "+" : "−";
  return {
    direction: percent > 0 ? "up" : "down",
    percent,
    label: `${sign}${Math.abs(percent)}% ${against}`,
  };
}

/**
 * Buckets items into one point per local day across the trailing window, oldest first.
 * Empty days are kept so the chart's x-axis stays evenly spaced and honest about gaps.
 */
export function dailySeries(
  items: readonly WindowedItem[],
  now: number,
  days = DEFAULT_WINDOW_DAYS,
): DashboardBucket[] {
  const today = startOfLocalDay(now);
  const buckets: DashboardBucket[] = [];
  const index = new Map<string, DashboardBucket>();

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const startsAt = today - offset * DAY_MS;
    const bucket: DashboardBucket = {
      key: dayKey(startsAt),
      label: dayLabel(startsAt),
      startsAt,
      value: 0,
      count: 0,
    };
    buckets.push(bucket);
    index.set(bucket.key, bucket);
  }

  for (const item of items) {
    const time = new Date(item.at).getTime();
    if (Number.isNaN(time)) continue;
    const bucket = index.get(dayKey(time));
    if (!bucket) continue;
    bucket.value += item.value;
    bucket.count += 1;
  }

  return buckets;
}

/* -----------------------------------------------------------------------------
 * Chart geometry — plain numbers in, SVG path strings out.
 * -------------------------------------------------------------------------- */

export type ChartPoint = { x: number; y: number };

export type AreaGeometry = {
  width: number;
  height: number;
  /** Closed path for the tinted fill. */
  areaPath: string;
  /** Open path for the stroke on top of the fill. */
  linePath: string;
  points: ChartPoint[];
  max: number;
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Maps a value series onto a `width × height` viewBox, oldest on the left.
 * A flat all-zero series still renders along the baseline rather than collapsing.
 */
export function areaGeometry(values: readonly number[], width = 600, height = 160): AreaGeometry {
  const max = Math.max(...values, 0) || 1;
  const points: ChartPoint[] = values.map((value, position) => {
    const ratio = values.length > 1 ? position / (values.length - 1) : 0.5;
    return {
      x: round(ratio * width),
      y: round(height - (Math.max(value, 0) / max) * height),
    };
  });

  if (!points.length) {
    return { width, height, areaPath: "", linePath: "", points, max };
  }

  const linePath = points
    .map((point, position) => `${position === 0 ? "M" : "L"}${point.x} ${point.y}`)
    .join(" ");
  const first = points[0] as ChartPoint;
  const last = points[points.length - 1] as ChartPoint;
  const areaPath = `${linePath} L${last.x} ${height} L${first.x} ${height} Z`;

  return { width, height, areaPath, linePath, points, max };
}

/** Percentage width of a bar relative to the largest value in its group. */
export function barShare(value: number, max: number): number {
  if (max <= 0) return 0;
  return round(Math.min(Math.max(value, 0) / max, 1) * 100);
}

/**
 * Splits a whole into token-mapped segments with percentage widths that always
 * total 100 when there is anything to show.
 */
export type DistributionSegment = {
  key: string;
  label: string;
  count: number;
  severity: DashboardSeverity;
};

export type SizedSegment = DistributionSegment & { percent: number };

export function distribution(segments: readonly DistributionSegment[]): {
  total: number;
  segments: SizedSegment[];
} {
  const total = segments.reduce((sum, segment) => sum + Math.max(segment.count, 0), 0);
  return {
    total,
    segments: segments.map((segment) => ({
      ...segment,
      percent: total <= 0 ? 0 : round((Math.max(segment.count, 0) / total) * 100),
    })),
  };
}

/* -----------------------------------------------------------------------------
 * Section-level failure — a supplemental panel that fails must not take the whole
 * dashboard down, so its loader resolves to a fallback plus a reportable failure.
 * -------------------------------------------------------------------------- */

export type SectionFailure = {
  /** Human name of the panel that degraded, e.g. "Notifications". */
  section: string;
  message: string;
};

export async function optionalSection<Value>(
  section: string,
  fallback: Value,
  load: () => Promise<Value>,
): Promise<{ value: Value; failure: SectionFailure | null }> {
  try {
    return { value: await load(), failure: null };
  } catch (error) {
    return {
      value: fallback,
      failure: {
        section,
        message: error instanceof Error ? error.message : `${section} could not be loaded.`,
      },
    };
  }
}

export function failureFor(
  failures: readonly SectionFailure[],
  section: string,
): SectionFailure | undefined {
  return failures.find((failure) => failure.section === section);
}
