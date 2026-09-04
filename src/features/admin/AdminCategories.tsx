import { useEffect, useState } from "react";
import { Eye, EyeOff, Pencil, Plus, Search, Tags, Trash2 } from "lucide-react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
import { formatDate } from "../workspace/format.ts";
import { AdminWorkspaceShell } from "./admin-workspace-shell.tsx";
import {
  categoryDescriptionValidationError,
  categoryValidationError,
  createAdminCategory,
  deleteAdminCategory,
  filterAdminCategories,
  findDuplicateCategoryName,
  getAdminCategoryStats,
  loadAdminCategories,
  replaceAdminCategory,
  updateAdminCategory,
  type AdminCategory,
} from "./admin-categories-api.ts";

type AdminCategoriesProps = {
  loadCategories?: () => Promise<AdminCategory[]>;
  createCategory?: (name: string, description: string) => Promise<AdminCategory>;
  updateCategory?: (
    categoryId: string,
    patch: { name?: string; description?: string; isActive?: boolean },
  ) => Promise<AdminCategory>;
  deleteCategory?: (categoryId: string) => Promise<{ clearedProducts: number }>;
};

type Notice = { message: string; state: NoticeState } | null;

type DialogState = { mode: "create" } | { mode: "edit"; category: AdminCategory } | null;

function CategoryRow({
  category,
  busy,
  onEdit,
  onToggle,
  onDelete,
}: {
  category: AdminCategory;
  busy: boolean;
  onEdit: (category: AdminCategory) => void;
  onToggle: (category: AdminCategory) => void;
  onDelete: (category: AdminCategory) => void;
}) {
  return (
    <TableRow id={`category-${category.id}`}>
      <TableCell>
        <div className="flex min-w-64 flex-col gap-1">
          <strong className="font-medium">{category.name}</strong>
          {category.description ? (
            <small className="line-clamp-2 text-xs text-muted-foreground">
              {category.description}
            </small>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        {category.product_count === 1 ? "1 product" : `${category.product_count} products`}
      </TableCell>
      <TableCell>{category.sort_order}</TableCell>
      <TableCell>
        {category.is_active ? (
          <Badge variant="outline">Active</Badge>
        ) : (
          <Badge variant="secondary">Hidden</Badge>
        )}
      </TableCell>
      <TableCell>{formatDate(category.updated_at)}</TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => onEdit(category)}
          >
            <Pencil data-icon="inline-start" />
            Edit
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => onToggle(category)}
          >
            {category.is_active ? (
              <EyeOff data-icon="inline-start" />
            ) : (
              <Eye data-icon="inline-start" />
            )}
            {category.is_active ? "Hide" : "Show"}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={busy}
            onClick={() => onDelete(category)}
          >
            <Trash2 data-icon="inline-start" />
            Delete
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function AdminCategories({
  loadCategories = loadAdminCategories,
  createCategory = createAdminCategory,
  updateCategory = updateAdminCategory,
  deleteCategory = deleteAdminCategory,
}: AdminCategoriesProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const [categories, setCategories] = useState<AdminCategory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AdminCategory | null>(null);

  useEffect(() => {
    let current = true;
    setError(null);

    void loadCategories()
      .then((next) => {
        if (current) setCategories(next);
      })
      .catch((loadError: unknown) => {
        if (current) {
          setError(loadError instanceof Error ? loadError.message : "Please try again.");
        }
      });

    return () => {
      current = false;
    };
  }, [loadCategories, loadVersion]);

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
        title="We could not load categories."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  const closeDialog = () => {
    setDialog(null);
    setName("");
    setDescription("");
    setNameError(null);
    setDescriptionError(null);
  };

  const openCreate = () => {
    setName("");
    setDescription("");
    setNameError(null);
    setDescriptionError(null);
    setDialog({ mode: "create" });
  };

  const openEdit = (category: AdminCategory) => {
    setName(category.name);
    setDescription(category.description);
    setNameError(null);
    setDescriptionError(null);
    setDialog({ mode: "edit", category });
  };

  const submitDialog = () => {
    if (!dialog) return;
    const current = dialog;
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();

    const nameErrorValue = categoryValidationError(trimmedName);
    if (nameErrorValue) {
      setNameError(nameErrorValue);
      return;
    }
    const descriptionErrorValue = categoryDescriptionValidationError(trimmedDescription);
    if (descriptionErrorValue) {
      setDescriptionError(descriptionErrorValue);
      return;
    }
    const duplicate = findDuplicateCategoryName(
      categories ?? [],
      trimmedName,
      current.mode === "edit" ? current.category.id : undefined,
    );
    if (duplicate) {
      setNameError(`A category named "${duplicate.name}" already exists.`);
      return;
    }

    setSaving(true);
    closeDialog();

    const request =
      current.mode === "edit"
        ? updateCategory(current.category.id, {
            name: trimmedName,
            description: trimmedDescription,
          })
        : createCategory(trimmedName, trimmedDescription);

    void request
      .then((saved) => {
        setCategories((prev) => (prev ? replaceAdminCategory(prev, saved) : prev));
        setNotice({
          message:
            current.mode === "edit"
              ? `"${saved.name}" was updated.`
              : `"${saved.name}" was added to the category list.`,
          state: "success",
        });
      })
      .catch((saveError: unknown) => {
        setNotice({
          message:
            saveError instanceof Error ? saveError.message : "The category could not be saved.",
          state: "error",
        });
      })
      .finally(() => setSaving(false));
  };

  const onToggle = (category: AdminCategory) => {
    setBusyId(category.id);
    void updateCategory(category.id, { isActive: !category.is_active })
      .then((saved) => {
        setCategories((prev) => (prev ? replaceAdminCategory(prev, saved) : prev));
        setNotice({
          message: saved.is_active
            ? `"${saved.name}" is visible to suppliers again.`
            : `"${saved.name}" was hidden from the supplier form.`,
          state: "success",
        });
      })
      .catch((toggleError: unknown) => {
        setNotice({
          message:
            toggleError instanceof Error
              ? toggleError.message
              : "The category could not be updated.",
          state: "error",
        });
      })
      .finally(() => setBusyId(null));
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    setBusyId(target.id);

    void deleteCategory(target.id)
      .then((result) => {
        setCategories((prev) =>
          prev ? prev.filter((category) => category.id !== target.id) : prev,
        );
        setNotice({
          message:
            result.clearedProducts > 0
              ? `"${target.name}" was deleted. ${result.clearedProducts} ${
                  result.clearedProducts === 1 ? "product was" : "products were"
                } set to uncategorized.`
              : `"${target.name}" was deleted.`,
          state: "success",
        });
      })
      .catch((deleteError: unknown) => {
        setNotice({
          message:
            deleteError instanceof Error
              ? deleteError.message
              : "The category could not be deleted.",
          state: "error",
        });
      })
      .finally(() => setBusyId(null));
  };

  const stats = categories ? getAdminCategoryStats(categories) : null;
  const filtered = categories ? filterAdminCategories(categories, searchTerm) : [];

  return (
    <AdminWorkspaceShell
      activePath="/admin/categories"
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Catalog"
        title="Product categories."
        copy="Keep the category list tidy. Suppliers pick from it when listing products, and renames or deletions are applied to existing products automatically."
      />
      <InlineNotice message={notice?.message} state={notice?.state} />
      {categories && stats ? (
        <>
          <StatGrid label="Categories summary">
            <StatCard label="Total" value={stats.total} />
            <StatCard label="Active" value={stats.active} />
            <StatCard label="Hidden" value={stats.hidden} />
            <StatCard label="In use" value={stats.inUse} />
          </StatGrid>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SearchToolbar
              label="Search categories"
              placeholder="Search categories or descriptions"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              result={`${filtered.length} of ${categories.length} categories`}
            />
            <Button type="button" onClick={openCreate}>
              <Plus data-icon="inline-start" />
              Add category
            </Button>
          </div>

          {categories.length ? (
            <TableShell>
              <Table className="min-w-4xl">
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead>Products</TableHead>
                    <TableHead>Order</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length ? (
                    filtered.map((category) => (
                      <CategoryRow
                        key={category.id}
                        category={category}
                        busy={busyId === category.id || saving}
                        onEdit={openEdit}
                        onToggle={onToggle}
                        onDelete={setPendingDelete}
                      />
                    ))
                  ) : (
                    <TableRow>
                      <TableCell className="p-0" colSpan={6}>
                        <EmptyState
                          icon={Search}
                          title="No matching categories"
                          copy="Try a different name or clear the search."
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableShell>
          ) : (
            <EmptyState
              icon={Tags}
              title="No categories yet"
              copy="Add a category so suppliers can group their products."
            />
          )}
        </>
      ) : (
        <LoadingState title="Loading categories…" />
      )}

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog?.mode === "edit" ? "Edit category" : "Add category"}</DialogTitle>
            <DialogDescription>
              {dialog?.mode === "edit"
                ? `Renaming "${dialog.category.name}" moves its ${dialog.category.product_count} existing products to the new name automatically.`
                : "Suppliers pick categories from this list when listing products."}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={nameError ? true : undefined}>
              <FieldLabel htmlFor="category-name" required>
                Name
              </FieldLabel>
              <Input
                id="category-name"
                value={name}
                maxLength={60}
                placeholder="e.g. Rice & Grains"
                aria-invalid={nameError ? true : undefined}
                onChange={(event) => {
                  setName(event.target.value);
                  if (nameError) setNameError(null);
                }}
              />
              {nameError ? <p className="text-sm text-destructive">{nameError}</p> : null}
            </Field>
            <Field data-invalid={descriptionError ? true : undefined}>
              <FieldLabel htmlFor="category-description">Description</FieldLabel>
              <Textarea
                id="category-description"
                value={description}
                maxLength={280}
                rows={3}
                placeholder="Optional note, e.g. Bulk sacks and retail packs of rice."
                aria-invalid={descriptionError ? true : undefined}
                onChange={(event) => {
                  setDescription(event.target.value);
                  if (descriptionError) setDescriptionError(null);
                }}
              />
              <FieldDescription>
                Optional. Helps suppliers pick the right category.
              </FieldDescription>
              {descriptionError ? (
                <p className="text-sm text-destructive">{descriptionError}</p>
              ) : null}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button type="button" disabled={saving} onClick={submitDialog}>
              {dialog?.mode === "edit" ? "Save changes" : "Create category"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this category?</AlertDialogTitle>
            <AlertDialogDescription>
              "{pendingDelete?.name}" will be removed from the category list.
              {pendingDelete && pendingDelete.product_count > 0
                ? ` ${pendingDelete.product_count} ${
                    pendingDelete.product_count === 1 ? "product" : "products"
                  } using it will become uncategorized.`
                : " No products use it right now."}
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete}>
              Delete category
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminWorkspaceShell>
  );
}
