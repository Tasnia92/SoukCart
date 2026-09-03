import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Icon } from "../../components/ui/Icon.tsx";
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
import { RouterLink, WorkspaceShell } from "../workspace/WorkspaceShell.tsx";
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

type RetailerCatalogProps = {
  loadProducts?: () => Promise<RetailerProduct[]>;
  loadCart?: (userId: string) => Promise<Record<string, number>>;
  addToCart?: (userId: string, productId: string, quantity: number) => Promise<void>;
};

type Notice = { message: string; state: NoticeState } | null;

const ADDED_FEEDBACK_MS = 900;

function ProductArt({ product }: { product: RetailerProduct }) {
  return product.image_url ? (
    <img src={product.image_url} alt="" loading="lazy" />
  ) : (
    <Icon name="bag" />
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
  const [popKey, setPopKey] = useState(0);
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
      const current = prev[product.id] ?? 1;
      const next = Math.min(Math.max(1, current + change), product.stock);
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
      setPopKey((key) => key + 1);
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
    <WorkspaceShell
      navigationLabel="Retailer navigation"
      items={[
        { to: "/retailer", icon: "home", label: "Overview" },
        { to: "/retailer/catalog", icon: "bag", label: "Place order", active: true },
        {
          to: "/retailer/cart",
          icon: "cart",
          label: "Cart",
          trailing: cartCount ? (
            <span className="animate-in zoom-in" key={popKey}>
              {cartCount}
            </span>
          ) : undefined,
        },
        { to: "/retailer/orders", icon: "package", label: "My orders" },
        { to: "/retailer/complaints", icon: "message", label: "Help Center" },
      ]}
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Supplier catalog"
        title="Place an order."
        copy="Pick products, choose quantities, and add them to your order."
        actions={
          <Button asChild>
            <RouterLink to="/retailer/cart">
              <Icon name="cart" />
              <span>Review order{cartCount ? ` (${cartCount})` : ""}</span>
            </RouterLink>
          </Button>
        }
      />
      <InlineNotice message={notice?.message} state={notice?.state} />
      {products ? (
        <>
          <SearchToolbar
            label="Search products"
            placeholder="Search products"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            result={`${filtered.length} of ${products.length} products`}
          />

          {categories.length ? (
            <div className="rt-category-filters" role="group" aria-label="Filter by category">
              <button
                className={`rt-category-pill${selectedCategory === null ? " is-active" : ""}`}
                type="button"
                aria-pressed={selectedCategory === null}
                onClick={() => setSelectedCategory(null)}
              >
                <span>All categories</span>
                <small>{products.length}</small>
              </button>
              {categories.map(({ category, count }) => (
                <button
                  className={`rt-category-pill${selectedCategory === category ? " is-active" : ""}`}
                  type="button"
                  aria-pressed={selectedCategory === category}
                  onClick={() => setSelectedCategory(category)}
                  key={category}
                >
                  <span>{category}</span>
                  <small>{count}</small>
                </button>
              ))}
            </div>
          ) : null}

          <div>
            {filtered.length ? (
              <div className="rt-catalog-grid">
                {filtered.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    quantity={quantities[product.id] ?? 1}
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
                icon="bag"
                title="No matching products"
                copy="Try a different search term."
              />
            )}
          </div>
        </>
      ) : (
        <LoadingState title="Loading the catalog…" />
      )}
    </WorkspaceShell>
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
    <article className="rt-product-card">
      <div className="rt-product-art">
        <ProductArt product={product} />
      </div>
      <div className="rt-product-body">
        <div className="rt-product-title-row">
          <h3 className="rt-product-name">{product.name}</h3>
          <span className="rt-product-price">{formatPrice(product.price)}</span>
        </div>
        <p className="rt-product-seller">{product.seller_name || "SoukCart sample"}</p>
        <p className="rt-product-desc">{product.description}</p>
        <p className={`rt-product-stock${outOfStock ? " is-out" : ""}`}>
          {outOfStock
            ? "Out of stock"
            : `${product.stock} in stock${inCart ? ` · ${inCart} in your order` : ""} · per ${product.unit}`}
        </p>
        <div className="rt-product-actions">
          <div className="rt-stepper" role="group" aria-label={`Quantity for ${product.name}`}>
            <button
              className="rt-stepper-button"
              type="button"
              aria-label="Decrease quantity"
              disabled={outOfStock || quantity <= 1}
              onClick={() => onStep(product, -1)}
            >
              <Icon name="minus" />
            </button>
            <output className="rt-stepper-value">{quantity}</output>
            <button
              className="rt-stepper-button"
              type="button"
              aria-label="Increase quantity"
              disabled={outOfStock || quantity >= product.stock}
              onClick={() => onStep(product, 1)}
            >
              <Icon name="plus" />
            </button>
          </div>
          <Button
            className={cn("rt-add-button", added && "is-added")}
            disabled={outOfStock || atMax || adding}
            onClick={() => onAdd(product)}
          >
            {added ? (
              <>
                <Icon name="check" />
                <span>Added</span>
              </>
            ) : (
              <span>{atMax ? "All stock in cart" : "Add to Cart"}</span>
            )}
          </Button>
        </div>
      </div>
    </article>
  );
}
