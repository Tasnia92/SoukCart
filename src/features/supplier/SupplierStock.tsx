import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type KeyboardEvent } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import {
  EmptyState,
  InlineNotice,
  LoadingState,
  PageHeader,
  SearchToolbar,
  TableShell,
  WorkspaceError,
} from "../../components/ui/Workspace.tsx";
import { useProductChanges } from "../../product-realtime.ts";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { RouterLink, WorkspaceShell } from "../workspace/WorkspaceShell.tsx";
import {
  filterSupplierProducts,
  loadSupplierProducts,
  saveProductStock,
  type SupplierProduct,
} from "./supplier-products-api.ts";
import {
  consumeSupplierNotice,
  supplierNavItems,
  type SupplierNotice,
} from "./supplier-shared.tsx";

type SupplierStockProps = {
  loadProducts?: (sellerId: string) => Promise<SupplierProduct[]>;
};

function StockRow({
  product,
  onSave,
}: {
  product: SupplierProduct;
  onSave: (product: SupplierProduct, raw: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState(String(product.stock));
  const [saving, setSaving] = useState(false);

  const save = () => {
    if (saving) return;
    setSaving(true);
    void onSave(product, value).then((ok) => {
      if (!ok) setSaving(false);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    save();
  };

  return (
    <tr data-stock-row={product.id}>
      <td>
        <strong className="sp-stock-name">{product.name}</strong>
        <span className={`sp-stock-chip${product.stock <= 0 ? " is-out" : ""}`}>
          {product.stock <= 0 ? "Out of stock" : "In stock"}
        </span>
      </td>
      <td>{product.unit}</td>
      <td>
        <strong>{product.stock}</strong>
      </td>
      <td>
        <label className="sp-stock-field">
          <span className="sr-only">New stock for {product.name}</span>
          <input
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </label>
      </td>
      <td className="sp-stock-save">
        <Button onClick={save} disabled={saving}>
          Save
        </Button>
      </td>
    </tr>
  );
}

export function SupplierStock({ loadProducts = loadSupplierProducts }: SupplierStockProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/supplier/stock" });
  const [products, setProducts] = useState<SupplierProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [notice, setNotice] = useState<SupplierNotice | null>(consumeSupplierNotice);

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

  const onSave = async (product: SupplierProduct, raw: string): Promise<boolean> => {
    const trimmed = raw.trim();
    const next = Number(trimmed);
    if (!trimmed || !Number.isInteger(next) || next < 1) {
      setNotice({ message: "Stock must be a whole number of at least 1.", state: "error" });
      return false;
    }
    try {
      await saveProductStock(sellerId, product.id, next);
      setProducts(
        (prev) =>
          prev?.map((item) => (item.id === product.id ? { ...item, stock: next } : item)) ?? prev,
      );
      setNotice({
        message: `${product.name} now has ${next} unit${next === 1 ? "" : "s"} in stock.`,
        state: "success",
      });
      return true;
    } catch (saveError) {
      setNotice({
        message: saveError instanceof Error ? saveError.message : "Please try again.",
        state: "error",
      });
      return false;
    }
  };

  const filtered = products ? filterSupplierProducts(products, searchTerm) : [];
  const activeProducts = products?.filter((product) => product.is_active) ?? [];
  const filteredActive = filtered.filter((product) => product.is_active);
  const outOfStock = activeProducts.filter((product) => product.stock <= 0).length;

  return (
    <WorkspaceShell
      navigationLabel="Supplier navigation"
      items={supplierNavItems("stock")}
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Stock availability"
        title="Manage stock."
        copy="Set how many units of each product retailers may order. Changes apply immediately."
        actions={
          <RouterLink className="button button-subtle" to="/supplier/products">
            <Icon name="bag" />
            <span>My products</span>
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
          {activeProducts.length ? (
            <>
              {filteredActive.length ? (
                <TableShell>
                  <table className="admin-table sp-stock-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Unit</th>
                        <th>Available now</th>
                        <th>New stock</th>
                        <th>
                          <span className="sr-only">Save</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredActive.map((product) => (
                        <StockRow
                          key={`${product.id}:${product.stock}`}
                          product={product}
                          onSave={onSave}
                        />
                      ))}
                    </tbody>
                  </table>
                </TableShell>
              ) : (
                <EmptyState
                  icon="search"
                  title="No matching products"
                  copy="Try a different search term."
                />
              )}
              <p className="sp-stock-hint">
                Only active listings are shown.{" "}
                {outOfStock
                  ? `${outOfStock} active product${outOfStock === 1 ? "" : "s"} is out of stock.`
                  : "All active products have stock available."}
              </p>
            </>
          ) : (
            <EmptyState
              icon="store"
              title="No active products"
              copy="Activate a listing from My products and its stock will appear here."
              action={
                <RouterLink className="button button-primary" to="/supplier/products">
                  <span>My products</span>
                </RouterLink>
              }
            />
          )}
        </>
      ) : (
        <LoadingState title="Loading your stock…" />
      )}
    </WorkspaceShell>
  );
}
