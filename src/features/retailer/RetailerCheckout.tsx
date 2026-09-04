import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, LockKeyhole, MapPin, Plus, ShoppingBag, Store, Truck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
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
  assertCartWithinStock,
  cartDeliveryCharge,
  cartItemCount,
  cartOrderTotal,
  cartPayableNow,
  cartSubtotal,
  initiateCheckout,
  loadCartLines,
  type CartLine,
  type CheckoutForm,
  type CheckoutOutcome,
  type PaymentMethod,
} from "./retailer-cart-api.ts";
import { RetailerWorkspaceShell } from "./retailer-shared.tsx";
import {
  createRetailerShippingAddress,
  loadRetailerShippingAddresses,
  type RetailerShippingAddress,
} from "./retailer-settings-api.ts";

type Notice = { message: string; state: NoticeState } | null;

const emptyForm = { phone: "", address: "", city: "", postcode: "", notes: "" };

type RetailerCheckoutProps = {
  loadLines?: (userId: string) => Promise<CartLine[]>;
  loadAddresses?: (userId: string) => Promise<RetailerShippingAddress[]>;
  checkout?: (method: PaymentMethod, form: CheckoutForm) => Promise<CheckoutOutcome>;
};

export function RetailerCheckout({
  loadLines = loadCartLines,
  loadAddresses = loadRetailerShippingAddresses,
  checkout = initiateCheckout,
}: RetailerCheckoutProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/retailer/checkout" });
  const [lines, setLines] = useState<CartLine[] | null>(null);
  const [addresses, setAddresses] = useState<RetailerShippingAddress[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [notice, setNotice] = useState<Notice>(null);
  const [selectedAddressId, setSelectedAddressId] = useState<string>("new");
  const [form, setForm] = useState(emptyForm);
  const [saveAddress, setSaveAddress] = useState(false);
  const [addressLabel, setAddressLabel] = useState("Shop");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("online");
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

    void Promise.all([loadLines(retailerId), loadAddresses(retailerId)])
      .then(([nextLines, nextAddresses]) => {
        if (!current) return;
        setLines(nextLines);
        setAddresses(nextAddresses);
        const preferred = nextAddresses.find((item) => item.is_default) ?? nextAddresses[0];
        if (preferred) {
          setSelectedAddressId(preferred.id);
          setForm({
            phone: preferred.phone,
            address: preferred.address,
            city: preferred.city,
            postcode: preferred.postcode,
            notes: "",
          });
          setSaveAddress(false);
        } else {
          setSelectedAddressId("new");
          setForm(emptyForm);
        }
      })
      .catch((loadError: unknown) => {
        if (current) {
          setError(loadError instanceof Error ? loadError.message : "Please try again.");
        }
      });

    return () => {
      current = false;
    };
  }, [loadAddresses, loadLines, loadVersion, retailerId]);

  useEffect(() => {
    if (lines && lines.length === 0) {
      void navigate({ to: "/retailer/cart", replace: true });
    }
  }, [lines, navigate]);

  const selectedSaved = useMemo(
    () => addresses?.find((item) => item.id === selectedAddressId) ?? null,
    [addresses, selectedAddressId],
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
        title="We could not load checkout."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  const setField = (name: keyof typeof emptyForm, value: string) =>
    setForm((prev) => ({ ...prev, [name]: value }));

  const onSelectAddress = (value: string) => {
    setSelectedAddressId(value);
    if (value === "new") {
      setForm((prev) => ({ ...emptyForm, notes: prev.notes }));
      setSaveAddress(true);
      return;
    }
    const match = addresses?.find((item) => item.id === value);
    if (!match) return;
    setForm((prev) => ({
      phone: match.phone,
      address: match.address,
      city: match.city,
      postcode: match.postcode,
      notes: prev.notes,
    }));
    setSaveAddress(false);
  };

  const onCheckout = async () => {
    if (!lines?.length) return;
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
      if (selectedAddressId === "new" && saveAddress) {
        await createRetailerShippingAddress(retailerId, {
          label: addressLabel.trim() || "Address",
          phone,
          address,
          city,
          postcode,
          isDefault: !(addresses && addresses.length > 0),
        });
      }
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
  const usingNewAddress = selectedAddressId === "new";

  return (
    <RetailerWorkspaceShell
      section="checkout"
      userName={userName}
      userEmail={state.profile.email}
      cartCount={cartCount}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Checkout"
        title="Delivery and payment."
        copy="Choose where this order should arrive, then pay securely."
        actions={
          <Button asChild variant="ghost">
            <RouterLink to="/retailer/cart">
              <ArrowLeft data-icon="inline-start" />
              Back to cart
            </RouterLink>
          </Button>
        }
      />
      <InlineNotice message={notice?.message} state={notice?.state} />

      {lines ? (
        lines.length ? (
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
            <section className="flex flex-col gap-6" aria-label="Checkout details">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MapPin className="size-4" aria-hidden="true" />
                    Delivery address
                  </CardTitle>
                  <CardDescription>
                    Pick a saved address or enter a new one for this order.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-6">
                  {addresses && addresses.length > 0 ? (
                    <RadioGroup value={selectedAddressId} onValueChange={onSelectAddress}>
                      <div className="flex flex-col gap-3">
                        {addresses.map((address) => (
                          <FieldLabel
                            key={address.id}
                            htmlFor={`checkout-address-${address.id}`}
                            className="rounded-lg border p-3"
                          >
                            <Field orientation="horizontal">
                              <RadioGroupItem
                                id={`checkout-address-${address.id}`}
                                value={address.id}
                              />
                              <FieldContent>
                                <FieldTitle className="flex items-center gap-2">
                                  {address.label}
                                  {address.is_default ? (
                                    <Badge variant="secondary">Default</Badge>
                                  ) : null}
                                </FieldTitle>
                                <FieldDescription>
                                  {address.address}, {address.city} {address.postcode} ·{" "}
                                  {address.phone}
                                </FieldDescription>
                              </FieldContent>
                            </Field>
                          </FieldLabel>
                        ))}
                        <FieldLabel
                          htmlFor="checkout-address-new"
                          className="rounded-lg border p-3"
                        >
                          <Field orientation="horizontal">
                            <RadioGroupItem id="checkout-address-new" value="new" />
                            <FieldContent>
                              <FieldTitle className="flex items-center gap-2">
                                <Plus className="size-4" aria-hidden="true" />
                                Use a different address
                              </FieldTitle>
                            </FieldContent>
                          </Field>
                        </FieldLabel>
                      </div>
                    </RadioGroup>
                  ) : null}

                  {(usingNewAddress || !addresses?.length) && (
                    <FieldGroup>
                      {!addresses?.length ? (
                        <p className="text-sm text-muted-foreground">
                          No saved addresses yet. Enter delivery details below — you can save them
                          for next time.
                        </p>
                      ) : null}
                      <Field>
                        <FieldLabel htmlFor="checkout-phone">Phone number</FieldLabel>
                        <Input
                          id="checkout-phone"
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
                        <FieldLabel htmlFor="checkout-address">Delivery address</FieldLabel>
                        <Input
                          id="checkout-address"
                          autoComplete="street-address"
                          placeholder="House, road, area"
                          required
                          value={form.address}
                          onChange={(event) => setField("address", event.target.value)}
                        />
                      </Field>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field>
                          <FieldLabel htmlFor="checkout-city">City</FieldLabel>
                          <Input
                            id="checkout-city"
                            autoComplete="address-level2"
                            placeholder="Dhaka"
                            required
                            value={form.city}
                            onChange={(event) => setField("city", event.target.value)}
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="checkout-postcode">Postcode</FieldLabel>
                          <Input
                            id="checkout-postcode"
                            autoComplete="postal-code"
                            placeholder="1205"
                            required
                            value={form.postcode}
                            onChange={(event) => setField("postcode", event.target.value)}
                          />
                        </Field>
                      </div>
                      <Field>
                        <FieldLabel htmlFor="checkout-address-label">Save as</FieldLabel>
                        <Input
                          id="checkout-address-label"
                          placeholder="Shop front"
                          value={addressLabel}
                          onChange={(event) => setAddressLabel(event.target.value)}
                          disabled={!saveAddress}
                        />
                      </Field>
                      <Field orientation="horizontal">
                        <Checkbox
                          id="checkout-save-address"
                          checked={saveAddress}
                          onCheckedChange={(checked) => setSaveAddress(checked === true)}
                        />
                        <FieldLabel htmlFor="checkout-save-address">
                          Save this address for future orders
                        </FieldLabel>
                      </Field>
                    </FieldGroup>
                  )}

                  {!usingNewAddress && selectedSaved ? (
                    <div className="rounded-lg bg-muted/50 p-4 text-sm">
                      <p className="font-medium">{selectedSaved.label}</p>
                      <p className="text-muted-foreground">
                        {selectedSaved.address}, {selectedSaved.city} {selectedSaved.postcode}
                      </p>
                      <p className="text-muted-foreground">{selectedSaved.phone}</p>
                    </div>
                  ) : null}

                  <Field>
                    <FieldLabel htmlFor="checkout-notes">Notes for the supplier</FieldLabel>
                    <Textarea
                      id="checkout-notes"
                      rows={2}
                      placeholder="Delivery instructions, packaging, etc."
                      value={form.notes}
                      onChange={(event) => setField("notes", event.target.value)}
                    />
                  </Field>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Payment method</CardTitle>
                  <CardDescription>Choose how you want to pay for this order.</CardDescription>
                </CardHeader>
                <CardContent>
                  <FieldSet>
                    <FieldLegend className="sr-only">Payment method</FieldLegend>
                    <RadioGroup
                      name="payment-method"
                      value={paymentMethod}
                      onValueChange={(value) => setPaymentMethod(value as PaymentMethod)}
                    >
                      <FieldLabel htmlFor="payment-method-online" className="rounded-lg border p-3">
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
                      <FieldLabel htmlFor="payment-method-cod" className="rounded-lg border p-3">
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
              </Card>
            </section>

            <aside aria-label="Order summary" className="xl:sticky xl:top-4">
              <Card>
                <CardHeader>
                  <CardTitle>Order summary</CardTitle>
                  <CardDescription>{cartCount} items ready to place.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <ul className="flex flex-col gap-2 text-sm">
                    {lines.map((line) => (
                      <li key={line.product.id} className="flex justify-between gap-3">
                        <span className="min-w-0 truncate">
                          {line.product.name} × {line.quantity}
                        </span>
                        <span className="tabular-nums">
                          {formatPrice(line.product.price * line.quantity)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <Separator />
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <dt className="text-muted-foreground">Subtotal</dt>
                    <dd className="text-right tabular-nums">{formatPrice(subtotal)}</dd>
                    <dt className="text-muted-foreground">Delivery</dt>
                    <dd className="text-right tabular-nums">{formatPrice(delivery)}</dd>
                    <dt className="font-medium">Total</dt>
                    <dd className="text-right font-medium tabular-nums">
                      {formatPrice(orderTotal)}
                    </dd>
                  </dl>
                </CardContent>
                <CardFooter className="flex-col items-stretch gap-3">
                  <Button type="button" disabled={checkingOut} onClick={() => void onCheckout()}>
                    {checkingOut ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <CheckoutIcon data-icon="inline-start" />
                    )}
                    {cod
                      ? `Pay delivery · ${formatPrice(payableNow)}`
                      : `Pay ${formatPrice(payableNow)}`}
                  </Button>
                  <p className="text-sm text-muted-foreground">
                    {cod
                      ? `Pay ${formatPrice(delivery)} delivery online now. Pay ${formatPrice(subtotal)} for products in cash when your order arrives.`
                      : "You will be redirected to SSLCommerz to complete the payment securely."}
                  </p>
                  <Button asChild variant="ghost" size="sm">
                    <RouterLink to="/retailer/settings">Manage saved addresses</RouterLink>
                  </Button>
                </CardFooter>
              </Card>
            </aside>
          </div>
        ) : (
          <EmptyState
            icon={Store}
            title="Your cart is empty"
            copy="Add products before checking out."
            action={
              <Button asChild>
                <RouterLink to="/retailer/catalog">
                  <ShoppingBag data-icon="inline-start" />
                  Browse catalog
                </RouterLink>
              </Button>
            }
          />
        )
      ) : (
        <LoadingState title="Loading checkout…" />
      )}
    </RetailerWorkspaceShell>
  );
}
