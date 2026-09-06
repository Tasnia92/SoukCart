import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { Download, RefreshCw, Search, Store, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  EmptyState,
  InlineNotice,
  LoadingState,
  PageHeader,
  SearchToolbar,
  StatCard,
  StatGrid,
  WorkspaceError,
} from "../../components/ui/Workspace.tsx";
import { useProductChanges } from "../../product-realtime.ts";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { RouterLink } from "../workspace/WorkspaceShell.tsx";
import {
  buildInventoryCsv,
  bulkAdjustProductStock,
  filterSupplierProducts,
  friendlyProductError,
  isProductLowStock,
  isProductOutOfStock,
  loadSupplierProducts,
  parseInventoryCsv,
  type StockAdjustmentInput,
  type SupplierProduct,
} from "./supplier-products-api.ts";
import {
  consumeSupplierNotice,
  ProductThumb,
  SupplierWorkspaceShell,
  type SupplierNotice,
} from "./supplier-shared.tsx";

type SupplierStockProps = {
  loadProducts?: (sellerId: string) => Promise<SupplierProduct[]>;
};

type StockFilter = "all" | "out" | "hidden";

type DraftRow = {
  stock: string;
};

function stockStatus(product: SupplierProduct): {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
} | null {
  if (!product.is_active) return { label: "Hidden", variant: "outline" };
  if (isProductOutOfStock(product)) return { label: "Out of stock", variant: "destructive" };
  if (isProductLowStock(product)) return { label: "Low stock", variant: "secondary" };
  return null;
}

function matchesStockFilter(product: SupplierProduct, filter: StockFilter): boolean {
  if (filter === "hidden") return !product.is_active;
  if (!product.is_active) return false;
  if (filter === "out") return isProductOutOfStock(product);
  return true;
}

function parseRelativeStock(raw: string, current: number): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^[+-]\d+$/.test(trimmed)) {
    const next = current + Number(trimmed);
    return Number.isInteger(next) && next >= 0 ? next : null;
  }
  const absolute = Number(trimmed);
  return Number.isInteger(absolute) && absolute >= 0 ? absolute : null;
}

function downloadTextFile(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function StockRow({
  product,
  draft,
  selected,
  onToggleSelected,
  onDraftChange,
  onSaveOne,
  saving,
}: {
  product: SupplierProduct;
  draft: DraftRow;
  selected: boolean;
  onToggleSelected: (checked: boolean) => void;
  onDraftChange: (patch: Partial<DraftRow>) => void;
  onSaveOne: () => void;
  saving: boolean;
}) {
  const status = stockStatus(product);
  const dirty = draft.stock.trim() !== String(product.stock);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    onSaveOne();
  };

  return (
    <TableRow data-stock-row={product.id} data-dirty={dirty ? "true" : undefined}>
      <TableCell>
        <Checkbox
          checked={selected}
          onCheckedChange={(value) => onToggleSelected(value === true)}
          aria-label={`Select ${product.name}`}
        />
      </TableCell>
      <TableCell>
        <div className="flex min-w-52 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
            <ProductThumb product={product} />
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <strong className="truncate font-medium">{product.name}</strong>
            <span className="text-xs text-muted-foreground">
              MOQ {product.min_order_qty}
              {dirty ? " · unsaved" : ""}
            </span>
          </span>
        </div>
      </TableCell>
      <TableCell>{product.unit}</TableCell>
      <TableCell>
        <div className="flex flex-col items-start gap-1">
          <strong className="tabular-nums">{product.stock}</strong>
          {status && <Badge variant={status.variant}>{status.label}</Badge>}
        </div>
      </TableCell>
      <TableCell>
        <label className="block min-w-28">
          <span className="sr-only">New stock for {product.name}</span>
          <Input
            type="text"
            inputMode="numeric"
            placeholder={`${product.stock} or +10`}
            value={draft.stock}
            aria-label={`New stock for ${product.name}`}
            onChange={(event) => onDraftChange({ stock: event.target.value })}
            onKeyDown={onKeyDown}
          />
        </label>
      </TableCell>
      <TableCell className="text-right">
        <Button type="button" size="sm" onClick={onSaveOne} disabled={saving || !dirty}>
          {saving ? "Saving" : "Update"}
        </Button>
      </TableCell>
    </TableRow>
  );
}

export function SupplierStock({ loadProducts = loadSupplierProducts }: SupplierStockProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/supplier/stock" });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [products, setProducts] = useState<SupplierProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [filter, setFilter] = useState<StockFilter>("all");
  const [notice, setNotice] = useState<SupplierNotice | null>(consumeSupplierNotice);
  const [drafts, setDrafts] = useState<Record<string, DraftRow>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [savingAll, setSavingAll] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [bulkDelta, setBulkDelta] = useState("+10");

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
        if (!current) return;
        setProducts(nextProducts);
        setDrafts((prev) => {
          const next: Record<string, DraftRow> = {};
          for (const product of nextProducts) {
            const existing = prev[product.id];
            const baseline: DraftRow = { stock: String(product.stock) };
            if (existing && existing.stock !== String(product.stock)) {
              next[product.id] = existing;
            } else {
              next[product.id] = baseline;
            }
          }
          return next;
        });
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

  const catalog = products ?? [];
  const visiblePool =
    filter === "hidden" || filter === "all"
      ? catalog
      : catalog.filter((product) => product.is_active);
  const searched = filterSupplierProducts(visiblePool, searchTerm);
  const filtered = searched.filter((product) => matchesStockFilter(product, filter));

  const counts = useMemo(() => {
    const active = catalog.filter((product) => product.is_active);
    return {
      all: catalog.length,
      out: active.filter(isProductOutOfStock).length,
      hidden: catalog.filter((product) => !product.is_active).length,
    };
  }, [catalog]);

  const dirtyIds = useMemo(() => {
    return catalog
      .filter((product) => {
        const draft = drafts[product.id];
        if (!draft) return false;
        return draft.stock.trim() !== String(product.stock);
      })
      .map((product) => product.id);
  }, [catalog, drafts]);

  const selectedIds = Object.entries(selected)
    .filter(([, checked]) => checked)
    .map(([id]) => id);

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
        title="We could not load your inventory."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  const buildAdjustment = (
    product: SupplierProduct,
    draft: DraftRow,
  ): StockAdjustmentInput | { error: string } => {
    const nextStock = parseRelativeStock(draft.stock, product.stock);
    if (nextStock === null) {
      return { error: `${product.name}: enter a whole number or relative change like +20 / -5.` };
    }
    if (nextStock === product.stock) {
      return { error: `${product.name}: nothing to save.` };
    }
    return {
      productId: product.id,
      mode: "absolute",
      value: nextStock,
      expectedVersion: product.stock_version,
    };
  };

  const applyResults = (results: Awaited<ReturnType<typeof bulkAdjustProductStock>>) => {
    const byId = new Map(results.map((result) => [result.id, result]));
    setProducts(
      (prev) =>
        prev?.map((product) => {
          const result = byId.get(product.id);
          if (!result) return product;
          return {
            ...product,
            stock: result.stock,
            stock_version: result.stockVersion,
          };
        }) ?? prev,
    );
    setDrafts((prev) => {
      const next = { ...prev };
      for (const result of results) {
        next[result.id] = { stock: String(result.stock) };
      }
      return next;
    });
  };

  const saveProducts = async (productIds: string[]) => {
    if (!products || !productIds.length) return;
    const adjustments: StockAdjustmentInput[] = [];
    for (const id of productIds) {
      const product = products.find((item) => item.id === id);
      const draft = drafts[id];
      if (!product || !draft) continue;
      const built = buildAdjustment(product, draft);
      if ("error" in built) {
        setNotice({ message: built.error, state: "error" });
        return;
      }
      adjustments.push(built);
    }
    if (!adjustments.length) {
      setNotice({ message: "No unsaved inventory changes to save.", state: "info" });
      return;
    }
    try {
      const results = await bulkAdjustProductStock(adjustments);
      applyResults(results);
      setNotice({
        message:
          results.length === 1 ? "Inventory updated." : `${results.length} inventory rows updated.`,
        state: "success",
      });
    } catch (saveError) {
      setNotice({ message: friendlyProductError(saveError), state: "error" });
    }
  };

  const onSaveOne = async (productId: string) => {
    setSavingId(productId);
    try {
      await saveProducts([productId]);
    } finally {
      setSavingId(null);
    }
  };

  const onSaveAll = async () => {
    setSavingAll(true);
    try {
      await saveProducts(dirtyIds);
    } finally {
      setSavingAll(false);
    }
  };

  const applyBulkDelta = async () => {
    const delta = Number(bulkDelta.trim());
    if (!Number.isInteger(delta) || delta === 0) {
      setNotice({ message: "Bulk adjustment must be a non-zero whole number.", state: "error" });
      return;
    }
    const targets = (selectedIds.length ? selectedIds : filtered.map((product) => product.id))
      .map((id) => products?.find((product) => product.id === id))
      .filter((product): product is SupplierProduct => Boolean(product));
    if (!targets.length) {
      setNotice({ message: "Select products or clear filters first.", state: "error" });
      return;
    }
    setSavingAll(true);
    try {
      const adjustments: StockAdjustmentInput[] = targets.map((product) => ({
        productId: product.id,
        mode: "relative",
        value: delta,
        expectedVersion: product.stock_version,
      }));
      const results = await bulkAdjustProductStock(adjustments);
      applyResults(results);
      setNotice({
        message: `Applied ${delta > 0 ? "+" : ""}${delta} to ${results.length} product${results.length === 1 ? "" : "s"}.`,
        state: "success",
      });
    } catch (saveError) {
      setNotice({ message: friendlyProductError(saveError), state: "error" });
    } finally {
      setSavingAll(false);
    }
  };

  const onExportCsv = () => {
    downloadTextFile(
      `soukcart-inventory-${new Date().toISOString().slice(0, 10)}.csv`,
      buildInventoryCsv(filtered.length ? filtered : catalog),
    );
  };

  const onImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !products) return;
    try {
      const text = await file.text();
      const rows = parseInventoryCsv(text);
      const byId = new Map(products.map((product) => [product.id, product]));
      const adjustments: StockAdjustmentInput[] = [];
      for (const row of rows) {
        const product = byId.get(row.productId);
        if (!product) {
          throw new Error(`Unknown product_id ${row.productId}.`);
        }
        adjustments.push({
          productId: product.id,
          mode: "absolute",
          value: row.stock,
          expectedVersion: product.stock_version,
        });
      }
      setSavingAll(true);
      const results = await bulkAdjustProductStock(adjustments);
      applyResults(results);
      setNotice({
        message: `Imported stock for ${results.length} product${results.length === 1 ? "" : "s"}.`,
        state: "success",
      });
    } catch (importError) {
      setNotice({ message: friendlyProductError(importError), state: "error" });
    } finally {
      setSavingAll(false);
    }
  };

  return (
    <SupplierWorkspaceShell
      section="stock"
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        title="Inventory management"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={retry}>
              <RefreshCw data-icon="inline-start" />
              Refresh
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onExportCsv}
              disabled={!catalog.length}
            >
              <Download data-icon="inline-start" />
              Export CSV
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={savingAll}
            >
              <Upload data-icon="inline-start" />
              Import CSV
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={onImportFile}
            />
            <Button asChild variant="outline">
              <RouterLink to="/supplier/products">Manage products</RouterLink>
            </Button>
          </div>
        }
      />
      <InlineNotice message={notice?.message} state={notice?.state} />
      {products ? (
        catalog.length ? (
          <>
            <StatGrid label="Inventory health summary">
              <StatCard label="Catalog" value={counts.all} />
              <StatCard label="Out of stock" value={counts.out} />
            </StatGrid>

            <Card>
              <CardHeader>
                <CardTitle>Manage Inventory</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <div className="overflow-x-auto pb-1">
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      size="sm"
                      value={filter}
                      onValueChange={(value) => {
                        if (value) setFilter(value as StockFilter);
                      }}
                      aria-label="Filter inventory"
                    >
                      <ToggleGroupItem value="all">All ({counts.all})</ToggleGroupItem>
                      <ToggleGroupItem value="out">Out ({counts.out})</ToggleGroupItem>
                      <ToggleGroupItem value="hidden">Hidden ({counts.hidden})</ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-muted-foreground">Bulk adjust selected</span>
                      <Input
                        className="w-28"
                        value={bulkDelta}
                        onChange={(event) => setBulkDelta(event.target.value)}
                        aria-label="Bulk stock delta"
                      />
                    </label>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void applyBulkDelta()}
                      disabled={savingAll}
                    >
                      Apply delta
                    </Button>
                    <Button
                      type="button"
                      onClick={() => void onSaveAll()}
                      disabled={savingAll || dirtyIds.length === 0}
                    >
                      {savingAll ? "Saving…" : `Save all (${dirtyIds.length})`}
                    </Button>
                  </div>
                </div>

                <SearchToolbar
                  label="Search inventory"
                  placeholder="Search products"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />

                {filtered.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          <Checkbox
                            checked={
                              filtered.length > 0 &&
                              filtered.every((product) => selected[product.id])
                            }
                            onCheckedChange={(value) => {
                              const checked = value === true;
                              setSelected((prev) => {
                                const next = { ...prev };
                                for (const product of filtered) next[product.id] = checked;
                                return next;
                              });
                            }}
                            aria-label="Select all visible products"
                          />
                        </TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead>Unit</TableHead>
                        <TableHead>Available</TableHead>
                        <TableHead>New quantity</TableHead>
                        <TableHead>
                          <span className="sr-only">Update stock</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((product) => (
                        <StockRow
                          key={product.id}
                          product={product}
                          draft={drafts[product.id] ?? { stock: String(product.stock) }}
                          selected={Boolean(selected[product.id])}
                          onToggleSelected={(checked) =>
                            setSelected((prev) => ({ ...prev, [product.id]: checked }))
                          }
                          onDraftChange={(patch) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [product.id]: {
                                ...(prev[product.id] ?? { stock: String(product.stock) }),
                                ...patch,
                              },
                            }))
                          }
                          onSaveOne={() => void onSaveOne(product.id)}
                          saving={savingAll || savingId === product.id}
                        />
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <EmptyState
                    icon={Search}
                    title="No inventory matches these filters"
                    copy="Try another stock status or a broader search term."
                  />
                )}
              </CardContent>
            </Card>
          </>
        ) : (
          <EmptyState
            icon={Store}
            title="No products yet"
            copy="Add a product to your catalog and its inventory will appear here."
            action={
              <Button asChild>
                <RouterLink to="/supplier/products">Manage products</RouterLink>
              </Button>
            }
          />
        )
      ) : (
        <LoadingState title="Loading your inventory…" />
      )}
    </SupplierWorkspaceShell>
  );
}
