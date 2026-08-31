import { supabase } from "../supabase.ts";
import { renderBrand } from "./Brand.ts";
import { renderIcon } from "./Icon.ts";

type Product = {
  id: string;
  name: string;
  description: string;
  price: number;
  unit: string;
  stock: number;
  category: string | null;
  image_url: string | null;
  is_active: boolean;
  created_at: string;
};

const PRODUCT_CATEGORIES = [
  "Rice & Grains",
  "Pulses & Lentils",
  "Oils & Ghee",
  "Vegetables",
  "Fruits",
  "Dairy & Eggs",
  "Meat & Fish",
  "Spices",
  "Snacks & Drinks",
  "Bakery & Sweets",
  "Household",
  "Other",
];

type Notice = { message: string; state: "info" | "success" | "error" };

type SupplierOrderStatus = "pending" | "confirmed" | "shipped" | "delivered" | "cancelled";

type SupplierOrderItem = {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
};

type SupplierOrder = {
  id: string;
  status: SupplierOrderStatus;
  cancel_requested: boolean;
  payment_status: string;
  payment_method: string;
  notes: string | null;
  created_at: string;
  retailer_name: string;
  retailer_email: string;
  items: SupplierOrderItem[];
  supplier_total: number;
};

const NOTICE_KEY = "soukcart:supplier-notice";
const PRODUCT_IMAGES_BUCKET = "product-images";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function renderSupplierApp(root: HTMLDivElement): void {
  let currentUserId = "";
  let currentUserName = "";
  let currentUserEmail = "";
  let products: Product[] = [];
  let orders: SupplierOrder[] = [];
  let orderSearch = "";
  let searchTerm = "";
  let notice: Notice | null = null;

  const path = window.location.pathname;
  const newMatch = path === "/supplier/products/new";
  const editMatch = path.match(/^\/supplier\/products\/([0-9a-f-]{36})\/edit$/);
  const formProductId = editMatch ? editMatch[1] : null;
  const isFormPage = newMatch || Boolean(editMatch);
  const isProductsPage = !isFormPage && path.endsWith("/products");
  const isCatalogArea = isFormPage || isProductsPage;
  const isStockPage = path.endsWith("/stock");
  const isOrdersPage = path.endsWith("/orders");

  let currentImageUrl: string | null = null;
  let originalImageUrl: string | null = null;
  let previewObjectUrl: string | null = null;

  const render = (html: string) => {
    root.innerHTML = html;
  };

  const readNotice = (): void => {
    const message = sessionStorage.getItem(NOTICE_KEY);
    if (message) {
      notice = { message, state: "success" };
      sessionStorage.removeItem(NOTICE_KEY);
    }
  };

  const renderSidebar = () => `
    <aside class="admin-sidebar">
      <div class="admin-sidebar-top">
        ${renderBrand("dark")}
      </div>
      <nav class="admin-nav" aria-label="Supplier navigation">
        <a class="admin-tab${isCatalogArea || isStockPage || isOrdersPage ? "" : " is-active"}" href="/supplier">
          ${renderIcon("home")}
          <span>Overview</span>
        </a>
        <a class="admin-tab${isOrdersPage ? " is-active" : ""}" href="/supplier/orders">
          ${renderIcon("package")}
          <span>Orders</span>
        </a>
        <a class="admin-tab${isCatalogArea ? " is-active" : ""}" href="/supplier/products">
          ${renderIcon("bag")}
          <span>My products</span>
        </a>
        <a class="admin-tab${isStockPage ? " is-active" : ""}" href="/supplier/stock">
          ${renderIcon("layers")}
          <span>Stock</span>
        </a>
      </nav>
      <div class="admin-sidebar-footer">
        <div class="admin-user">
          <span class="admin-user-info">
            <strong>${escapeHtml(currentUserName || "Supplier")}</strong>
            <small>${escapeHtml(currentUserEmail)}</small>
          </span>
        </div>
        <button class="button button-secondary button-block" type="button" data-logout>
          <span>Log out</span>
        </button>
      </div>
    </aside>`;

  const renderNotice = () =>
    `<p class="admin-notice${notice ? ` is-visible is-${notice.state}` : ""}" data-admin-notice role="status">${notice ? escapeHtml(notice.message) : ""}</p>`;

  const renderOverview = () => {
    const activeCount = products.filter((product) => product.is_active).length;
    const outOfStock = products.filter((product) => product.stock <= 0).length;
    const unitsInStock = products.reduce((sum, product) => sum + product.stock, 0);
    const recent = products.slice(0, 4);

    render(`<div class="admin-layout">
      ${renderSidebar()}
      <main class="admin-main">
        <header class="admin-header">
          <div>
            <p class="eyebrow">Supplier workspace</p>
            <h1 class="display-xl">Good to see you, ${escapeHtml(getFirstName(currentUserName))}.</h1>
            <p>Keep your catalog fresh so retailers always see what you can deliver.</p>
          </div>
          <div class="admin-header-actions">
            <a class="button button-primary" href="/supplier/products/new">${renderIcon("plus")}<span>Add product</span></a>
            <a class="button button-subtle" href="/supplier/stock">${renderIcon("layers")}<span>Manage stock</span></a>
          </div>
        </header>

        ${renderNotice()}

        <section class="admin-stats" aria-label="Catalog summary">
          ${renderStat("total", "Total products", "Everything you list")}
          ${renderStat("active", "Active listings", "Visible to retailers")}
          ${renderStat("out", "Out of stock", "Needs restocking")}
          ${renderStat("units", "Units in stock", "Across all products")}
        </section>

        <section class="rt-section" aria-labelledby="recent-heading">
          <div class="rt-section-heading">
            <div>
              <p class="eyebrow">Latest activity</p>
              <h2 id="recent-heading" class="display-sm">Recent listings</h2>
            </div>
            <a class="text-button" href="/supplier/products">View all</a>
          </div>
          ${recent.length ? renderProductList(recent) : renderEmpty("No products yet", "Add your first product and retailers will see it in the catalog.", "/supplier/products/new", "Add product")}
        </section>
      </main>
    </div>`);

    setStat("total", String(products.length));
    setStat("active", String(activeCount));
    setStat("out", String(outOfStock));
    setStat("units", String(unitsInStock));
  };

  const renderProductList = (rows: Product[]): string => `
    <div class="rt-order-list">
      ${rows
        .map(
          (product) => `
        <a class="rt-order-card" href="/supplier/products/${product.id}/edit">
          <span class="rt-order-art sp-list-art">${renderProductThumb(product)}</span>
          <span class="rt-order-card-body">
            <strong class="rt-order-id">${escapeHtml(product.name)}</strong>
            <small>${formatPrice(product.price)} per ${escapeHtml(product.unit)} · ${formatDate(product.created_at)}</small>
          </span>
          <span class="rt-order-card-end">
            <strong>${product.stock} in stock</strong>
            ${renderStockChip(product)}
          </span>
        </a>`,
        )
        .join("")}
    </div>`;

  const renderProducts = () => {
    render(`<div class="admin-layout">
      ${renderSidebar()}
      <main class="admin-main">
        <header class="admin-header">
          <div>
            <p class="eyebrow">Product catalog</p>
            <h1 class="display-xl">My products.</h1>
            <p>Add products, set your prices, and control what retailers can order.</p>
          </div>
          <div class="admin-header-actions">
            <a class="button button-primary" href="/supplier/products/new">
              ${renderIcon("plus")}
              <span>New product</span>
            </a>
          </div>
        </header>

        ${renderNotice()}

        <div class="admin-toolbar">
          <label class="admin-search">
            ${renderIcon("search")}
            <span class="sr-only">Search products</span>
            <input type="search" data-product-search placeholder="Search products" value="${escapeHtml(searchTerm)}" />
          </label>
          <span class="admin-result-count" data-result-count>${getFilteredProducts().length} of ${products.length} products</span>
        </div>

        <div data-products-grid>${renderProductsGrid()}</div>
      </main>
    </div>`);
  };

  const renderProductsGrid = (): string => {
    const filtered = getFilteredProducts();
    if (!filtered.length) {
      return products.length
        ? `<div class="rt-empty-card">
            <span class="rt-empty-icon">${renderIcon("search")}</span>
            <strong>No matching products</strong>
            <span>Try a different search term.</span>
          </div>`
        : `<div class="rt-empty-card">
            <span class="rt-empty-icon">${renderIcon("bag")}</span>
            <strong>No products yet</strong>
            <span>Add your first product and retailers will see it in the catalog.</span>
            <a class="button button-primary" href="/supplier/products/new"><span>Add product</span></a>
          </div>`;
    }

    return `<div class="rt-catalog-grid">
      ${filtered.map((product) => renderProductCard(product)).join("")}
    </div>`;
  };

  const renderProductCard = (product: Product): string => `
    <article class="rt-product-card${product.is_active ? "" : " is-hidden"}">
      <div class="rt-product-art">${renderProductThumb(product)}</div>
      <div class="rt-product-body">
        <div class="rt-product-title-row">
          <h3 class="rt-product-name">${escapeHtml(product.name)}</h3>
          <span class="rt-product-price">${formatPrice(product.price)}</span>
        </div>
        <p class="rt-product-desc">${escapeHtml(product.description || "No description yet.")}</p>
        <p class="rt-product-stock${product.stock <= 0 ? " is-out" : ""}">${product.stock <= 0 ? "Out of stock" : `${product.stock} in stock`} · per ${escapeHtml(product.unit)}</p>
        <div class="sp-product-meta">
          ${renderStockChip(product)}
          <small>Added ${formatDate(product.created_at)}</small>
        </div>
        <div class="sp-product-actions">
          <a class="sp-card-action" href="/supplier/products/${product.id}/edit">Edit</a>
          <button class="sp-card-action" type="button" data-toggle-active="${product.id}" ${product.stock <= 0 ? "disabled" : ""}>${product.is_active ? "Hide" : "Show"}</button>
          <button class="sp-card-action is-danger" type="button" data-delete-product="${product.id}" data-product-name="${escapeHtml(product.name)}">Delete</button>
        </div>
      </div>
    </article>`;

  const renderStock = () => {
    const active = products.filter((product) => product.is_active);
    const outOfStock = products.filter((product) => product.is_active && product.stock <= 0).length;

    render(`<div class="admin-layout">
      ${renderSidebar()}
      <main class="admin-main">
        <header class="admin-header">
          <div>
            <p class="eyebrow">Stock availability</p>
            <h1 class="display-xl">Manage stock.</h1>
            <p>Set how many units of each product retailers may order. Changes apply immediately.</p>
          </div>
          <div class="admin-header-actions">
            <a class="button button-subtle" href="/supplier/products">${renderIcon("bag")}<span>My products</span></a>
          </div>
        </header>

        ${renderNotice()}

        <div class="admin-toolbar">
          <label class="admin-search">
            ${renderIcon("search")}
            <span class="sr-only">Search products</span>
            <input type="search" data-product-search placeholder="Search products" value="${escapeHtml(searchTerm)}" />
          </label>
          <span class="admin-result-count" data-result-count>${getFilteredProducts().length} of ${products.length} products</span>
        </div>

        ${
          active.length
            ? `<div data-products-grid>${renderStockTable()}</div>
              <p class="sp-stock-hint">Only active listings are shown. ${outOfStock ? `${outOfStock} active product${outOfStock === 1 ? "" : "s"} is out of stock.` : "All active products have stock available."}</p>`
            : renderEmpty(
                "No active products",
                "Activate a listing from My products and its stock will appear here.",
                "/supplier/products",
                "My products",
              )
        }
      </main>
    </div>`);
  };

  const renderStockTable = (): string => {
    const rows = getFilteredProducts().filter((product) => product.is_active);
    if (!rows.length) {
      return `<div class="rt-empty-card">
        <span class="rt-empty-icon">${renderIcon("search")}</span>
        <strong>No matching products</strong>
        <span>Try a different search term.</span>
      </div>`;
    }

    return `<div class="admin-table-wrap">
      <table class="admin-table sp-stock-table">
        <thead><tr><th>Product</th><th>Unit</th><th>Available now</th><th>New stock</th><th><span class="sr-only">Save</span></th></tr></thead>
        <tbody>
          ${rows
            .map(
              (product) => `
            <tr data-stock-row="${product.id}">
              <td>
                <strong class="sp-stock-name">${escapeHtml(product.name)}</strong>
                <span class="sp-stock-chip${product.stock <= 0 ? " is-out" : ""}">${product.stock <= 0 ? "Out of stock" : "In stock"}</span>
              </td>
              <td>${escapeHtml(product.unit)}</td>
              <td><strong data-stock-now="${product.id}">${product.stock}</strong></td>
              <td>
                <label class="sp-stock-field">
                  <span class="sr-only">New stock for ${escapeHtml(product.name)}</span>
                  <input type="number" min="0" step="1" inputmode="numeric" data-stock-input="${product.id}" value="${product.stock}" />
                </label>
              </td>
              <td class="sp-stock-save">
                <button class="button button-primary" type="button" data-save-stock="${product.id}"><span>Save</span></button>
              </td>
            </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
  };

  const renderEmpty = (title: string, copy: string, href: string, label: string): string => `
    <div class="rt-empty-card">
      <span class="rt-empty-icon">${renderIcon("store")}</span>
      <strong>${title}</strong>
      <span>${copy}</span>
      <a class="button button-primary" href="${href}"><span>${label}</span></a>
    </div>`;

  const renderImagePicker = (): string => `
    <div class="sp-image-picker admin-field">
      <span>Product image</span>
      <label class="sp-image-drop"${currentImageUrl ? " hidden" : ""} data-image-drop>
        ${renderIcon("image")}
        <strong>Add a product image</strong>
        <small>PNG or JPG, up to 5 MB</small>
        <input class="sr-only" type="file" name="image" accept="image/png,image/jpeg,image/webp" data-product-image />
      </label>
      <div class="sp-image-preview-wrap"${currentImageUrl ? "" : " hidden"} data-image-preview-wrap>
        <img class="sp-image-preview" data-image-preview-src src="${currentImageUrl ? escapeHtml(currentImageUrl) : ""}" alt="Product image preview" />
        <button class="button button-subtle" type="button" data-remove-image><span>Choose a different image</span></button>
      </div>
    </div>`;

  const renderProductForm = () => {
    const editing = formProductId ? products.find((product) => product.id === formProductId) : null;

    if (formProductId && !editing) {
      window.location.assign("/supplier/products");
      return;
    }

    currentImageUrl = editing?.image_url ?? null;
    originalImageUrl = editing?.image_url ?? null;

    render(`<div class="admin-layout">
      ${renderSidebar()}
      <main class="admin-main">
        <p class="sp-back-row"><a class="text-button" href="/supplier/products">Back to my products</a></p>

        <header class="admin-header">
          <div>
            <p class="eyebrow">${editing ? "Edit listing" : "New listing"}</p>
            <h1 class="display-xl">${editing ? "Edit product." : "Add a product."}</h1>
            <p>${editing ? "Update the details or swap the photo — retailers see the changes right away." : "Give retailers what they need: a clear name, a fair price, and a photo."}</p>
          </div>
        </header>

        ${renderNotice()}

        <form class="sp-form-card" data-product-form>
          <div class="sp-form-grid">
            <label class="admin-field sp-field-full">
              <span>Product name</span>
              <input name="name" type="text" maxlength="120" placeholder="e.g. Miniket rice, 50 kg sack" value="${editing ? escapeHtml(editing.name) : ""}" required />
            </label>
            <label class="admin-field sp-field-full">
              <span>Description</span>
              <textarea name="description" rows="3" maxlength="500" placeholder="Short detail retailers will see">${editing ? escapeHtml(editing.description) : ""}</textarea>
            </label>
            <label class="admin-field">
              <span>Price (৳)</span>
              <input name="price" type="number" min="0" step="0.01" placeholder="0.00" value="${editing ? String(editing.price) : ""}" required />
            </label>
            <label class="admin-field">
              <span>Unit</span>
              <input name="unit" type="text" maxlength="24" placeholder="kg, crate, piece…" value="${editing ? escapeHtml(editing.unit) : "piece"}" required />
            </label>
            <label class="admin-field">
              <span>Category</span>
              <select name="category" class="sp-category-select">
                <option value="">Choose a category</option>
                ${PRODUCT_CATEGORIES.map(
                  (category) =>
                    `<option value="${escapeHtml(category)}"${editing?.category === category ? " selected" : ""}>${escapeHtml(category)}</option>`,
                ).join("")}
              </select>
            </label>
            <label class="admin-field">
              <span>Stock</span>
              <input name="stock" type="number" min="0" step="1" value="${editing ? String(editing.stock) : "0"}" required />
            </label>
            ${renderImagePicker()}
          </div>
          <div class="sp-form-actions">
            <a class="button button-secondary" href="/supplier/products">Cancel</a>
            <button class="button button-primary" type="submit"><span>${editing ? "Save changes" : "Create product"}</span></button>
          </div>
          <p class="admin-form-feedback" data-product-feedback role="status" aria-live="polite"></p>
        </form>
      </main>
    </div>`);
  };

  const renderOrderRows = (): void => {
    const tableBody = root.querySelector<HTMLTableSectionElement>("[data-supplier-orders-body]");
    if (!tableBody) {
      return;
    }

    const filtered = getFilteredOrders();
    tableBody.innerHTML = filtered.length
      ? filtered.map((order) => renderSupplierOrderRow(order)).join("")
      : `<tr><td class="admin-empty" colspan="8">
          <strong>No matching orders</strong>
          <span>Try a different order number, retailer, or product.</span>
        </td></tr>`;

    const resultCount = root.querySelector<HTMLElement>("[data-order-count]");
    if (resultCount) {
      resultCount.textContent = `${filtered.length} of ${orders.length} orders`;
    }
  };

  const renderSupplierOrderRow = (order: SupplierOrder): string => `
    <tr class="rt-order-row" data-supplier-order-toggle="${order.id}" aria-expanded="false">
      <td><strong class="rt-order-id">#${shortId(order.id)}</strong></td>
      <td>${formatDate(order.created_at)}</td>
      <td><div class="admin-user-cell"><span class="admin-avatar">${escapeHtml(getInitials(order.retailer_name))}</span><span><strong>${escapeHtml(order.retailer_name)}</strong><small>${escapeHtml(order.retailer_email)}</small></span></div></td>
      <td>${order.items.reduce((sum, item) => sum + item.quantity, 0)}</td>
      <td><strong>${formatPrice(order.supplier_total)}</strong></td>
      <td>${supplierPaymentBadge(order)}</td>
      <td><span class="rt-status rt-status-${order.status}">${statusLabel(order.status)}</span>${order.cancel_requested ? '<span class="rt-cancel-flag">Cancel requested</span>' : ""}</td>
      <td class="rt-order-toggle">${renderIcon("plus")}</td>
    </tr>
    <tr class="rt-order-detail" data-supplier-order-detail="${order.id}" hidden>
      <td colspan="8">
        <div class="rt-order-detail-body">
          ${order.items
            .map(
              (item) => `
            <div class="ad-activity-line">
              <span class="ad-activity-product"><strong>${escapeHtml(item.product_name)}</strong></span>
              <span>${item.quantity} × ${formatPrice(item.unit_price)}</span>
              <strong>${formatPrice(item.line_total)}</strong>
            </div>`,
            )
            .join("")}
          ${order.notes ? `<p class="rt-order-notes"><strong>Notes:</strong> ${escapeHtml(order.notes)}</p>` : ""}
          <div class="rt-order-detail-actions">${supplierOrderActions(order)}</div>
        </div>
      </td>
    </tr>`;

  const supplierOrderActions = (order: SupplierOrder): string => {
    if (order.cancel_requested && order.status === "confirmed") {
      return '<span class="admin-muted">The retailer asked to cancel. The admin team will resolve it.</span>';
    }
    if (order.status === "pending") {
      return `<button class="text-button" type="button" data-supplier-order-status="${order.id}" data-next-status="confirmed">${renderIcon("check")}<span>Confirm order</span></button>`;
    }
    if (order.status === "confirmed") {
      return `<button class="text-button" type="button" data-supplier-order-status="${order.id}" data-next-status="shipped">${renderIcon("truck")}<span>Mark shipped</span></button>`;
    }
    if (order.status === "shipped") {
      return '<span class="admin-muted">Shipped · waiting for delivery to be confirmed.</span>';
    }
    return "";
  };

  const renderOrders = () => {
    render(`<div class="admin-layout">
      ${renderSidebar()}
      <main class="admin-main">
        <header class="admin-header">
          <div>
            <p class="eyebrow">Order fulfillment</p>
            <h1 class="display-xl">Orders.</h1>
            <p>Confirm incoming orders and mark them shipped once dispatched.</p>
          </div>
          <div class="admin-header-actions">
            <a class="button button-subtle" href="/supplier/stock">${renderIcon("layers")}<span>Manage stock</span></a>
          </div>
        </header>

        ${renderNotice()}

        <div class="admin-toolbar">
          <label class="admin-search">
            ${renderIcon("search")}
            <span class="sr-only">Search orders</span>
            <input type="search" data-order-search placeholder="Search orders" value="${escapeHtml(orderSearch)}" />
          </label>
          <span class="admin-result-count" data-order-count>${orders.length} of ${orders.length} orders</span>
        </div>

        ${
          orders.length
            ? `<div class="admin-table-wrap">
          <table class="admin-table rt-orders-table">
            <thead><tr><th>Order</th><th>Placed</th><th>Retailer</th><th>Units</th><th>Total</th><th>Payment</th><th>Status</th><th><span class="sr-only">Order lines</span></th></tr></thead>
            <tbody data-supplier-orders-body>${orders.map((order) => renderSupplierOrderRow(order)).join("")}</tbody>
          </table>
        </div>`
            : `<div class="rt-empty-card">
        <span class="rt-empty-icon">${renderIcon("package")}</span>
        <strong>No orders yet</strong>
        <span>Orders that include your products will show up here.</span>
      </div>`
        }
      </main>
    </div>`);
  };

  const getFilteredOrders = (): SupplierOrder[] => {
    const query = orderSearch.trim().toLowerCase();
    if (!query) {
      return orders;
    }
    return orders.filter((order) =>
      [
        shortId(order.id),
        order.retailer_name,
        order.retailer_email,
        order.items.map((item) => item.product_name).join(" "),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  };

  const renderPanel = () => {
    if (isFormPage) {
      renderProductForm();
    } else if (isStockPage) {
      renderStock();
    } else if (isProductsPage) {
      renderProducts();
    } else if (isOrdersPage) {
      renderOrders();
    } else {
      renderOverview();
    }
  };

  const loadDashboard = async () => {
    if (isOrdersPage) {
      const { data: orderData, error: orderError } = await supabase.rpc("supplier_orders");
      if (orderError) {
        throw new Error(orderError.message);
      }
      orders = ((Array.isArray(orderData) ? orderData : []) as SupplierOrder[]).map((row) => ({
        ...row,
        status: row.status as SupplierOrderStatus,
        cancel_requested: row.cancel_requested === true,
        supplier_total: Number(row.supplier_total),
        items: (row.items ?? []).map((item: SupplierOrderItem) => ({
          ...item,
          unit_price: Number(item.unit_price),
          line_total: Number(item.line_total),
        })),
      }));
      renderPanel();
      return;
    }

    const { data, error } = await supabase
      .from("products")
      .select(
        "id, name, description, price, unit, stock, category, image_url, is_active, created_at",
      )
      .eq("seller_id", currentUserId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    products = (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      price: Number(row.price),
      unit: row.unit,
      stock: row.stock,
      category: row.category ?? null,
      image_url: row.image_url,
      is_active: row.is_active,
      created_at: row.created_at,
    }));

    renderPanel();
  };

  const renderError = (message: string) => {
    render(`<div class="admin-error-screen">
      <p class="eyebrow">Supplier workspace</p>
      <h1 class="display-lg">We could not load your catalog.</h1>
      <p>${escapeHtml(message)}</p>
      <div class="admin-error-actions">
        <button class="button button-primary" type="button" data-refresh><span>Try again</span></button>
        <button class="button button-subtle" type="button" data-logout>Log out</button>
      </div>
    </div>`);
  };

  const boot = async () => {
    readNotice();
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      window.location.assign("/");
      return;
    }

    currentUserId = data.session.user.id;
    const { data: profile, error: profileError } = await supabase
      .from("users")
      .select("name, email, role")
      .eq("id", currentUserId)
      .single();

    if (profileError || !profile) {
      await supabase.auth.signOut();
      window.location.assign("/");
      return;
    }
    if (profile.role === "admin") {
      window.location.assign("/admin");
      return;
    }
    if (profile.role === "retailer") {
      window.location.assign("/retailer");
      return;
    }
    if (profile.role !== "seller") {
      window.location.assign("/");
      return;
    }

    currentUserName = profile.name || profile.email;
    currentUserEmail = profile.email;

    try {
      await loadDashboard();
    } catch (error) {
      renderError(error instanceof Error ? error.message : "Please try again.");
    }
  };

  const setPreviewImage = (url: string | null, revokePrevious = true): void => {
    if (revokePrevious && previewObjectUrl) {
      URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = null;
    }

    const drop = root.querySelector<HTMLElement>("[data-image-drop]");
    const wrap = root.querySelector<HTMLElement>("[data-image-preview-wrap]");
    const img = root.querySelector<HTMLImageElement>("[data-image-preview-src]");

    if (!drop || !wrap || !img) {
      return;
    }

    if (url) {
      img.src = url;
      drop.hidden = true;
      wrap.hidden = false;
    } else {
      img.removeAttribute("src");
      drop.hidden = false;
      wrap.hidden = true;
    }
  };

  const submitProduct = async (form: HTMLFormElement): Promise<void> => {
    if (!form.reportValidity()) {
      return;
    }

    const formData = new FormData(form);
    const name = readFormText(formData, "name").trim();
    const payload = {
      name,
      description: readFormText(formData, "description").trim(),
      price: Number(readFormText(formData, "price")),
      unit: readFormText(formData, "unit").trim() || "piece",
      stock: Math.max(0, Math.floor(Number(readFormText(formData, "stock")))),
      category: readFormText(formData, "category").trim() || null,
    };

    const fileInput = form.elements.namedItem("image");
    const file =
      fileInput instanceof HTMLInputElement && fileInput.files?.[0] ? fileInput.files[0] : null;

    if (file) {
      if (!file.type.startsWith("image/")) {
        setFeedback(form, "Please choose an image file (PNG or JPG).", "error");
        return;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setFeedback(form, "The image is too large. Please pick one under 5 MB.", "error");
        return;
      }
    }

    const submitButton = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    submitButton?.setAttribute("disabled", "true");

    try {
      let imageUrl = currentImageUrl;

      if (file) {
        setFeedback(form, "Uploading image…", "info");
        const extension = file.type.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
        const objectPath = `${currentUserId}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from(PRODUCT_IMAGES_BUCKET)
          .upload(objectPath, file, { contentType: file.type, cacheControl: "3600" });
        if (uploadError) {
          throw new Error(`The image could not be uploaded. ${uploadError.message}`);
        }
        imageUrl = supabase.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(objectPath)
          .data.publicUrl;
      }

      if (formProductId) {
        const { error } = await supabase
          .from("products")
          .update({ ...payload, image_url: imageUrl })
          .eq("id", formProductId)
          .eq("seller_id", currentUserId);
        if (error) {
          throw new Error(error.message);
        }
        notice = { message: `${payload.name} was updated.`, state: "success" };
      } else {
        const { error } = await supabase.from("products").insert({
          ...payload,
          seller_id: currentUserId,
          image_url: imageUrl,
          is_active: true,
        });
        if (error) {
          throw new Error(error.message);
        }
        notice = { message: `${payload.name} was added to your catalog.`, state: "success" };
      }

      if (originalImageUrl && originalImageUrl !== imageUrl) {
        void removeStoredImage(originalImageUrl);
      }

      sessionStorage.setItem(NOTICE_KEY, notice.message);
      window.location.assign("/supplier/products");
    } catch (error) {
      setFeedback(
        form,
        error instanceof Error ? error.message : "The product could not be saved.",
        "error",
      );
      submitButton?.removeAttribute("disabled");
    }
  };

  const toggleActive = async (productId: string): Promise<void> => {
    const product = products.find((item) => item.id === productId);
    if (!product) {
      return;
    }

    const nextActive = !product.is_active;
    const { error } = await supabase
      .from("products")
      .update({ is_active: nextActive })
      .eq("id", productId)
      .eq("seller_id", currentUserId);

    if (error) {
      setNotice(error.message, "error");
      return;
    }

    product.is_active = nextActive;
    refreshGrid();
    setNotice(
      `${product.name} is now ${nextActive ? "visible to retailers" : "hidden"}.`,
      "success",
    );
  };

  const deleteProduct = async (
    productId: string,
    productName: string,
    button: HTMLButtonElement,
  ): Promise<void> => {
    if (!window.confirm(`Delete ${productName}? This cannot be undone.`)) {
      return;
    }

    button.disabled = true;
    const { error } = await supabase
      .from("products")
      .delete()
      .eq("id", productId)
      .eq("seller_id", currentUserId);

    if (error) {
      button.disabled = false;
      setNotice(error.message, "error");
      return;
    }

    const removed = products.find((item) => item.id === productId);
    products = products.filter((item) => item.id !== productId);
    refreshGrid();
    if (removed?.image_url) {
      void removeStoredImage(removed.image_url);
    }
    setNotice(`${productName} was deleted.`, "success");
  };

  const saveStock = async (productId: string, button: HTMLButtonElement): Promise<void> => {
    const product = products.find((item) => item.id === productId);
    if (!product) {
      return;
    }
    const input = root.querySelector<HTMLInputElement>(`[data-stock-input="${productId}"]`);
    const raw = input?.value.trim() ?? "";
    const next = Number(raw);
    if (!raw || !Number.isInteger(next) || next < 0) {
      setNotice("Stock must be a whole number of 0 or more.", "error");
      return;
    }

    button.disabled = true;
    const { error } = await supabase
      .from("products")
      .update({ stock: next })
      .eq("id", productId)
      .eq("seller_id", currentUserId);
    if (error) {
      button.disabled = false;
      setNotice(error.message, "error");
      return;
    }

    product.stock = next;
    refreshGrid();
    setNotice(`${product.name} now has ${next} unit${next === 1 ? "" : "s"} in stock.`, "success");
  };

  const removeStoredImage = async (url: string): Promise<void> => {
    const objectPath = extractObjectPath(url);
    if (!objectPath) {
      return;
    }
    try {
      await supabase.storage.from(PRODUCT_IMAGES_BUCKET).remove([objectPath]);
    } catch {
      // Best-effort cleanup; an orphaned image does not affect the listing.
    }
  };

  const refreshGrid = (): void => {
    const grid = root.querySelector<HTMLElement>("[data-products-grid]");
    const count = root.querySelector<HTMLElement>("[data-result-count]");
    if (grid) {
      grid.innerHTML = isStockPage ? renderStockTable() : renderProductsGrid();
    }
    if (count) {
      count.textContent = `${getFilteredProducts().length} of ${products.length} products`;
    }
  };

  const getFilteredProducts = (): Product[] => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) {
      return products;
    }
    return products.filter((product) =>
      [product.name, product.description, product.unit, product.category ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  };

  const setNotice = (message: string, state: Notice["state"]): void => {
    const element = root.querySelector<HTMLElement>("[data-admin-notice]");
    if (!element) {
      notice = { message, state };
      return;
    }
    element.className = `admin-notice is-visible is-${state}`;
    element.textContent = message;
  };

  root.addEventListener("click", async (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const logout = event.target.closest<HTMLButtonElement>("[data-logout]");
    if (logout) {
      await supabase.auth.signOut();
      window.location.assign("/");
      return;
    }

    const refresh = event.target.closest<HTMLButtonElement>("[data-refresh]");
    if (refresh) {
      refresh.disabled = true;
      try {
        await loadDashboard();
      } catch (error) {
        renderError(error instanceof Error ? error.message : "Please try again.");
      }
      return;
    }

    const removeImageButton = event.target.closest<HTMLButtonElement>("[data-remove-image]");
    if (removeImageButton) {
      const input = root.querySelector<HTMLInputElement>('input[name="image"]');
      if (input) {
        input.value = "";
      }
      currentImageUrl = null;
      setPreviewImage(null);
      return;
    }

    const activeToggle = event.target.closest<HTMLButtonElement>("[data-toggle-active]");
    if (activeToggle && !activeToggle.disabled) {
      const productId = activeToggle.dataset.toggleActive;
      if (productId) {
        await toggleActive(productId);
      }
      return;
    }

    const deleteButton = event.target.closest<HTMLButtonElement>("[data-delete-product]");
    if (deleteButton) {
      const productId = deleteButton.dataset.deleteProduct;
      const productName = deleteButton.dataset.productName || "this product";
      if (productId) {
        await deleteProduct(productId, productName, deleteButton);
      }
      return;
    }

    const saveStockButton = event.target.closest<HTMLButtonElement>("[data-save-stock]");
    if (saveStockButton) {
      const productId = saveStockButton.dataset.saveStock;
      if (productId) {
        await saveStock(productId, saveStockButton);
      }
      return;
    }

    const orderRow = event.target.closest<HTMLTableRowElement>("[data-supplier-order-toggle]");
    if (orderRow) {
      const orderId = orderRow.dataset.supplierOrderToggle;
      const detail = orderId
        ? root.querySelector<HTMLTableRowElement>(`[data-supplier-order-detail="${orderId}"]`)
        : null;
      if (orderId && detail) {
        const expanded = detail.hidden;
        detail.hidden = !expanded;
        orderRow.setAttribute("aria-expanded", String(expanded));
        const toggleCell = orderRow.querySelector<HTMLElement>(".rt-order-toggle");
        if (toggleCell) {
          toggleCell.innerHTML = renderIcon(expanded ? "minus" : "plus");
        }
      }
      return;
    }

    const orderStatusButton = event.target.closest<HTMLButtonElement>(
      "[data-supplier-order-status]",
    );
    if (orderStatusButton) {
      const orderId = orderStatusButton.dataset.supplierOrderStatus;
      const nextStatus = orderStatusButton.dataset.nextStatus;
      const order = orders.find((item) => item.id === orderId);
      if (order && orderId && (nextStatus === "confirmed" || nextStatus === "shipped")) {
        const confirmed = window.confirm(
          nextStatus === "confirmed"
            ? `Confirm order #${shortId(order.id)} for ${order.retailer_name}? They will see it as confirmed.`
            : `Mark order #${shortId(order.id)} as shipped for ${order.retailer_name}?`,
        );
        if (!confirmed) {
          return;
        }
        orderStatusButton.disabled = true;
        const { data, error } = await supabase.rpc("seller_set_order_status", {
          p_order_id: orderId,
          p_status: nextStatus,
        });
        if (error) {
          orderStatusButton.disabled = false;
          setNotice(
            error instanceof Error ? error.message : "The order could not be updated.",
            "error",
          );
          return;
        }
        order.status = (typeof data === "string" ? data : nextStatus) as SupplierOrderStatus;
        renderOrders();
        setNotice(
          nextStatus === "confirmed"
            ? `Order #${shortId(order.id)} is confirmed.`
            : `Order #${shortId(order.id)} is marked shipped.`,
          "success",
        );
      }
      return;
    }
  });

  root.addEventListener("change", (event) => {
    if (
      !(event.target instanceof HTMLInputElement) ||
      !event.target.matches("[data-product-image]")
    ) {
      return;
    }

    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/") || file.size > MAX_IMAGE_BYTES) {
      event.target.value = "";
      setFeedback(
        root.querySelector<HTMLFormElement>("[data-product-form]"),
        "Please pick a PNG or JPG image under 5 MB.",
        "error",
      );
      return;
    }

    previewObjectUrl = URL.createObjectURL(file);
    setPreviewImage(previewObjectUrl);
  });

  root.addEventListener("input", (event) => {
    if (!(event.target instanceof HTMLInputElement)) {
      return;
    }
    if (event.target.matches("[data-order-search]")) {
      orderSearch = event.target.value;
      renderOrderRows();
      return;
    }
    if (event.target.matches("[data-product-search]")) {
      searchTerm = event.target.value;
      refreshGrid();
    }
  });

  root.addEventListener("keydown", (event) => {
    if (!(event.target instanceof HTMLInputElement) || event.key !== "Enter") {
      return;
    }
    const stockInput = event.target.closest<HTMLInputElement>("[data-stock-input]");
    if (!stockInput) {
      return;
    }
    event.preventDefault();
    const saveButton = stockInput
      .closest("tr")
      ?.querySelector<HTMLButtonElement>("[data-save-stock]");
    saveButton?.click();
  });

  root.addEventListener("submit", async (event) => {
    if (
      !(event.target instanceof HTMLFormElement) ||
      !event.target.matches("[data-product-form]")
    ) {
      return;
    }
    event.preventDefault();
    await submitProduct(event.target);
  });

  void boot();
}

function renderProductThumb(product: Product): string {
  return product.image_url
    ? `<img src="${escapeHtml(product.image_url)}" alt="" loading="lazy" />`
    : renderIcon("bag");
}

function renderStat(key: string, label: string, detail: string): string {
  return `<article class="admin-stat">
    <p class="admin-stat-label">${label}</p>
    <strong data-stat="${key}">0</strong>
    <small>${detail}</small>
  </article>`;
}

function setStat(key: string, value: string): void {
  const element = document.querySelector<HTMLElement>(`[data-stat="${key}"]`);
  if (element) {
    element.textContent = value;
  }
}

function renderStockChip(product: Product): string {
  if (!product.is_active) {
    return '<span class="sp-chip is-hidden">Hidden</span>';
  }
  if (product.stock <= 0) {
    return '<span class="sp-chip is-out">Out of stock</span>';
  }
  return '<span class="sp-chip is-active">Active</span>';
}

function supplierPaymentBadge(order: SupplierOrder): string {
  if (order.payment_status === "paid") {
    return '<span class="rt-pay-badge">Paid</span>';
  }
  if (order.payment_method === "cod") {
    return '<span class="rt-pay-badge is-cod">COD</span>';
  }
  return "";
}

function statusLabel(status: SupplierOrderStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "confirmed":
      return "Confirmed";
    case "shipped":
      return "Shipped";
    case "delivered":
      return "Delivered";
    case "cancelled":
      return "Cancelled";
  }
}

function shortId(value: string): string {
  return value.replaceAll("-", "").slice(0, 8).toUpperCase();
}

function getInitials(value: string): string {
  const initials = value
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return initials || "U";
}

function setFeedback(form: HTMLFormElement | null, message: string, state = "info"): void {
  const feedback = form?.querySelector<HTMLElement>("[data-product-feedback]");
  if (!feedback) {
    return;
  }
  feedback.className = `admin-form-feedback${message ? ` is-visible is-${state}` : ""}`;
  feedback.textContent = message;
}

function extractObjectPath(url: string): string | null {
  const marker = `/object/public/${PRODUCT_IMAGES_BUCKET}/`;
  const index = url.indexOf(marker);
  return index === -1 ? null : decodeURIComponent(url.slice(index + marker.length).split("?")[0]);
}

function readFormText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function formatPrice(value: number): string {
  return `৳${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getFirstName(value: string): string {
  return value.trim().split(/\s+/)[0] ?? "there";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
