import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  InlineNotice,
  LoadingState,
  PageHeader,
  WorkspaceError,
  type NoticeState,
} from "../../components/ui/Workspace.tsx";
import { RouterLink } from "../../components/ui/RouterLink.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import {
  matchesStatusTab,
  orderTypeOf,
  primaryProductName,
  statusTabOf,
  type OrderStatusTab,
} from "../orders/order-presentation.tsx";
import {
  OrdersDataTable,
  type OrderMenuItem,
  type OrderTableRow,
} from "../orders/orders-data-table.tsx";
import { searchParam } from "../workspace/search.ts";
import { invoiceIsAvailable } from "./retailer-invoice-api.ts";
import {
  canCancelOrder,
  canRequestCodDeliveryRefund,
  filterOrdersByQuery,
  loadCartCount,
  loadRetailerOrders,
  needsGatewayPaymentVerification,
  orderTotal,
  type RetailerOrder,
} from "./retailer-orders-api.ts";
import { needsDeliveryConfirmation } from "./retailer-dashboard-api.ts";
import { useRetailerOrderChanges } from "./retailer-realtime.ts";
import { applyReconciliation, reconcileRetailerPayments } from "./retailer-overview-api.ts";
import { RetailerWorkspaceShell } from "./retailer-shared.tsx";

type RetailerOrdersProps = {
  loadOrders?: (retailerId: string) => Promise<RetailerOrder[]>;
  loadCart?: (userId: string) => Promise<number>;
};

type Notice = { message: string; state: NoticeState } | null;

function parseTab(value: string | null): OrderStatusTab {
  if (
    value === "all" ||
    value === "pending" ||
    value === "shipped" ||
    value === "delivered" ||
    value === "cancelled"
  ) {
    return value;
  }
  if (value === "action") return "pending";
  if (value === "active") return "pending";
  return "all";
}

function needsAction(order: RetailerOrder): boolean {
  return (
    needsDeliveryConfirmation(order) ||
    needsGatewayPaymentVerification(order) ||
    order.cancel_requested ||
    canRequestCodDeliveryRefund(order)
  );
}

function toRow(order: RetailerOrder): OrderTableRow {
  const product = primaryProductName(order.items);
  return {
    id: order.id,
    productName: product.name,
    productImageUrl: order.items[0]?.image_url ?? null,
    extraItemCount: product.extraCount,
    customerName: "",
    type: orderTypeOf(order),
    price: orderTotal(order),
    date: order.created_at,
    status: order.status,
  };
}

export function RetailerOrders({
  loadOrders = loadRetailerOrders,
  loadCart = loadCartCount,
}: RetailerOrdersProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/retailer/orders" });
  const searchStr = useRouterState({ select: (routerState) => routerState.location.searchStr });
  const filterParam = searchParam(searchStr, "filter");
  const focusOrderId = searchParam(searchStr, "order");
  const tab = parseTab(filterParam);
  const [orders, setOrders] = useState<RetailerOrder[] | null>(null);
  const [cartCount, setCartCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [notice, setNotice] = useState<Notice>(null);
  const [query, setQuery] = useState("");
  const [needsActionOnly, setNeedsActionOnly] = useState(() => filterParam === "action");

  const retailerId = state.status === "retailer" ? state.session.user.id : "";

  useRetailerOrderChanges({
    enabled: Boolean(retailerId),
    retailerId: retailerId || undefined,
    onChange: () => setLoadVersion((version) => version + 1),
  });

  useEffect(() => {
    if (focusOrderId) {
      void navigate({
        to: "/retailer/orders/$orderId",
        params: { orderId: focusOrderId },
      });
    }
  }, [focusOrderId, navigate]);

  useEffect(() => {
    if (!retailerId) return;
    let current = true;
    setError(null);

    void Promise.all([loadOrders(retailerId), loadCart(retailerId)])
      .then(([nextOrders, nextCartCount]) => {
        if (!current) return;
        setOrders(nextOrders);
        setCartCount(nextCartCount);
        void reconcileRetailerPayments(retailerId, nextOrders)
          .then(({ updates, cartCleared }) => {
            if (!current || (!updates.length && !cartCleared)) return;
            setOrders((previous) => (previous ? applyReconciliation(previous, updates) : previous));
            if (cartCleared) setCartCount(0);
            const settled = updates.some(
              (update) =>
                update.payment_status === "paid" || update.delivery_payment_status === "paid",
            );
            if (settled) {
              setNotice({
                message: "A payment went through while you were away.",
                state: "success",
              });
            }
          })
          .catch(() => {
            // Reconciliation is a background correction.
          });
      })
      .catch((loadError: unknown) => {
        if (current) {
          setError(loadError instanceof Error ? loadError.message : "Please try again.");
        }
      });

    return () => {
      current = false;
    };
  }, [loadCart, loadOrders, loadVersion, retailerId]);

  const searched = useMemo(() => filterOrdersByQuery(orders ?? [], query), [orders, query]);
  const filtered = useMemo(
    () =>
      searched.filter((order) => {
        if (needsActionOnly && !needsAction(order)) return false;
        if (tab === "cancelled") return order.status === "cancelled" || order.cancel_requested;
        return matchesStatusTab(order.status, tab);
      }),
    [searched, needsActionOnly, tab],
  );
  const counts = useMemo(() => {
    const list = searched;
    return {
      all: list.length,
      pending: list.filter((order) => statusTabOf(order.status) === "pending").length,
      shipped: list.filter((order) => order.status === "shipped").length,
      delivered: list.filter((order) => order.status === "delivered").length,
      cancelled: list.filter((order) => order.status === "cancelled" || order.cancel_requested)
        .length,
    };
  }, [searched]);
  const inTransitCount = useMemo(
    () =>
      (orders ?? []).filter(
        (order) =>
          order.status === "pending" || order.status === "confirmed" || order.status === "shipped",
      ).length,
    [orders],
  );

  if (state.status !== "retailer") return null;

  const onLogout = () => {
    void store.signOut().then(() => {
      void navigate({ to: "/" });
    });
  };
  const retry = () => setLoadVersion((version) => version + 1);
  const userName = state.profile.name || state.profile.email;

  if (error) {
    return (
      <WorkspaceError
        eyebrow="Retailer workspace"
        title="We could not load your workspace."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  const setTab = (value: OrderStatusTab) => {
    setNeedsActionOnly(false);
    void navigate({
      to: "/retailer/orders",
      search: (value === "all" ? {} : { filter: value }) as never,
      replace: true,
    });
  };

  const openOrder = (orderId: string) => {
    void navigate({ to: "/retailer/orders/$orderId", params: { orderId } });
  };

  return (
    <RetailerWorkspaceShell
      section="orders"
      userName={userName}
      userEmail={state.profile.email}
      cartCount={cartCount}
      inTransitCount={orders ? inTransitCount : undefined}
      onLogout={onLogout}
    >
      <PageHeader
        title="Orders"
        actions={
          <Button asChild>
            <RouterLink to="/retailer">
              <Plus data-icon="inline-start" />
              Place order
            </RouterLink>
          </Button>
        }
      />
      <InlineNotice message={notice?.message} state={notice?.state} />
      {orders ? (
        <OrdersDataTable
          rows={filtered.map(toRow)}
          tab={tab}
          onTabChange={setTab}
          counts={counts}
          search={query}
          onSearchChange={setQuery}
          showCustomer={false}
          showColumns={false}
          activeFilterCount={needsActionOnly ? 1 : 0}
          extraFilters={
            <Field orientation="horizontal">
              <Checkbox
                id="retailer-needs-action"
                checked={needsActionOnly}
                onCheckedChange={(checked) => setNeedsActionOnly(checked === true)}
              />
              <FieldLabel htmlFor="retailer-needs-action">Needs action</FieldLabel>
            </Field>
          }
          onRowOpen={openOrder}
          rowMenuItems={(row) => {
            const order = orders.find((item) => item.id === row.id);
            const items: OrderMenuItem[] = [
              {
                label: "View order",
                to: "/retailer/orders/$orderId",
                params: { orderId: row.id },
              },
            ];
            if (
              order &&
              (order.status === "pending" ||
                order.status === "confirmed" ||
                order.status === "shipped")
            ) {
              items.push({
                label: "Track order",
                to: "/retailer/orders/$orderId",
                params: { orderId: row.id },
              });
            }
            if (order && needsGatewayPaymentVerification(order)) {
              items.push({
                label: "Verify payment",
                to: "/retailer/orders/$orderId",
                params: { orderId: row.id },
              });
            }
            if (order && needsDeliveryConfirmation(order)) {
              items.push({
                label: "Verify delivery",
                to: "/retailer/orders/$orderId",
                params: { orderId: row.id },
              });
            }
            if (order && canCancelOrder(order)) {
              items.push({
                label: "Cancel order",
                to: "/retailer/orders/$orderId",
                params: { orderId: row.id },
              });
            }
            if (order && canRequestCodDeliveryRefund(order)) {
              items.push({
                label: "Request delivery refund",
                to: "/retailer/orders/$orderId",
                params: { orderId: row.id },
              });
            }
            if (order?.status === "delivered") {
              items.push({
                label: "Reorder items",
                to: "/retailer/orders/$orderId",
                params: { orderId: row.id },
              });
            }
            if (order && invoiceIsAvailable(order)) {
              items.push({
                label: "Download invoice",
                to: "/retailer/orders/$orderId/invoice",
                params: { orderId: row.id },
              });
            }
            items.push({
              label: "Contact support",
              to: "/retailer/complaints",
              search: { order: row.id },
            });
            return items;
          }}
          emptyTitle={orders.length ? "No matching orders" : "No orders yet"}
          emptyCopy={
            orders.length
              ? "Try another tab or clear the search."
              : "Place your first order and it will show up here."
          }
          emptyAction={
            <Button asChild>
              <RouterLink to="/retailer">
                <ShoppingBag data-icon="inline-start" />
                Place order
              </RouterLink>
            </Button>
          }
        />
      ) : (
        <LoadingState title="Loading your orders…" />
      )}
    </RetailerWorkspaceShell>
  );
}
