import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ImageIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  InlineNotice,
  LoadingState,
  PageHeader,
  WorkspaceError,
} from "../../components/ui/Workspace.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { RouterLink } from "../workspace/WorkspaceShell.tsx";
import {
  createSupplierProduct,
  DEFAULT_PRODUCT_UNIT,
  loadProductCategoryOptions,
  loadSupplierProduct,
  MAX_IMAGE_BYTES,
  MAX_PRODUCT_DESCRIPTION,
  mergeCurrentCategory,
  PRODUCT_CATEGORIES,
  productUnitOptions,
  productValidationError,
  removeStoredImage,
  updateSupplierProduct,
  uploadProductImage,
  type ProductPayload,
  type SupplierProduct,
} from "./supplier-products-api.ts";
import { SUPPLIER_NOTICE_KEY, SupplierWorkspaceShell } from "./supplier-shared.tsx";

type SupplierProductFormProps = {
  productId?: string;
  loadProduct?: (sellerId: string, productId: string) => Promise<SupplierProduct | null>;
  loadCategories?: () => Promise<string[]>;
};

type Feedback = { message: string; state: "info" | "success" | "error" } | null;

const UNCATEGORIZED = "__uncategorized__";

function readText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export function SupplierProductForm({
  productId,
  loadProduct = loadSupplierProduct,
  loadCategories = loadProductCategoryOptions,
}: SupplierProductFormProps) {
  const isEdit = Boolean(productId);
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/supplier/products/new" });
  const sellerId = state.status === "seller" ? state.session.user.id : "";

  const [editing, setEditing] = useState<SupplierProduct | null | undefined>(
    isEdit ? undefined : null,
  );
  const [categoryOptions, setCategoryOptions] = useState<string[] | null>(null);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [keptImageUrl, setKeptImageUrl] = useState<string | null>(null);
  const [previewObjectUrl, setPreviewObjectUrl] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!sellerId) return;
    let current = true;

    void loadCategories()
      .then((options) => {
        if (current) setCategoryOptions(options);
      })
      .catch(() => {
        if (current) setCategoryOptions([...PRODUCT_CATEGORIES]);
      });

    return () => {
      current = false;
    };
  }, [loadCategories, sellerId]);

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
        setDescription(found.description ?? "");
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

  const categoryChoices = mergeCurrentCategory(
    categoryOptions ?? [...PRODUCT_CATEGORIES],
    editing?.category ?? null,
  );

  const unitChoices = productUnitOptions(editing?.unit ?? DEFAULT_PRODUCT_UNIT);

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
      unit: readText(formData, "unit").trim() || DEFAULT_PRODUCT_UNIT,
      stock: Number(readText(formData, "stock")),
      min_order_qty: Number(readText(formData, "min_order_qty")),
      category: (() => {
        const category = readText(formData, "category").trim();
        return !category || category === UNCATEGORIZED ? null : category;
      })(),
    };
    const file = fileInputRef.current?.files?.[0] ?? null;
    const validationMessage = productValidationError(payload, {
      allowZeroStock: isEdit,
      requireImage: true,
      imageUrl: keptImageUrl,
      hasImageFile: Boolean(file),
    });
    if (validationMessage) {
      setFeedback({ message: validationMessage, state: "error" });
      return;
    }

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
        message = `${payload.name} was submitted for approval. Retailers see it once SoukCart approves it.`;
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
    <SupplierWorkspaceShell
      section="products"
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      {children}
    </SupplierWorkspaceShell>
  );

  if (editing === undefined) {
    return shell(<LoadingState title="Loading product…" />);
  }

  const displayUrl = previewObjectUrl ?? keptImageUrl;

  return shell(
    <>
      <div className="flex">
        <Button asChild variant="link" className="h-auto p-0">
          <RouterLink to="/supplier/products">Back to my products</RouterLink>
        </Button>
      </div>
      <PageHeader
        title={editing ? "Edit product" : "Add a product"}
        copy={
          editing
            ? "Update the details or swap the photo — approved listings reach retailers right away."
            : "New listings are reviewed by SoukCart before retailers can order them. Fields marked * are required."
        }
      />
      <InlineNotice />
      <form onSubmit={onSubmit} noValidate>
        <Card>
          <CardHeader>
            <CardTitle>{editing ? "Product details" : "New product details"}</CardTitle>
            <CardDescription>
              Add the listing information retailers need before placing an order.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldSet>
              <FieldLegend className="sr-only">Product details</FieldLegend>
              <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field className="md:col-span-2">
                  <FieldLabel htmlFor="product-name" required>
                    Product name
                  </FieldLabel>
                  <Input
                    id="product-name"
                    name="name"
                    type="text"
                    maxLength={120}
                    placeholder="e.g. Miniket rice, 50 kg sack"
                    defaultValue={editing?.name ?? ""}
                    required
                    aria-required="true"
                  />
                </Field>
                <Field className="md:col-span-2">
                  <FieldLabel htmlFor="product-description">Long description</FieldLabel>
                  <Textarea
                    id="product-description"
                    name="description"
                    rows={6}
                    maxLength={MAX_PRODUCT_DESCRIPTION}
                    placeholder="The full story retailers see on the product page — origin, grain size, packaging, shelf life…"
                    value={description}
                    onChange={(event) => setDescription(event.currentTarget.value)}
                  />
                  <FieldDescription className="flex flex-wrap items-center justify-between gap-2">
                    <span>Shown on the product page — write the details retailers ask about.</span>
                    <span className="tabular-nums">
                      {description.length}/{MAX_PRODUCT_DESCRIPTION}
                    </span>
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="product-price" required>
                    Price per unit (৳)
                  </FieldLabel>
                  <Input
                    id="product-price"
                    name="price"
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="0.01"
                    defaultValue={editing ? String(editing.price) : ""}
                    required
                    aria-required="true"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="product-unit" required>
                    Unit
                  </FieldLabel>
                  <Select name="unit" defaultValue={editing ? editing.unit : DEFAULT_PRODUCT_UNIT}>
                    <SelectTrigger id="product-unit" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {unitChoices.map((unit) => (
                          <SelectItem value={unit.value} key={unit.value}>
                            {unit.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    How this product is sold and priced — retailers see the price per unit.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="product-category">Category</FieldLabel>
                  <Select name="category" defaultValue={editing?.category ?? UNCATEGORIZED}>
                    <SelectTrigger id="product-category" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value={UNCATEGORIZED}>Choose a category</SelectItem>
                        {categoryChoices.map((category) => (
                          <SelectItem value={category} key={category}>
                            {category}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="product-stock" required>
                    Stock
                  </FieldLabel>
                  <Input
                    id="product-stock"
                    name="stock"
                    type="number"
                    min={isEdit ? "0" : "1"}
                    step="1"
                    defaultValue={editing ? String(editing.stock) : "1"}
                    required
                    aria-required="true"
                  />
                  {isEdit ? (
                    <FieldDescription>Set to 0 to mark the product out of stock.</FieldDescription>
                  ) : null}
                </Field>
                <Field>
                  <FieldLabel htmlFor="product-moq" required>
                    Minimum order quantity
                  </FieldLabel>
                  <Input
                    id="product-moq"
                    name="min_order_qty"
                    type="number"
                    min="1"
                    step="1"
                    defaultValue={editing ? String(editing.min_order_qty) : "1"}
                    required
                    aria-required="true"
                  />
                  <FieldDescription>Retailers must buy at least this many units.</FieldDescription>
                </Field>
                <Field className="md:col-span-2">
                  <FieldLabel htmlFor="product-image" required>
                    Product image
                  </FieldLabel>
                  <label
                    htmlFor="product-image"
                    hidden={Boolean(displayUrl)}
                    className="flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-destructive/80 bg-destructive/5 p-6 text-center"
                  >
                    <ImageIcon aria-hidden="true" className="text-destructive" />
                    <span className="font-medium">Add a product image</span>
                    <span className="text-sm text-destructive">
                      Required · PNG or JPG, up to 5 MB
                    </span>
                    <input
                      id="product-image"
                      ref={fileInputRef}
                      className="sr-only"
                      type="file"
                      name="image"
                      accept="image/png,image/jpeg,image/webp"
                      required={!displayUrl}
                      aria-required={!displayUrl}
                      onChange={onFileChange}
                    />
                  </label>
                  {displayUrl ? (
                    <div className="flex flex-col items-start gap-3">
                      <img
                        className="max-h-96 w-full rounded-lg border object-contain"
                        src={displayUrl}
                        alt="Product image preview"
                      />
                      <Button type="button" variant="outline" onClick={onRemoveImage}>
                        Choose a different image
                      </Button>
                    </div>
                  ) : null}
                </Field>
              </FieldGroup>
            </FieldSet>
          </CardContent>
          <CardFooter className="flex flex-col items-stretch gap-3">
            <div className="flex flex-wrap justify-end gap-2">
              <Button asChild variant="secondary">
                <RouterLink to="/supplier/products">Cancel</RouterLink>
              </Button>
              <Button type="submit" disabled={submitting}>
                {editing ? "Save changes" : "Create product"}
              </Button>
            </div>
            <div role="status" aria-live="polite">
              {feedback ? (
                <Alert variant={feedback.state === "error" ? "destructive" : "default"}>
                  <AlertTitle>
                    {feedback.state === "error" ? "Product update" : "Product status"}
                  </AlertTitle>
                  <AlertDescription>{feedback.message}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          </CardFooter>
        </Card>
      </form>
    </>,
  );
}
