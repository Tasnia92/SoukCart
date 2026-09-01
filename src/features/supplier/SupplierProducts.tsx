import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Icon } from "../../components/ui/Icon.tsx";
import {
  EmptyState,
  InlineNotice,
  LoadingState,
  PageHeader,
  SearchToolbar,
  WorkspaceError,
} from "../../components/ui/Workspace.tsx";
import { useProductChanges } from "../../product-realtime.ts";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { formatDate, formatPrice } from "../workspace/format.ts";
import { RouterLink, WorkspaceShell } from "../workspace/WorkspaceShell.tsx";
import {
  deleteSupplierProduct,
  filterSupplierProducts,
  loadSupplierProducts,
  removeStoredImage,
  setProductActive,
  type SupplierProduct,
} from "./supplier-products-api.ts";
import {
  consumeSupplierNotice,
  ProductThumb,
  StockChip,
  supplierNavItems,
  type SupplierNotice,
} from "./supplier-shared.tsx";

type SupplierProductsProps = {
  loadProducts?: (sellerId: string) => Promise<SupplierProduct[]>;
};

function ProductCard({
  product,
  busy,
  onToggleActive,
  onDelete,
}: {
  product: SupplierProduct;
  busy: boolean;
  onToggleActive: (product: SupplierProduct) => void;
  onDelete: (product: SupplierProduct) => void;
}) {
  return (
    <article className={`rt-product-card${product.is_active ? "" : " is-hidden"}`}>
      <div className="rt-product-art">
        <ProductThumb product={product} />
      </div>
      <div className="rt-product-body">
        <div className="rt-product-title-row">
          <h3 className="rt-product-name">{product.name}</h3>
          <span className="rt-product-price">{formatPrice(product.price)}</span>
        </div>
        <p className="rt-product-desc">{product.description || "No description yet."}</p>
        <p className={`rt-product-stock${product.stock <= 0 ? " is-out" : ""}`}>
          {product.stock <= 0 ? "Out of stock" : `${product.stock} in stock`} · per {product.unit}
        </p>
        <div className="sp-product-meta">
          <StockChip product={product} />
          <small>Added {formatDate(product.created_at)}</small>
        </div>
        <div className="sp-product-actions">
          <RouterLink
            className="sp-card-action"
            to="/supplier/products/$productId/edit"
            params={{ productId: product.id }}
          >
            Edit
          </RouterLink>
          <button
            className="sp-card-action"
            type="button"
            disabled={product.stock <= 0}
            onClick={() => onToggleActive(product)}
          >
            {product.is_active ? "Hide" : "Show"}
          </button>
          <button
            className="sp-card-action is-danger"
            type="button"
            disabled={busy}
            onClick={() => onDelete(product)}
          >
            Delete
          </button>
        </div>
      </div>
    </article>
  );
}

export function SupplierProducts({ loadProducts = loadSupplierProducts }: SupplierProductsProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/supplier/products" });
  const [products, setProducts] = useState<SupplierProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [notice, setNotice] = useState<SupplierNotice | null>(consumeSupplierNotice);
  const [busyId, setBusyId] = useState<string | null>(null);

  const sellerId = state.status === "seller" ? state.session.user.id : "";

  useProductChanges({
    enabled: Boolean(sellerId),
    sellerId,
    onChange: () => setLoadVersion((version) => version + 1),
  });

  useEffect(() => {
    if (!sellerId) return;
    let current = true;
    setError(null);

    void loadProducts(sellerId)
      .then((nextProducts) => {
        if (current) setProducts(nextProducts);
      })
      .catch((loadError: unknown) => {
        if (current) {
          setError(loadError instanceof Error ? loadError.message : "Please try again.");
        }
      });

    return () => {
      current = false;
    };
  }, [loadProducts, loadVersion, sellerId]);

  if (state.status !== "seller") return null;

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
        eyebrow="Supplier workspace"
        title="We could not load your catalog."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  const onToggleActive = (product: SupplierProduct) => {
    const nextActive = !product.is_active;
    void setProductActive(sellerId, product.id, nextActive)
      .then(() => {
        setProducts(
          (prev) =>
            prev?.map((item) =>
              item.id === product.id ? { ...item, is_active: nextActive } : item,
            ) ?? prev,
        );
        setNotice({
          message: `${product.name} is now ${nextActive ? "visible to retailers" : "hidden"}.`,
          state: "success",
        });
      })
      .catch((toggleError: unknown) => {
        setNotice({
          message: toggleError instanceof Error ? toggleError.message : "Please try again.",
          state: "error",
        });
      });
  };

  const onDelete = (product: SupplierProduct) => {
    if (!window.confirm(`Delete ${product.name}? This cannot be undone.`)) return;
    setBusyId(product.id);
    void deleteSupplierProduct(sellerId, product.id)
      .then(() => {
        setProducts((prev) => prev?.filter((item) => item.id !== product.id) ?? prev);
        if (product.image_url) void removeStoredImage(product.image_url);
        setNotice({ message: `${product.name} was deleted.`, state: "success" });
      })
      .catch((deleteError: unknown) => {
        setNotice({
          message: deleteError instanceof Error ? deleteError.message : "Please try again.",
          state: "error",
        });
      })
      .finally(() => setBusyId(null));
  };

  const filtered = products ? filterSupplierProducts(products, searchTerm) : [];

  return (
    <WorkspaceShell
      navigationLabel="Supplier navigation"
      items={supplierNavItems("products")}
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Product catalog"
        title="My products."
        copy="Add products, set your prices, and control what retailers can order."
        actions={
          <RouterLink className="button button-primary" to="/supplier/products/new">
            <Icon name="plus" />
            <span>New product</span>
          </RouterLink>
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
          {filtered.length ? (
            <div className="rt-catalog-grid">
              {filtered.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  busy={busyId === product.id}
                  onToggleActive={onToggleActive}
                  onDelete={onDelete}
                />
              ))}
            </div>
          ) : products.length ? (
            <EmptyState
              icon="search"
              title="No matching products"
              copy="Try a different search term."
            />
          ) : (
            <EmptyState
              icon="bag"
              title="No products yet"
              copy="Add your first product and retailers will see it in the catalog."
              action={
                <RouterLink className="button button-primary" to="/supplier/products/new">
                  <span>Add product</span>
                </RouterLink>
              }
            />
          )}
        </>
      ) : (
        <LoadingState title="Loading your products…" />
      )}
    </WorkspaceShell>
  );
}
