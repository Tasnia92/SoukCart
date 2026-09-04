import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, Minus, Plus, ShoppingBag, Store, Trash2 } from "lucide-react";
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
  EmptyState,
  InlineNotice,
  LoadingState,
  PageHeader,
  WorkspaceError,
  type NoticeState,
} from "../../components/ui/Workspace.tsx";
import { RouterLink } from "../../components/ui/RouterLink.tsx";
import { useProductChanges } from "../../product-realtime.ts";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { formatPrice } from "../workspace/format.ts";
import {
  cartDeliveryCharge,
  cartItemCount,
  cartOrderTotal,
  cartSubtotal,
  clampCartQuantity,
  loadCartLines,
  removeCartLine,
  updateCartQuantity,
  type CartLine,
} from "./retailer-cart-api.ts";
import { RetailerWorkspaceShell } from "./retailer-shared.tsx";

type RetailerCartProps = {
  loadLines?: (userId: string) => Promise<CartLine[]>;
  updateQuantity?: (userId: string, productId: string, quantity: number) => Promise<void>;
  removeLine?: (userId: string, productId: string) => Promise<void>;
};

type Notice = { message: string; state: NoticeState } | null;

export function RetailerCart({
  loadLines = loadCartLines,
  updateQuantity = updateCartQuantity,
  removeLine = removeCartLine,
}: RetailerCartProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/retailer/cart" });
  const [lines, setLines] = useState<CartLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [notice, setNotice] = useState<Notice>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const retailerId = state.status === "retailer" ? state.session.user.id : "";

  useProductChanges({
    enabled: Boolean(retailerId),
    onChange: () => setLoadVersion((version) => version + 1),
  });

  useEffect(() => {
    if (!retailerId) return;
    let current = true;
    setError(null);

    void loadLines(retailerId)
      .then((next) => {
        if (current) setLines(next);
      })
      .catch((loadError: unknown) => {
        if (current) {
          setError(loadError instanceof Error ? loadError.message : "Please try again.");
        }
      });

    return () => {
      current = false;
    };
  }, [loadLines, loadVersion, retailerId]);

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

  const onStep = (line: CartLine, change: number) => {
    const next = clampCartQuantity(
      line.quantity,
      change,
      line.product.stock,
      line.product.min_order_qty,
    );
    if (next === line.quantity) return;
    setBusyId(line.product.id);
    void updateQuantity(retailerId, line.product.id, next)
      .then(() => {
        setLines(
          (prev) =>
            prev?.map((item) =>
              item.product.id === line.product.id ? { ...item, quantity: next } : item,
            ) ?? prev,
        );
        setBusyId(null);
      })
      .catch((stepError: unknown) => {
        setNotice({
          message:
            stepError instanceof Error ? stepError.message : "Quantity could not be updated.",
          state: "error",
        });
        setBusyId(null);
      });
  };

  const onRemove = (line: CartLine) => {
    setBusyId(line.product.id);
    void removeLine(retailerId, line.product.id)
      .then(() => {
        setLines((prev) => prev?.filter((item) => item.product.id !== line.product.id) ?? prev);
        setBusyId(null);
      })
      .catch((removeError: unknown) => {
        setNotice({
          message:
            removeError instanceof Error ? removeError.message : "The item could not be removed.",
          state: "error",
        });
        setBusyId(null);
      });
  };

  const cartCount = lines ? cartItemCount(lines) : 0;
  const subtotal = lines ? cartSubtotal(lines) : 0;
  const delivery = cartDeliveryCharge();
  const orderTotal = lines ? cartOrderTotal(lines) : delivery;

  return (
    <RetailerWorkspaceShell
      section="cart"
      userName={userName}
      userEmail={state.profile.email}
      cartCount={cartCount}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Cart"
        title="Review your order."
        copy="Adjust quantities, then continue to delivery and payment."
      />
      <InlineNotice message={notice?.message} state={notice?.state} />
      {lines ? (
        lines.length ? (
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
            <section className="flex flex-col gap-4" aria-label="Order items">
              {lines.map((line) => (
                <CartLineRow
                  key={line.product.id}
                  line={line}
                  busy={busyId === line.product.id}
                  onStep={onStep}
                  onRemove={onRemove}
                />
              ))}
            </section>
            <aside aria-label="Order summary" className="xl:sticky xl:top-4">
              <Card>
                <CardHeader>
                  <CardTitle>Order summary</CardTitle>
                  <CardDescription>Totals before delivery details.</CardDescription>
                  <CardAction>
                    <Badge variant="secondary">{cartCount} items</Badge>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <dt className="text-muted-foreground">Subtotal</dt>
                    <dd className="text-right font-medium tabular-nums">{formatPrice(subtotal)}</dd>
                    <dt className="text-muted-foreground">Delivery</dt>
                    <dd className="text-right font-medium tabular-nums">{formatPrice(delivery)}</dd>
                    <dt className="font-medium">Total</dt>
                    <dd className="text-right font-medium tabular-nums">
                      {formatPrice(orderTotal)}
                    </dd>
                  </dl>
                  <Separator className="my-4" />
                  <p className="text-sm text-muted-foreground">
                    Next you will choose a delivery address and payment method.
                  </p>
                </CardContent>
                <CardFooter className="flex-col items-stretch gap-2">
                  <Button asChild>
                    <RouterLink to="/retailer/checkout">
                      Proceed to checkout
                      <ArrowRight data-icon="inline-end" />
                    </RouterLink>
                  </Button>
                  <Button asChild variant="ghost">
                    <RouterLink to="/retailer">Continue shopping</RouterLink>
                  </Button>
                </CardFooter>
              </Card>
            </aside>
          </div>
        ) : (
          <EmptyState
            icon={Store}
            title="Your cart is empty"
            copy="Browse the catalog and add products to start ordering."
            action={
              <Button asChild>
                <RouterLink to="/retailer">Browse catalog</RouterLink>
              </Button>
            }
          />
        )
      ) : (
        <LoadingState title="Loading your order…" />
      )}
    </RetailerWorkspaceShell>
  );
}

function CartLineRow({
  line,
  busy,
  onStep,
  onRemove,
}: {
  line: CartLine;
  busy: boolean;
  onStep: (line: CartLine, change: number) => void;
  onRemove: (line: CartLine) => void;
}) {
  const { product, quantity } = line;

  return (
    <article>
      <Card size="sm">
        <CardHeader>
          <CardTitle>
            <h3>{product.name}</h3>
          </CardTitle>
          <CardDescription>
            {product.seller_name || "SoukCart sample"} · {formatPrice(product.price)} per{" "}
            {product.unit}
          </CardDescription>
          <CardAction>
            <Badge variant="outline">{formatPrice(product.price * quantity)}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="grid items-center gap-4 sm:grid-cols-[5rem_1fr]">
          <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-muted">
            {product.image_url ? (
              <img
                className="size-full object-cover"
                src={product.image_url}
                alt=""
                loading="lazy"
              />
            ) : (
              <ShoppingBag className="size-8 text-muted-foreground" aria-hidden="true" />
            )}
          </div>
          <div
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label={`Quantity for ${product.name}`}
          >
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="Decrease quantity"
              disabled={busy || quantity <= product.min_order_qty}
              onClick={() => onStep(line, -1)}
            >
              <Minus />
            </Button>
            <span className="min-w-8 text-center tabular-nums">{quantity}</span>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="Increase quantity"
              disabled={busy || quantity >= product.stock}
              onClick={() => onStep(line, 1)}
            >
              <Plus />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => onRemove(line)}
            >
              <Trash2 data-icon="inline-start" />
              Remove
            </Button>
          </div>
        </CardContent>
      </Card>
    </article>
  );
}
