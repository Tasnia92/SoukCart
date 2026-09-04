import { useNavigate } from "@tanstack/react-router";
import { Check, Minus, Plus, ShoppingBag, ShoppingCart } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  EmptyState,
  InlineNotice,
  LoadingState,
  PageHeader,
  SearchToolbar,
  WorkspaceError,
  type NoticeState,
} from "../../components/ui/Workspace.tsx";
import { useProductChanges } from "../../product-realtime.ts";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { formatPrice } from "../workspace/format.ts";
import { RouterLink } from "../workspace/WorkspaceShell.tsx";
import {
  filterProducts,
  getCategoryCounts,
  loadActiveProducts,
  loadCartQuantities,
  nextCartQuantity,
  upsertCartItem,
  type RetailerProduct,
} from "./retailer-catalog-api.ts";
import { consumeRetailerNotice } from "./retailer-flash.ts";
import { RetailerWorkspaceShell } from "./retailer-shared.tsx";

type RetailerCatalogProps = {
  loadProducts?: () => Promise<RetailerProduct[]>;
  loadCart?: (userId: string) => Promise<Record<string, number>>;
  addToCart?: (userId: string, productId: string, quantity: number) => Promise<void>;
};

type Notice = { message: string; state: NoticeState } | null;

const ADDED_FEEDBACK_MS = 900;
const ALL_CATEGORIES = "__all_categories__";

function ProductArt({ product }: { product: RetailerProduct }) {
  if (!product.image_url) {
    return <ShoppingBag className="size-10 text-muted-foreground" aria-hidden="true" />;
  }

  return (
    <img
      className="absolute inset-0 size-full object-cover"
      src={product.image_url}
      alt=""
      loading="lazy"
    />
  );
}

export function RetailerCatalog({
  loadProducts = loadActiveProducts,
  loadCart = loadCartQuantities,
  addToCart = upsertCartItem,
}: RetailerCatalogProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/retailer/catalog" });
  const [products, setProducts] = useState<RetailerProduct[] | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [notice, setNotice] = useState<Notice>(() => consumeRetailerNotice());
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addedId, setAddedId] = useState<string | null>(null);

  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const retailerId = state.status === "retailer" ? state.session.user.id : "";

  useProductChanges({
    enabled: Boolean(retailerId),
    onChange: () => setLoadVersion((version) => version + 1),
  });

  useEffect(() => {
    if (!retailerId) return;
    let current = true;
    setError(null);

    void Promise.all([loadProducts(), loadCart(retailerId)])
      .then(([nextProducts, nextCart]) => {
        if (!current) return;
        setProducts(nextProducts);
        setCart(nextCart);
      })
      .catch((loadError: unknown) => {
        if (current) {
          setError(loadError instanceof Error ? loadError.message : "Please try again.");
        }
      });

    return () => {
      current = false;
    };
  }, [loadCart, loadProducts, loadVersion, retailerId]);

  useEffect(
    () => () => {
      if (addedTimer.current) clearTimeout(addedTimer.current);
    },
    [],
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

  const cartCount = Object.values(cart).reduce((sum, qty) => sum + (qty > 0 ? qty : 0), 0);

  const setQuantity = (product: RetailerProduct, change: number) => {
    setQuantities((prev) => {
      const minQty = Math.max(1, product.min_order_qty || 1);
      const current = prev[product.id] ?? minQty;
      const next = Math.min(Math.max(minQty, current + change), product.stock);
      return { ...prev, [product.id]: next };
    });
  };

  const onAdd = async (product: RetailerProduct) => {
    if (addingId === product.id) return;

    let wanted: number;
    try {
      wanted = nextCartQuantity(product, cart[product.id] ?? 0, quantities[product.id] ?? 1);
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
      setQuantities((prev) => ({ ...prev, [product.id]: 1 }));
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

  const filtered = products ? filterProducts(products, searchTerm, selectedCategory) : [];
  const categories = products ? getCategoryCounts(products) : [];

  return (
    <RetailerWorkspaceShell
      section="catalog"
      userName={userName}
      userEmail={state.profile.email}
      cartCount={cartCount}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Supplier catalog"
        title="Place an order."
        copy="Pick products, choose quantities, and add them to your order."
        actions={
          <Button asChild>
            <RouterLink to="/retailer/cart">
              <ShoppingCart data-icon="inline-start" />
              Review order{cartCount ? ` (${cartCount})` : ""}
            </RouterLink>
          </Button>
        }
      />
      <InlineNotice message={notice?.message} state={notice?.state} />
      {products ? (
        <div className="flex flex-col gap-6">
          <SearchToolbar
            label="Search products"
            placeholder="Search products"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            result={`${filtered.length} of ${products.length} products`}
          />

          {categories.length ? (
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
                All categories
                <Badge variant="secondary">{products.length}</Badge>
              </ToggleGroupItem>
              {categories.map(({ category, count }) => (
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
          ) : null}

          {filtered.length ? (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  quantity={quantities[product.id] ?? product.min_order_qty}
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
              title="No matching products"
              copy="Try a different search term."
            />
          )}
        </div>
      ) : (
        <LoadingState title="Loading the catalog…" />
      )}
    </RetailerWorkspaceShell>
  );
}

function ProductCard({
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
  const atMax = !outOfStock && inCart >= product.stock;

  return (
    <article className="h-full">
      <Card className="h-full gap-0 overflow-hidden py-0">
        <div className="relative flex aspect-[4/3] w-full shrink-0 items-center justify-center overflow-hidden bg-muted">
          <ProductArt product={product} />
        </div>
        <CardHeader className="pt-(--card-spacing)">
          <CardTitle>
            <h3 className="line-clamp-2 min-h-[2.75rem] leading-snug">{product.name}</h3>
          </CardTitle>
          <CardDescription className="truncate">
            {product.seller_name || "SoukCart sample"}
          </CardDescription>
          <CardAction>
            <Badge variant="outline">{formatPrice(product.price)}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-3">
          <p className="line-clamp-3 min-h-[3.75rem] text-sm text-muted-foreground">
            {product.description}
          </p>
          <div className="flex min-h-7 flex-wrap content-start gap-2">
            <Badge variant={outOfStock ? "destructive" : "secondary"}>
              {outOfStock ? "Out of stock" : `${product.stock} in stock`}
            </Badge>
            {product.min_order_qty > 1 ? (
              <Badge variant="outline">Min {product.min_order_qty}</Badge>
            ) : null}
            {inCart ? <Badge variant="outline">{inCart} in your order</Badge> : null}
            {!outOfStock ? <Badge variant="outline">Per {product.unit}</Badge> : null}
          </div>
        </CardContent>
        <CardFooter className="mt-auto flex-col items-stretch gap-3 border-t pt-(--card-spacing) pb-(--card-spacing) sm:flex-row sm:items-center sm:justify-between">
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
            variant={added ? "secondary" : "default"}
            disabled={outOfStock || atMax || adding}
            onClick={() => onAdd(product)}
          >
            {added ? <Check data-icon="inline-start" /> : <ShoppingCart data-icon="inline-start" />}
            {added ? "Added" : atMax ? "All stock in cart" : "Add to Cart"}
          </Button>
        </CardFooter>
      </Card>
    </article>
  );
}
