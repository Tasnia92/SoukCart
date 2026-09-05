import { useNavigate } from "@tanstack/react-router";
import { useState, type MouseEvent } from "react";
import { ArrowRight, Mail, MapPin, Package, Phone, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  DashboardBadge,
  DashboardCard,
  DashboardLink,
  DashboardTable,
  SectionEmpty,
  SectionError,
  type DashboardColumn,
} from "../../components/dashboard/Dashboard.tsx";
import { failureFor } from "../../components/dashboard/dashboard-model.ts";
import { TableShell, type NoticeState } from "../../components/ui/Workspace.tsx";
import { PaymentBadge, shortId, StatusBadge } from "../orders/order-presentation.tsx";
import { formatDate, formatPrice } from "../workspace/format.ts";
import { RouterLink } from "../workspace/WorkspaceShell.tsx";
import { TradeLicenseCopyField } from "./trade-license-copy-field.tsx";
import { completeManualRefund, type ActivityOrder } from "./admin-activity-api.ts";
import { resolveComplaint } from "./admin-complaints-api.ts";
import {
  ADMIN_DISPUTES_SECTION,
  ADMIN_SLA_LABELS,
  ADMIN_VERIFICATIONS_SECTION,
  type AdminDashboard,
  type AdminQueueItem,
  type AdminQueueKind,
  type AdminRecentOrder,
  type AdminSlaBucket,
} from "./admin-dashboard-api.ts";

export type QueueKindFilter = "all" | AdminQueueKind;
export type QueueSlaFilter = "all" | AdminSlaBucket;

type AdminActionWorkspaceProps = {
  dashboard: AdminDashboard;
  kindFilter: QueueKindFilter;
  slaFilter: QueueSlaFilter;
  onKindFilter: (value: QueueKindFilter) => void;
  onMutated: () => void;
  onNotice: (notice: { message: string; state: NoticeState }) => void;
  search?: string;
  showKindFilters?: boolean;
};

type PendingMutation =
  | { type: "settle"; order: ActivityOrder }
  | { type: "resolve"; item: AdminQueueItem }
  | { type: "batch-settle"; orders: ActivityOrder[] }
  | { type: "batch-resolve"; items: AdminQueueItem[] };

export const KIND_FILTERS: { value: QueueKindFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "refund", label: "Refunds" },
  { value: "cancellation", label: "Cancellations" },
  { value: "dispute", label: "Disputes" },
  { value: "verification", label: "Verifications" },
];

export const QUEUE_KIND_LABELS: Record<AdminQueueKind, string> = {
  refund: "Refund",
  cancellation: "Cancellation",
  dispute: "Dispute",
  verification: "Verification",
};

function slaVariant(sla: AdminSlaBucket): "destructive" | "default" | "outline" {
  if (sla === "overdue") return "destructive";
  if (sla === "due_today") return "default";
  return "outline";
}

function matchesFilters(
  item: AdminQueueItem,
  kindFilter: QueueKindFilter,
  slaFilter: QueueSlaFilter,
): boolean {
  if (kindFilter !== "all" && item.kind !== kindFilter) return false;
  if (slaFilter !== "all" && item.sla !== slaFilter) return false;
  return true;
}

export function exposureCopy(dashboard: AdminDashboard): string {
  const { sla } = dashboard;
  const parts: string[] = [];
  if (sla.refundCount) {
    parts.push(
      `${sla.refundCount} refund${sla.refundCount === 1 ? "" : "s"} · ${formatPrice(sla.refundAmount)} at risk`,
    );
  }
  if (sla.cancellationCount) {
    parts.push(
      `${sla.cancellationCount} cancellation${sla.cancellationCount === 1 ? "" : "s"} · ${formatPrice(sla.cancellationAmount)}`,
    );
  }
  if (sla.disputeCount) {
    parts.push(`${sla.disputeCount} dispute${sla.disputeCount === 1 ? "" : "s"}`);
  }
  if (sla.verificationCount) {
    parts.push(`${sla.verificationCount} verification${sla.verificationCount === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}

function partyName(item: AdminQueueItem): string {
  if (item.order) return item.order.retailer_name;
  if (item.verification) return item.verification.shop_name;
  return item.title;
}

function recordHref(item: AdminQueueItem): {
  to: string;
  params?: Record<string, string>;
  search?: Record<string, string>;
  hash?: string;
} {
  return { to: item.to, params: item.params, search: item.search, hash: item.hash };
}

const recentColumns: DashboardColumn<AdminRecentOrder>[] = [
  {
    key: "order",
    header: "Order",
    cell: (order) => <span className="font-medium">#{shortId(order.id)}</span>,
  },
  {
    key: "retailer",
    header: "Retailer",
    cell: (order) => (
      <span className="flex flex-col gap-1">
        <span className="font-medium">{order.retailerName}</span>
        <small className="text-xs text-muted-foreground">{order.retailerEmail}</small>
      </span>
    ),
  },
  { key: "placed", header: "Placed", cell: (order) => formatDate(order.createdAt) },
  { key: "units", header: "Units", numeric: true, cell: (order) => order.units },
  {
    key: "total",
    header: "Total",
    numeric: true,
    cell: (order) => <span className="font-medium">{formatPrice(order.total)}</span>,
  },
  {
    key: "payment",
    header: "Payment",
    cell: (order) => (
      <PaymentBadge
        paymentStatus={order.paymentStatus}
        paymentMethod={order.paymentMethod}
        showFailed
      />
    ),
  },
  {
    key: "status",
    header: "Status",
    cell: (order) => (
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={order.status} />
        {order.cancelRequested ? (
          <DashboardBadge severity="critical">Cancel requested</DashboardBadge>
        ) : null}
      </div>
    ),
  },
];

export function AdminActionWorkspace({
  dashboard,
  kindFilter,
  slaFilter,
  onKindFilter,
  onMutated,
  onNotice,
  search = "",
  showKindFilters = true,
}: AdminActionWorkspaceProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [sheet, setSheet] = useState<AdminQueueItem | null>(null);
  const [pending, setPending] = useState<PendingMutation | null>(null);
  const [busy, setBusy] = useState(false);

  const disputesFailure = failureFor(dashboard.failures, ADMIN_DISPUTES_SECTION);
  const verificationsFailure = failureFor(dashboard.failures, ADMIN_VERIFICATIONS_SECTION);
  const query = search.trim().toLowerCase();
  const visible = dashboard.queue.filter((item) => {
    if (!matchesFilters(item, kindFilter, slaFilter)) return false;
    if (!query) return true;
    return (
      item.title.toLowerCase().includes(query) ||
      item.detail.toLowerCase().includes(query) ||
      item.recordId.toLowerCase().includes(query) ||
      partyName(item).toLowerCase().includes(query)
    );
  });
  const selectedItems = visible.filter((item) => selected.has(item.id));
  const selectedKind = selectedItems[0]?.kind;
  const canBatch =
    selectedItems.length > 0 &&
    selectedItems.every((item) => item.kind === selectedKind && item.batchable);

  const toggleSelected = (id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const stopRow = (event: MouseEvent) => {
    event.stopPropagation();
  };

  const run = (work: () => Promise<void>, success: string) => {
    setBusy(true);
    void work()
      .then(() => {
        onNotice({ message: success, state: "success" });
        setSelected(new Set());
        setSheet(null);
        setPending(null);
        onMutated();
      })
      .catch((error: unknown) => {
        onNotice({
          message: error instanceof Error ? error.message : "The action could not be completed.",
          state: "error",
        });
      })
      .finally(() => setBusy(false));
  };

  const confirmPending = () => {
    if (!pending) return;
    if (pending.type === "settle") {
      const order = pending.order;
      run(
        () => completeManualRefund(order.id),
        `Manual refund for order #${shortId(order.id)} was marked completed.`,
      );
      return;
    }
    if (pending.type === "resolve") {
      const complaint = pending.item.complaint;
      if (!complaint) return;
      run(() => resolveComplaint(complaint.id), "Dispute marked as resolved.");
      return;
    }
    if (pending.type === "batch-settle") {
      const orders = pending.orders;
      run(
        () =>
          Promise.all(orders.map((order) => completeManualRefund(order.id))).then(() => undefined),
        `${orders.length} refunds marked completed.`,
      );
      return;
    }
    const items = pending.items;
    run(
      () =>
        Promise.all(
          items.map((item) =>
            item.complaint ? resolveComplaint(item.complaint.id) : Promise.resolve(),
          ),
        ).then(() => undefined),
      `${items.length} disputes marked as resolved.`,
    );
  };

  const startBatch = () => {
    if (!canBatch || !selectedKind) return;
    if (selectedKind === "refund") {
      const orders = selectedItems
        .map((item) => item.order)
        .filter((order): order is ActivityOrder => Boolean(order));
      setPending({ type: "batch-settle", orders });
      return;
    }
    if (selectedKind === "dispute") {
      setPending({ type: "batch-resolve", items: [...selectedItems] });
    }
  };

  const pendingMessage = (() => {
    if (!pending) return "";
    if (pending.type === "settle") {
      return `Confirm that the manual refund of ${formatPrice(pending.order.refund_amount)} for order #${shortId(pending.order.id)} has been paid?`;
    }
    if (pending.type === "resolve") {
      return `Mark “${pending.item.title}” as resolved?`;
    }
    if (pending.type === "batch-settle") {
      return `Mark ${pending.orders.length} manual refunds as completed?`;
    }
    return `Mark ${pending.items.length} disputes as resolved?`;
  })();

  const openQueueItem = (item: AdminQueueItem) => setSheet(item);

  const sheetItem = sheet;
  const sheetOrder = sheet?.order;

  return (
    <>
      {dashboard.queue.length ? (
        <div className="flex flex-col gap-4" id="admin-action-queue">
          {disputesFailure ? (
            <SectionError
              message={`Disputes could not be loaded, so this queue may be incomplete. ${disputesFailure.message}`}
              onRetry={onMutated}
            />
          ) : null}
          {verificationsFailure ? (
            <SectionError
              message={`Supplier verifications could not be loaded. ${verificationsFailure.message}`}
              onRetry={onMutated}
            />
          ) : null}

          <div className="flex flex-col gap-3">
            {showKindFilters ? (
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={kindFilter}
                onValueChange={(value) => onKindFilter((value || "all") as QueueKindFilter)}
                className="flex flex-wrap"
                aria-label="Filter by type"
              >
                {KIND_FILTERS.map((filter) => (
                  <ToggleGroupItem value={filter.value} key={filter.value}>
                    {filter.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            ) : null}
          </div>

          {selectedItems.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">{selectedItems.length} selected</span>
              <Button type="button" size="sm" disabled={!canBatch || busy} onClick={startBatch}>
                {busy ? <Spinner data-icon="inline-start" /> : null}
                {selectedKind === "refund"
                  ? "Settle selected refunds"
                  : selectedKind === "dispute"
                    ? "Resolve selected disputes"
                    : "Batch not available"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setSelected(new Set())}
              >
                Clear
              </Button>
            </div>
          ) : null}

          {visible.length ? (
            <>
              <div className="flex flex-col gap-3 md:hidden">
                {visible.map((item) => (
                  <Item
                    key={item.id}
                    variant="outline"
                    className="cursor-pointer"
                    onClick={() => openQueueItem(item)}
                  >
                    <ItemMedia variant="icon">
                      <span onClick={stopRow} onKeyDown={(event) => event.stopPropagation()}>
                        <Checkbox
                          checked={selected.has(item.id)}
                          onCheckedChange={(checked) => toggleSelected(item.id, checked === true)}
                          aria-label={`Select ${item.title}`}
                        />
                      </span>
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{item.title}</ItemTitle>
                      <ItemDescription>
                        {partyName(item)} · {item.marker}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions onClick={stopRow}>
                      <Badge variant={slaVariant(item.sla)}>{ADMIN_SLA_LABELS[item.sla]}</Badge>
                      <Button type="button" size="sm" onClick={() => openQueueItem(item)}>
                        Open
                      </Button>
                    </ItemActions>
                  </Item>
                ))}
              </div>
              <TableShell className="hidden md:block">
                <Table className="db-queue min-w-[56rem]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <span className="sr-only">Select</span>
                      </TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>What</TableHead>
                      <TableHead>Who</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((item) => (
                      <TableRow
                        key={item.id}
                        className="cursor-pointer"
                        onClick={() => openQueueItem(item)}
                      >
                        <TableCell onClick={stopRow}>
                          <Checkbox
                            checked={selected.has(item.id)}
                            onCheckedChange={(checked) => toggleSelected(item.id, checked === true)}
                            aria-label={`Select ${item.title}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{QUEUE_KIND_LABELS[item.kind]}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex min-w-0 flex-col gap-1">
                            <strong className="font-medium">{item.title}</strong>
                            <small className="truncate text-xs text-muted-foreground">
                              {item.detail}
                            </small>
                          </div>
                        </TableCell>
                        <TableCell>{partyName(item)}</TableCell>
                        <TableCell>
                          {item.amount !== null ? (
                            <strong className="font-medium">{formatPrice(item.amount)}</strong>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Badge variant={slaVariant(item.sla)}>
                              {ADMIN_SLA_LABELS[item.sla]}
                            </Badge>
                            <small className="text-xs text-muted-foreground">{item.marker}</small>
                          </div>
                        </TableCell>
                        <TableCell className="text-right" onClick={stopRow}>
                          <div className="flex justify-end gap-2">
                            {item.kind === "refund" &&
                            item.order?.manual_refund_status === "pending" ? (
                              <Button
                                type="button"
                                size="sm"
                                disabled={busy}
                                onClick={() => {
                                  const order = item.order;
                                  if (order) setPending({ type: "settle", order });
                                }}
                              >
                                Settle
                              </Button>
                            ) : null}
                            {item.kind === "verification" ? (
                              <Button type="button" size="sm" variant="default" asChild>
                                <RouterLink
                                  to={recordHref(item).to}
                                  params={recordHref(item).params}
                                  search={recordHref(item).search}
                                  hash={recordHref(item).hash}
                                >
                                  Review
                                  <ArrowRight data-icon="inline-end" />
                                </RouterLink>
                              </Button>
                            ) : (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => openQueueItem(item)}
                              >
                                Open
                                <ArrowRight data-icon="inline-end" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableShell>
            </>
          ) : (
            <SectionEmpty
              icon={ShieldCheck}
              title="No items match these filters"
              copy="Clear a filter or search to see everything waiting on you."
            />
          )}
        </div>
      ) : (
        <Alert>
          <ShieldCheck />
          <AlertTitle>Nothing needs you right now</AlertTitle>
          <AlertDescription>
            No refunds, cancellations, disputes, or supplier applications are waiting.
          </AlertDescription>
        </Alert>
      )}

      <Sheet
        open={Boolean(sheet)}
        onOpenChange={(open) => {
          if (!open) setSheet(null);
        }}
      >
        <SheetContent className="w-full sm:max-w-lg" side="right">
          <SheetHeader>
            <SheetTitle>{sheetItem ? sheetItem.title : "Record"}</SheetTitle>
            <SheetDescription>
              {sheetItem ? sheetItem.detail : "Review this record and take action here."}
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-6">
            {sheetItem ? (
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={slaVariant(sheetItem.sla)}>{ADMIN_SLA_LABELS[sheetItem.sla]}</Badge>
                <Badge variant="outline">{sheetItem.marker}</Badge>
                <span className="text-xs text-muted-foreground">ID {sheetItem.recordId}</span>
              </div>
            ) : null}
            {sheetOrder ? (
              <div className="flex flex-col gap-2 text-sm">
                <p className="flex items-center gap-2">
                  <StatusBadge status={sheetOrder.status} />
                  <PaymentBadge
                    paymentStatus={sheetOrder.payment_status}
                    paymentMethod={sheetOrder.payment_method}
                    showFailed
                  />
                </p>
                <p>
                  <span className="text-muted-foreground">Retailer </span>
                  {sheetOrder.retailer_name}
                </p>
                <p>
                  <span className="text-muted-foreground">Total </span>
                  {formatPrice(sheetOrder.total)}
                </p>
                {sheetOrder.cancellation_reason ? (
                  <Alert>
                    <AlertTitle>Cancellation reason</AlertTitle>
                    <AlertDescription>{sheetOrder.cancellation_reason}</AlertDescription>
                  </Alert>
                ) : null}
                {sheetOrder.manual_refund_status !== "not_required" ? (
                  <Alert>
                    <AlertTitle>Manual refund</AlertTitle>
                    <AlertDescription>
                      {formatPrice(sheetOrder.refund_amount)} ·{" "}
                      {sheetOrder.manual_refund_status.replaceAll("_", " ")}
                    </AlertDescription>
                  </Alert>
                ) : null}
              </div>
            ) : null}
            {sheetItem?.complaint ? (
              <p className="text-sm">{sheetItem.complaint.description}</p>
            ) : null}
            {sheetItem?.verification ? (
              <div className="flex flex-col gap-4">
                <TradeLicenseCopyField
                  id={`queue-trade-license-${sheetItem.verification.user_id}`}
                  value={sheetItem.verification.trade_license_number}
                />
                <ItemGroup>
                  <Item size="sm">
                    <ItemMedia variant="icon">
                      <MapPin />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>Location</ItemTitle>
                      <ItemDescription>{sheetItem.verification.location}</ItemDescription>
                    </ItemContent>
                  </Item>
                  <Item size="sm">
                    <ItemMedia variant="icon">
                      <Phone />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>Phone</ItemTitle>
                      <ItemDescription>
                        {sheetItem.verification.contact_phone || "Not provided"}
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                  <Item size="sm">
                    <ItemMedia variant="icon">
                      <Mail />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>Email</ItemTitle>
                      <ItemDescription>
                        {sheetItem.verification.supplier_email || "Not provided"}
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                </ItemGroup>
                {sheetItem.verification.shop_details ? (
                  <p className="text-sm leading-relaxed">{sheetItem.verification.shop_details}</p>
                ) : null}
              </div>
            ) : null}
          </div>
          <SheetFooter>
            {sheetItem?.kind === "cancellation" && sheetItem.order ? (
              <p className="text-sm text-muted-foreground">
                The suppliers on the order review cancellation requests. Admin has read-only
                oversight.
              </p>
            ) : null}
            {sheetItem?.kind === "refund" && sheetItem.order?.manual_refund_status === "pending" ? (
              <Button
                type="button"
                disabled={busy}
                onClick={() => {
                  const order = sheetItem.order;
                  if (order) setPending({ type: "settle", order });
                }}
              >
                Settle refund
              </Button>
            ) : null}
            {sheetItem?.kind === "dispute" ? (
              <Button
                type="button"
                disabled={busy}
                onClick={() => setPending({ type: "resolve", item: sheetItem })}
              >
                Mark resolved
              </Button>
            ) : null}
            {sheetItem?.kind === "verification" ? (
              <Button asChild>
                <RouterLink
                  to={recordHref(sheetItem).to}
                  params={recordHref(sheetItem).params}
                  search={recordHref(sheetItem).search}
                  hash={recordHref(sheetItem).hash}
                >
                  Review application
                  <ArrowRight data-icon="inline-end" />
                </RouterLink>
              </Button>
            ) : sheetItem ? (
              <Button variant="outline" asChild>
                <RouterLink
                  to={recordHref(sheetItem).to}
                  params={recordHref(sheetItem).params}
                  search={recordHref(sheetItem).search}
                  hash={recordHref(sheetItem).hash}
                >
                  Open full record
                  <ArrowRight data-icon="inline-end" />
                </RouterLink>
              </Button>
            ) : null}
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={Boolean(pending)}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm this action</AlertDialogTitle>
            <AlertDialogDescription>{pendingMessage}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <AlertDialogAction type="button" variant="default" onClick={confirmPending}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

const NEEDS_YOU_LIMIT = 5;

/** Compact home list of the most urgent queue items. */
export function AdminNeedsYouNow({ dashboard }: { dashboard: AdminDashboard }) {
  const urgent = dashboard.queue
    .filter((item) => item.sla === "overdue" || item.sla === "due_today")
    .slice(0, NEEDS_YOU_LIMIT);
  const items = urgent.length ? urgent : dashboard.queue.slice(0, NEEDS_YOU_LIMIT);

  return (
    <DashboardCard
      eyebrow="Now"
      title="Needs you now"
      meta={
        dashboard.queue.length
          ? `${dashboard.queue.length} open · showing ${items.length}`
          : "Nothing waiting"
      }
      severity={urgent.length ? "attention" : undefined}
      action={<DashboardLink to="/admin/inbox">Open all</DashboardLink>}
    >
      {items.length ? (
        <ItemGroup aria-label="Work that needs attention">
          {items.map((item) => (
            <Item key={item.id} variant="outline" size="sm">
              <ItemContent>
                <ItemTitle>{item.title}</ItemTitle>
                <ItemDescription>
                  {QUEUE_KIND_LABELS[item.kind]} · {partyName(item)}
                  {item.amount !== null ? ` · ${formatPrice(item.amount)}` : ""}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Badge variant={slaVariant(item.sla)}>{ADMIN_SLA_LABELS[item.sla]}</Badge>
                {item.kind === "verification" ? (
                  <Button size="sm" variant="ghost" asChild>
                    <RouterLink
                      to={recordHref(item).to}
                      params={recordHref(item).params}
                      search={recordHref(item).search}
                      hash={recordHref(item).hash}
                    >
                      Review
                      <ArrowRight data-icon="inline-end" />
                    </RouterLink>
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" asChild>
                    <RouterLink to="/admin/inbox" search={{ kind: item.kind }}>
                      Open
                      <ArrowRight data-icon="inline-end" />
                    </RouterLink>
                  </Button>
                )}
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      ) : (
        <SectionEmpty
          icon={ShieldCheck}
          title="You’re caught up"
          copy="When refunds, cancellations, disputes, or applications need you, they’ll show up here."
        />
      )}
    </DashboardCard>
  );
}

/** Skim-friendly recent orders — deep-links into Orders, no detail sheet. */
export function AdminRecentOrders({ dashboard }: { dashboard: AdminDashboard }) {
  const navigate = useNavigate();

  return (
    <DashboardCard
      eyebrow="Latest"
      title="Recent orders"
      meta={dashboard.recent.length ? `Newest ${dashboard.recent.length}` : "No orders yet"}
      action={<DashboardLink to="/admin/order">All orders</DashboardLink>}
    >
      {dashboard.recent.length ? (
        <>
          <div className="flex flex-col gap-3 md:hidden">
            {dashboard.recent.map((order) => (
              <Item key={order.id} variant="outline" size="sm">
                <ItemContent>
                  <ItemTitle>
                    #{shortId(order.id)} · {formatPrice(order.total)}
                  </ItemTitle>
                  <ItemDescription>
                    {order.retailerName} · {formatDate(order.createdAt)}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <StatusBadge status={order.status} />
                  <Button size="sm" variant="ghost" asChild>
                    <RouterLink
                      to="/admin/order"
                      search={{ order: order.id }}
                      hash={`order-${order.id}`}
                    >
                      Open
                    </RouterLink>
                  </Button>
                </ItemActions>
              </Item>
            ))}
          </div>
          <div className="hidden md:block">
            <DashboardTable
              label="Recent marketplace orders"
              columns={recentColumns}
              rows={dashboard.recent}
              rowKey={(order) => order.id}
              onRowClick={(order) => {
                void navigate({
                  to: "/admin/order",
                  search: { order: order.id },
                  hash: `order-${order.id}`,
                } as never);
              }}
            />
          </div>
        </>
      ) : (
        <SectionEmpty
          icon={Package}
          title="No orders yet"
          copy="Orders will appear here as soon as retailers start checking out."
        />
      )}
    </DashboardCard>
  );
}
