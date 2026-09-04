/* -----------------------------------------------------------------------------
 * Seller customer insights — order-centric retailer aggregates (not a CRM),
 * with range tabs and CSV export.
 * -------------------------------------------------------------------------- */

import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Download, MapPin, RefreshCw, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  EmptyState,
  LoadingState,
  PageHeader,
  StatCard,
  StatGrid,
  TableShell,
  WorkspaceError,
} from "../../components/ui/Workspace.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { useTableChanges } from "../../workspace-realtime.ts";
import { formatDate, formatPrice, formatUpdatedAt } from "../workspace/format.ts";
import { SupplierWorkspaceShell } from "./supplier-shared.tsx";
import {
  loadSellerCustomerInsights,
  type SellerCustomerInsights,
  type SellerCustomerRow,
} from "./supplier-customers-api.ts";

type RangeDays = 30 | 90 | 365;

type SupplierCustomersProps = {
  loadInsights?: (days: number) => Promise<SellerCustomerInsights>;
};

const ORDER_TABLES = ["orders"] as const;
const RANGE_OPTIONS = [30, 90, 365] as const satisfies readonly RangeDays[];

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function downloadCustomersCsv(customers: readonly SellerCustomerRow[], windowDays: number): void {
  const header = [
    "Retailer",
    "Email",
    "Orders",
    "Gross sales",
    "Average order value",
    "First order",
    "Last order",
    "Top city",
    "Delivered",
  ];
  const lines = [
    header.join(","),
    ...customers.map((row) =>
      [
        row.retailerName,
        row.retailerEmail,
        row.orderCount,
        row.grossSales.toFixed(2),
        row.averageOrderValue.toFixed(2),
        row.firstOrderAt,
        row.lastOrderAt,
        row.topCity ?? "",
        row.deliveredCount,
      ]
        .map((cell) => csvEscape(String(cell)))
        .join(","),
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `soukcart-customers-${windowDays}d-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function SupplierCustomers({
  loadInsights = loadSellerCustomerInsights,
}: SupplierCustomersProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/supplier" });
  const [insights, setInsights] = useState<SellerCustomerInsights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [rangeDays, setRangeDays] = useState<RangeDays>(90);

  const retry = useCallback(() => setLoadVersion((version) => version + 1), []);

  useTableChanges({
    enabled: Boolean(insights) && !error,
    tables: ORDER_TABLES,
    onChange: retry,
    coalesceMs: 1500,
  });

  useEffect(() => {
    if (!updatedAt) return;
    const timer = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [updatedAt]);

  useEffect(() => {
    let current = true;
    setError(null);
    setLoading(true);

    void loadInsights(rangeDays)
      .then((next) => {
        if (!current) return;
        setInsights(next);
        setUpdatedAt(Date.now());
      })
      .catch((loadError: unknown) => {
        if (current) {
          setError(loadError instanceof Error ? loadError.message : "Please try again.");
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
    };
  }, [loadInsights, loadVersion, rangeDays]);

  if (state.status !== "seller") return null;

  const onLogout = () => {
    void store.signOut().then(() => {
      void navigate({ to: "/" });
    });
  };
  const userName = state.profile.name || state.profile.email;

  if (error && !insights) {
    return (
      <WorkspaceError
        eyebrow="Seller workspace"
        title="We could not load customer insights."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  const summary = insights?.summary;
  const customers = insights?.customers ?? [];
  const topCities = insights?.topCities ?? [];

  return (
    <SupplierWorkspaceShell
      section="customers"
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Insights"
        title="Customers."
        copy="Order-centric view of retailers who bought your items — not a CRM. Totals reflect your supplier share of each order."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {updatedAt ? (
              <span className="text-sm text-muted-foreground" aria-live="polite">
                {loading ? "Refreshing" : formatUpdatedAt(updatedAt, nowTick)}
              </span>
            ) : null}
            <Button type="button" variant="ghost" disabled={loading} onClick={retry}>
              {loading ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RefreshCw data-icon="inline-start" />
              )}
              Refresh
            </Button>
          </div>
        }
      />

      {insights ? (
        <div className="flex flex-col gap-6">
          <Tabs
            value={String(rangeDays)}
            onValueChange={(value) => setRangeDays(Number(value) as RangeDays)}
          >
            <TabsList variant="line" className="w-full justify-start">
              {RANGE_OPTIONS.map((days) => (
                <TabsTrigger key={days} value={String(days)}>
                  Last {days} days
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <StatGrid label="Customer summary">
            <StatCard
              label="Unique retailers"
              value={summary?.uniqueCustomers ?? 0}
              detail={`In the last ${summary?.windowDays ?? rangeDays} days`}
            />
            <StatCard
              label="Repeat retailers"
              value={summary?.repeatCustomers ?? 0}
              detail="Two or more orders in range"
            />
            <StatCard
              label="Orders"
              value={summary?.orderCount ?? 0}
              detail="Non-cancelled orders with your items"
            />
            <StatCard
              label="Gross sales"
              value={formatPrice(summary?.grossSales ?? 0)}
              detail={`AOV ${formatPrice(summary?.averageOrderValue ?? 0)}`}
            />
          </StatGrid>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <Card>
              <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1.5">
                  <CardTitle>Retailers by gross</CardTitle>
                  <CardDescription>
                    Up to 100 retailers sorted by your supplier gross in this window.
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!customers.length}
                  onClick={() => downloadCustomersCsv(customers, summary?.windowDays ?? rangeDays)}
                >
                  <Download data-icon="inline-start" />
                  Export CSV
                </Button>
              </CardHeader>
              <CardContent>
                {customers.length ? (
                  <TableShell>
                    <Table className="min-w-4xl">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Retailer</TableHead>
                          <TableHead>Orders</TableHead>
                          <TableHead>Gross</TableHead>
                          <TableHead>AOV</TableHead>
                          <TableHead>Top city</TableHead>
                          <TableHead>Last order</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {customers.map((row) => (
                          <TableRow key={row.retailerId}>
                            <TableCell>
                              <div className="flex min-w-40 flex-col">
                                <span className="truncate font-medium">{row.retailerName}</span>
                                <span className="truncate text-xs text-muted-foreground">
                                  {row.retailerEmail}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="tabular-nums">{row.orderCount}</TableCell>
                            <TableCell className="tabular-nums font-medium">
                              {formatPrice(row.grossSales)}
                            </TableCell>
                            <TableCell className="tabular-nums">
                              {formatPrice(row.averageOrderValue)}
                            </TableCell>
                            <TableCell>{row.topCity ?? "—"}</TableCell>
                            <TableCell>
                              {row.lastOrderAt ? formatDate(row.lastOrderAt) : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableShell>
                ) : (
                  <EmptyState
                    icon={Users}
                    title="No retailers in this range"
                    copy="When retailers buy your items, their order totals will appear here."
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Top cities</CardTitle>
                <CardDescription>Delivery cities ranked by your gross sales.</CardDescription>
              </CardHeader>
              <CardContent>
                {topCities.length ? (
                  <ul className="flex flex-col gap-3" aria-label="Top cities">
                    {topCities.map((city) => (
                      <li
                        key={city.city}
                        className="flex items-start justify-between gap-3 rounded-lg border p-3"
                      >
                        <div className="flex min-w-0 items-start gap-2">
                          <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <p className="truncate font-medium">{city.city}</p>
                            <p className="text-xs text-muted-foreground">
                              {city.orderCount} order{city.orderCount === 1 ? "" : "s"}
                            </p>
                          </div>
                        </div>
                        <span className="shrink-0 tabular-nums text-sm font-medium">
                          {formatPrice(city.grossSales)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState
                    icon={MapPin}
                    title="No city data yet"
                    copy="Cities appear once orders with delivery locations land in this window."
                  />
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <LoadingState title="Loading customer insights…" />
      )}
    </SupplierWorkspaceShell>
  );
}
