import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { MoreHorizontal, Plus, Search, ShoppingBag, Trash2 } from "lucide-react";
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
import { formatPrice } from "../workspace/format.ts";
import { ProductArt } from "../workspace/product-art.tsx";
import { searchParam } from "../workspace/search.ts";
import { RouterLink } from "../workspace/WorkspaceShell.tsx";
import {
  CATALOG_PAGE_SIZE,
  deleteSupplierProduct,
  deleteSupplierProducts,
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
import { isAdminModerated, isAwaitingReview } from "./supplier-overview-api.ts";
import {
  consumeSupplierNotice,
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
  onDelete,
}: {
  product: SupplierProduct;
  busy: boolean;
  selected: boolean;
  onToggleSelected: (checked: boolean) => void;
  onToggleActive: (product: SupplierProduct) => void;
  onDelete: (product: SupplierProduct) => void;
}) {
  return (
    <Card
      className="h-full gap-0 overflow-hidden py-0 data-[selected=true]:ring-2 data-[selected=true]:ring-ring"
      data-selected={selected ? "true" : undefined}
    >
      <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden bg-muted">
        <ProductArt src={product.image_url} />
        <div className="absolute top-2 left-2 z-10">
          <Checkbox
            checked={selected}
            onCheckedChange={(value) => onToggleSelected(value === true)}
            aria-label={`Select ${product.name}`}
            className="border-background bg-background/90"
          />
        </div>
        <div className="absolute top-2 right-2 z-10">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="secondary"
                size="icon-sm"
                disabled={busy}
                aria-label={`More actions for ${product.name}`}
                className="size-7 bg-background/90"
              >
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem
                  disabled={
                    busy ||
                    isAdminModerated(product) ||
                    isAwaitingReview(product) ||
                    (product.is_active && product.stock <= 0)
                  }
                  onClick={() => onToggleActive(product)}
                >
                  {product.is_active
                    ? "Hide from retailers"
                    : isAdminModerated(product)
                      ? "Hidden by admin"
                      : isAwaitingReview(product)
                        ? "Waiting for admin approval"
                        : "Show to retailers"}
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
        </div>
      </div>
      <CardHeader className="pt-(--card-spacing)">
        <CardTitle className="line-clamp-2 min-h-10 text-sm leading-snug">{product.name}</CardTitle>
        <CardDescription className="text-sm font-semibold text-foreground">
          {formatPrice(product.price)}{" "}
          <span className="font-normal text-muted-foreground">per {product.unit}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <StockChip product={product} />
          {product.approval_status === "pending" ? (
            <Badge variant="secondary">Pending approval</Badge>
          ) : null}
          {product.approval_status === "rejected" ? (
            <Badge variant="destructive">Not approved</Badge>
          ) : null}
          {product.moderation_status === "hidden" ? (
            <Badge variant="destructive">Hidden by admin</Badge>
          ) : null}
          {product.moderation_status === "removed" ? (
            <Badge variant="destructive">Removed by admin</Badge>
          ) : null}
        </div>
        {product.approval_note ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-xs text-destructive">
            <strong>Review note:</strong> {product.approval_note}
          </p>
        ) : null}
        {product.moderation_reason ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-xs text-destructive">
            <strong>Admin reason:</strong> {product.moderation_reason}
          </p>
        ) : null}
        <div className="mt-auto flex items-baseline justify-between gap-2 text-sm">
          <span>
            <span className="font-medium tabular-nums">{product.stock}</span> {product.unit}{" "}
            available
          </span>
          <span className="text-xs text-muted-foreground">MOQ {product.min_order_qty}</span>
        </div>
      </CardContent>
      <CardFooter className="mt-auto border-t pt-(--card-spacing) pb-(--card-spacing)">
        <Button asChild variant="outline" size="sm" className="w-full">
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
    if (isAwaitingReview(product)) {
      setNotice({
        message:
          product.approval_status === "pending"
            ? `${product.name} is waiting for admin approval. Retailers see it once it is approved.`
            : `${product.name} was not approved. Edit the listing to resubmit it for review.`,
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
    const actionable = isActive
      ? targets.filter((product) => !isAdminModerated(product) && !isAwaitingReview(product))
      : targets;
    const skipped = targets.length - actionable.length;
    if (!actionable.length) {
      setNotice({
        message:
          "Selected products are admin-moderated or still awaiting approval and cannot be shown.",
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
                skipped ? ` (${skipped} awaiting review or admin-moderated skipped)` : ""
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
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="grid items-end gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(10rem,auto)_minmax(10rem,auto)]">
                <SearchToolbar
                  label="Search products"
                  placeholder="Search by name, category, or unit"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
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
              {selectedIds.length ? (
                <div className="flex flex-wrap items-center gap-2 border-t pt-3">
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
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
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
