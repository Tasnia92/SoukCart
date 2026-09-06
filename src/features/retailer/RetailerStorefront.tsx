import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Check,
  Minus,
  Plus,
  RefreshCw,
  ShoppingBag,
  ShoppingCart,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { RouterLink } from "../../components/ui/RouterLink.tsx";
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
import { ProductArt } from "../workspace/product-art.tsx";
import { reorderOrderItems } from "./retailer-cart-api.ts";
import {
  filterProducts,
  getCategoryCounts,
  loadActiveProducts,
  loadCartQuantities,
  minOrderQuantity,
  nextCartQuantity,
  parseProductSort,
  PRODUCT_SORTS,
  sortProducts,
  upsertCartItem,
  type ProductSort,
  type RetailerProduct,
} from "./retailer-catalog-api.ts";
import {
  buildRetailerDashboard,
  loadRetailerDashboardInput,
  type RetailerDashboardInput,
  type RetailerNextAction,
} from "./retailer-dashboard-api.ts";
import { consumeRetailerNotice } from "./retailer-flash.ts";
import { useRetailerOrderChanges } from "./retailer-realtime.ts";
import {
  applyReconciliation,
  reconcileRetailerPayments,
  type ReconciliationResult,
} from "./retailer-overview-api.ts";
import type { RetailerOrder } from "./retailer-orders-api.ts";
import { RetailerWorkspaceShell } from "./retailer-shared.tsx";

type RetailerStorefrontProps = {
  /** "home" renders the storefront cockpit; "catalog" renders the plain all-products page. */
  variant?: "home" | "catalog";
  loadProducts?: () => Promise<RetailerProduct[]>;
  loadCart?: (userId: string) => Promise<Record<string, number>>;
  addToCart?: (userId: string, productId: string, quantity: number) => Promise<void>;
  loadInput?: (retailerId: string) => Promise<RetailerDashboardInput>;
  /** Overridable so tests can render without touching the payment gateway. */
  reconcile?: (
    retailerId: string,
    orders: readonly RetailerOrder[],
  ) => Promise<ReconciliationResult>;
};

type Notice = { message: string; state: NoticeState } | null;

export const ADDED_FEEDBACK_MS = 900;
const ALL_CATEGORIES = "__all_categories__";
/** Category chips shown before the "View all" expander takes over. */
const CATEGORY_PREVIEW_COUNT = 6;

/**
 * The one thing worth doing right now (a broken payment, an unconfirmed
 * delivery) as a compact banner above the product listing. The "browse" case
 * is skipped — the storefront already is the browse surface, and an open
 * basket stays quiet: the cart button and sidebar badge already count it.
 */
function ActionBanner({ action }: { action: RetailerNextAction }) {
  const ActionIcon = action.icon;
  const destructive = action.severity === "critical";

  return (
    <div
      className={
        destructive
          ? "flex flex-col gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between"
          : "flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
      }
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={
            destructive
              ? "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive"
              : "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
          }
        >
          <ActionIcon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium">{action.title}</p>
          <p className="text-sm text-muted-foreground">{action.copy}</p>
        </div>
      </div>
      <Button
        asChild
        size="sm"
        variant={destructive ? "destructive" : "default"}
        className="shrink-0 self-start sm:self-center"
      >
        <RouterLink
          to={action.orderId ? "/retailer/orders/$orderId" : action.to}
          params={action.orderId ? { orderId: action.orderId } : undefined}
        >
          {action.actionLabel}
          <ArrowRight data-icon="inline-end" />
        </RouterLink>
      </Button>
    </div>
  );
}

export function RetailerStorefront({
  variant = "home",
  loadProducts = loadActiveProducts,
  loadCart = loadCartQuantities,
  addToCart = upsertCartItem,
  loadInput = loadRetailerDashboardInput,
  reconcile = reconcileRetailerPayments,
}: RetailerStorefrontProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/retailer" });
  // The shared header search lands on this page with the term in `?q=`; the
  // local input starts from it and follows along if the URL term changes.
  const urlQuery = useSearch({
    strict: false,
    select: (search) => {
      const value = (search as Record<string, unknown>).q;
      return typeof value === "string" ? value : "";
    },
  });
  const [products, setProducts] = useState<RetailerProduct[] | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [orders, setOrders] = useState<RetailerOrder[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [searchTerm, setSearchTerm] = useState(urlQuery);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [sort, setSort] = useState<ProductSort>("name");
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [notice, setNotice] = useState<Notice>(() => consumeRetailerNotice());
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addedId, setAddedId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);

  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSearchTerm(urlQuery);
  }, [urlQuery]);

  const retailerId = state.status === "retailer" ? state.session.user.id : "";

  useProductChanges({
    enabled: Boolean(retailerId),
    onChange: () => setLoadVersion((version) => version + 1),
  });

  useRetailerOrderChanges({
    enabled: Boolean(retailerId),
    retailerId: retailerId || undefined,
    onChange: () => setLoadVersion((version) => version + 1),
  });

  useEffect(() => {
    if (!retailerId) return;
    let current = true;
    setError(null);

    void Promise.all([loadProducts(), loadCart(retailerId), loadInput(retailerId)])
      .then(([nextProducts, nextCart, nextInput]) => {
        if (!current) return;
        setProducts(nextProducts);
        setCart(nextCart);
        setOrders([...nextInput.orders]);

        // Payment reconciliation runs after the page has painted, so a slow
        // gateway can no longer hold up the storefront.
        void reconcile(retailerId, nextInput.orders)
          .then(({ updates, cartCleared }) => {
            if (!current || (!updates.length && !cartCleared)) return;
            setOrders((previous) => applyReconciliation(previous, updates));
            if (cartCleared) setCart({});
          })
          .catch(() => {
            // Reconciliation is a background correction; the shown data stays valid.
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
  }, [loadCart, loadInput, loadProducts, loadVersion, reconcile, retailerId]);

  useEffect(
    () => () => {
      if (addedTimer.current) clearTimeout(addedTimer.current);
    },
    [],
  );

  const cartCount = Object.values(cart).filter((qty) => qty > 0).length;
  const dashboard = useMemo(
    () => buildRetailerDashboard({ orders, cartItems: cartCount }),
    [cartCount, orders],
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

  const reorderOrder = orders.find((order) => order.id === dashboard.reorderOrderId);

  const setQuantity = (product: RetailerProduct, change: number) => {
    setQuantities((prev) => {
      const minQty = minOrderQuantity(product);
      const current = prev[product.id] ?? minQty;
      const next = Math.min(Math.max(minQty, current + change), product.stock);
      return { ...prev, [product.id]: next };
    });
  };

  const onAdd = async (product: RetailerProduct) => {
    if (addingId === product.id) return;

    let wanted: number;
    try {
      wanted = nextCartQuantity(
        product,
        cart[product.id] ?? 0,
        quantities[product.id] ?? minOrderQuantity(product),
      );
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

    setAddingId(product.id);
    try {
      await addToCart(retailerId, product.id, wanted);
      setCart((prev) => ({ ...prev, [product.id]: wanted }));
      // Restart the stepper from the product's minimum order quantity, the
      // same value a fresh page load would show.
      setQuantities((prev) => ({ ...prev, [product.id]: minOrderQuantity(product) }));
      setAddedId(product.id);
      if (addedTimer.current) clearTimeout(addedTimer.current);
      addedTimer.current = setTimeout(() => {
        setAddedId((current) => (current === product.id ? null : current));
      }, ADDED_FEEDBACK_MS);
    } catch (addError) {
      setNotice({
        message: addError instanceof Error ? addError.message : "The product could not be added.",
        state: "error",
      });
    } finally {
      setAddingId(null);
    }
  };

  const onReorder = () => {
    if (!reorderOrder) return;
    setReordering(true);
    void reorderOrderItems(
      retailerId,
      reorderOrder.items.map((item) => ({ product_id: item.product_id, quantity: item.quantity })),
    )
      .then(async (outcome) => {
        if (!outcome.lines) {
          setNotice({
            message:
              "None of these items are orderable right now — the catalog or stock may have changed.",
            state: "info",
          });
          return;
        }
        setCart(await loadCart(retailerId));
        const unavailable = outcome.unavailable
          ? ` ${outcome.unavailable} item${outcome.unavailable === 1 ? " is" : "s are"} no longer orderable.`
          : "";
        setNotice({
          message: `Added ${outcome.lines} item${outcome.lines === 1 ? "" : "s"} (${outcome.units} units) to your cart.${unavailable}`,
          state: "success",
        });
      })
      .catch((reorderError: unknown) => {
        setNotice({
          message:
            reorderError instanceof Error
              ? reorderError.message
              : "The items could not be added to your cart.",
          state: "error",
        });
      })
      .finally(() => setReordering(false));
  };

  const filtered = products
    ? sortProducts(filterProducts(products, searchTerm, selectedCategory), sort)
    : [];
  const categories = products ? getCategoryCounts(products) : [];
  const previewCategories = categories.slice(0, CATEGORY_PREVIEW_COUNT);
  const selectedBeyondPreview =
    selectedCategory && !previewCategories.some(({ category }) => category === selectedCategory);
  const visibleCategories =
    showAllCategories || selectedBeyondPreview ? categories : previewCategories;
  const nextAction = dashboard.nextAction;

  return (
    <RetailerWorkspaceShell
      section={variant === "catalog" ? "catalog" : "storefront"}
      userName={userName}
      userEmail={state.profile.email}
      cartCount={cartCount}
      onLogout={onLogout}
    >
      {variant === "catalog" ? (
        <PageHeader
          eyebrow="Catalog"
          title="Products."
          copy="Everything listed by verified suppliers — search, filter, and add to your order."
        />
      ) : null}
      <InlineNotice message={notice?.message} state={notice?.state} />

      {products ? (
        <div className="flex flex-col gap-5 pb-20 md:pb-0">
          {variant === "home" && nextAction.kind !== "browse" ? (
            <ActionBanner action={nextAction} />
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground" aria-live="polite">
              {filtered.length} of {products.length} products
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {variant === "home" && reorderOrder ? (
                <Button variant="outline" size="sm" onClick={onReorder} disabled={reordering}>
                  <RefreshCw data-icon="inline-start" />
                  Reorder last order
                </Button>
              ) : null}
              <Select value={sort} onValueChange={(value) => setSort(parseProductSort(value))}>
                <SelectTrigger size="sm" className="w-44" aria-label="Sort products">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCT_SORTS.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {categories.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <ToggleGroup
                className="flex-wrap justify-start"
                type="single"
                variant="outline"
                value={selectedCategory ?? ALL_CATEGORIES}
                onValueChange={(value) => {
                  if (value) setSelectedCategory(value === ALL_CATEGORIES ? null : value);
                }}
                aria-label="Filter by category"
              >
                <ToggleGroupItem type="button" value={ALL_CATEGORIES} aria-label="All categories">
                  All
                  <Badge variant="secondary">{products.length}</Badge>
                </ToggleGroupItem>
                {visibleCategories.map(({ category, count }) => (
                  <ToggleGroupItem
                    type="button"
                    value={category}
                    aria-label={category}
                    key={category}
                  >
                    {category}
                    <Badge variant="secondary">{count}</Badge>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {categories.length > CATEGORY_PREVIEW_COUNT ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAllCategories((show) => !show)}
                  aria-expanded={showAllCategories}
                >
                  {showAllCategories ? "Show less" : "View all"}
                  {showAllCategories ? (
                    <ChevronUp data-icon="inline-end" />
                  ) : (
                    <ChevronDown data-icon="inline-end" />
                  )}
                </Button>
              ) : null}
            </div>
          ) : null}

          {filtered.length ? (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {filtered.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  quantity={quantities[product.id] ?? minOrderQuantity(product)}
                  inCart={cart[product.id] ?? 0}
                  adding={addingId === product.id}
                  added={addedId === product.id}
                  onStep={setQuantity}
                  onAdd={onAdd}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={ShoppingBag}
              title={products.length ? "No matching products" : "The catalog is empty"}
              copy={
                products.length
                  ? "Try a different search term or category."
                  : "Supplier listings will appear here as soon as they are published."
              }
            />
          )}
        </div>
      ) : (
        <LoadingState title="Loading the catalog…" />
      )}

      {cartCount && products ? (
        <div
          className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 p-3 backdrop-blur md:hidden"
          role="region"
          aria-label="Cart summary"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">
              {cartCount} product{cartCount === 1 ? "" : "s"} in your order
            </span>
            <Button asChild size="sm">
              <RouterLink to="/retailer/cart">
                Review order
                <ArrowRight data-icon="inline-end" />
              </RouterLink>
            </Button>
          </div>
        </div>
      ) : null}
    </RetailerWorkspaceShell>
  );
}

export function ProductCard({
  product,
  quantity,
  inCart,
  adding,
  added,
  onStep,
  onAdd,
}: {
  product: RetailerProduct;
  quantity: number;
  inCart: number;
  adding: boolean;
  added: boolean;
  onStep: (product: RetailerProduct, change: number) => void;
  onAdd: (product: RetailerProduct) => void;
}) {
  const outOfStock = product.stock <= 0;
  const lowStock = !outOfStock && product.stock <= 5;
  const inOrder = inCart > 0 || added;

  return (
    <article className="h-full">
      <Card
        size="sm"
        className="group h-full gap-0 overflow-hidden py-0 transition-shadow hover:shadow-lg"
      >
        <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden bg-muted">
          <ProductArt
            src={product.image_url}
            alt={product.name}
            className="transition-transform duration-300 group-hover:scale-[1.04]"
          />
          <RouterLink
            to="/retailer/products/$productId"
            params={{ productId: product.id }}
            className="absolute inset-0 z-0"
            aria-hidden="true"
            tabIndex={-1}
          />
          {outOfStock ? (
            <Badge variant="destructive" className="absolute top-2 left-2 z-10">
              Out of stock
            </Badge>
          ) : null}
          {inCart ? <Badge className="absolute top-2 right-2 z-10">In order</Badge> : null}
        </div>
        <CardHeader className="pt-4">
          <CardTitle className="text-base">
            <h3 className="line-clamp-2 min-h-[2.5rem] leading-snug">
              <RouterLink
                to="/retailer/products/$productId"
                params={{ productId: product.id }}
                className="hover:underline"
              >
                {product.name}
              </RouterLink>
            </h3>
          </CardTitle>
          {product.seller_name ? (
            <CardDescription className="truncate">{product.seller_name}</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-lg font-semibold tabular-nums">{formatPrice(product.price)}</span>
            <span className="text-xs text-muted-foreground">per {product.unit}</span>
            <span
              className={
                lowStock
                  ? "ml-auto text-xs font-medium text-amber-600 dark:text-amber-400"
                  : "ml-auto text-xs text-muted-foreground"
              }
            >
              {outOfStock ? "Out of stock" : `${product.stock} in stock`}
            </span>
          </div>
          {product.description ? (
            <p className="line-clamp-2 text-sm text-muted-foreground">{product.description}</p>
          ) : null}
        </CardContent>
        <CardFooter className="mt-auto flex-col items-stretch gap-2 border-t pt-3 pb-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-2">
          {inOrder ? (
            <>
              <span className="text-sm text-muted-foreground">
                {added ? (
                  "Added to your order."
                ) : (
                  <>
                    <span className="font-medium tabular-nums text-foreground">{inCart}</span> in
                    order
                  </>
                )}
              </span>
              <Button
                asChild
                size="sm"
                variant={added ? "default" : "secondary"}
                className="shrink-0"
              >
                <RouterLink to="/retailer/cart">
                  {added ? (
                    <Check data-icon="inline-start" />
                  ) : (
                    <ArrowRight data-icon="inline-end" />
                  )}
                  View order
                </RouterLink>
              </Button>
            </>
          ) : (
            <>
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
                  disabled={outOfStock || quantity <= product.min_order_qty}
                  onClick={() => onStep(product, -1)}
                >
                  <Minus />
                </Button>
                <output className="min-w-8 text-center font-medium tabular-nums">{quantity}</output>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="Increase quantity"
                  disabled={outOfStock || quantity >= product.stock}
                  onClick={() => onStep(product, 1)}
                >
                  <Plus />
                </Button>
              </div>
              <Button
                type="button"
                size="sm"
                className="shrink-0"
                disabled={outOfStock || adding}
                onClick={() => onAdd(product)}
              >
                <ShoppingCart data-icon="inline-start" />
                Add
              </Button>
            </>
          )}
        </CardFooter>
      </Card>
    </article>
  );
}
