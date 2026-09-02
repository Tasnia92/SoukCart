import { describe, expect, it } from "vite-plus/test";
import {
  ageInDays,
  areaGeometry,
  barShare,
  dailySeries,
  distribution,
  failureFor,
  isWithinPreviousWindow,
  isWithinWindow,
  optionalSection,
  periodDelta,
  sumPreviousWindow,
  sumWindow,
} from "./dashboard-model.ts";

const now = Date.parse("2026-09-02T12:00:00.000Z");
const DAY = 86_400_000;

function iso(offsetDays: number, offsetMs = 0): string {
  return new Date(now - offsetDays * DAY - offsetMs).toISOString();
}

describe("dashboard windows", () => {
  it("treats the window edge as inside and one millisecond past it as outside", () => {
    expect(isWithinWindow(iso(30), now, 30)).toBe(true);
    expect(isWithinWindow(iso(30, 1), now, 30)).toBe(false);
    // A future timestamp belongs to no window rather than the current one.
    expect(isWithinWindow(new Date(now + DAY).toISOString(), now, 30)).toBe(false);
  });

  it("puts the preceding window immediately behind the trailing one", () => {
    expect(isWithinPreviousWindow(iso(30), now, 30)).toBe(false);
    expect(isWithinPreviousWindow(iso(30, 1), now, 30)).toBe(true);
    expect(isWithinPreviousWindow(iso(60), now, 30)).toBe(true);
    expect(isWithinPreviousWindow(iso(60, 1), now, 30)).toBe(false);
  });

  it("sums each window independently", () => {
    const items = [
      { at: iso(1), value: 100 },
      { at: iso(29), value: 50 },
      { at: iso(31), value: 25 },
      { at: iso(90), value: 1000 },
    ];

    expect(sumWindow(items, now, 30)).toBe(150);
    expect(sumPreviousWindow(items, now, 30)).toBe(25);
  });

  it("floors order age at whole days", () => {
    expect(ageInDays(iso(0), now)).toBe(0);
    expect(ageInDays(iso(1, -1), now)).toBe(0);
    expect(ageInDays(iso(1), now)).toBe(1);
    expect(ageInDays(iso(2, 1), now)).toBe(2);
  });
});

describe("periodDelta", () => {
  it("states what the percentage is measured against", () => {
    expect(periodDelta(120, 100)).toEqual({
      direction: "up",
      percent: 20,
      label: "+20% vs previous 30 days",
    });
    expect(periodDelta(80, 100)).toEqual({
      direction: "down",
      percent: -20,
      label: "−20% vs previous 30 days",
    });
    expect(periodDelta(100, 100)).toEqual({
      direction: "flat",
      percent: 0,
      label: "No change vs previous 30 days",
    });
  });

  it("never divides by an empty previous period", () => {
    expect(periodDelta(500, 0)).toEqual({
      direction: "new",
      percent: null,
      label: "First activity in 60 days",
    });
    expect(periodDelta(0, 0)).toEqual({
      direction: "flat",
      percent: null,
      label: "No change vs previous 30 days",
    });
  });
});

describe("dailySeries", () => {
  it("keeps one point per day, oldest first, including empty days", () => {
    const series = dailySeries(
      [
        { at: iso(0), value: 40 },
        { at: iso(0), value: 60 },
      ],
      now,
      5,
    );

    expect(series).toHaveLength(5);
    expect(series.map((bucket) => bucket.key)).toEqual(
      [...series].sort((left, right) => left.key.localeCompare(right.key)).map((b) => b.key),
    );
    const today = series[series.length - 1];
    expect(today?.value).toBe(100);
    expect(today?.count).toBe(2);
    expect(series.slice(0, 4).every((bucket) => bucket.value === 0 && bucket.count === 0)).toBe(
      true,
    );
  });

  it("drops points outside the window and unparseable timestamps", () => {
    const series = dailySeries(
      [
        { at: iso(90), value: 999 },
        { at: "not-a-date", value: 5 },
        { at: iso(1), value: 7 },
      ],
      now,
      3,
    );

    expect(series.reduce((sum, bucket) => sum + bucket.value, 0)).toBe(7);
    expect(series.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(1);
  });
});

describe("chart geometry", () => {
  it("maps a series across the viewBox with the peak on the top edge", () => {
    const geometry = areaGeometry([0, 5, 10], 100, 40);

    expect(geometry.max).toBe(10);
    expect(geometry.points).toEqual([
      { x: 0, y: 40 },
      { x: 50, y: 20 },
      { x: 100, y: 0 },
    ]);
    expect(geometry.linePath).toBe("M0 40 L50 20 L100 0");
    // The fill closes back along the baseline.
    expect(geometry.areaPath.endsWith("L100 40 L0 40 Z")).toBe(true);
  });

  it("keeps an all-zero series on the baseline instead of dividing by zero", () => {
    const geometry = areaGeometry([0, 0], 100, 40);

    expect(geometry.max).toBe(1);
    expect(geometry.points.every((point) => point.y === 40)).toBe(true);
  });

  it("handles an empty series and clamps bar shares", () => {
    expect(areaGeometry([], 100, 40).linePath).toBe("");
    expect(barShare(5, 10)).toBe(50);
    expect(barShare(20, 10)).toBe(100);
    expect(barShare(5, 0)).toBe(0);
  });
});

describe("distribution", () => {
  it("splits a whole into percentages that total 100", () => {
    const result = distribution([
      { key: "a", label: "A", count: 3, severity: "positive" },
      { key: "b", label: "B", count: 1, severity: "critical" },
    ]);

    expect(result.total).toBe(4);
    expect(result.segments.map((segment) => segment.percent)).toEqual([75, 25]);
  });

  it("reports zero width when there is nothing to show", () => {
    const result = distribution([{ key: "a", label: "A", count: 0, severity: "neutral" }]);

    expect(result.total).toBe(0);
    expect(result.segments[0]?.percent).toBe(0);
  });
});

describe("optionalSection", () => {
  it("passes a successful load straight through", async () => {
    const result = await optionalSection("Notifications", [] as number[], async () => [1, 2]);

    expect(result.value).toEqual([1, 2]);
    expect(result.failure).toBeNull();
  });

  it("falls back and reports the failure instead of rejecting", async () => {
    const result = await optionalSection("Disputes", [] as number[], () =>
      Promise.reject(new Error("Disputes are unavailable.")),
    );

    expect(result.value).toEqual([]);
    expect(result.failure).toEqual({
      section: "Disputes",
      message: "Disputes are unavailable.",
    });
    expect(failureFor([result.failure!], "Disputes")).toBe(result.failure);
    expect(failureFor([result.failure!], "Notifications")).toBeUndefined();
  });
});
