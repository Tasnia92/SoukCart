import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Brand } from "../../components/ui/Brand.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import {
  EmptyState,
  InlineNotice,
  LoadingState,
  PageHeader,
  TableShell,
  WorkspaceError,
} from "../../components/ui/Workspace.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { shortId } from "../orders/order-presentation.tsx";
import { formatDate, formatDateTime, formatPrice } from "../workspace/format.ts";
import { RouterLink, WorkspaceShell } from "../workspace/WorkspaceShell.tsx";
import { loadCartCount } from "./retailer-orders-api.ts";
import {
  invoiceTotal,
  loadInvoice,
  type InvoiceOrder,
  type InvoiceResult,
} from "./retailer-invoice-api.ts";

type RetailerInvoiceProps = {
  orderId: string;
  load?: (orderId: string) => Promise<InvoiceResult>;
  loadCart?: (userId: string) => Promise<number>;
};

export function RetailerInvoice({
  orderId,
  load = loadInvoice,
  loadCart = loadCartCount,
}: RetailerInvoiceProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/retailer/orders/$orderId/invoice" });
  const [result, setResult] = useState<InvoiceResult | null>(null);
  const [cartCount, setCartCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);

  const retailerId = state.status === "retailer" ? state.session.user.id : "";

  useEffect(() => {
    if (!retailerId) return;
    let current = true;
    setError(null);

    void Promise.all([load(orderId), loadCart(retailerId)])
      .then(([nextResult, nextCartCount]) => {
        if (!current) return;
        setResult(nextResult);
        setCartCount(nextCartCount);
      })
      .catch((loadError: unknown) => {
        if (current) {
          setError(loadError instanceof Error ? loadError.message : "Please try again.");
        }
      });

    return () => {
      current = false;
    };
  }, [load, loadCart, loadVersion, orderId, retailerId]);

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

  return (
    <WorkspaceShell
      navigationLabel="Retailer navigation"
      items={[
        { to: "/retailer", icon: "home", label: "Overview" },
        { to: "/retailer/catalog", icon: "bag", label: "Place order" },
        {
          to: "/retailer/cart",
          icon: "cart",
          label: "Cart",
          trailing: cartCount ? <span className="rt-nav-badge">{cartCount}</span> : undefined,
        },
        { to: "/retailer/orders", icon: "package", label: "My orders", active: true },
        { to: "/retailer/complaints", icon: "message", label: "Help Center" },
      ]}
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Invoice"
        title={`Order ${shortId(orderId)}.`}
        copy="Download a copy of this invoice for your records."
        actions={
          <RouterLink className="button button-subtle" to="/retailer/orders">
            <Icon name="package" />
            <span>Back to orders</span>
          </RouterLink>
        }
      />
      <InlineNotice />
      <div className="rt-invoice-panel">
        {result ? (
          result.kind === "not-found" ? (
            <EmptyState
              icon="bag"
              title="Invoice not found"
              copy="This order could not be loaded."
              action={
                <RouterLink className="button button-primary" to="/retailer/orders">
                  <span>Back to orders</span>
                </RouterLink>
              }
            />
          ) : result.kind === "unpaid" ? (
            <EmptyState
              icon="clock"
              title="Invoice not available yet"
              copy="The invoice appears once the order has been paid."
              action={
                <RouterLink className="button button-primary" to="/retailer/orders">
                  <span>Back to orders</span>
                </RouterLink>
              }
            />
          ) : (
            <InvoiceCard
              order={result.order}
              billToName={state.profile.name || "Retailer"}
              billToEmail={state.profile.email}
            />
          )
        ) : (
          <LoadingState title="Loading the invoice…" />
        )}
      </div>
    </WorkspaceShell>
  );
}

function InvoiceCard({
  order,
  billToName,
  billToEmail,
}: {
  order: InvoiceOrder;
  billToName: string;
  billToEmail: string;
}) {
  const total = invoiceTotal(order);
  return (
    <div className="rt-invoice">
      <div className="rt-invoice-head">
        <Brand variant="dark" />
        <div className="rt-invoice-meta">
          <p className="eyebrow">Invoice</p>
          <h2 className="display-sm">#{shortId(order.id)}</h2>
          <p>Issued {formatDate(order.created_at)}</p>
        </div>
      </div>

      <div className="rt-invoice-grid">
        <div>
          <p className="rt-invoice-label">Bill to</p>
          <strong>{billToName}</strong>
          <span>{billToEmail}</span>
        </div>
        <div>
          <p className="rt-invoice-label">Payment</p>
          <strong>SSLCommerz</strong>
          <span>Paid {formatDateTime(order.paid_at ?? order.created_at)}</span>
        </div>
      </div>

      <TableShell>
        <table className="admin-table rt-invoice-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>Unit price</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.id}>
                <td>{item.product_name}</td>
                <td>{item.quantity}</td>
                <td>{formatPrice(item.unit_price)}</td>
                <td>
                  <strong>{formatPrice(item.unit_price * item.quantity)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>

      <div className="rt-invoice-total">
        <span>Subtotal</span>
        <strong>{formatPrice(total)}</strong>
      </div>

      <div className="rt-invoice-payment">
        <p className="rt-invoice-label">Transaction reference</p>
        <code>{order.tran_id ?? ""}</code>
        {order.val_id ? <code>{order.val_id}</code> : null}
        {order.bank_tran_id ? <code>{order.bank_tran_id}</code> : null}
      </div>

      <div className="rt-invoice-actions">
        <button className="button button-primary" type="button" onClick={() => window.print()}>
          <Icon name="download" />
          <span>Download PDF</span>
        </button>
        <RouterLink className="button button-subtle" to="/retailer/orders">
          <span>Back to orders</span>
        </RouterLink>
      </div>
    </div>
  );
}
