import { useNavigate } from "@tanstack/react-router";
import {
  House,
  LockKeyhole,
  MessageSquare,
  Minus,
  Package,
  Plus,
  ShoppingBag,
  ShoppingCart,
  Store,
  Trash2,
  Truck,
} from "lucide-react";
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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  EmptyState,
  InlineNotice,
  LoadingState,
  PageHeader,
  WorkspaceError,
  type NoticeState,
} from "../../components/ui/Workspace.tsx";
import { useProductChanges } from "../../product-realtime.ts";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { formatPrice } from "../workspace/format.ts";
import { RouterLink, WorkspaceShell } from "../workspace/WorkspaceShell.tsx";
import {
  assertCartWithinStock,
  assertSingleSupplierCart,
  cartDeliveryCharge,
  cartItemCount,
  cartOrderTotal,
  cartPayableNow,
  cartSubtotal,
  clampCartQuantity,
  initiateCheckout,
  loadCartLines,
  removeCartLine,
  updateCartQuantity,
  type CartLine,
  type CheckoutForm,
  type CheckoutOutcome,
  type PaymentMethod,
} from "./retailer-cart-api.ts";

type RetailerCartProps = {
  loadLines?: (userId: string) => Promise<CartLine[]>;
  updateQuantity?: (userId: string, productId: string, quantity: number) => Promise<void>;
  removeLine?: (userId: string, productId: string) => Promise<void>;
  checkout?: (method: PaymentMethod, form: CheckoutForm) => Promise<CheckoutOutcome>;
};

type Notice = { message: string; state: NoticeState } | null;

const emptyForm = { phone: "", address: "", city: "", postcode: "", notes: "" };

export function RetailerCart({
  loadLines = loadCartLines,
  updateQuantity = updateCartQuantity,
  removeLine = removeCartLine,
  checkout = initiateCheckout,
}: RetailerCartProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/retailer/cart" });
  const [lines, setLines] = useState<CartLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [notice, setNotice] = useState<Notice>(null);
  const [form, setForm] = useState(emptyForm);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("online");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);

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

  const setField = (name: keyof typeof emptyForm, value: string) =>
    setForm((prev) => ({ ...prev, [name]: value }));

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

  const onCheckout = async () => {
    if (!lines) return;
    const phone = form.phone.trim();
    const address = form.address.trim();
    const city = form.city.trim();
    const postcode = form.postcode.trim();
    const notes = form.notes.trim() || null;
    if (!phone || !address || !city || !postcode) {
      setNotice({
        message: "Enter your phone number, delivery address, city, and postcode.",
        state: "error",
      });
      return;
    }

    setCheckingOut(true);
    try {
      assertCartWithinStock(lines);
      assertSingleSupplierCart(lines);
      const outcome = await checkout(paymentMethod, { phone, address, city, postcode, notes });
      sessionStorage.setItem("soukcart:payment-return", "1");
      window.location.assign(outcome.url);
    } catch (checkoutError) {
      setCheckingOut(false);
      setNotice({
        message:
          checkoutError instanceof Error
            ? checkoutError.message
            : "The payment could not be started.",
        state: "error",
      });
    }
  };

  const cartCount = lines ? cartItemCount(lines) : 0;
  const subtotal = lines ? cartSubtotal(lines) : 0;
  const delivery = cartDeliveryCharge();
  const orderTotal = lines ? cartOrderTotal(lines) : delivery;
  const payableNow = lines ? cartPayableNow(lines, paymentMethod) : 0;
  const cod = paymentMethod === "cod";
  const CheckoutIcon = cod ? Truck : LockKeyhole;

  return (
    <WorkspaceShell
      navigationLabel="Retailer navigation"
      items={[
        { to: "/retailer", icon: House, label: "Overview" },
        { to: "/retailer/catalog", icon: ShoppingBag, label: "Place order" },
        {
          to: "/retailer/cart",
          icon: ShoppingCart,
          label: "Cart",
          active: true,
          trailing: cartCount || undefined,
        },
        { to: "/retailer/orders", icon: Package, label: "My orders" },
        { to: "/retailer/complaints", icon: MessageSquare, label: "Help Center" },
      ]}
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Order review"
        title="Your order."
        copy="Check quantities and totals before placing your order."
      />
      <InlineNotice message={notice?.message} state={notice?.state} />
      {lines ? (
        lines.length ? (
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
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
            <aside aria-label="Order summary">
              <Card>
                <CardHeader>
                  <CardTitle>Order summary</CardTitle>
                  <CardDescription>Delivery and payment details for this order.</CardDescription>
                  <CardAction>
                    <Badge variant="secondary">{cartCount} items</Badge>
                  </CardAction>
                </CardHeader>
                <CardContent className="flex flex-col gap-6">
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <dt className="text-muted-foreground">Items</dt>
                    <dd className="text-right font-medium tabular-nums">{cartCount}</dd>
                    <dt className="text-muted-foreground">Subtotal</dt>
                    <dd className="text-right font-medium tabular-nums">{formatPrice(subtotal)}</dd>
                    <dt className="text-muted-foreground">Delivery</dt>
                    <dd className="text-right font-medium tabular-nums">{formatPrice(delivery)}</dd>
                    <dt className="font-medium">Total</dt>
                    <dd className="text-right font-medium tabular-nums">
                      {formatPrice(orderTotal)}
                    </dd>
                  </dl>
                  <Separator />
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="retailer-checkout-phone">Phone number</FieldLabel>
                      <Input
                        id="retailer-checkout-phone"
                        name="phone"
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        placeholder="01XXXXXXXXX"
                        required
                        value={form.phone}
                        onChange={(event) => setField("phone", event.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="retailer-checkout-address">Delivery address</FieldLabel>
                      <Input
                        id="retailer-checkout-address"
                        name="address"
                        type="text"
                        autoComplete="street-address"
                        placeholder="House, road, area"
                        required
                        value={form.address}
                        onChange={(event) => setField("address", event.target.value)}
                      />
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field>
                        <FieldLabel htmlFor="retailer-checkout-city">City</FieldLabel>
                        <Input
                          id="retailer-checkout-city"
                          name="city"
                          type="text"
                          autoComplete="address-level2"
                          placeholder="Dhaka"
                          required
                          value={form.city}
                          onChange={(event) => setField("city", event.target.value)}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="retailer-checkout-postcode">Postcode</FieldLabel>
                        <Input
                          id="retailer-checkout-postcode"
                          name="postcode"
                          type="text"
                          autoComplete="postal-code"
                          placeholder="1205"
                          required
                          value={form.postcode}
                          onChange={(event) => setField("postcode", event.target.value)}
                        />
                      </Field>
                    </div>
                    <Field>
                      <FieldLabel htmlFor="retailer-checkout-notes">
                        Notes for the supplier
                      </FieldLabel>
                      <Textarea
                        id="retailer-checkout-notes"
                        name="notes"
                        rows={2}
                        placeholder="Delivery instructions, packaging, etc."
                        value={form.notes}
                        onChange={(event) => setField("notes", event.target.value)}
                      />
                    </Field>
                  </FieldGroup>
                  <FieldSet>
                    <FieldLegend>Payment method</FieldLegend>
                    <RadioGroup
                      name="payment-method"
                      value={paymentMethod}
                      onValueChange={(value) => setPaymentMethod(value as PaymentMethod)}
                    >
                      <FieldLabel htmlFor="payment-method-online">
                        <Field orientation="horizontal">
                          <RadioGroupItem id="payment-method-online" value="online" />
                          <LockKeyhole
                            className="size-5 text-muted-foreground"
                            aria-hidden="true"
                          />
                          <FieldContent>
                            <FieldTitle>Pay online</FieldTitle>
                            <FieldDescription>
                              Card or mobile banking via SSLCommerz
                            </FieldDescription>
                          </FieldContent>
                        </Field>
                      </FieldLabel>
                      <FieldLabel htmlFor="payment-method-cod">
                        <Field orientation="horizontal">
                          <RadioGroupItem id="payment-method-cod" value="cod" />
                          <Truck className="size-5 text-muted-foreground" aria-hidden="true" />
                          <FieldContent>
                            <FieldTitle>Cash on delivery</FieldTitle>
                            <FieldDescription>
                              Pay delivery online now; pay for products in cash on arrival
                            </FieldDescription>
                          </FieldContent>
                        </Field>
                      </FieldLabel>
                    </RadioGroup>
                  </FieldSet>
                </CardContent>
                <CardFooter className="flex-col items-stretch gap-3">
                  <Button type="button" disabled={checkingOut} onClick={() => void onCheckout()}>
                    <CheckoutIcon data-icon="inline-start" />
                    {cod
                      ? `Pay delivery · ${formatPrice(payableNow)}`
                      : `Pay ${formatPrice(payableNow)}`}
                  </Button>
                  <p className="text-sm text-muted-foreground">
                    {cod
                      ? `Pay ${formatPrice(delivery)} delivery online now. Pay ${formatPrice(subtotal)} for products in cash when your order arrives.`
                      : "You will be redirected to SSLCommerz to complete the payment securely."}
                  </p>
                </CardFooter>
              </Card>
            </aside>
          </div>
        ) : (
          <EmptyState
            icon={Store}
            title="Your order is empty"
            copy="Browse the catalog and add products to start ordering."
            action={
              <Button asChild>
                <RouterLink to="/retailer/catalog">Browse catalog</RouterLink>
              </Button>
            }
          />
        )
      ) : (
        <LoadingState title="Loading your order…" />
      )}
    </WorkspaceShell>
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
            className="flex items-center gap-2"
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
            <output className="min-w-8 text-center font-medium tabular-nums">{quantity}</output>
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
          </div>
        </CardContent>
        <CardFooter className="justify-between">
          <span className="text-sm text-muted-foreground">
            {product.stock} available
            {product.min_order_qty > 1 ? ` · min ${product.min_order_qty}` : ""}
          </span>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            aria-label={`Remove ${product.name} from order`}
            disabled={busy}
            onClick={() => onRemove(line)}
          >
            <Trash2 data-icon="inline-start" />
            Remove
          </Button>
        </CardFooter>
      </Card>
    </article>
  );
}
