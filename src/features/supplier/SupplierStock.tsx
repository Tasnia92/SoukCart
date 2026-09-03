import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type KeyboardEvent } from "react";
import { Search, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
    <TableRow data-stock-row={product.id}>
      <TableCell>
        <div className="flex flex-col items-start gap-1">
          <strong className="font-medium">{product.name}</strong>
          <Badge variant={product.stock <= 0 ? "destructive" : "secondary"}>
            {product.stock <= 0 ? "Out of stock" : "In stock"}
          </Badge>
        </div>
      </TableCell>
      <TableCell>{product.unit}</TableCell>
      <TableCell>
        <strong>{product.stock}</strong>
      </TableCell>
      <TableCell>
        <label className="block min-w-24">
          <span className="sr-only">New stock for {product.name}</span>
          <Input
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </label>
      </TableCell>
      <TableCell className="text-right">
        <Button type="button" onClick={save} disabled={saving}>
          Save
        </Button>
      </TableCell>
    </TableRow>
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
    if (!trimmed || !Number.isInteger(next) || next < 0) {
      setNotice({ message: "Stock must be a whole number of 0 or more.", state: "error" });
      return false;
    }
    try {
      await saveProductStock(sellerId, product.id, next);
      setProducts(
        (prev) =>
          prev?.map((item) => (item.id === product.id ? { ...item, stock: next } : item)) ?? prev,
      );
      setNotice({
        message:
          next === 0
            ? `${product.name} is now marked out of stock.`
            : `${product.name} now has ${next} unit${next === 1 ? "" : "s"} in stock.`,
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
        title="Stock"
        copy="Set how many units of each product retailers may order. Changes apply immediately."
        actions={
          <Button asChild variant="outline">
            <RouterLink to="/supplier/products">My products</RouterLink>
          </Button>
        }
      />
      <InlineNotice message={notice?.message} state={notice?.state} />
      {products ? (
        <>
          {activeProducts.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Active listings</CardTitle>
                <CardDescription>
                  Only active listings are shown.{" "}
                  {outOfStock
                    ? `${outOfStock} active product${outOfStock === 1 ? "" : "s"} is out of stock.`
                    : "All active products have stock available."}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <SearchToolbar
                  label="Search products"
                  placeholder="Search products"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  result={`${filtered.length} of ${products.length} products`}
                />
                {filteredActive.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead>Unit</TableHead>
                        <TableHead>Available now</TableHead>
                        <TableHead>New stock</TableHead>
                        <TableHead>
                          <span className="sr-only">Save</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredActive.map((product) => (
                        <StockRow
                          key={`${product.id}:${product.stock}`}
                          product={product}
                          onSave={onSave}
                        />
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <EmptyState
                    icon={Search}
                    title="No matching products"
                    copy="Try a different search term."
                  />
                )}
              </CardContent>
            </Card>
          ) : (
            <EmptyState
              icon={Store}
              title="No active products"
              copy="Activate a listing from My products and its stock will appear here."
              action={
                <Button asChild>
                  <RouterLink to="/supplier/products">My products</RouterLink>
                </Button>
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
