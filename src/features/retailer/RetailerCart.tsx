import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Icon } from "../../components/ui/Icon.tsx";
import {
  EmptyState,
  InlineNotice,
  LoadingState,
  PageHeader,
  WorkspaceError,
  type NoticeState,
} from "../../components/ui/Workspace.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { formatPrice } from "../workspace/format.ts";
import { RouterLink, WorkspaceShell } from "../workspace/WorkspaceShell.tsx";
import {
  assertCartWithinStock,
  cartItemCount,
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
import { RETAILER_NOTICE_KEY } from "./retailer-flash.ts";
import { clearCart } from "./retailer-orders-api.ts";

type RetailerCartProps = {
  loadLines?: (userId: string) => Promise<CartLine[]>;
  updateQuantity?: (userId: string, productId: string, quantity: number) => Promise<void>;
  removeLine?: (userId: string, productId: string) => Promise<void>;
  checkout?: (method: PaymentMethod, form: CheckoutForm) => Promise<CheckoutOutcome>;
  clearRetailerCart?: (userId: string) => Promise<void>;
};

type Notice = { message: string; state: NoticeState } | null;

const emptyForm = { phone: "", address: "", city: "", postcode: "", notes: "" };

export function RetailerCart({
  loadLines = loadCartLines,
  updateQuantity = updateCartQuantity,
  removeLine = removeCartLine,
  checkout = initiateCheckout,
  clearRetailerCart = clearCart,
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
    const next = clampCartQuantity(line.quantity, change, line.product.stock);
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
      const outcome = await checkout(paymentMethod, { phone, address, city, postcode, notes });
      if ("method" in outcome) {
        await clearRetailerCart(retailerId);
        sessionStorage.setItem(
          RETAILER_NOTICE_KEY,
          "Order placed. Pay in cash when your order arrives.",
        );
        window.location.assign("/retailer/orders");
        return;
      }
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
  const cod = paymentMethod === "cod";

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
          active: true,
          trailing: cartCount ? <span className="rt-nav-badge">{cartCount}</span> : undefined,
        },
        { to: "/retailer/orders", icon: "package", label: "My orders" },
        { to: "/retailer/complaints", icon: "message", label: "Help Center" },
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
          <div className="rt-cart-layout">
            <section className="rt-cart-list" aria-label="Order items">
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
            <aside className="rt-summary-card" aria-label="Order summary">
              <p className="eyebrow">Order summary</p>
              <div className="rt-summary-row">
                <span>Items</span>
                <strong>{cartCount}</strong>
              </div>
              <div className="rt-summary-row">
                <span>Subtotal</span>
                <strong>{formatPrice(subtotal)}</strong>
              </div>
              <label className="admin-field">
                <span>Phone number</span>
                <input
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="01XXXXXXXXX"
                  required
                  value={form.phone}
                  onChange={(event) => setField("phone", event.target.value)}
                />
              </label>
              <label className="admin-field">
                <span>Delivery address</span>
                <input
                  name="address"
                  type="text"
                  autoComplete="street-address"
                  placeholder="House, road, area"
                  required
                  value={form.address}
                  onChange={(event) => setField("address", event.target.value)}
                />
              </label>
              <div className="rt-checkout-grid">
                <label className="admin-field">
                  <span>City</span>
                  <input
                    name="city"
                    type="text"
                    autoComplete="address-level2"
                    placeholder="Dhaka"
                    required
                    value={form.city}
                    onChange={(event) => setField("city", event.target.value)}
                  />
                </label>
                <label className="admin-field">
                  <span>Postcode</span>
                  <input
                    name="postcode"
                    type="text"
                    autoComplete="postal-code"
                    placeholder="1205"
                    required
                    value={form.postcode}
                    onChange={(event) => setField("postcode", event.target.value)}
                  />
                </label>
              </div>
              <label className="admin-field">
                <span>Notes for the supplier</span>
                <textarea
                  name="notes"
                  rows={2}
                  placeholder="Delivery instructions, packaging, etc."
                  value={form.notes}
                  onChange={(event) => setField("notes", event.target.value)}
                />
              </label>
              <fieldset className="rt-payment-methods">
                <legend className="sr-only">Payment method</legend>
                <label className="rt-payment-method">
                  <input
                    type="radio"
                    name="payment-method"
                    value="online"
                    checked={paymentMethod === "online"}
                    onChange={() => setPaymentMethod("online")}
                  />
                  <span className="rt-payment-icon">
                    <Icon name="lock" />
                  </span>
                  <span className="rt-payment-body">
                    <strong>Pay online</strong>
                    <small>Card or mobile banking via SSLCommerz</small>
                  </span>
                </label>
                <label className="rt-payment-method">
                  <input
                    type="radio"
                    name="payment-method"
                    value="cod"
                    checked={paymentMethod === "cod"}
                    onChange={() => setPaymentMethod("cod")}
                  />
                  <span className="rt-payment-icon">
                    <Icon name="truck" />
                  </span>
                  <span className="rt-payment-body">
                    <strong>Cash on delivery</strong>
                    <small>Pay in cash when your order arrives</small>
                  </span>
                </label>
              </fieldset>
              <button
                className="button button-primary button-block"
                type="button"
                disabled={checkingOut}
                onClick={() => void onCheckout()}
              >
                <span>
                  <Icon name={cod ? "truck" : "lock"} />
                </span>
                <span>
                  {cod ? `Place order · ${formatPrice(subtotal)}` : `Pay ${formatPrice(subtotal)}`}
                </span>
              </button>
              <p className="rt-summary-hint">
                {cod
                  ? "Pay in cash when your order arrives."
                  : "You will be redirected to SSLCommerz to complete the payment securely."}
              </p>
            </aside>
          </div>
        ) : (
          <EmptyState
            icon="store"
            title="Your order is empty"
            copy="Browse the catalog and add products to start ordering."
            action={
              <RouterLink className="button button-primary" to="/retailer/catalog">
                <span>Browse catalog</span>
              </RouterLink>
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
    <article className="rt-cart-line">
      <div className="rt-cart-art">
        {product.image_url ? (
          <img src={product.image_url} alt="" loading="lazy" />
        ) : (
          <Icon name="bag" />
        )}
      </div>
      <div className="rt-cart-line-body">
        <h3 className="rt-product-name">{product.name}</h3>
        <p className="rt-product-seller">
          {product.seller_name || "SoukCart sample"} · {formatPrice(product.price)} per{" "}
          {product.unit}
        </p>
        <div className="rt-stepper" role="group" aria-label={`Quantity for ${product.name}`}>
          <button
            className="rt-stepper-button"
            type="button"
            aria-label="Decrease quantity"
            disabled={busy}
            onClick={() => onStep(line, -1)}
          >
            <Icon name="minus" />
          </button>
          <output className="rt-stepper-value">{quantity}</output>
          <button
            className="rt-stepper-button"
            type="button"
            aria-label="Increase quantity"
            disabled={busy || quantity >= product.stock}
            onClick={() => onStep(line, 1)}
          >
            <Icon name="plus" />
          </button>
        </div>
      </div>
      <div className="rt-cart-line-end">
        <strong>{formatPrice(product.price * quantity)}</strong>
        <button
          className="rt-remove-button"
          type="button"
          aria-label={`Remove ${product.name} from order`}
          disabled={busy}
          onClick={() => onRemove(line)}
        >
          <Icon name="trash" />
        </button>
      </div>
    </article>
  );
}
