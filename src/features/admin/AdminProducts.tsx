import { useEffect, useState } from "react";
import { Ban, Check, EyeOff, Package, RotateCcw, Search, Trash2 } from "lucide-react";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  EmptyState,
  InlineNotice,
  LoadingState,
  PageHeader,
  SearchToolbar,
  StatCard,
  StatGrid,
  TableShell,
  WorkspaceError,
  type NoticeState,
} from "../../components/ui/Workspace.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { formatDate, formatPrice, initials } from "../workspace/format.ts";
import { AdminWorkspaceShell } from "./admin-workspace-shell.tsx";
import {
  ADMIN_PRODUCT_SORTS,
  approveAdminProduct,
  filterAdminProducts,
  getAdminProductStats,
  hideAdminProduct,
  loadAdminProducts,
  rejectAdminProduct,
  removeAdminProduct,
  restoreAdminProduct,
  sortAdminProducts,
  type AdminProduct,
  type AdminProductFilter,
  type AdminProductSort,
} from "./admin-products-api.ts";

type AdminProductsProps = {
  loadProducts?: () => Promise<AdminProduct[]>;
  hideProduct?: (productId: string, reason: string) => Promise<unknown>;
  removeProduct?: (productId: string, reason: string) => Promise<{ purged?: boolean }>;
  restoreProduct?: (productId: string) => Promise<unknown>;
  approveProduct?: (productId: string) => Promise<unknown>;
  rejectProduct?: (productId: string, reason: string) => Promise<unknown>;
};

type Notice = { message: string; state: NoticeState } | null;
type ModerateAction = "hide" | "remove" | "reject";

const MAX_REASON_LENGTH = 1000;

function statusBadge(product: AdminProduct) {
  if (product.moderation_status === "removed") {
    return <Badge variant="destructive">Removed</Badge>;
  }
  if (product.moderation_status === "hidden") {
    return <Badge variant="destructive">Hidden by admin</Badge>;
  }
  if (product.approval_status === "pending") {
    return <Badge variant="secondary">Pending approval</Badge>;
  }
  if (product.approval_status === "rejected") {
    return <Badge variant="destructive">Rejected</Badge>;
  }
  if (!product.is_active) {
    return <Badge variant="secondary">Hidden by seller</Badge>;
  }
  return <Badge variant="outline">Active</Badge>;
}

function ProductThumb({ product }: { product: AdminProduct }) {
  if (product.image_url) {
    return <img src={product.image_url} alt="" className="size-10 rounded-md object-cover" />;
  }
  return (
    <span className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
      <Package className="size-4" aria-hidden="true" />
    </span>
  );
}

function ProductRow({
  product,
  busy,
  onModerate,
  onRestore,
  onApprove,
}: {
  product: AdminProduct;
  busy: boolean;
  onModerate: (product: AdminProduct, action: ModerateAction) => void;
  onRestore: (product: AdminProduct) => void;
  onApprove: (product: AdminProduct) => void;
}) {
  return (
    <TableRow id={`product-${product.id}`}>
      <TableCell>
        <div className="flex min-w-64 items-start gap-3">
          <ProductThumb product={product} />
          <span className="flex min-w-0 flex-col gap-1">
            <strong className="line-clamp-2 font-medium">{product.name}</strong>
            <small className="text-xs text-muted-foreground">
              {product.category || "Uncategorized"} · {formatPrice(product.price)} / {product.unit}
            </small>
            {product.moderation_reason ? (
              <small className="line-clamp-2 text-xs text-destructive">
                Reason: {product.moderation_reason}
              </small>
            ) : null}
            {product.approval_note ? (
              <small className="line-clamp-2 text-xs text-destructive">
                Review note: {product.approval_note}
              </small>
            ) : null}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar size="sm">
            <AvatarFallback>{initials(product.seller_name || product.seller_email)}</AvatarFallback>
          </Avatar>
          <span className="flex min-w-0 flex-col gap-1">
            <strong className="truncate font-medium">
              {product.shop_name || product.seller_name}
            </strong>
            <small className="truncate text-xs text-muted-foreground">{product.seller_email}</small>
          </span>
        </div>
      </TableCell>
      <TableCell>
        {product.stock} {product.unit}
      </TableCell>
      <TableCell>{formatDate(product.created_at)}</TableCell>
      <TableCell>{statusBadge(product)}</TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-2">
          {product.approval_status === "pending" ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => onApprove(product)}
              >
                <Check data-icon="inline-start" />
                Approve
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => onModerate(product, "reject")}
              >
                <Ban data-icon="inline-start" />
                Reject
              </Button>
            </>
          ) : null}
          {product.moderation_status === "hidden" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onRestore(product)}
            >
              <RotateCcw data-icon="inline-start" />
              Restore
            </Button>
          ) : null}
          {product.moderation_status === "ok" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => onModerate(product, "hide")}
            >
              <EyeOff data-icon="inline-start" />
              Hide
            </Button>
          ) : null}
          {product.moderation_status !== "removed" ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => onModerate(product, "remove")}
            >
              <Trash2 data-icon="inline-start" />
              Remove
            </Button>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

export function AdminProducts({
  loadProducts = loadAdminProducts,
  hideProduct = hideAdminProduct,
  removeProduct = removeAdminProduct,
  restoreProduct = restoreAdminProduct,
  approveProduct = approveAdminProduct,
  rejectProduct = rejectAdminProduct,
}: AdminProductsProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const [products, setProducts] = useState<AdminProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<AdminProductFilter>("all");
  const [sort, setSort] = useState<AdminProductSort>("newest");
  const [notice, setNotice] = useState<Notice>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ product: AdminProduct; action: ModerateAction } | null>(
    null,
  );
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    let current = true;
    setError(null);

    void loadProducts()
      .then((next) => {
        if (current) setProducts(next);
      })
      .catch((loadError: unknown) => {
        if (current) {
          setError(loadError instanceof Error ? loadError.message : "Please try again.");
        }
      });

    return () => {
      current = false;
    };
  }, [loadProducts, loadVersion]);

  if (state.status !== "admin") return null;

  const onLogout = () => {
    void store.signOut();
  };
  const retry = () => setLoadVersion((version) => version + 1);
  const userName = state.profile.name || "Administrator";

  if (error) {
    return (
      <WorkspaceError
        eyebrow="Admin"
        title="We could not load products."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  const closeModerateDialog = () => {
    setPending(null);
    setReason("");
    setReasonError(null);
    setConfirmRemove(false);
  };

  const openModerate = (product: AdminProduct, action: ModerateAction) => {
    setPending({ product, action });
    setReason("");
    setReasonError(null);
    setConfirmRemove(false);
  };

  const applyLocalModeration = (
    productId: string,
    next: Partial<AdminProduct>,
    options?: { purged?: boolean },
  ) => {
    setProducts((prev) => {
      if (!prev) return prev;
      if (options?.purged) return prev.filter((item) => item.id !== productId);
      return prev.map((item) => (item.id === productId ? { ...item, ...next } : item));
    });
  };

  const submitModeration = () => {
    if (!pending) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      setReasonError("Add a reason so the seller knows what violated the rules.");
      return;
    }
    if (pending.action === "remove" && !confirmRemove) {
      setConfirmRemove(true);
      return;
    }

    const { product, action } = pending;
    setBusyId(product.id);
    closeModerateDialog();

    const request =
      action === "hide"
        ? hideProduct(product.id, trimmed)
        : action === "reject"
          ? rejectProduct(product.id, trimmed)
          : removeProduct(product.id, trimmed);

    void request
      .then((result) => {
        const purged =
          action === "remove" && result && typeof result === "object" && "purged" in result
            ? Boolean((result as { purged?: boolean }).purged)
            : false;
        if (action === "reject") {
          applyLocalModeration(product.id, {
            approval_status: "rejected",
            approval_note: trimmed,
            approved_at: new Date().toISOString(),
          });
          setNotice({
            message: `${product.name} was rejected. The seller can edit it and resubmit for review.`,
            state: "success",
          });
          return;
        }
        applyLocalModeration(
          product.id,
          {
            is_active: false,
            moderation_status: action === "hide" ? "hidden" : "removed",
            moderation_reason: trimmed,
            moderated_at: new Date().toISOString(),
          },
          { purged },
        );
        setNotice({
          message:
            action === "hide"
              ? `${product.name} was hidden from the catalog.`
              : purged
                ? `${product.name} was permanently deleted.`
                : `${product.name} was removed from the catalog.`,
          state: "success",
        });
      })
      .catch((moderateError: unknown) => {
        setNotice({
          message:
            moderateError instanceof Error
              ? moderateError.message
              : "The product could not be moderated.",
          state: "error",
        });
      })
      .finally(() => setBusyId(null));
  };

  const onApprove = (product: AdminProduct) => {
    setBusyId(product.id);
    void approveProduct(product.id)
      .then(() => {
        applyLocalModeration(product.id, {
          approval_status: "approved",
          approval_note: null,
          approved_at: new Date().toISOString(),
        });
        setNotice({
          message: `${product.name} was approved and is now available to retailers.`,
          state: "success",
        });
      })
      .catch((approveError: unknown) => {
        setNotice({
          message:
            approveError instanceof Error
              ? approveError.message
              : "The product could not be approved.",
          state: "error",
        });
      })
      .finally(() => setBusyId(null));
  };

  const onRestore = (product: AdminProduct) => {
    setBusyId(product.id);
    void restoreProduct(product.id)
      .then(() => {
        applyLocalModeration(product.id, {
          is_active: true,
          moderation_status: "ok",
          moderation_reason: null,
          moderated_by: null,
          moderated_at: null,
        });
        setNotice({
          message: `${product.name} is visible in the catalog again.`,
          state: "success",
        });
      })
      .catch((restoreError: unknown) => {
        setNotice({
          message:
            restoreError instanceof Error
              ? restoreError.message
              : "The product could not be restored.",
          state: "error",
        });
      })
      .finally(() => setBusyId(null));
  };

  const stats = products ? getAdminProductStats(products) : null;
  const filtered = products
    ? sortAdminProducts(filterAdminProducts(products, searchTerm, statusFilter), sort)
    : [];

  return (
    <AdminWorkspaceShell
      activePath="/admin/products"
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Catalog"
        title="Product moderation."
        copy="Approve new supplier listings before they reach retailers. Hide or remove products that violate marketplace rules, and attach a reason the seller can see."
      />
      <InlineNotice message={notice?.message} state={notice?.state} />
      {products && stats ? (
        <>
          <StatGrid label="Products summary">
            <StatCard label="Total" value={stats.total} />
            <StatCard label="Active" value={stats.active} />
            <StatCard label="Pending approval" value={stats.pending} />
            <StatCard label="Rejected" value={stats.rejected} />
            <StatCard label="Hidden by admin" value={stats.hidden} />
            <StatCard label="Removed" value={stats.removed} />
          </StatGrid>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SearchToolbar
              label="Search products"
              placeholder="Search products, sellers, or reasons"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              result={`${filtered.length} of ${products.length} products`}
            />
            <div className="flex items-center gap-2">
              <Select value={sort} onValueChange={(value) => setSort(value as AdminProductSort)}>
                <SelectTrigger className="w-36" aria-label="Sort products by listing date">
                  <SelectValue placeholder="Sort" />
                </SelectTrigger>
                <SelectContent>
                  {ADMIN_PRODUCT_SORTS.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={statusFilter}
                onValueChange={(value) => setStatusFilter(value as AdminProductFilter)}
              >
                <SelectTrigger className="w-44" aria-label="Filter by status">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="pending">Pending approval</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="hidden">Hidden by admin</SelectItem>
                  <SelectItem value="removed">Removed</SelectItem>
                  <SelectItem value="seller_hidden">Hidden by seller</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {products.length ? (
            <TableShell>
              <Table className="min-w-5xl">
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Seller</TableHead>
                    <TableHead>Stock</TableHead>
                    <TableHead>Listed</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length ? (
                    filtered.map((product) => (
                      <ProductRow
                        key={product.id}
                        product={product}
                        busy={busyId === product.id}
                        onModerate={openModerate}
                        onRestore={onRestore}
                        onApprove={onApprove}
                      />
                    ))
                  ) : (
                    <TableRow>
                      <TableCell className="p-0" colSpan={6}>
                        <EmptyState
                          icon={Search}
                          title="No matching products"
                          copy="Try a different seller, product name, or status filter."
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableShell>
          ) : (
            <EmptyState icon={Package} title="No products yet" />
          )}
        </>
      ) : (
        <LoadingState title="Loading products…" />
      )}

      <Dialog
        open={pending !== null && !confirmRemove}
        onOpenChange={(open) => !open && closeModerateDialog()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending?.action === "hide"
                ? "Hide product"
                : pending?.action === "reject"
                  ? "Reject listing"
                  : "Remove product"}
            </DialogTitle>
            <DialogDescription>
              {pending?.action === "hide"
                ? `"${pending.product.name}" will leave the retailer catalog. The seller can see your reason and cannot show it again until you restore it.`
                : pending?.action === "reject"
                  ? `"${pending.product.name}" will not be listed. The seller sees your reason, can fix the listing, and resubmit it for review.`
                  : `"${pending?.product.name ?? "This product"}" will be permanently taken down. If it was never ordered it may be deleted entirely.`}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={reasonError ? true : undefined}>
              <FieldLabel htmlFor="product-moderation-reason">Reason</FieldLabel>
              <FieldDescription>
                Required. The seller will see this in their notifications.
              </FieldDescription>
              <Textarea
                id="product-moderation-reason"
                value={reason}
                maxLength={MAX_REASON_LENGTH}
                rows={4}
                aria-invalid={reasonError ? true : undefined}
                placeholder="Explain which rule was violated…"
                onChange={(event) => {
                  setReason(event.target.value);
                  if (reasonError) setReasonError(null);
                }}
              />
              {reasonError ? <p className="text-sm text-destructive">{reasonError}</p> : null}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeModerateDialog}>
              Cancel
            </Button>
            <Button
              type="button"
              variant={
                pending?.action === "remove" || pending?.action === "reject"
                  ? "destructive"
                  : "default"
              }
              disabled={busyId !== null}
              onClick={submitModeration}
            >
              {pending?.action === "hide"
                ? "Hide product"
                : pending?.action === "reject"
                  ? "Reject listing"
                  : "Continue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pending !== null && confirmRemove}
        onOpenChange={(open) => {
          if (!open) closeModerateDialog();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this product?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be restored. The seller will be notified with your reason
              {pending ? `: “${reason.trim()}”` : ""}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={submitModeration}>
              Remove product
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminWorkspaceShell>
  );
}
