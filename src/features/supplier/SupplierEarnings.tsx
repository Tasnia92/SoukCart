/* -----------------------------------------------------------------------------
 * Seller earnings / payout ledger — totals from `seller_earnings` plus the
 * recent accrual rows (available / paid / reversed) with filters and CSV export.
 * -------------------------------------------------------------------------- */

import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, Search, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
  SearchToolbar,
  StatCard,
  StatGrid,
  TableShell,
  WorkspaceError,
} from "../../components/ui/Workspace.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { useTableChanges } from "../../workspace-realtime.ts";
import { shortId } from "../orders/order-presentation.tsx";
import { formatDate, formatPercent, formatPrice, formatUpdatedAt } from "../workspace/format.ts";
import {
  loadSellerEarnings,
  type SellerEarnings,
  type SellerEarningsRow,
  type SellerEarningsRowStatus,
} from "./supplier-dashboard-api.ts";
import { SupplierWorkspaceShell } from "./supplier-shared.tsx";

type SupplierEarningsProps = {
  loadEarnings?: () => Promise<SellerEarnings>;
};

type StatusFilter = "all" | SellerEarningsRowStatus;

const PAYOUT_TABLES = ["seller_payouts"] as const;

function payoutStatusLabel(status: SellerEarningsRowStatus): string {
  if (status === "paid") return "Paid";
  if (status === "reversed") return "Reversed";
  return "Available";
}

function payoutStatusVariant(
  status: SellerEarningsRowStatus,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "available") return "outline";
  if (status === "reversed") return "destructive";
  return "secondary";
}

function matchesStatus(row: SellerEarningsRow, filter: StatusFilter): boolean {
  return filter === "all" || row.status === filter;
}

function matchesOrderSearch(row: SellerEarningsRow, term: string): boolean {
  const query = term.trim().toLowerCase();
  if (!query) return true;
  const compact = query.replaceAll("-", "");
  return (
    row.orderId.toLowerCase().includes(query) ||
    shortId(row.orderId).toLowerCase().includes(compact)
  );
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function downloadEarningsCsv(rows: readonly SellerEarningsRow[]): void {
  const header = [
    "Order",
    "Gross",
    "Commission rate",
    "Commission",
    "Net payable",
    "Status",
    "Accrued",
    "Paid",
  ];
  const lines = [
    header.join(","),
    ...rows.map((row) =>
      [
        shortId(row.orderId),
        row.gross.toFixed(2),
        row.commissionRate.toFixed(4),
        row.commissionAmount.toFixed(2),
        row.netPayable.toFixed(2),
        row.status,
        row.accruedAt,
        row.paidAt ?? "",
      ]
        .map((cell) => csvEscape(String(cell)))
        .join(","),
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `soukcart-earnings-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function LedgerRow({ row }: { row: SellerEarningsRow }) {
  return (
    <TableRow>
      <TableCell className="font-medium">#{shortId(row.orderId)}</TableCell>
      <TableCell className="tabular-nums">{formatPrice(row.gross)}</TableCell>
      <TableCell className="tabular-nums">{formatPrice(row.commissionAmount)}</TableCell>
      <TableCell className="tabular-nums font-medium">{formatPrice(row.netPayable)}</TableCell>
      <TableCell>
        <Badge variant={payoutStatusVariant(row.status)}>{payoutStatusLabel(row.status)}</Badge>
      </TableCell>
      <TableCell>{formatDate(row.accruedAt)}</TableCell>
      <TableCell>{row.paidAt ? formatDate(row.paidAt) : "—"}</TableCell>
    </TableRow>
  );
}

export function SupplierEarnings({ loadEarnings = loadSellerEarnings }: SupplierEarningsProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/supplier/earnings" });
  const [earnings, setEarnings] = useState<SellerEarnings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchTerm, setSearchTerm] = useState("");

  const retry = useCallback(() => setLoadVersion((version) => version + 1), []);

  useTableChanges({
    enabled: Boolean(earnings) && !error,
    tables: PAYOUT_TABLES,
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

    void loadEarnings()
      .then((next) => {
        if (!current) return;
        setEarnings(next);
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
  }, [loadEarnings, loadVersion]);

  const filteredRows = useMemo(() => {
    const rows = earnings?.rows ?? [];
    return rows.filter(
      (row) => matchesStatus(row, statusFilter) && matchesOrderSearch(row, searchTerm),
    );
  }, [earnings?.rows, searchTerm, statusFilter]);

  const statusCounts = useMemo(() => {
    const rows = earnings?.rows ?? [];
    return {
      all: rows.length,
      available: rows.filter((row) => row.status === "available").length,
      paid: rows.filter((row) => row.status === "paid").length,
      reversed: rows.filter((row) => row.status === "reversed").length,
    };
  }, [earnings?.rows]);

  if (state.status !== "seller") return null;

  const onLogout = () => {
    void store.signOut().then(() => {
      void navigate({ to: "/" });
    });
  };
  const userName = state.profile.name || state.profile.email;

  if (error && !earnings) {
    return (
      <WorkspaceError
        eyebrow="Seller workspace"
        title="We could not load your earnings."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  return (
    <SupplierWorkspaceShell
      section="earnings"
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        title="Earnings and payouts."
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

      {earnings ? (
        <div className="flex flex-col gap-6">
          <StatGrid label="Earnings summary">
            <StatCard
              label="Available balance"
              value={formatPrice(earnings.available)}
              detail="Ready for the next weekly SoukCart payout"
            />
            <StatCard
              label="Paid lifetime"
              value={formatPrice(earnings.paid)}
              detail="Already settled to you"
            />
            <StatCard
              label="Commission rate"
              value={formatPercent(earnings.commissionRate)}
              detail="Applied to new delivered, paid orders"
            />
          </StatGrid>

          <Card>
            <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1.5">
                <CardTitle>Payout ledger</CardTitle>
                <CardDescription>
                  Up to 40 recent accrual rows. Export matches the filters below.
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!filteredRows.length}
                onClick={() => downloadEarningsCsv(filteredRows)}
              >
                <Download data-icon="inline-start" />
                Export CSV
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {earnings.rows.length ? (
                <>
                  <Tabs
                    value={statusFilter}
                    onValueChange={(value) => setStatusFilter(value as StatusFilter)}
                  >
                    <TabsList variant="line" className="w-full justify-start">
                      <TabsTrigger value="all">All ({statusCounts.all})</TabsTrigger>
                      <TabsTrigger value="available">
                        Available ({statusCounts.available})
                      </TabsTrigger>
                      <TabsTrigger value="paid">Paid ({statusCounts.paid})</TabsTrigger>
                      <TabsTrigger value="reversed">Reversed ({statusCounts.reversed})</TabsTrigger>
                    </TabsList>
                  </Tabs>
                  <SearchToolbar
                    label="Search payouts by order"
                    placeholder="Search by order id"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    result={`${filteredRows.length} of ${earnings.rows.length} rows`}
                  />
                  {filteredRows.length ? (
                    <TableShell>
                      <Table className="min-w-4xl">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Order</TableHead>
                            <TableHead>Gross</TableHead>
                            <TableHead>Commission</TableHead>
                            <TableHead>Net</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Accrued</TableHead>
                            <TableHead>Paid</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredRows.map((row) => (
                            <LedgerRow key={row.id} row={row} />
                          ))}
                        </TableBody>
                      </Table>
                    </TableShell>
                  ) : (
                    <EmptyState
                      icon={Search}
                      title="No payouts match these filters"
                      copy="Try another status tab or a broader order id search."
                    />
                  )}
                </>
              ) : (
                <EmptyState
                  icon={Wallet}
                  title="No payouts yet"
                  copy="Ledger rows appear after an order is delivered and paid. Available balance stays at zero until then."
                />
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <LoadingState title="Loading your earnings…" />
      )}
    </SupplierWorkspaceShell>
  );
}
