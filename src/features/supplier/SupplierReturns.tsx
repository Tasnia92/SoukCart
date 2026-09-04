/* -----------------------------------------------------------------------------
 * Seller returns queue — open return workflow with status actions and realtime
 * refresh on `order_returns`.
 * -------------------------------------------------------------------------- */

import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, RotateCcw, Search } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
import { Textarea } from "@/components/ui/textarea";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  EmptyState,
  InlineNotice,
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
import { formatDate, formatDateTime, formatPrice, formatUpdatedAt } from "../workspace/format.ts";
import { SupplierWorkspaceShell, type SupplierNotice } from "./supplier-shared.tsx";
import {
  isOpenReturnStatus,
  loadSellerReturns,
  nextReturnActions,
  returnStatusLabel,
  setSellerReturnStatus,
  type SellerReturn,
  type SellerReturnStatus,
} from "./supplier-returns-api.ts";

type SupplierReturnsProps = {
  loadReturns?: () => Promise<SellerReturn[]>;
};

type StatusFilter = "open" | "all" | "requested" | "approved" | "received" | "refunded" | "closed";

type PendingAction = {
  returnRow: SellerReturn;
  status: Exclude<SellerReturnStatus, "requested">;
  label: string;
};

const RETURN_TABLES = ["order_returns"] as const;

function returnStatusVariant(
  status: SellerReturnStatus,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "requested") return "outline";
  if (status === "rejected") return "destructive";
  if (status === "closed" || status === "refunded") return "secondary";
  return "default";
}

function matchesFilter(row: SellerReturn, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "open") return isOpenReturnStatus(row.status);
  return row.status === filter;
}

function matchesSearch(row: SellerReturn, term: string): boolean {
  const query = term.trim().toLowerCase();
  if (!query) return true;
  const compact = query.replaceAll("-", "");
  return (
    row.retailer_name.toLowerCase().includes(query) ||
    row.retailer_email.toLowerCase().includes(query) ||
    row.order_id.toLowerCase().includes(query) ||
    shortId(row.order_id).toLowerCase().includes(compact)
  );
}

function needsNote(status: Exclude<SellerReturnStatus, "requested">): boolean {
  return status === "rejected";
}

function needsRefundAmount(status: Exclude<SellerReturnStatus, "requested">): boolean {
  return status === "refunded";
}

function ReturnActions({
  row,
  disabled,
  onAction,
}: {
  row: SellerReturn;
  disabled: boolean;
  onAction: (action: PendingAction) => void;
}) {
  const actions = nextReturnActions(row.status);
  if (!actions.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action) => (
        <Button
          key={action.status}
          type="button"
          size="sm"
          variant={action.status === "rejected" ? "destructive" : "outline"}
          disabled={disabled}
          onClick={() => onAction({ returnRow: row, status: action.status, label: action.label })}
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}

function ReturnMobileCard({
  row,
  busy,
  onAction,
}: {
  row: SellerReturn;
  busy: boolean;
  onAction: (action: PendingAction) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="font-medium">#{shortId(row.order_id)}</p>
          <p className="truncate text-sm text-muted-foreground">{row.retailer_name}</p>
          <p className="text-xs text-muted-foreground">{formatDateTime(row.requested_at)}</p>
        </div>
        <Badge variant={returnStatusVariant(row.status)}>{returnStatusLabel(row.status)}</Badge>
      </div>
      <p className="text-sm whitespace-normal text-muted-foreground">{row.reason}</p>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>Refund {formatPrice(row.refund_amount)}</span>
        <span className="font-medium">{formatPrice(row.supplier_total)}</span>
      </div>
      <ReturnActions row={row} disabled={busy} onAction={onAction} />
    </div>
  );
}

export function SupplierReturns({ loadReturns = loadSellerReturns }: SupplierReturnsProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/supplier" });
  const isMobile = useIsMobile();
  const [returns, setReturns] = useState<SellerReturn[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<SupplierNotice | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [searchTerm, setSearchTerm] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<PendingAction | null>(null);
  const [formTarget, setFormTarget] = useState<PendingAction | null>(null);
  const [sellerNote, setSellerNote] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [noteInvalid, setNoteInvalid] = useState(false);

  const retry = useCallback(() => setLoadVersion((version) => version + 1), []);

  useTableChanges({
    enabled: Boolean(returns) && !error,
    tables: RETURN_TABLES,
    onChange: retry,
    coalesceMs: 800,
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

    void loadReturns()
      .then((next) => {
        if (!current) return;
        setReturns(next);
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
  }, [loadReturns, loadVersion]);

  const counts = useMemo(() => {
    const list = returns ?? [];
    return {
      open: list.filter((row) => isOpenReturnStatus(row.status)).length,
      all: list.length,
      requested: list.filter((row) => row.status === "requested").length,
      approved: list.filter((row) => row.status === "approved").length,
      received: list.filter((row) => row.status === "received").length,
      refunded: list.filter((row) => row.status === "refunded").length,
      closed: list.filter((row) => row.status === "closed" || row.status === "rejected").length,
    };
  }, [returns]);

  const filtered = useMemo(() => {
    const list = returns ?? [];
    return list.filter((row) => matchesFilter(row, statusFilter) && matchesSearch(row, searchTerm));
  }, [returns, searchTerm, statusFilter]);

  if (state.status !== "seller") return null;

  const onLogout = () => {
    void store.signOut().then(() => {
      void navigate({ to: "/" });
    });
  };
  const userName = state.profile.name || state.profile.email;

  if (error && !returns) {
    return (
      <WorkspaceError
        eyebrow="Seller workspace"
        title="We could not load your returns."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  const openAction = (action: PendingAction) => {
    if (needsNote(action.status) || needsRefundAmount(action.status)) {
      setSellerNote(action.returnRow.seller_note);
      setRefundAmount(String(action.returnRow.refund_amount));
      setNoteInvalid(false);
      setFormTarget(action);
      return;
    }
    setConfirmTarget(action);
  };

  const applyStatus = (action: PendingAction, note?: string, amount?: number) => {
    setBusyId(action.returnRow.id);
    setNotice(null);
    void setSellerReturnStatus(action.returnRow.id, action.status, note, amount)
      .then(() => {
        setNotice({
          message: `Return for order #${shortId(action.returnRow.order_id)} is now ${returnStatusLabel(action.status).toLowerCase()}.`,
          state: "success",
        });
        retry();
      })
      .catch((actionError: unknown) => {
        setNotice({
          message:
            actionError instanceof Error ? actionError.message : "The return could not be updated.",
          state: "error",
        });
      })
      .finally(() => setBusyId(null));
  };

  const confirmSimple = () => {
    const target = confirmTarget;
    if (!target) return;
    setConfirmTarget(null);
    applyStatus(target);
  };

  const confirmForm = () => {
    const target = formTarget;
    if (!target) return;
    if (needsNote(target.status) && sellerNote.trim().length < 3) {
      setNoteInvalid(true);
      return;
    }
    const amount = needsRefundAmount(target.status) ? Number(refundAmount) : undefined;
    if (needsRefundAmount(target.status) && (!Number.isFinite(amount) || (amount ?? 0) < 0)) {
      setNotice({ message: "Enter a valid refund amount.", state: "error" });
      return;
    }
    setFormTarget(null);
    applyStatus(target, sellerNote.trim(), amount);
  };

  return (
    <SupplierWorkspaceShell
      section="returns"
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Fulfillment"
        title="Returns."
        copy="Review retailer return requests, mark items received, and record refunds for your delivered orders."
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

      <InlineNotice message={notice?.message} state={notice?.state} />

      {returns ? (
        <div className="flex flex-col gap-6">
          <StatGrid label="Returns summary">
            <StatCard
              label="Open"
              value={counts.open}
              detail="Requested, approved, received, or refunded"
            />
            <StatCard label="Requested" value={counts.requested} detail="Awaiting your decision" />
            <StatCard label="Approved" value={counts.approved} detail="Waiting for items back" />
            <StatCard label="Closed" value={counts.closed} detail="Rejected or fully closed" />
          </StatGrid>

          <Card>
            <CardHeader>
              <CardTitle>Return queue</CardTitle>
              <CardDescription>
                Advance each return through approve, receive, refund, and close.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {returns.length ? (
                <>
                  <div className="overflow-x-auto">
                    <Tabs
                      value={statusFilter}
                      onValueChange={(value) => setStatusFilter(value as StatusFilter)}
                    >
                      <TabsList variant="line" className="w-max min-w-full justify-start">
                        <TabsTrigger value="open">Open ({counts.open})</TabsTrigger>
                        <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
                        <TabsTrigger value="requested">Requested ({counts.requested})</TabsTrigger>
                        <TabsTrigger value="approved">Approved ({counts.approved})</TabsTrigger>
                        <TabsTrigger value="received">Received ({counts.received})</TabsTrigger>
                        <TabsTrigger value="refunded">Refunded ({counts.refunded})</TabsTrigger>
                        <TabsTrigger value="closed">Closed ({counts.closed})</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>
                  <SearchToolbar
                    label="Search returns"
                    placeholder="Search by retailer or order id"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    result={`${filtered.length} of ${returns.length} returns`}
                  />
                  {filtered.length ? (
                    isMobile ? (
                      <div className="flex flex-col gap-3">
                        {filtered.map((row) => (
                          <ReturnMobileCard
                            key={row.id}
                            row={row}
                            busy={busyId === row.id}
                            onAction={openAction}
                          />
                        ))}
                      </div>
                    ) : (
                      <TableShell>
                        <Table className="min-w-5xl">
                          <TableHeader>
                            <TableRow>
                              <TableHead>Order</TableHead>
                              <TableHead>Retailer</TableHead>
                              <TableHead>Requested</TableHead>
                              <TableHead>Reason</TableHead>
                              <TableHead>Refund</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>
                                <span className="sr-only">Actions</span>
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filtered.map((row) => (
                              <TableRow key={row.id}>
                                <TableCell className="font-medium">
                                  #{shortId(row.order_id)}
                                </TableCell>
                                <TableCell>
                                  <div className="flex min-w-40 flex-col">
                                    <span className="truncate font-medium">
                                      {row.retailer_name}
                                    </span>
                                    <span className="truncate text-xs text-muted-foreground">
                                      {row.retailer_email}
                                    </span>
                                  </div>
                                </TableCell>
                                <TableCell>{formatDate(row.requested_at)}</TableCell>
                                <TableCell className="max-w-56">
                                  <span className="line-clamp-2 text-sm text-muted-foreground">
                                    {row.reason}
                                  </span>
                                </TableCell>
                                <TableCell className="tabular-nums">
                                  {formatPrice(row.refund_amount)}
                                </TableCell>
                                <TableCell>
                                  <Badge variant={returnStatusVariant(row.status)}>
                                    {returnStatusLabel(row.status)}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <ReturnActions
                                    row={row}
                                    disabled={busyId === row.id}
                                    onAction={openAction}
                                  />
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableShell>
                    )
                  ) : (
                    <EmptyState
                      icon={Search}
                      title="No returns match these filters"
                      copy="Try another status tab or a broader retailer / order search."
                    />
                  )}
                </>
              ) : (
                <EmptyState
                  icon={RotateCcw}
                  title="No returns yet"
                  copy="Return requests for your delivered orders will show up here."
                />
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <LoadingState title="Loading returns…" />
      )}

      <AlertDialog
        open={confirmTarget !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmTarget
                ? `${confirmTarget.label} return for #${shortId(confirmTarget.returnRow.order_id)}?`
                : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This updates the return status and notifies the retailer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <AlertDialogAction type="button" onClick={confirmSimple}>
              {confirmTarget?.label ?? "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={formTarget !== null}
        onOpenChange={(open) => {
          if (!open) setFormTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {formTarget
                ? `${formTarget.label} return for #${shortId(formTarget.returnRow.order_id)}`
                : ""}
            </DialogTitle>
            <DialogDescription>
              {formTarget?.status === "rejected"
                ? "Add a short note explaining the rejection."
                : "Confirm the refund amount recorded for this return."}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            {formTarget && needsRefundAmount(formTarget.status) ? (
              <Field>
                <FieldLabel htmlFor="return-refund-amount">Refund amount</FieldLabel>
                <Input
                  id="return-refund-amount"
                  type="number"
                  min={0}
                  step="0.01"
                  value={refundAmount}
                  onChange={(event) => setRefundAmount(event.target.value)}
                />
              </Field>
            ) : null}
            <Field>
              <FieldLabel htmlFor="return-seller-note">
                {formTarget?.status === "rejected" ? "Rejection note" : "Seller note"}
              </FieldLabel>
              <Textarea
                id="return-seller-note"
                value={sellerNote}
                aria-invalid={noteInvalid || undefined}
                onChange={(event) => {
                  setSellerNote(event.target.value);
                  setNoteInvalid(false);
                }}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setFormTarget(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant={formTarget?.status === "rejected" ? "destructive" : "default"}
              onClick={confirmForm}
            >
              {formTarget?.label ?? "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SupplierWorkspaceShell>
  );
}
