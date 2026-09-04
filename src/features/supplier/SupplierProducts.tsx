import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Copy, MoreHorizontal, Plus, Search, ShoppingBag, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
import { searchParam } from "../workspace/search.ts";
import { RouterLink } from "../workspace/WorkspaceShell.tsx";
import {
  CATALOG_PAGE_SIZE,
  deleteSupplierProduct,
  deleteSupplierProducts,
  duplicateSupplierProduct,
  filterSupplierProducts,
  friendlyProductError,
  isProductLowStock,
  loadSupplierProducts,
  paginateProducts,
  PRODUCT_CATEGORIES,
  removeStoredImage,
  setProductActive,
  setProductsActive,
  sortSupplierProducts,
  type ProductSort,
  type SupplierProduct,
} from "./supplier-products-api.ts";
import { isAdminModerated } from "./supplier-overview-api.ts";
import {
  consumeSupplierNotice,
  ProductThumb,
  StockChip,
  SupplierWorkspaceShell,
  type SupplierNotice,
} from "./supplier-shared.tsx";

type SupplierProductsProps = {
  loadProducts?: (sellerId: string) => Promise<SupplierProduct[]>;
};

type ProductFilter = "all" | "active" | "low" | "out" | "hidden";

function parseProductFilter(value: string | null): ProductFilter {
  if (value === "active" || value === "low" || value === "out" || value === "hidden") return value;
  return "all";
}

function matchesProductFilter(product: SupplierProduct, filter: ProductFilter): boolean {
  if (filter === "active") return product.is_active;
  if (filter === "low") return product.is_active && isProductLowStock(product);
  if (filter === "out") return product.is_active && product.stock <= 0;
  if (filter === "hidden") return !product.is_active;
  return true;
}

function ProductCard({
  product,
  busy,
  selected,
  onToggleSelected,
  onToggleActive,
  onDuplicate,
  onDelete,
}: {
  product: SupplierProduct;
  busy: boolean;
  selected: boolean;
  onToggleSelected: (checked: boolean) => void;
  onToggleActive: (product: SupplierProduct) => void;
  onDuplicate: (product: SupplierProduct) => void;
  onDelete: (product: SupplierProduct) => void;
}) {
  return (
    <Card
      className="h-full gap-0 overflow-hidden py-0"
      data-selected={selected ? "true" : undefined}
    >
      <div className="relative flex aspect-[4/3] w-full shrink-0 items-center justify-center overflow-hidden bg-muted text-muted-foreground">
        <ProductThumb product={product} fill />
        <div className="absolute top-2 left-2 z-10">
          <Checkbox
            checked={selected}
            onCheckedChange={(value) => onToggleSelected(value === true)}
            aria-label={`Select ${product.name}`}
            className="border-background bg-background/90"
          />
        </div>
      </div>
      <CardHeader className="pt-(--card-spacing)">
        <CardTitle className="line-clamp-2 min-h-[2.75rem] leading-snug">{product.name}</CardTitle>
        <CardDescription className="truncate">
          {formatPrice(product.price)} per {product.unit}
        </CardDescription>
        <CardAction>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={busy}
                aria-label={`More actions for ${product.name}`}
              >
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem
                  disabled={
                    busy || isAdminModerated(product) || (product.is_active && product.stock <= 0)
                  }
                  onClick={() => onToggleActive(product)}
                >
                  {product.is_active
                    ? "Hide from retailers"
                    : isAdminModerated(product)
                      ? "Hidden by admin"
                      : "Show to retailers"}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={busy} onClick={() => onDuplicate(product)}>
                  <Copy />
                  Duplicate
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  variant="destructive"
                  disabled={busy || product.moderation_status === "removed"}
                  onClick={() => onDelete(product)}
                >
                  <Trash2 />
                  Delete product
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <p className="line-clamp-2 min-h-[2.5rem] text-sm text-muted-foreground">
          {product.description || "Add a description to help retailers understand this product."}
        </p>
        <div className="flex min-h-7 flex-wrap content-start items-center gap-2">
          <StockChip product={product} />
          {product.category ? <Badge variant="outline">{product.category}</Badge> : null}
          {product.moderation_status === "hidden" ? (
            <Badge variant="destructive">Hidden by admin</Badge>
          ) : null}
          {product.moderation_status === "removed" ? (
            <Badge variant="destructive">Removed by admin</Badge>
          ) : null}
          {product.is_active && isProductLowStock(product) ? (
            <Badge variant="outline">Low stock</Badge>
          ) : null}
          {product.is_active && product.stock <= 0 ? (
            <Badge variant="destructive">Out of stock</Badge>
          ) : null}
        </div>
        {product.moderation_reason ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <strong>Admin reason:</strong> {product.moderation_reason}
          </p>
        ) : null}
        <Item variant="muted" size="sm">
          <ItemContent>
            <ItemDescription>Available stock</ItemDescription>
            <ItemTitle>
              {product.stock} {product.unit}
            </ItemTitle>
          </ItemContent>
          <ItemActions>
            <Badge variant="secondary">MOQ {product.min_order_qty}</Badge>
          </ItemActions>
        </Item>
      </CardContent>
      <CardFooter className="mt-auto justify-between border-t pt-(--card-spacing) pb-(--card-spacing)">
        <span className="text-xs text-muted-foreground">
          Added {formatDate(product.created_at)}
        </span>
        <Button asChild variant="outline" size="sm">
          <RouterLink to="/supplier/products/$productId/edit" params={{ productId: product.id }}>
            Edit product
          </RouterLink>
        </Button>
      </CardFooter>
    </Card>
  );
}

export function SupplierProducts({ loadProducts = loadSupplierProducts }: SupplierProductsProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/supplier/products" });
  const searchStr = useRouterState({ select: (routerState) => routerState.location.searchStr });
  const [products, setProducts] = useState<SupplierProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [filter, setFilter] = useState<ProductFilter>(() =>
    parseProductFilter(searchParam(searchStr, "filter")),
  );
  const [category, setCategory] = useState<string>("all");
  const [sort, setSort] = useState<ProductSort>("newest");
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<SupplierNotice | null>(consumeSupplierNotice);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [deleteTarget, setDeleteTarget] = useState<SupplierProduct | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [undo, setUndo] = useState<{ product: SupplierProduct; previous: boolean } | null>(null);

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
          setError(friendlyProductError(loadError));
        }
      });

    return () => {
      current = false;
    };
  }, [loadProducts, loadVersion, sellerId]);

  useEffect(() => {
    setFilter(parseProductFilter(searchParam(searchStr, "filter")));
  }, [searchStr]);

  useEffect(() => {
    setPage(1);
  }, [searchTerm, filter, category, sort]);

  const categories = useMemo(() => {
    const fromCatalog = new Set(
      (products ?? [])
        .map((product) => product.category)
        .filter((value): value is string => Boolean(value)),
    );
    for (const known of PRODUCT_CATEGORIES) fromCatalog.add(known);
    return [...fromCatalog].sort((a, b) => a.localeCompare(b));
  }, [products]);

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
        eyebrow="Seller workspace"
        title="We could not load your catalog."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  const onToggleActive = (product: SupplierProduct) => {
    if (isAdminModerated(product)) {
      setNotice({
        message: "An administrator moderated this product. You cannot show it again yourself.",
        state: "error",
      });
      return;
    }
    const nextActive = !product.is_active;
    const previous = product.is_active;
    setBusyId(product.id);
    setProducts(
      (prev) =>
        prev?.map((item) => (item.id === product.id ? { ...item, is_active: nextActive } : item)) ??
        prev,
    );
    setUndo({ product, previous });
    void setProductActive(sellerId, product.id, nextActive)
      .then(() => {
        setNotice({
          message: `${product.name} is now ${nextActive ? "visible to retailers" : "hidden"}.`,
          state: "success",
        });
      })
      .catch((toggleError: unknown) => {
        setProducts(
          (prev) =>
            prev?.map((item) =>
              item.id === product.id ? { ...item, is_active: previous } : item,
            ) ?? prev,
        );
        setUndo(null);
        setNotice({
          message: friendlyProductError(toggleError),
          state: "error",
        });
      })
      .finally(() => setBusyId(null));
  };

  const onUndoVisibility = () => {
    if (!undo) return;
    const { product, previous } = undo;
    setUndo(null);
    setBusyId(product.id);
    setProducts(
      (prev) =>
        prev?.map((item) => (item.id === product.id ? { ...item, is_active: previous } : item)) ??
        prev,
    );
    void setProductActive(sellerId, product.id, previous)
      .then(() => {
        setNotice({
          message: `Restored visibility for ${product.name}.`,
          state: "success",
        });
      })
      .catch((undoError: unknown) => {
        setNotice({ message: friendlyProductError(undoError), state: "error" });
      })
      .finally(() => setBusyId(null));
  };

  const onDuplicate = (product: SupplierProduct) => {
    setBusyId(product.id);
    void duplicateSupplierProduct(product.id)
      .then(async (copy) => {
        const refreshed = await loadProducts(sellerId);
        setProducts(refreshed);
        setNotice({
          message: `Created hidden copy “${copy.name}”.`,
          state: "success",
        });
        setFilter("hidden");
      })
      .catch((duplicateError: unknown) => {
        setNotice({ message: friendlyProductError(duplicateError), state: "error" });
      })
      .finally(() => setBusyId(null));
  };

  const confirmDelete = () => {
    const product = deleteTarget;
    if (!product) return;
    setDeleteTarget(null);
    setBusyId(product.id);
    void deleteSupplierProduct(sellerId, product.id)
      .then(() => {
        setProducts((prev) => prev?.filter((item) => item.id !== product.id) ?? prev);
        if (product.image_url) void removeStoredImage(product.image_url);
        setNotice({ message: `${product.name} was deleted.`, state: "success" });
      })
      .catch((deleteError: unknown) => {
        setNotice({
          message: friendlyProductError(deleteError),
          state: "error",
        });
      })
      .finally(() => setBusyId(null));
  };

  const selectedIds = Object.entries(selected)
    .filter(([, checked]) => checked)
    .map(([id]) => id);

  const runBulkVisibility = (isActive: boolean) => {
    if (!selectedIds.length || !products) return;
    const targets = products.filter((product) => selectedIds.includes(product.id));
    const actionable = isActive ? targets.filter((product) => !isAdminModerated(product)) : targets;
    const skipped = targets.length - actionable.length;
    if (!actionable.length) {
      setNotice({
        message: "Selected products were moderated by an administrator and cannot be shown again.",
        state: "error",
      });
      return;
    }
    const ids = actionable.map((product) => product.id);
    setBulkBusy(true);
    void setProductsActive(sellerId, ids, isActive)
      .then(() => {
        setProducts(
          (prev) =>
            prev?.map((item) =>
              ids.includes(item.id) ? { ...item, is_active: isActive } : item,
            ) ?? prev,
        );
        setSelected({});
        setNotice({
          message: isActive
            ? `Showed ${ids.length} product${ids.length === 1 ? "" : "s"}${
                skipped ? ` (${skipped} admin-moderated skipped)` : ""
              }.`
            : `Hid ${ids.length} product${ids.length === 1 ? "" : "s"}.`,
          state: "success",
        });
      })
      .catch((bulkError: unknown) => {
        setNotice({ message: friendlyProductError(bulkError), state: "error" });
      })
      .finally(() => setBulkBusy(false));
  };

  const confirmBulkDelete = () => {
    if (!selectedIds.length || !products) return;
    const targets = products.filter((product) => selectedIds.includes(product.id));
    setBulkDeleteOpen(false);
    setBulkBusy(true);
    void deleteSupplierProducts(sellerId, selectedIds)
      .then(() => {
        for (const product of targets) {
          if (product.image_url) void removeStoredImage(product.image_url);
        }
        setProducts((prev) => prev?.filter((item) => !selectedIds.includes(item.id)) ?? prev);
        setSelected({});
        setNotice({
          message: `Deleted ${targets.length} product${targets.length === 1 ? "" : "s"}.`,
          state: "success",
        });
      })
      .catch((bulkError: unknown) => {
        setNotice({ message: friendlyProductError(bulkError), state: "error" });
      })
      .finally(() => setBulkBusy(false));
  };

  const searched = products ? filterSupplierProducts(products, searchTerm) : [];
  const categoryFiltered =
    category === "all" ? searched : searched.filter((product) => product.category === category);
  const statusFiltered = categoryFiltered.filter((product) =>
    matchesProductFilter(product, filter),
  );
  const sorted = sortSupplierProducts(statusFiltered, sort);
  const paged = paginateProducts(sorted, page, CATALOG_PAGE_SIZE);

  const counts = {
    all: products?.length ?? 0,
    active: products?.filter((product) => product.is_active).length ?? 0,
    low: products?.filter((product) => product.is_active && isProductLowStock(product)).length ?? 0,
    out: products?.filter((product) => product.is_active && product.stock <= 0).length ?? 0,
    hidden: products?.filter((product) => !product.is_active).length ?? 0,
  };

  return (
    <SupplierWorkspaceShell
      section="products"
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Catalog"
        title="Products"
        copy="Filter, sort, duplicate, and bulk-manage listings without leaving the catalog."
        actions={
          <Button asChild>
            <RouterLink to="/supplier/products/new">
              <Plus data-icon="inline-start" />
              Add product
            </RouterLink>
          </Button>
        }
      />
      <InlineNotice message={notice?.message} state={notice?.state} />
      {undo ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span>Visibility changed for {undo.product.name}.</span>
          <Button type="button" size="sm" variant="outline" onClick={onUndoVisibility}>
            Undo
          </Button>
        </div>
      ) : null}
      {products ? (
        <>
          <Card size="sm">
            <CardHeader>
              <CardTitle>Catalog filters</CardTitle>
              <CardDescription>
                {counts.active} active · {counts.low} low · {counts.out} out · {counts.hidden}{" "}
                hidden
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="overflow-x-auto pb-1">
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={filter}
                  onValueChange={(value) => {
                    if (value) setFilter(value as ProductFilter);
                  }}
                  aria-label="Filter products"
                >
                  <ToggleGroupItem value="all">All ({counts.all})</ToggleGroupItem>
                  <ToggleGroupItem value="active">Active ({counts.active})</ToggleGroupItem>
                  <ToggleGroupItem value="low">Low stock ({counts.low})</ToggleGroupItem>
                  <ToggleGroupItem value="out">Out ({counts.out})</ToggleGroupItem>
                  <ToggleGroupItem value="hidden">Hidden ({counts.hidden})</ToggleGroupItem>
                </ToggleGroup>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Category</span>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger aria-label="Filter by category">
                      <SelectValue placeholder="All categories" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All categories</SelectItem>
                      {categories.map((value) => (
                        <SelectItem key={value} value={value}>
                          {value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Sort</span>
                  <Select value={sort} onValueChange={(value) => setSort(value as ProductSort)}>
                    <SelectTrigger aria-label="Sort products">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="newest">Newest</SelectItem>
                      <SelectItem value="name">Name</SelectItem>
                      <SelectItem value="stock">Stock (low first)</SelectItem>
                      <SelectItem value="price">Price (high first)</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              </div>
              <SearchToolbar
                label="Search products"
                placeholder="Search by name, category, or unit"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                result={`${paged.total} match${paged.total === 1 ? "" : "es"} · page ${paged.page}/${paged.pageCount}`}
              />
              {selectedIds.length ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {selectedIds.length} selected
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={bulkBusy}
                    onClick={() => runBulkVisibility(true)}
                  >
                    Show
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={bulkBusy}
                    onClick={() => runBulkVisibility(false)}
                  >
                    Hide
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={bulkBusy}
                    onClick={() => setBulkDeleteOpen(true)}
                  >
                    Delete
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {paged.items.length ? (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {paged.items.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    busy={busyId === product.id || bulkBusy}
                    selected={Boolean(selected[product.id])}
                    onToggleSelected={(checked) =>
                      setSelected((prev) => ({ ...prev, [product.id]: checked }))
                    }
                    onToggleActive={onToggleActive}
                    onDuplicate={onDuplicate}
                    onDelete={setDeleteTarget}
                  />
                ))}
              </div>
              {paged.pageCount > 1 ? (
                <div className="flex items-center justify-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={paged.page <= 1}
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Page {paged.page} of {paged.pageCount}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={paged.page >= paged.pageCount}
                    onClick={() => setPage((value) => Math.min(paged.pageCount, value + 1))}
                  >
                    Next
                  </Button>
                </div>
              ) : null}
            </>
          ) : products.length ? (
            <EmptyState
              icon={Search}
              title="No products match these filters"
              copy="Try another status, category, or a broader search term."
            />
          ) : (
            <EmptyState
              icon={ShoppingBag}
              title="Create your first product"
              copy="Add a product with a clear image, wholesale price, and available stock."
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

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name ?? "this product"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the listing from your catalog and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Keep product</AlertDialogCancel>
            <AlertDialogAction type="button" variant="destructive" onClick={confirmDelete}>
              Delete product
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedIds.length} product{selectedIds.length === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the selected listings and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Keep products</AlertDialogCancel>
            <AlertDialogAction type="button" variant="destructive" onClick={confirmBulkDelete}>
              Delete selected
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SupplierWorkspaceShell>
  );
}
