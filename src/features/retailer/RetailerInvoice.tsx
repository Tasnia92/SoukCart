import { useNavigate } from "@tanstack/react-router";
import { Clock, Download, Package, ShoppingBag } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Brand } from "../../components/ui/Brand.tsx";
import {
  EmptyState,
  InlineNotice,
  LoadingState,
  PageHeader,
  WorkspaceError,
} from "../../components/ui/Workspace.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { DeliveryDetails, shortId } from "../orders/order-presentation.tsx";
import { formatDate, formatDateTime, formatPrice } from "../workspace/format.ts";
import { RouterLink } from "../workspace/WorkspaceShell.tsx";
import { loadCartCount } from "./retailer-orders-api.ts";
import {
  invoiceMerchandiseTotal,
  invoiceTotal,
  loadInvoice,
  type InvoiceOrder,
  type InvoiceResult,
} from "./retailer-invoice-api.ts";
import { RetailerWorkspaceShell } from "./retailer-shared.tsx";

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
    <RetailerWorkspaceShell
      section="orders"
      userName={userName}
      userEmail={state.profile.email}
      cartCount={cartCount}
      onLogout={onLogout}
    >
      <div className="print:hidden">
        <PageHeader
          eyebrow="Invoice"
          title={`Order ${shortId(orderId)}.`}
          copy="Download a copy of this invoice for your records."
          actions={
            <Button asChild variant="ghost">
              <RouterLink to="/retailer/orders">
                <Package data-icon="inline-start" />
                Back to orders
              </RouterLink>
            </Button>
          }
        />
        <InlineNotice />
      </div>
      {result ? (
        result.kind === "not-found" ? (
          <EmptyState
            icon={ShoppingBag}
            title="Invoice not found"
            copy="This order could not be loaded."
            action={
              <Button asChild>
                <RouterLink to="/retailer/orders">Back to orders</RouterLink>
              </Button>
            }
          />
        ) : result.kind === "cancelled" ? (
          <EmptyState
            icon={ShoppingBag}
            title="No invoice for cancelled orders"
            copy="Cancelled orders do not have a retailer invoice."
            action={
              <Button asChild>
                <RouterLink to="/retailer/orders">Back to orders</RouterLink>
              </Button>
            }
          />
        ) : result.kind === "unpaid" ? (
          <EmptyState
            icon={Clock}
            title="Invoice not available yet"
            copy="The invoice appears once the order has been paid, or cash on delivery has been collected."
            action={
              <Button asChild>
                <RouterLink to="/retailer/orders">Back to orders</RouterLink>
              </Button>
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
    </RetailerWorkspaceShell>
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
  const subtotal = invoiceMerchandiseTotal(order);
  const total = invoiceTotal(order);

  return (
    <Card className="print:break-inside-auto print:overflow-visible print:rounded-none print:bg-background print:shadow-none print:ring-0">
      <CardHeader className="print:pt-8">
        <div className="mb-4">
          <Brand variant="dark" />
        </div>
        <CardTitle>
          <h2>Invoice #{shortId(order.id)}</h2>
        </CardTitle>
        <CardDescription>Issued {formatDate(order.created_at)}</CardDescription>
        <CardAction>
          <Badge>Paid</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-6 print:gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card size="sm" className="print:shadow-none print:ring-1">
            <CardHeader>
              <CardTitle>
                <h3>Bill to</h3>
              </CardTitle>
              <CardDescription>{billToEmail}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="font-medium">{billToName}</p>
            </CardContent>
          </Card>
          <Card size="sm" className="print:shadow-none print:ring-1">
            <CardHeader>
              <CardTitle>
                <h3>Payment</h3>
              </CardTitle>
              <CardDescription>
                Paid {formatDateTime(order.paid_at ?? order.created_at)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="font-medium">
                {order.payment_method === "cod" ? "Cash on delivery" : "SSLCommerz"}
              </p>
            </CardContent>
          </Card>
        </div>
        <DeliveryDetails
          phone={order.delivery_phone}
          address={order.delivery_address}
          city={order.delivery_city}
          postcode={order.delivery_postcode}
        />

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Qty</TableHead>
              <TableHead>Unit price</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {order.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>{item.product_name}</TableCell>
                <TableCell>{item.quantity}</TableCell>
                <TableCell>{formatPrice(item.unit_price)}</TableCell>
                <TableCell className="text-right">
                  <strong>{formatPrice(item.unit_price * item.quantity)}</strong>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <Separator />
        <dl className="grid grid-cols-[1fr_auto] gap-3 text-sm">
          <dt className="text-muted-foreground">Subtotal</dt>
          <dd className="text-right tabular-nums">{formatPrice(subtotal)}</dd>
          <dt className="text-muted-foreground">Delivery</dt>
          <dd className="text-right tabular-nums">{formatPrice(order.delivery_charge)}</dd>
          <dt className="font-medium">Total</dt>
          <dd className="text-right text-lg font-semibold tabular-nums">{formatPrice(total)}</dd>
        </dl>

        {order.tran_id || order.val_id || order.bank_tran_id ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Transaction reference</h3>
            {order.tran_id ? (
              <code className="break-all text-sm text-muted-foreground">{order.tran_id}</code>
            ) : null}
            {order.val_id ? (
              <code className="break-all text-sm text-muted-foreground">{order.val_id}</code>
            ) : null}
            {order.bank_tran_id ? (
              <code className="break-all text-sm text-muted-foreground">{order.bank_tran_id}</code>
            ) : null}
          </div>
        ) : null}
      </CardContent>
      <CardFooter className="justify-end gap-2 print:hidden">
        <Button type="button" onClick={() => window.print()}>
          <Download data-icon="inline-start" />
          Download PDF
        </Button>
        <Button asChild variant="ghost">
          <RouterLink to="/retailer/orders">Back to orders</RouterLink>
        </Button>
      </CardFooter>
    </Card>
  );
}
