import { useNavigate } from "@tanstack/react-router";
import { Check, Minus, PackageOpen, Plus, ShoppingCart } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
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
import { RouterLink } from "../../components/ui/RouterLink.tsx";
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
import { ProductArt } from "../workspace/product-art.tsx";
import {
  loadActiveProducts,
  loadCartQuantities,
  nextCartQuantity,
  relatedProducts,
  upsertCartItem,
  type RetailerProduct,
} from "./retailer-catalog-api.ts";
import { ADDED_FEEDBACK_MS, ProductCard } from "./RetailerStorefront.tsx";
import { RetailerWorkspaceShell } from "./retailer-shared.tsx";

type RetailerProductPageProps = {
  productId: string;
  loadProducts?: () => Promise<RetailerProduct[]>;
  loadCart?: (userId: string) => Promise<Record<string, number>>;
  addToCart?: (userId: string, productId: string, quantity: number) => Promise<void>;
};

type Notice = { message: string; state: NoticeState } | null;

export function RetailerProductPage({
  productId,
  loadProducts = loadActiveProducts,
  loadCart = loadCartQuantities,
  addToCart = upsertCartItem,
}: RetailerProductPageProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/retailer/products/$productId" });
  const retailerId = state.status === "retailer" ? state.session.user.id : "";

  const [products, setProducts] = useState<RetailerProduct[] | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addedId, setAddedId] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);

  useEffect(() => {
    if (!retailerId) return;
    let current = true;
    setError(null);

    void Promise.all([loadProducts(), loadCart(retailerId)])
      .then(([list, cartQuantities]) => {
        if (!current) return;
        setProducts(list);
        setCart(cartQuantities);
      })
      .catch((loadError: unknown) => {
        if (!current) return;
        setError(
          loadError instanceof Error ? loadError.message : "We could not load this product.",
        );
      });

    return () => {
      current = false;
    };
  }, [retailerId, loadVersion, loadProducts, loadCart]);

  useEffect(() => {
    if (!addedId) return;
    const timer = setTimeout(() => {
      setAddedId((current) => (current === addedId ? null : current));
    }, ADDED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [addedId]);

  if (state.status !== "retailer") return null;

  const onLogout = () => {
    void store.signOut().then(() => {
      void navigate({ to: "/" });
    });
  };
  const retry = () => setLoadVersion((version) => version + 1);
  const userName = state.profile.name || state.profile.email;

  const cartCount = Object.values(cart).filter((quantity) => quantity > 0).length;

  const shell = (children: ReactNode) => (
    <RetailerWorkspaceShell
      section="storefront"
      userName={userName}
      userEmail={state.profile.email}
      cartCount={cartCount}
      onLogout={onLogout}
    >
      {children}
    </RetailerWorkspaceShell>
  );

  if (error) {
    return shell(
      <WorkspaceError
        eyebrow="Retailer workspace"
        title="We could not load this product."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />,
    );
  }

  if (!products) {
    return shell(<LoadingState title="Loading product…" />);
  }

  const product = products.find((item) => item.id === productId) ?? null;
  if (!product) {
    return shell(
      <>
        <div className="flex">
          <Button asChild variant="link" className="h-auto p-0">
            <RouterLink to="/retailer/">Back to storefront</RouterLink>
          </Button>
        </div>
        <EmptyState
          icon={PackageOpen}
          title="This product is no longer available"
          copy="It may have sold out or been removed by the supplier. Browse the storefront for alternatives."
          action={
            <Button asChild>
              <RouterLink to="/retailer/">Browse the storefront</RouterLink>
            </Button>
          }
        />
      </>,
    );
  }

  const related = relatedProducts(products, product);
  const minQty = Math.max(1, product.min_order_qty || 1);
  const quantity = quantities[product.id] ?? minQty;
  const inCart = cart[product.id] ?? 0;
  const outOfStock = product.stock <= 0;
  const atMax = !outOfStock && inCart >= product.stock;
  const lowStock = !outOfStock && product.stock <= 5;
  const added = addedId === product.id;

  const setQuantity = (target: RetailerProduct, change: number) => {
    setQuantities((prev) => {
      const minOrder = Math.max(1, target.min_order_qty || 1);
      const current = prev[target.id] ?? minOrder;
      const next = Math.min(Math.max(minOrder, current + change), target.stock);
      return { ...prev, [target.id]: next };
    });
  };

  const onAdd = async (target: RetailerProduct) => {
    if (addingId === target.id) return;

    let wanted: number;
    try {
      wanted = nextCartQuantity(target, cart[target.id] ?? 0, quantities[target.id] ?? 1);
    } catch (validationError) {
      setNotice({
        message:
          validationError instanceof Error
            ? validationError.message
            : "The product could not be added.",
        state: "error",
      });
      return;
    }

    setAddingId(target.id);
    try {
      await addToCart(retailerId, target.id, wanted);
      setCart((prev) => ({ ...prev, [target.id]: wanted }));
      setAddedId(target.id);
      setNotice(null);
    } catch (addError) {
      setNotice({
        message: addError instanceof Error ? addError.message : "The product could not be added.",
        state: "error",
      });
    } finally {
      setAddingId(null);
    }
  };

  const relatedCopy = [
    product.seller_name ? `More from ${product.seller_name}.` : null,
    product.category ? `More in ${product.category}.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return shell(
    <>
      <div className="flex">
        <Button asChild variant="link" className="h-auto p-0">
          <RouterLink to="/retailer/">Back to storefront</RouterLink>
        </Button>
      </div>
      <PageHeader
        eyebrow="Product details"
        title={product.name}
        copy={product.seller_name ? `Sold by ${product.seller_name}.` : undefined}
        actions={
          cartCount > 0 ? (
            <Button asChild variant="outline">
              <RouterLink to="/retailer/cart">View order ({cartCount})</RouterLink>
            </Button>
          ) : null
        }
      />
      <InlineNotice message={notice?.message} state={notice?.state} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card size="sm" className="gap-0 overflow-hidden py-0">
          <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden bg-muted">
            <ProductArt src={product.image_url} alt={product.name} />
          </div>
        </Card>
        <Card className="gap-0 py-0">
          <CardHeader className="pt-5">
            <CardTitle className="sr-only">{product.name}</CardTitle>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-heading text-3xl font-semibold tabular-nums">
                {formatPrice(product.price)}
              </span>
              <span className="text-sm text-muted-foreground">per {product.unit}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {outOfStock ? (
                <Badge variant="destructive">Out of stock</Badge>
              ) : lowStock ? (
                <Badge
                  variant="outline"
                  className="border-amber-600/40 text-amber-600 dark:text-amber-400"
                >
                  Low stock — {product.stock} {product.unit}
                </Badge>
              ) : (
                <Badge variant="outline">
                  {product.stock} {product.unit} in stock
                </Badge>
              )}
              {product.category ? <Badge variant="secondary">{product.category}</Badge> : null}
            </div>
            {product.seller_name ? (
              <CardDescription className="truncate">Sold by {product.seller_name}</CardDescription>
            ) : null}
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4">
            <div>
              <h2 className="text-sm font-medium">About this product</h2>
              <p className="mt-1 text-sm whitespace-pre-line text-muted-foreground">
                {product.description
                  ? product.description
                  : "The supplier has not added a description for this product yet."}
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-muted-foreground">Minimum order</dt>
                <dd className="font-medium">
                  {product.min_order_qty} {product.unit}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">In stock</dt>
                <dd className="font-medium">
                  {product.stock} {product.unit}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Category</dt>
                <dd className="font-medium">{product.category ?? "Uncategorized"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Sold by</dt>
                <dd className="truncate font-medium">{product.seller_name ?? "—"}</dd>
              </div>
            </dl>
          </CardContent>
          <CardFooter className="mt-auto flex-col items-stretch gap-2 border-t pt-4 pb-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div
              className="flex items-center gap-2"
              role="group"
              aria-label={`Quantity for ${product.name}`}
            >
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Decrease quantity"
                disabled={outOfStock || quantity <= minQty}
                onClick={() => setQuantity(product, -1)}
              >
                <Minus />
              </Button>
              <output className="min-w-10 text-center text-lg font-medium tabular-nums">
                {quantity}
              </output>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Increase quantity"
                disabled={outOfStock || quantity >= product.stock}
                onClick={() => setQuantity(product, 1)}
              >
                <Plus />
              </Button>
            </div>
            <Button
              type="button"
              size="lg"
              className="shrink-0"
              variant={added ? "secondary" : "default"}
              disabled={outOfStock || atMax || addingId === product.id}
              onClick={() => onAdd(product)}
            >
              {added ? (
                <Check data-icon="inline-start" />
              ) : (
                <ShoppingCart data-icon="inline-start" />
              )}
              {added ? "Added to your order" : atMax ? "All in cart" : "Add to order"}
            </Button>
          </CardFooter>
        </Card>
      </div>

      {related.length ? (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="font-heading text-lg font-semibold">Related products</h2>
            <p className="text-sm text-muted-foreground">
              {relatedCopy || "Other products you may need."}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {related.map((item) => (
              <ProductCard
                key={item.id}
                product={item}
                quantity={quantities[item.id] ?? item.min_order_qty}
                inCart={cart[item.id] ?? 0}
                adding={addingId === item.id}
                added={addedId === item.id}
                onStep={setQuantity}
                onAdd={onAdd}
              />
            ))}
          </div>
        </section>
      ) : null}
    </>,
  );
}
