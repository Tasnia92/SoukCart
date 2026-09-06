/* -----------------------------------------------------------------------------
 * Seller retailers — order-centric retailer aggregates (not a CRM), all-time,
 * with CSV export.
 * -------------------------------------------------------------------------- */

import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EmptyState,
  LoadingState,
  PageHeader,
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

type SupplierCustomersProps = {
  loadInsights?: () => Promise<SellerCustomerInsights>;
};

const ORDER_TABLES = ["orders"] as const;

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function downloadCustomersCsv(customers: readonly SellerCustomerRow[]): void {
  const header = [
    "Retailer",
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
  anchor.download = `soukcart-retailers-${new Date().toISOString().slice(0, 10)}.csv`;
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

    void loadInsights()
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
  }, [loadInsights, loadVersion]);

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
        title="We could not load retailer insights."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  const customers = insights?.customers ?? [];

  return (
    <SupplierWorkspaceShell
      section="customers"
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        title="Retailers."
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
        <Card>
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <CardTitle>Retailer list</CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!customers.length}
              onClick={() => downloadCustomersCsv(customers)}
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
                      <TableHead>Last order</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customers.map((row) => (
                      <TableRow key={row.retailerId}>
                        <TableCell>
                          <span className="block max-w-60 truncate font-medium">
                            {row.retailerName}
                          </span>
                        </TableCell>
                        <TableCell className="tabular-nums">{row.orderCount}</TableCell>
                        <TableCell className="tabular-nums font-medium">
                          {formatPrice(row.grossSales)}
                        </TableCell>
                        <TableCell>{row.lastOrderAt ? formatDate(row.lastOrderAt) : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableShell>
            ) : (
              <EmptyState
                icon={Users}
                title="No retailers yet"
                copy="When retailers buy your items, their order totals will appear here."
              />
            )}
          </CardContent>
        </Card>
      ) : (
        <LoadingState title="Loading retailer insights…" />
      )}
    </SupplierWorkspaceShell>
  );
}
