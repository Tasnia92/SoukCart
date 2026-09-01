import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Icon } from "../../components/ui/Icon.tsx";
import {
  InlineNotice,
  LoadingState,
  PageHeader,
  WorkspaceError,
} from "../../components/ui/Workspace.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { RouterLink, WorkspaceShell } from "../workspace/WorkspaceShell.tsx";
import {
  createSupplierProduct,
  loadSupplierProduct,
  MAX_IMAGE_BYTES,
  PRODUCT_CATEGORIES,
  removeStoredImage,
  updateSupplierProduct,
  uploadProductImage,
  type ProductPayload,
  type SupplierProduct,
} from "./supplier-products-api.ts";
import { SUPPLIER_NOTICE_KEY, supplierNavItems } from "./supplier-shared.tsx";

type SupplierProductFormProps = {
  productId?: string;
  loadProduct?: (sellerId: string, productId: string) => Promise<SupplierProduct | null>;
};

type Feedback = { message: string; state: "info" | "success" | "error" } | null;

function readText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export function SupplierProductForm({
  productId,
  loadProduct = loadSupplierProduct,
}: SupplierProductFormProps) {
  const isEdit = Boolean(productId);
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/supplier/products/new" });
  const sellerId = state.status === "seller" ? state.session.user.id : "";

  const [editing, setEditing] = useState<SupplierProduct | null | undefined>(
    isEdit ? undefined : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [keptImageUrl, setKeptImageUrl] = useState<string | null>(null);
  const [previewObjectUrl, setPreviewObjectUrl] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEdit || !sellerId || !productId) return;
    let current = true;
    setError(null);

    void loadProduct(sellerId, productId)
      .then((found) => {
        if (!current) return;
        if (!found) {
          void navigate({ to: "/supplier/products", replace: true });
          return;
        }
        setEditing(found);
        setKeptImageUrl(found.image_url ?? null);
      })
      .catch((loadError: unknown) => {
        if (current) {
          setError(loadError instanceof Error ? loadError.message : "Please try again.");
        }
      });

    return () => {
      current = false;
    };
  }, [isEdit, loadProduct, navigate, productId, sellerId]);

  useEffect(() => {
    return () => {
      if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    };
  }, [previewObjectUrl]);

  if (state.status !== "seller") return null;

  const onLogout = () => {
    void store.signOut().then(() => {
      void navigate({ to: "/" });
    });
  };
  const userName = state.profile.name || state.profile.email;

  if (error) {
    return (
      <WorkspaceError
        eyebrow="Supplier workspace"
        title="We could not load your catalog."
        message={error}
        onRetry={() => setError(null)}
        onLogout={onLogout}
      />
    );
  }

  const resetPreview = () => {
    setPreviewObjectUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return null;
    });
  };

  const onFileChange = (event: FormEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > MAX_IMAGE_BYTES) {
      event.currentTarget.value = "";
      setFeedback({ message: "Please pick a PNG or JPG image under 5 MB.", state: "error" });
      return;
    }
    resetPreview();
    setPreviewObjectUrl(URL.createObjectURL(file));
  };

  const onRemoveImage = () => {
    if (fileInputRef.current) fileInputRef.current.value = "";
    resetPreview();
    setKeptImageUrl(null);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    const formData = new FormData(form);
    const payload: ProductPayload = {
      name: readText(formData, "name").trim(),
      description: readText(formData, "description").trim(),
      price: Number(readText(formData, "price")),
      unit: readText(formData, "unit").trim() || "piece",
      stock: Math.max(0, Math.floor(Number(readText(formData, "stock")))),
      category: readText(formData, "category").trim() || null,
    };

    const file = fileInputRef.current?.files?.[0] ?? null;
    if (file) {
      if (!file.type.startsWith("image/")) {
        setFeedback({ message: "Please choose an image file (PNG or JPG).", state: "error" });
        return;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setFeedback({
          message: "The image is too large. Please pick one under 5 MB.",
          state: "error",
        });
        return;
      }
    }

    setSubmitting(true);
    const originalImageUrl = editing?.image_url ?? null;

    try {
      let imageUrl = keptImageUrl;
      if (file) {
        setFeedback({ message: "Uploading image…", state: "info" });
        imageUrl = await uploadProductImage(sellerId, file);
      }

      let message: string;
      if (isEdit && productId) {
        await updateSupplierProduct(sellerId, productId, payload, imageUrl);
        message = `${payload.name} was updated.`;
      } else {
        await createSupplierProduct(sellerId, payload, imageUrl);
        message = `${payload.name} was added to your catalog.`;
      }

      if (originalImageUrl && originalImageUrl !== imageUrl) {
        void removeStoredImage(originalImageUrl);
      }

      sessionStorage.setItem(SUPPLIER_NOTICE_KEY, message);
      void navigate({ to: "/supplier/products" });
    } catch (submitError) {
      setFeedback({
        message:
          submitError instanceof Error ? submitError.message : "The product could not be saved.",
        state: "error",
      });
      setSubmitting(false);
    }
  };

  const shell = (children: ReactNode) => (
    <WorkspaceShell
      navigationLabel="Supplier navigation"
      items={supplierNavItems("products")}
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      {children}
    </WorkspaceShell>
  );

  if (editing === undefined) {
    return shell(<LoadingState title="Loading product…" />);
  }

  const displayUrl = previewObjectUrl ?? keptImageUrl;

  return shell(
    <>
      <p className="sp-back-row">
        <RouterLink className="text-button" to="/supplier/products">
          Back to my products
        </RouterLink>
      </p>
      <PageHeader
        eyebrow={editing ? "Edit listing" : "New listing"}
        title={editing ? "Edit product." : "Add a product."}
        copy={
          editing
            ? "Update the details or swap the photo — retailers see the changes right away."
            : "Give retailers what they need: a clear name, a fair price, and a photo."
        }
      />
      <InlineNotice />
      <form className="sp-form-card" onSubmit={onSubmit} noValidate>
        <div className="sp-form-grid">
          <label className="admin-field sp-field-full">
            <span>Product name</span>
            <input
              name="name"
              type="text"
              maxLength={120}
              placeholder="e.g. Miniket rice, 50 kg sack"
              defaultValue={editing?.name ?? ""}
              required
            />
          </label>
          <label className="admin-field sp-field-full">
            <span>Description</span>
            <textarea
              name="description"
              rows={3}
              maxLength={500}
              placeholder="Short detail retailers will see"
              defaultValue={editing?.description ?? ""}
            />
          </label>
          <label className="admin-field">
            <span>Price (৳)</span>
            <input
              name="price"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              defaultValue={editing ? String(editing.price) : ""}
              required
            />
          </label>
          <label className="admin-field">
            <span>Unit</span>
            <input
              name="unit"
              type="text"
              maxLength={24}
              placeholder="kg, crate, piece…"
              defaultValue={editing ? editing.unit : "piece"}
              required
            />
          </label>
          <label className="admin-field">
            <span>Category</span>
            <select
              name="category"
              className="sp-category-select"
              defaultValue={editing?.category ?? ""}
            >
              <option value="">Choose a category</option>
              {PRODUCT_CATEGORIES.map((category) => (
                <option value={category} key={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-field">
            <span>Stock</span>
            <input
              name="stock"
              type="number"
              min="0"
              step="1"
              defaultValue={editing ? String(editing.stock) : "0"}
              required
            />
          </label>
          <div className="sp-image-picker admin-field">
            <span>Product image</span>
            <label className="sp-image-drop" hidden={Boolean(displayUrl)}>
              <Icon name="image" />
              <strong>Add a product image</strong>
              <small>PNG or JPG, up to 5 MB</small>
              <input
                ref={fileInputRef}
                className="sr-only"
                type="file"
                name="image"
                accept="image/png,image/jpeg,image/webp"
                onChange={onFileChange}
              />
            </label>
            <div className="sp-image-preview-wrap" hidden={!displayUrl}>
              <img
                className="sp-image-preview"
                src={displayUrl ?? ""}
                alt="Product image preview"
              />
              <button className="button button-subtle" type="button" onClick={onRemoveImage}>
                <span>Choose a different image</span>
              </button>
            </div>
          </div>
        </div>
        <div className="sp-form-actions">
          <RouterLink className="button button-secondary" to="/supplier/products">
            Cancel
          </RouterLink>
          <button className="button button-primary" type="submit" disabled={submitting}>
            <span>{editing ? "Save changes" : "Create product"}</span>
          </button>
        </div>
        <p
          className={`admin-form-feedback${feedback ? ` is-visible is-${feedback.state}` : ""}`}
          role="status"
          aria-live="polite"
        >
          {feedback?.message}
        </p>
      </form>
    </>,
  );
}
