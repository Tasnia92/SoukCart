import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { MoreHorizontal, Plus, Search, ShoppingBag } from "lucide-react";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
    <Card className="overflow-hidden py-0">
      <div className="flex aspect-[4/3] items-center justify-center bg-muted text-muted-foreground">
        <ProductThumb product={product} />
      </div>
      <CardHeader>
        <CardTitle className="flex items-start justify-between gap-2">
          <span className="truncate">{product.name}</span>
          <span className="shrink-0 text-base">{formatPrice(product.price)}</span>
        </CardTitle>
        <CardDescription className="line-clamp-2">
          {product.description || "No description yet."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          {product.stock <= 0 ? "Out of stock" : `${product.stock} in stock`} · per {product.unit}
        </p>
        <div className="flex items-center gap-2">
          <StockChip product={product} />
          <span className="text-xs text-muted-foreground">
            Added {formatDate(product.created_at)}
          </span>
        </div>
      </CardContent>
      <CardFooter className="justify-between border-t">
        <Button asChild variant="outline" size="sm">
          <RouterLink to="/supplier/products/$productId/edit" params={{ productId: product.id }}>
            Edit
          </RouterLink>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`More actions for ${product.name}`}
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem
                disabled={product.stock <= 0}
                onClick={() => onToggleActive(product)}
              >
                {product.is_active ? "Hide from retailers" : "Show to retailers"}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                variant="destructive"
                disabled={busy}
                onClick={() => onDelete(product)}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardFooter>
    </Card>
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
        title="My products"
        copy="Add products, set your prices, and control what retailers can order."
        actions={
          <Button asChild>
            <RouterLink to="/supplier/products/new">
              <Plus data-icon="inline-start" />
              New product
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
          {filtered.length ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
              icon={Search}
              title="No matching products"
              copy="Try a different search term."
            />
          ) : (
            <EmptyState
              icon={ShoppingBag}
              title="No products yet"
              copy="Add your first product and retailers will see it in the catalog."
              action={
                <Button asChild>
                  <RouterLink to="/supplier/products/new">Add product</RouterLink>
                </Button>
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
