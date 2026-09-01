import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Icon } from "../../components/ui/Icon.tsx";
import {
  EmptyState,
  InlineNotice,
  LoadingState,
  PageHeader,
  StatCard,
  StatGrid,
  WorkspaceError,
} from "../../components/ui/Workspace.tsx";
import { useProductChanges } from "../../product-realtime.ts";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { firstName, formatDate, formatPrice } from "../workspace/format.ts";
import { RouterLink, WorkspaceShell } from "../workspace/WorkspaceShell.tsx";
import {
  getSupplierOverviewStats,
  loadSupplierProducts,
  type SupplierProduct,
} from "./supplier-overview-api.ts";

type SupplierOverviewProps = {
  loadProducts?: (sellerId: string) => Promise<SupplierProduct[]>;
};

type Notice = { message: string; state: "success" };
const SUPPLIER_NOTICE_KEY = "soukcart:supplier-notice";

function consumeSupplierNotice(): Notice | null {
  if (typeof sessionStorage === "undefined") return null;
  const message = sessionStorage.getItem(SUPPLIER_NOTICE_KEY);
  if (!message) return null;
  sessionStorage.removeItem(SUPPLIER_NOTICE_KEY);
  return { message, state: "success" };
}

function StockChip({ product }: { product: SupplierProduct }) {
  if (!product.is_active) return <span className="sp-chip is-hidden">Hidden</span>;
  if (product.stock <= 0) return <span className="sp-chip is-out">Out of stock</span>;
  return <span className="sp-chip is-active">Active</span>;
}

function ProductArt({ product }: { product: SupplierProduct }) {
  return product.image_url ? (
    <img src={product.image_url} alt="" loading="lazy" />
  ) : (
    <Icon name="bag" />
  );
}

function RecentListing({ product }: { product: SupplierProduct }) {
  return (
    <RouterLink
      className="rt-order-card"
      to="/supplier/products/$productId/edit"
      params={{ productId: product.id }}
    >
      <span className="rt-order-art sp-list-art">
        <ProductArt product={product} />
      </span>
      <span className="rt-order-card-body">
        <strong className="rt-order-id">{product.name}</strong>
        <small>
          {formatPrice(product.price)} per {product.unit} · {formatDate(product.created_at)}
        </small>
      </span>
      <span className="rt-order-card-end">
        <strong>{product.stock} in stock</strong>
        <StockChip product={product} />
      </span>
    </RouterLink>
  );
}

export function SupplierOverview({ loadProducts = loadSupplierProducts }: SupplierOverviewProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/supplier" });
  const [products, setProducts] = useState<SupplierProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [notice] = useState(consumeSupplierNotice);

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

  const stats = products ? getSupplierOverviewStats(products) : null;
  const recent = products?.slice(0, 4) ?? [];
  return (
    <WorkspaceShell
      navigationLabel="Supplier navigation"
      items={[
        { to: "/supplier", icon: "home", label: "Overview", active: true },
        { to: "/supplier/orders", icon: "package", label: "Orders" },
        { to: "/supplier/products", icon: "bag", label: "My products" },
        { to: "/supplier/stock", icon: "layers", label: "Stock" },
      ]}
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Supplier workspace"
        title={<>Good to see you, {firstName(userName)}.</>}
        copy="Keep your catalog fresh so retailers always see what you can deliver."
        actions={
          <>
            <RouterLink className="button button-primary" to="/supplier/products/new">
              <Icon name="plus" />
              <span>Add product</span>
            </RouterLink>
            <RouterLink className="button button-subtle" to="/supplier/stock">
              <Icon name="layers" />
              <span>Manage stock</span>
            </RouterLink>
          </>
        }
      />
      <InlineNotice message={notice?.message} state={notice?.state} />
      {stats ? (
        <>
          <StatGrid label="Catalog summary">
            <StatCard label="Total products" value={stats.total} detail="Everything you list" />
            <StatCard label="Active listings" value={stats.active} detail="Visible to retailers" />
            <StatCard label="Out of stock" value={stats.outOfStock} detail="Needs restocking" />
            <StatCard
              label="Units in stock"
              value={stats.unitsInStock}
              detail="Across all products"
            />
          </StatGrid>
          <section className="rt-section" aria-labelledby="recent-heading">
            <div className="rt-section-heading">
              <div>
                <p className="eyebrow">Latest activity</p>
                <h2 id="recent-heading" className="display-sm">
                  Recent listings
                </h2>
              </div>
              <RouterLink className="text-button" to="/supplier/products">
                View all
              </RouterLink>
            </div>
            {recent.length ? (
              <div className="rt-order-list">
                {recent.map((product) => (
                  <RecentListing key={product.id} product={product} />
                ))}
              </div>
            ) : (
              <EmptyState
                icon="store"
                title="No products yet"
                copy="Add your first product and retailers will see it in the catalog."
                action={
                  <RouterLink className="button button-primary" to="/supplier/products/new">
                    <span>Add product</span>
                  </RouterLink>
                }
              />
            )}
          </section>
        </>
      ) : (
        <LoadingState title="Loading your catalog…" />
      )}
    </WorkspaceShell>
  );
}
