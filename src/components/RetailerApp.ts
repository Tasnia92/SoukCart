import { supabase } from "../supabase.ts";
import { renderBrand } from "./Brand.ts";
import { renderIcon, type IconName } from "./Icon.ts";

type Product = {
  id: string;
  name: string;
  description: string;
  price: number;
  unit: string;
  stock: number;
  category: string | null;
  image_url: string | null;
  seller_name: string | null;
};

type OrderStatus = "pending" | "confirmed" | "shipped" | "delivered" | "cancelled";

type PaymentStatus = "unpaid" | "paid" | "failed" | "cancelled";

type PaymentMethod = "online" | "cod";

type OrderItem = {
  id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  product_name: string;
};

type Order = {
  id: string;
  status: OrderStatus;
  cancel_requested: boolean;
  payment_status: PaymentStatus;
  payment_method: PaymentMethod;
  tran_id: string | null;
  notes: string | null;
  created_at: string;
  items: OrderItem[];
};

type InvoiceOrder = Order & {
  paid_at: string | null;
  tran_id: string | null;
  val_id: string | null;
  bank_tran_id: string | null;
};

type ComplaintStatus = "open" | "resolved";

type Complaint = {
  id: string;
  subject: string;
  description: string;
  attachment_url: string | null;
  status: ComplaintStatus;
  created_at: string;
};

const NOTICE_KEY = "soukcart:notice";
const COMPLAINT_FILES_BUCKET = "complaint-files";
const MAX_COMPLAINT_FILE_BYTES = 5 * 1024 * 1024;

function cancelAction(order: Order): string {
  if (order.status === "pending") {
    return `<button class="text-button rt-cancel-button" type="button" data-cancel-order="${order.id}">${renderIcon("trash")}<span>Cancel order</span></button>`;
  }
  if (order.status === "confirmed") {
    if (order.cancel_requested) {
      return '<span class="admin-muted">Cancellation requested · waiting for admin approval</span>';
    }
    return `<button class="text-button rt-cancel-button" type="button" data-cancel-order="${order.id}">${renderIcon("trash")}<span>Request cancellation</span></button>`;
  }
  if (order.status === "shipped") {
    return '<span class="admin-muted">Shipped · cancellation is no longer available</span>';
  }
  if (order.status === "delivered") {
    return '<span class="admin-muted">Delivered · file a complaint for returns</span>';
  }
  return "";
}

export function renderRetailerApp(root: HTMLDivElement): void {
  let currentUserId = "";
  let currentUserName = "";
  let currentUserEmail = "";
  let products: Product[] = [];
  let orders: Order[] = [];
  let cart: Record<string, number> = {};
  let searchTerm = "";
  let selectedCategory: string | null = null;
  let quantities: Record<string, number> = {};
  let complaints: Complaint[] = [];
  let notice: { message: string; state: "info" | "success" | "error" } | null = null;

  const path = window.location.pathname;
  const invoiceMatch = path.match(/^\/retailer\/orders\/([0-9a-fA-F-]+)\/invoice$/);
  const invoiceOrderId = invoiceMatch?.[1] ?? null;
  const isCatalog = path.endsWith("/catalog");
  const isCart = path.endsWith("/cart");
  const isOrders = path.endsWith("/orders") || Boolean(invoiceOrderId);
  const isComplaints = path.endsWith("/complaints");
  const checkoutMatch = path.match(/^\/retailer\/checkout\/(success|failed|cancelled)$/);
  const checkoutKind = checkoutMatch
    ? (checkoutMatch[1] as "success" | "failed" | "cancelled")
    : null;

  const render = (html: string) => {
    root.innerHTML = html;
  };

  const cartCount = (): number =>
    Object.values(cart).reduce((sum, quantity) => sum + (quantity > 0 ? quantity : 0), 0);

  const cartTotal = (): number =>
    Object.entries(cart).reduce((sum, [productId, quantity]) => {
      const product = products.find((item) => item.id === productId);
      return product ? sum + product.price * quantity : sum;
    }, 0);

  const readNotice = (): void => {
    const message = sessionStorage.getItem(NOTICE_KEY);
    if (message) {
      notice = { message, state: "success" };
      sessionStorage.removeItem(NOTICE_KEY);
    }
  };

  const renderCartTab = (): string => `
    ${renderIcon("cart")}
    <span>Cart</span>
    ${cartCount() ? `<span class="rt-nav-badge">${cartCount()}</span>` : ""}`;

  const renderSidebar = () => `
    <aside class="admin-sidebar">
      <div class="admin-sidebar-top">
        ${renderBrand("dark")}
      </div>
      <nav class="admin-nav" aria-label="Retailer navigation">
        <a class="admin-tab${isCatalog || isCart || isOrders || isComplaints ? "" : " is-active"}" href="/retailer">
          ${renderIcon("home")}
          <span>Overview</span>
        </a>
        <a class="admin-tab${isCatalog ? " is-active" : ""}" href="/retailer/catalog">
          ${renderIcon("bag")}
          <span>Place order</span>
        </a>
        <a class="admin-tab${isCart ? " is-active" : ""}" href="/retailer/cart">
          ${renderCartTab()}
        </a>
        <a class="admin-tab${isOrders ? " is-active" : ""}" href="/retailer/orders">
          ${renderIcon("package")}
          <span>My orders</span>
        </a>
        <a class="admin-tab${isComplaints ? " is-active" : ""}" href="/retailer/complaints">
          ${renderIcon("message")}
          <span>Help Center</span>
        </a>
      </nav>
      <div class="admin-sidebar-footer">
        <div class="admin-user">
          <span class="admin-user-info">
            <strong>${escapeHtml(currentUserName || "Retailer")}</strong>
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
    const pending = orders.filter((order) => order.status === "pending").length;
    const delivered = orders.filter((order) => order.status === "delivered").length;
    const recent = orders.slice(0, 4);

    render(`<div class="admin-layout">
      ${renderSidebar()}
      <main class="admin-main">
        <header class="admin-header">
          <div>
            <p class="eyebrow">Retailer workspace</p>
            <h1 class="display-xl">Good to see you, ${escapeHtml(getFirstName(currentUserName))}.</h1>
            <p>Browse suppliers, build an order, and track every delivery from one place.</p>
          </div>
          <div class="admin-header-actions">
            <a class="button button-primary" href="/retailer/catalog">${renderIcon("bag")}<span>Place order</span></a>
            <a class="button button-subtle" href="/retailer/orders">${renderIcon("package")}<span>My orders</span></a>
          </div>
        </header>

        ${renderNotice()}

        <section class="admin-stats" aria-label="Order summary">
          ${renderStat("orders", "Orders placed", "All time")}
          ${renderStat("pending", "Pending", "Awaiting confirmation")}
          ${renderStat("delivered", "Delivered", "Completed orders")}
          ${renderStat("in-cart", "In cart", "Items ready to order")}
        </section>

        <section class="rt-section" aria-labelledby="recent-heading">
          <div class="rt-section-heading">
            <div>
              <p class="eyebrow">Latest activity</p>
              <h2 id="recent-heading" class="display-sm">Recent orders</h2>
            </div>
            <a class="text-button" href="/retailer/orders">View all</a>
          </div>
          ${recent.length ? renderOrderList(recent) : renderEmpty("No orders yet", "Start with the catalog and place your first order.", "/retailer/catalog", "Place order")}
        </section>
      </main>
    </div>`);

    setStat("orders", String(orders.length));
    setStat("pending", String(pending));
    setStat("delivered", String(delivered));
    setStat("in-cart", String(cartCount()));
  };

  const renderCatalog = () => {
    render(`<div class="admin-layout">
      ${renderSidebar()}
      <main class="admin-main">
        <header class="admin-header">
          <div>
            <p class="eyebrow">Supplier catalog</p>
            <h1 class="display-xl">Place an order.</h1>
            <p>Pick products, choose quantities, and add them to your order.</p>
          </div>
          <div class="admin-header-actions">
            <a class="button button-primary" href="/retailer/cart">${renderIcon("cart")}<span>Review order${cartCount() ? ` (${cartCount()})` : ""}</span></a>
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
          renderCategoryButtons()
            ? `<div class="rt-category-filters" role="group" aria-label="Filter by category" data-category-filters>${renderCategoryButtons()}</div>`
            : ""
        }

        <div data-catalog-grid>${renderCatalogGrid()}</div>
      </main>
    </div>`);
  };

  const renderCategoryButtons = (): string => {
    const categories = Array.from(
      new Set(
        products
          .map((product) => product.category)
          .filter((category): category is string => Boolean(category)),
      ),
    ).sort((a, b) => a.localeCompare(b));
    if (!categories.length) {
      return "";
    }
    return `
      <button class="rt-category-pill${selectedCategory === null ? " is-active" : ""}" type="button" data-category-all>
        <span>All categories</span><small>${products.length}</small>
      </button>
      ${categories
        .map((category) => {
          const count = products.filter((product) => product.category === category).length;
          return `<button class="rt-category-pill${selectedCategory === category ? " is-active" : ""}" type="button" data-category-filter="${escapeHtml(category)}">
            <span>${escapeHtml(category)}</span><small>${count}</small>
          </button>`;
        })
        .join("")}`;
  };

  const renderCatalogGrid = (): string => {
    const filtered = getFilteredProducts();
    if (!filtered.length) {
      return `<div class="rt-empty-card">
        <span class="rt-empty-icon">${renderIcon("bag")}</span>
        <strong>No matching products</strong>
        <span>Try a different search term.</span>
      </div>`;
    }

    return `<div class="rt-catalog-grid">
      ${filtered.map((product) => renderProductCard(product)).join("")}
    </div>`;
  };

  const renderProductCard = (product: Product): string => {
    const quantity = quantities[product.id] ?? 1;
    const outOfStock = product.stock <= 0;
    const inCart = cart[product.id] ?? 0;
    const atMax = !outOfStock && inCart >= product.stock;
    return `<article class="rt-product-card">
      <div class="rt-product-art">${renderProductThumb(product)}</div>
      <div class="rt-product-body">
        <div class="rt-product-title-row">
          <h3 class="rt-product-name">${escapeHtml(product.name)}</h3>
          <span class="rt-product-price">${formatPrice(product.price)}</span>
        </div>
        <p class="rt-product-seller">${escapeHtml(product.seller_name || "SoukCart sample")}</p>
        <p class="rt-product-desc">${escapeHtml(product.description)}</p>
        <p class="rt-product-stock${outOfStock ? " is-out" : ""}">${outOfStock ? "Out of stock" : `${product.stock} in stock${inCart ? ` · ${inCart} in your order` : ""} · per ${escapeHtml(product.unit)}`}</p>
        <div class="rt-product-actions">
          <div class="rt-stepper" role="group" aria-label="Quantity for ${escapeHtml(product.name)}">
            <button class="rt-stepper-button" type="button" data-qty-minus="${product.id}" aria-label="Decrease quantity" ${outOfStock || quantity <= 1 ? "disabled" : ""}>${renderIcon("minus")}</button>
            <output class="rt-stepper-value" data-qty-value="${product.id}">${quantity}</output>
            <button class="rt-stepper-button" type="button" data-qty-plus="${product.id}" aria-label="Increase quantity" ${outOfStock || quantity >= product.stock ? "disabled" : ""}>${renderIcon("plus")}</button>
          </div>
          <button class="button button-primary rt-add-button" type="button" data-add-to-cart="${product.id}" ${outOfStock || atMax ? "disabled" : ""}>
            <span>${atMax ? "All stock in cart" : "Add to Cart"}</span>
          </button>
        </div>
      </div>
    </article>`;
  };

  const renderCart = () => {
    const lines = Object.entries(cart)
      .map(([productId, quantity]) => ({
        product: products.find((item) => item.id === productId),
        quantity,
      }))
      .filter(
        (line): line is { product: Product; quantity: number } =>
          Boolean(line.product) && line.quantity > 0,
      );

    render(`<div class="admin-layout">
      ${renderSidebar()}
      <main class="admin-main">
        <header class="admin-header">
          <div>
            <p class="eyebrow">Order review</p>
            <h1 class="display-xl">Your order.</h1>
            <p>Check quantities and totals before placing your order.</p>
          </div>
        </header>

        ${renderNotice()}

        ${
          lines.length
            ? `
        <div class="rt-cart-layout">
          <section class="rt-cart-list" aria-label="Order items">
            ${lines.map(({ product, quantity }) => renderCartLine(product, quantity)).join("")}
          </section>
          <aside class="rt-summary-card" aria-label="Order summary">
            <p class="eyebrow">Order summary</p>
            <div class="rt-summary-row"><span>Items</span><strong>${lines.reduce((sum, line) => sum + line.quantity, 0)}</strong></div>
            <div class="rt-summary-row"><span>Subtotal</span><strong>${formatPrice(cartTotal())}</strong></div>
            <label class="admin-field">
              <span>Phone number</span>
              <input name="phone" data-checkout-phone type="tel" inputmode="tel" autocomplete="tel" placeholder="01XXXXXXXXX" required />
            </label>
            <label class="admin-field">
              <span>Delivery address</span>
              <input name="address" data-checkout-address type="text" autocomplete="street-address" placeholder="House, road, area" required />
            </label>
            <div class="rt-checkout-grid">
              <label class="admin-field">
                <span>City</span>
                <input name="city" data-checkout-city type="text" autocomplete="address-level2" placeholder="Dhaka" required />
              </label>
              <label class="admin-field">
                <span>Postcode</span>
                <input name="postcode" data-checkout-postcode type="text" autocomplete="postal-code" placeholder="1205" required />
              </label>
            </div>
            <label class="admin-field">
              <span>Notes for the supplier</span>
              <textarea name="notes" data-order-notes rows="2" placeholder="Delivery instructions, packaging, etc."></textarea>
            </label>
            <fieldset class="rt-payment-methods">
              <legend class="sr-only">Payment method</legend>
              <label class="rt-payment-method">
                <input type="radio" name="payment-method" value="online" checked />
                <span class="rt-payment-icon">${renderIcon("lock")}</span>
                <span class="rt-payment-body">
                  <strong>Pay online</strong>
                  <small>Card or mobile banking via SSLCommerz</small>
                </span>
              </label>
              <label class="rt-payment-method">
                <input type="radio" name="payment-method" value="cod" />
                <span class="rt-payment-icon">${renderIcon("truck")}</span>
                <span class="rt-payment-body">
                  <strong>Cash on delivery</strong>
                  <small>Pay in cash when your order arrives</small>
                </span>
              </label>
            </fieldset>
            <button class="button button-primary button-block" type="button" data-checkout>
              <span data-checkout-icon>${renderIcon("lock")}</span><span data-checkout-label>Pay ${formatPrice(cartTotal())}</span>
            </button>
            <p class="rt-summary-hint" data-checkout-hint>You will be redirected to SSLCommerz to complete the payment securely.</p>
          </aside>
        </div>`
            : renderEmpty(
                "Your order is empty",
                "Browse the catalog and add products to start ordering.",
                "/retailer/catalog",
                "Browse catalog",
              )
        }
      </main>
    </div>`);
  };

  const renderCartLine = (product: Product, quantity: number): string => `
    <article class="rt-cart-line">
      <div class="rt-cart-art">${renderProductThumb(product)}</div>
      <div class="rt-cart-line-body">
        <h3 class="rt-product-name">${escapeHtml(product.name)}</h3>
        <p class="rt-product-seller">${escapeHtml(product.seller_name || "SoukCart sample")} · ${formatPrice(product.price)} per ${escapeHtml(product.unit)}</p>
        <div class="rt-stepper" role="group" aria-label="Quantity for ${escapeHtml(product.name)}">
          <button class="rt-stepper-button" type="button" data-qty-minus="${product.id}" aria-label="Decrease quantity">${renderIcon("minus")}</button>
          <output class="rt-stepper-value" data-qty-value="${product.id}">${quantity}</output>
          <button class="rt-stepper-button" type="button" data-qty-plus="${product.id}" aria-label="Increase quantity" ${quantity >= product.stock ? "disabled" : ""}>${renderIcon("plus")}</button>
        </div>
      </div>
      <div class="rt-cart-line-end">
        <strong>${formatPrice(product.price * quantity)}</strong>
        <button class="rt-remove-button" type="button" data-remove-line="${product.id}" aria-label="Remove ${escapeHtml(product.name)} from order">${renderIcon("trash")}</button>
      </div>
    </article>`;

  const renderOrders = () => {
    render(`<div class="admin-layout">
      ${renderSidebar()}
      <main class="admin-main">
        <header class="admin-header">
          <div>
            <p class="eyebrow">Order history</p>
            <h1 class="display-xl">My orders.</h1>
            <p>Every order you place, from confirmation to delivery.</p>
          </div>
          <div class="admin-header-actions">
            <a class="button button-primary" href="/retailer/catalog">${renderIcon("bag")}<span>Place order</span></a>
          </div>
        </header>

        ${renderNotice()}

        ${orders.length ? renderOrdersTable(orders) : renderEmpty("No orders yet", "Place your first order and it will show up here.", "/retailer/catalog", "Place order")}
      </main>
    </div>`);
  };

  const renderOrdersTable = (rows: Order[]): string => `
    <div class="admin-table-wrap">
      <table class="admin-table rt-orders-table">
        <thead><tr><th>Order</th><th>Placed</th><th>Items</th><th>Total</th><th>Status</th><th><span class="sr-only">Details</span></th></tr></thead>
        <tbody>
          ${rows
            .map(
              (order) => `
            <tr class="rt-order-row" data-order-toggle="${order.id}" aria-expanded="false">
              <td><strong class="rt-order-id">#${shortId(order.id)}</strong></td>
              <td>${formatDate(order.created_at)}</td>
              <td>${order.items.reduce((sum, item) => sum + item.quantity, 0)}</td>
              <td><strong>${formatPrice(orderTotal(order))}</strong></td>
              <td>${paymentBadge(order)}<span class="rt-status rt-status-${order.status}">${statusLabel(order.status)}</span></td>
              <td class="rt-order-toggle">${renderIcon("plus")}</td>
            </tr>
            <tr class="rt-order-detail" data-order-detail="${order.id}" hidden>
              <td colspan="6">
                <div class="rt-order-detail-body">
                  ${order.items
                    .map(
                      (item) => `
                    <div class="rt-order-item-row">
                      <span>${escapeHtml(item.product_name)}</span>
                      <span>${item.quantity} × ${formatPrice(item.unit_price)}</span>
                      <strong>${formatPrice(item.unit_price * item.quantity)}</strong>
                    </div>`,
                    )
                    .join("")}
                  ${order.notes ? `<p class="rt-order-notes"><strong>Notes:</strong> ${escapeHtml(order.notes)}</p>` : ""}
                  <div class="rt-order-detail-actions">
                    ${order.payment_status === "paid" ? `<a class="text-button rt-invoice-link" href="/retailer/orders/${order.id}/invoice">${renderIcon("download")}<span>Download invoice</span></a>` : ""}
                    ${order.payment_status === "unpaid" && order.tran_id ? `<button class="text-button rt-invoice-link" type="button" data-verify-payment="${order.id}">${renderIcon("refresh")}<span>Verify payment</span></button>` : ""}
                    ${cancelAction(order)}
                  </div>
                </div>
              </td>
            </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>`;

  const renderOrderList = (rows: Order[]): string => `
    <div class="rt-order-list">
      ${rows
        .map(
          (order) => `
        <a class="rt-order-card" href="/retailer/orders">
          <span class="rt-order-art">${renderIcon(order.status === "delivered" ? "check" : "package")}</span>
          <span class="rt-order-card-body">
            <strong class="rt-order-id">#${shortId(order.id)}</strong>
            <small>${order.items.reduce((sum, item) => sum + item.quantity, 0)} items · ${formatDate(order.created_at)}</small>
          </span>
          <span class="rt-order-card-end">
            <strong>${formatPrice(orderTotal(order))}</strong>
            ${paymentBadge(order)}
            <span class="rt-status rt-status-${order.status}">${statusLabel(order.status)}</span>
          </span>
        </a>`,
        )
        .join("")}
    </div>`;

  const renderEmpty = (title: string, copy: string, href: string, label: string): string => `
    <div class="rt-empty-card">
      <span class="rt-empty-icon">${renderIcon("store")}</span>
      <strong>${title}</strong>
      <span>${copy}</span>
      <a class="button button-primary" href="${href}"><span>${label}</span></a>
    </div>`;

  const renderComplaints = () => {
    render(`<div class="admin-layout">
      ${renderSidebar()}
      <main class="admin-main">
        <header class="admin-header">
          <div>
            <p class="eyebrow">Support</p>
            <h1 class="display-xl">Help Center.</h1>
            <p>Tell us what went wrong.</p>
          </div>
        </header>

        ${renderNotice()}

        <div class="cp-layout">
          <section class="cp-list" aria-label="Your complaints">
            <div class="rt-section-heading">
              <div>
                <p class="eyebrow">Your reports</p>
                <h2 class="display-sm">Filed complaints</h2>
              </div>
              <span class="admin-result-count" data-complaint-count>${complaints.length} filed</span>
            </div>
            ${complaints.length ? renderComplaintList() : renderEmpty("No complaints yet", "Complaints you file will show up here.", "/retailer/complaints", "File a complaint")}
          </section>

          <form class="cp-form-card" data-complaint-form>
            <div class="cp-form-heading">
              <p class="eyebrow">New report</p>
              <h2 class="display-sm">File a complaint</h2>
            </div>
            <label class="admin-field">
              <span>Subject</span>
              <input name="subject" type="text" maxlength="120" placeholder="What is this about?" required />
            </label>
            <label class="admin-field">
              <span>Details</span>
              <textarea name="description" rows="4" maxlength="2000" placeholder="What happened, and what would fix it?" required></textarea>
            </label>
            <label class="admin-field">
              <span>Attachment (optional)</span>
              <input name="attachment" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" data-complaint-file />
            </label>
            <div class="cp-form-actions">
              <button class="button button-primary" type="submit"><span>Submit complaint</span></button>
            </div>
            <p class="admin-form-feedback" data-complaint-feedback role="status" aria-live="polite"></p>
          </form>
        </div>
      </main>
    </div>`);
  };

  const renderComplaintList = (): string => `
    <div class="cp-list-cards">
      ${complaints
        .map(
          (complaint) => `
        <article class="cp-card">
          <div class="cp-card-top">
            <strong>${escapeHtml(complaint.subject)}</strong>
            <span class="cp-status cp-status-${complaint.status}">${complaint.status === "open" ? "Open" : "Resolved"}</span>
          </div>
          <p>${escapeHtml(complaint.description)}</p>
          ${complaint.attachment_url ? `<a class="text-button" href="${escapeHtml(complaint.attachment_url)}" target="_blank" rel="noopener noreferrer">${renderIcon("download")}<span>View attachment</span></a>` : ""}
          <small>Filed ${formatDateTime(complaint.created_at)}</small>
        </article>`,
        )
        .join("")}
    </div>`;

  const renderPanel = () => {
    if (invoiceOrderId) {
      renderInvoice(invoiceOrderId);
    } else if (checkoutKind) {
      renderCheckoutResult(checkoutKind);
    } else if (isCatalog) {
      renderCatalog();
    } else if (isCart) {
      renderCart();
    } else if (isOrders) {
      renderOrders();
    } else if (isComplaints) {
      renderComplaints();
    } else {
      renderOverview();
    }
  };

  const loadDashboard = async () => {
    const [productResult, orderResult, cartResult, complaintResult] = await Promise.all([
      supabase
        .from("products")
        .select("id, name, description, price, unit, stock, category, image_url, users(name)")
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("orders")
        .select(
          "id, status, cancel_requested, payment_status, payment_method, tran_id, notes, created_at, order_items(id, product_id, quantity, unit_price, products(name))",
        )
        .eq("retailer_id", currentUserId)
        .order("created_at", { ascending: false }),
      supabase.from("cart_items").select("product_id, quantity").eq("user_id", currentUserId),
      isComplaints
        ? supabase
            .from("complaints")
            .select("id, subject, description, attachment_url, status, created_at")
            .eq("retailer_id", currentUserId)
            .order("created_at", { ascending: false })
        : null,
    ]);

    if (productResult.error) {
      throw new Error(productResult.error.message);
    }
    if (orderResult.error) {
      throw new Error(orderResult.error.message);
    }
    if (cartResult.error) {
      throw new Error(cartResult.error.message);
    }
    if (complaintResult?.error) {
      throw new Error(complaintResult.error.message);
    }

    complaints = (complaintResult?.data ?? []).map((row) => ({
      id: row.id,
      subject: row.subject,
      description: row.description,
      attachment_url: row.attachment_url,
      status: row.status as ComplaintStatus,
      created_at: row.created_at,
    }));

    cart = (cartResult.data ?? []).reduce<Record<string, number>>((acc, row) => {
      acc[row.product_id] = row.quantity;
      return acc;
    }, {});

    products = (productResult.data ?? []).map((row) => {
      const sellerRelation = row.users as { name: string } | { name: string }[] | null;
      const sellerName = Array.isArray(sellerRelation)
        ? (sellerRelation[0]?.name ?? null)
        : (sellerRelation?.name ?? null);
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        price: Number(row.price),
        unit: row.unit,
        stock: row.stock,
        category: row.category ?? null,
        image_url: row.image_url,
        seller_name: sellerName,
      };
    });

    orders = (orderResult.data ?? []).map((row) => ({
      id: row.id,
      status: row.status as OrderStatus,
      cancel_requested: row.cancel_requested === true,
      payment_status: (row.payment_status ?? "unpaid") as PaymentStatus,
      payment_method: (row.payment_method ?? "online") as PaymentMethod,
      tran_id: row.tran_id ?? null,
      notes: row.notes,
      created_at: row.created_at,
      items: (row.order_items ?? []).map((item) => {
        const productRelation = item.products as { name: string } | { name: string }[] | null;
        const productName = Array.isArray(productRelation)
          ? (productRelation[0]?.name ?? "Unknown product")
          : (productRelation?.name ?? "Unknown product");
        return {
          id: item.id,
          product_id: item.product_id,
          quantity: item.quantity,
          unit_price: Number(item.unit_price),
          product_name: productName,
        };
      }),
    }));
    const justPaid = await reconcileUnpaidOrders();
    if (justPaid) {
      await supabase.from("cart_items").delete().eq("user_id", currentUserId);
      cart = {};
    }

    renderPanel();
  };

  const reconcileUnpaidOrders = async (): Promise<boolean> => {
    let justPaid = false;
    for (const order of orders) {
      if (order.payment_status !== "unpaid" || !order.tran_id) {
        continue;
      }
      const { data, error } = await supabase.functions.invoke("sslcommerz-checkout", {
        body: { action: "query", tranId: order.tran_id },
      });
      if (error) {
        continue;
      }
      const payload = isRecord(data) ? data : null;
      const paymentStatus = typeof payload?.paymentStatus === "string" ? payload.paymentStatus : "";
      if (paymentStatus === "paid" || paymentStatus === "failed" || paymentStatus === "cancelled") {
        order.payment_status = paymentStatus;
        if (paymentStatus === "paid") {
          justPaid = true;
        }
      }
    }
    return justPaid;
  };

  const renderError = (message: string) => {
    render(`<div class="admin-error-screen">
      <p class="eyebrow">Retailer workspace</p>
      <h1 class="display-lg">We could not load your workspace.</h1>
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
    const session = data.session;

    if (checkoutKind) {
      if (session) {
        currentUserId = session.user.id;
        const { data: profile } = await supabase
          .from("users")
          .select("name, email")
          .eq("id", currentUserId)
          .maybeSingle();
        currentUserName = profile?.name || profile?.email || "";
        currentUserEmail = profile?.email || "";
      }
      renderCheckoutResult(checkoutKind);
      return;
    }

    if (!session) {
      window.location.assign("/");
      return;
    }

    currentUserId = session.user.id;
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
    if (profile.role !== "retailer") {
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

  const updateQuantity = (productId: string, change: number): void => {
    const product = products.find((item) => item.id === productId);
    const current = quantities[productId] ?? 1;
    const next = Math.min(Math.max(1, current + change), product?.stock ?? current + change);
    quantities[productId] = next;
    const value = root.querySelector<HTMLElement>(`[data-qty-value="${productId}"]`);
    if (value) {
      value.textContent = String(quantities[productId]);
    }
    const plusButton = root.querySelector<HTMLButtonElement>(`[data-qty-plus="${productId}"]`);
    if (plusButton) {
      plusButton.disabled = Boolean(product && next >= product.stock);
    }
    const minusButton = root.querySelector<HTMLButtonElement>(`[data-qty-minus="${productId}"]`);
    if (minusButton) {
      minusButton.disabled = next <= 1;
    }
  };

  const addToCart = async (productId: string, button: HTMLButtonElement): Promise<void> => {
    const product = products.find((item) => item.id === productId);
    if (!product) {
      return;
    }
    const wanted = (cart[productId] ?? 0) + (quantities[productId] ?? 1);
    if (wanted > product.stock) {
      const remaining = product.stock - (cart[productId] ?? 0);
      if (remaining <= 0) {
        throw new Error(
          `You already have all ${product.stock} unit${product.stock === 1 ? "" : "s"} of ${product.name} in your order.`,
        );
      }
      throw new Error(
        `Only ${remaining} more unit${remaining === 1 ? "" : "s"} of ${product.name} are in stock.`,
      );
    }
    const { error } = await supabase
      .from("cart_items")
      .upsert(
        { user_id: currentUserId, product_id: productId, quantity: wanted },
        { onConflict: "user_id,product_id" },
      );
    if (error) {
      throw new Error(error.message);
    }
    cart[productId] = wanted;
    quantities[productId] = 1;

    const qtyValue = root.querySelector<HTMLElement>(`[data-qty-value="${productId}"]`);
    if (qtyValue) {
      qtyValue.textContent = "1";
    }

    const sidebar = root.querySelector<HTMLElement>(".admin-sidebar");
    const cartTab = sidebar?.querySelector<HTMLElement>('a[href="/retailer/cart"]');
    if (cartTab) {
      cartTab.innerHTML = renderCartTab();
      const badge = cartTab.querySelector<HTMLElement>(".rt-nav-badge");
      if (badge) {
        badge.classList.remove("rt-nav-badge--pop");
        void badge.offsetWidth;
        badge.classList.add("rt-nav-badge--pop");
      }
    }

    showAddedFeedback(button);
  };

  const showAddedFeedback = (button: HTMLButtonElement): void => {
    button.classList.remove("is-added");
    void button.offsetWidth;
    button.classList.add("is-added");
    button.innerHTML = `${renderIcon("check")}<span>Added</span>`;
    window.setTimeout(() => {
      button.classList.remove("is-added");
      button.innerHTML = "<span>Add to Cart</span>";
    }, 900);
  };

  const changeCartQuantity = async (productId: string, change: number): Promise<void> => {
    const current = cart[productId] ?? 1;
    const product = products.find((item) => item.id === productId);
    const next = Math.min(current + change, product?.stock ?? current + change);
    if (next < 1) {
      return;
    }
    const { error } = await supabase
      .from("cart_items")
      .update({ quantity: next })
      .eq("user_id", currentUserId)
      .eq("product_id", productId);
    if (error) {
      throw new Error(error.message);
    }
    cart[productId] = next;
    renderCart();
  };

  const removeLine = async (productId: string): Promise<void> => {
    const { error } = await supabase
      .from("cart_items")
      .delete()
      .eq("user_id", currentUserId)
      .eq("product_id", productId);
    if (error) {
      throw new Error(error.message);
    }
    delete cart[productId];
    renderCart();
  };

  const startCheckout = async (): Promise<void> => {
    const phone = readInput("[data-checkout-phone]").trim();
    const address = readInput("[data-checkout-address]").trim();
    const city = readInput("[data-checkout-city]").trim();
    const postcode = readInput("[data-checkout-postcode]").trim();
    const notes = readInput("[data-order-notes]").trim() || null;
    if (!phone || !address || !city || !postcode) {
      throw new Error("Enter your phone number, delivery address, city, and postcode.");
    }

    for (const [productId, quantity] of Object.entries(cart)) {
      const product = products.find((item) => item.id === productId);
      if (product && quantity > product.stock) {
        throw new Error(
          `Only ${product.stock} unit${product.stock === 1 ? "" : "s"} of ${product.name} are in stock, but your order has ${quantity}. Reduce the quantity and try again.`,
        );
      }
    }

    const methodRadio = root.querySelector<HTMLInputElement>(
      'input[name="payment-method"]:checked',
    );
    const paymentMethod = methodRadio?.value === "cod" ? "cod" : "online";

    const { data, error } = await supabase.functions.invoke("sslcommerz-checkout", {
      body: {
        action: "initiate",
        paymentMethod,
        checkout: { phone, address, city, postcode, notes },
        baseUrl: window.location.origin,
        ipnUrl: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sslcommerz-ipn`,
      },
    });
    if (error) {
      throw new Error(functionErrorMessage(error));
    }
    const payload = isRecord(data) ? data : null;
    if (payload?.method === "cod") {
      await supabase.from("cart_items").delete().eq("user_id", currentUserId);
      cart = {};
      sessionStorage.setItem(NOTICE_KEY, "Order placed. Pay in cash when your order arrives.");
      window.location.assign("/retailer/orders");
      return;
    }
    const url = typeof payload?.url === "string" ? payload.url : "";
    if (!url) {
      throw new Error("The payment could not be started. Please try again.");
    }
    sessionStorage.setItem("soukcart:payment-return", "1");
    window.location.assign(url);
  };

  const updateCheckoutUI = (): void => {
    const methodRadio = root.querySelector<HTMLInputElement>(
      'input[name="payment-method"]:checked',
    );
    const cod = methodRadio?.value === "cod";
    const icon = root.querySelector<HTMLElement>("[data-checkout-icon]");
    const label = root.querySelector<HTMLElement>("[data-checkout-label]");
    const hint = root.querySelector<HTMLElement>("[data-checkout-hint]");
    if (icon) {
      icon.innerHTML = renderIcon(cod ? "truck" : "lock");
    }
    if (label) {
      label.textContent = cod
        ? `Place order · ${formatPrice(cartTotal())}`
        : `Pay ${formatPrice(cartTotal())}`;
    }
    if (hint) {
      hint.textContent = cod
        ? "Pay in cash when your order arrives."
        : "You will be redirected to SSLCommerz to complete the payment securely.";
    }
  };

  const renderCheckoutResult = (kind: "success" | "failed" | "cancelled"): void => {
    const headline =
      kind === "success"
        ? "Confirming your payment."
        : kind === "failed"
          ? "Payment failed."
          : "Payment cancelled.";
    render(`<div class="admin-layout">
      ${renderSidebar()}
      <main class="admin-main">
        <header class="admin-header">
          <div>
            <p class="eyebrow">Payment result</p>
            <h1 class="display-xl">${headline}</h1>
            <p>We are checking the payment status with SSLCommerz.</p>
          </div>
        </header>

        <div class="rt-empty-card" data-checkout-result>
          <span class="rt-empty-icon">${renderIcon("clock")}</span>
          <strong>Checking the payment…</strong>
          <span>This usually takes a few seconds.</span>
        </div>
      </main>
    </div>`);
    void settleCheckout(kind);
  };

  const settleCheckout = async (kind: "success" | "failed" | "cancelled"): Promise<void> => {
    const params = new URLSearchParams(window.location.search);
    const tranId = params.get("tran_id") ?? "";
    const valId = params.get("val_id") ?? "";
    const status = params.get("status") ?? "";
    const result = root.querySelector<HTMLElement>("[data-checkout-result]");

    if (!tranId || !valId) {
      showCheckoutResult(kind, false, result);
      return;
    }

    const { data, error } = await supabase.functions.invoke("sslcommerz-checkout", {
      body: { action: "complete", tranId, valId, status },
    });
    const paid = !error && isRecord(data) && data.paymentStatus === "paid";

    if (paid && kind === "success" && currentUserId) {
      await supabase.from("cart_items").delete().eq("user_id", currentUserId);
      cart = {};
      sessionStorage.setItem(NOTICE_KEY, "Payment received. Your order is with the suppliers.");
      const orderId = isRecord(data) && typeof data.orderId === "string" ? data.orderId : "";
      window.location.assign(orderId ? `/retailer/orders/${orderId}/invoice` : "/retailer/orders");
      return;
    }

    showCheckoutResult(kind, paid, result);
  };

  const showCheckoutResult = (
    kind: "success" | "failed" | "cancelled",
    paid: boolean,
    result: HTMLElement | null,
  ): void => {
    if (!result) {
      return;
    }
    const ok = kind === "success" && paid;
    const icon = ok ? "check" : kind === "failed" ? "minus" : "clock";
    const title = ok
      ? "Payment received"
      : kind === "failed"
        ? "Payment failed"
        : "Payment cancelled";
    const copy = ok
      ? "Your order is with the suppliers."
      : "No charge was made. You can try again from your cart.";
    const href = ok ? (currentUserId ? "/retailer/orders" : "/") : "/retailer/cart";
    const label = ok ? (currentUserId ? "View orders" : "Sign in") : "Back to cart";
    result.innerHTML = `
      <span class="rt-empty-icon${ok ? " is-success" : ""}">${renderIcon(icon)}</span>
      <strong>${title}</strong>
      <span>${copy}</span>
      <a class="button button-primary" href="${href}"><span>${label}</span></a>`;
  };

  const readInput = (selector: string): string => {
    const element = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
    return element?.value ?? "";
  };

  const renderInvoice = (orderId: string): void => {
    render(`<div class="admin-layout">
      ${renderSidebar()}
      <main class="admin-main">
        <header class="admin-header">
          <div>
            <p class="eyebrow">Invoice</p>
            <h1 class="display-xl">Order ${escapeHtml(shortId(orderId))}.</h1>
            <p>Download a copy of this invoice for your records.</p>
          </div>
          <div class="admin-header-actions">
            <a class="button button-subtle" href="/retailer/orders">${renderIcon("package")}<span>Back to orders</span></a>
          </div>
        </header>

        ${renderNotice()}

        <div class="rt-invoice-panel" data-invoice-panel>
          <div class="rt-empty-card">
            <span class="rt-empty-icon">${renderIcon("clock")}</span>
            <strong>Loading the invoice…</strong>
          </div>
        </div>
      </main>
    </div>`);
    void loadInvoice(orderId);
  };

  const loadInvoice = async (orderId: string): Promise<void> => {
    const panel = root.querySelector<HTMLElement>("[data-invoice-panel]");
    const showState = (
      icon: IconName,
      title: string,
      copy: string,
      href: string,
      label: string,
    ): void => {
      if (!panel) {
        return;
      }
      panel.innerHTML = `
        <div class="rt-empty-card">
          <span class="rt-empty-icon">${renderIcon(icon)}</span>
          <strong>${title}</strong>
          <span>${copy}</span>
          <a class="button button-primary" href="${href}"><span>${label}</span></a>
        </div>`;
    };

    const { data: row, error } = await supabase
      .from("orders")
      .select(
        "id, status, cancel_requested, payment_status, payment_method, notes, created_at, paid_at, tran_id, val_id, bank_tran_id, order_items(id, product_id, quantity, unit_price, products(name))",
      )
      .eq("id", orderId)
      .single();
    if (error || !row) {
      showState(
        "bag",
        "Invoice not found",
        "This order could not be loaded.",
        "/retailer/orders",
        "Back to orders",
      );
      return;
    }
    if (row.payment_status !== "paid") {
      showState(
        "clock",
        "Invoice not available yet",
        "The invoice appears once the order has been paid.",
        "/retailer/orders",
        "Back to orders",
      );
      return;
    }

    const items: OrderItem[] = (row.order_items ?? []).map((item) => {
      const productRelation = item.products as { name: string } | { name: string }[] | null;
      const productName = Array.isArray(productRelation)
        ? (productRelation[0]?.name ?? "Unknown product")
        : (productRelation?.name ?? "Unknown product");
      return {
        id: item.id,
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: Number(item.unit_price),
        product_name: productName,
      };
    });
    const order: InvoiceOrder = {
      id: row.id,
      status: row.status as OrderStatus,
      cancel_requested: row.cancel_requested === true,
      payment_status: row.payment_status as PaymentStatus,
      payment_method: (row.payment_method ?? "online") as PaymentMethod,
      notes: row.notes,
      created_at: row.created_at,
      paid_at: row.paid_at,
      tran_id: row.tran_id,
      val_id: row.val_id,
      bank_tran_id: row.bank_tran_id,
      items,
    };

    if (panel) {
      panel.innerHTML = renderInvoiceCard(order);
    }
  };

  const renderInvoiceCard = (order: InvoiceOrder): string => {
    const total = order.items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
    return `<div class="rt-invoice">
      <div class="rt-invoice-head">
        ${renderBrand("dark")}
        <div class="rt-invoice-meta">
          <p class="eyebrow">Invoice</p>
          <h2 class="display-sm">#${escapeHtml(shortId(order.id))}</h2>
          <p>Issued ${formatDate(order.created_at)}</p>
        </div>
      </div>

      <div class="rt-invoice-grid">
        <div>
          <p class="rt-invoice-label">Bill to</p>
          <strong>${escapeHtml(currentUserName || "Retailer")}</strong>
          <span>${escapeHtml(currentUserEmail)}</span>
        </div>
        <div>
          <p class="rt-invoice-label">Payment</p>
          <strong>SSLCommerz</strong>
          <span>Paid ${order.paid_at ? formatDateTime(order.paid_at) : formatDateTime(order.created_at)}</span>
        </div>
      </div>

      <div class="admin-table-wrap">
        <table class="admin-table rt-invoice-table">
          <thead>
            <tr><th>Item</th><th>Qty</th><th>Unit price</th><th>Total</th></tr>
          </thead>
          <tbody>
            ${order.items
              .map(
                (item) => `
              <tr>
                <td>${escapeHtml(item.product_name)}</td>
                <td>${item.quantity}</td>
                <td>${formatPrice(item.unit_price)}</td>
                <td><strong>${formatPrice(item.unit_price * item.quantity)}</strong></td>
              </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>

      <div class="rt-invoice-total">
        <span>Subtotal</span>
        <strong>${formatPrice(total)}</strong>
      </div>

      <div class="rt-invoice-payment">
        <p class="rt-invoice-label">Transaction reference</p>
        <code>${escapeHtml(order.tran_id ?? "")}</code>
        ${order.val_id ? `<code>${escapeHtml(order.val_id)}</code>` : ""}
        ${order.bank_tran_id ? `<code>${escapeHtml(order.bank_tran_id)}</code>` : ""}
      </div>

      <div class="rt-invoice-actions">
        <button class="button button-primary" type="button" data-invoice-print>
          ${renderIcon("download")}<span>Download PDF</span>
        </button>
        <a class="button button-subtle" href="/retailer/orders"><span>Back to orders</span></a>
      </div>
    </div>`;
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

    const categoryAllButton = event.target.closest<HTMLButtonElement>("[data-category-all]");
    if (categoryAllButton) {
      selectedCategory = null;
      refreshCatalog();
      return;
    }

    const categoryButton = event.target.closest<HTMLButtonElement>("[data-category-filter]");
    if (categoryButton) {
      selectedCategory = categoryButton.dataset.categoryFilter ?? null;
      refreshCatalog();
      return;
    }

    const minusButton = event.target.closest<HTMLButtonElement>("[data-qty-minus]");
    if (minusButton) {
      const productId = minusButton.dataset.qtyMinus;
      if (!productId) {
        return;
      }
      if (minusButton.closest(".rt-cart-line")) {
        try {
          await changeCartQuantity(productId, -1);
        } catch (error) {
          setNotice(
            error instanceof Error ? error.message : "Quantity could not be updated.",
            "error",
          );
        }
      } else {
        updateQuantity(productId, -1);
      }
      return;
    }

    const plusButton = event.target.closest<HTMLButtonElement>("[data-qty-plus]");
    if (plusButton) {
      const productId = plusButton.dataset.qtyPlus;
      if (!productId) {
        return;
      }
      if (plusButton.closest(".rt-cart-line")) {
        try {
          await changeCartQuantity(productId, 1);
        } catch (error) {
          setNotice(
            error instanceof Error ? error.message : "Quantity could not be updated.",
            "error",
          );
        }
      } else {
        updateQuantity(productId, 1);
      }
      return;
    }

    const addButton = event.target.closest<HTMLButtonElement>("[data-add-to-cart]");
    if (addButton) {
      const productId = addButton.dataset.addToCart;
      if (productId && !addButton.classList.contains("is-added")) {
        try {
          await addToCart(productId, addButton);
        } catch (error) {
          setNotice(
            error instanceof Error ? error.message : "The product could not be added.",
            "error",
          );
        }
      }
      return;
    }

    const removeButton = event.target.closest<HTMLButtonElement>("[data-remove-line]");
    if (removeButton) {
      const productId = removeButton.dataset.removeLine;
      if (productId) {
        try {
          await removeLine(productId);
        } catch (error) {
          setNotice(
            error instanceof Error ? error.message : "The item could not be removed.",
            "error",
          );
        }
      }
      return;
    }

    const checkoutButton = event.target.closest<HTMLButtonElement>("[data-checkout]");
    if (checkoutButton) {
      checkoutButton.disabled = true;
      try {
        await startCheckout();
      } catch (error) {
        checkoutButton.disabled = false;
        setNotice(
          error instanceof Error ? error.message : "The payment could not be started.",
          "error",
        );
      }
      return;
    }

    const printButton = event.target.closest<HTMLButtonElement>("[data-invoice-print]");
    if (printButton) {
      window.print();
      return;
    }

    const verifyButton = event.target.closest<HTMLButtonElement>("[data-verify-payment]");
    if (verifyButton) {
      const orderId = verifyButton.dataset.verifyPayment;
      const order = orders.find((item) => item.id === orderId);
      if (order && order.tran_id) {
        verifyButton.disabled = true;
        const { data, error } = await supabase.functions.invoke("sslcommerz-checkout", {
          body: { action: "query", tranId: order.tran_id },
        });
        if (!error) {
          const payload = isRecord(data) ? data : null;
          const paymentStatus =
            typeof payload?.paymentStatus === "string" ? payload.paymentStatus : "";
          if (
            paymentStatus === "paid" ||
            paymentStatus === "failed" ||
            paymentStatus === "cancelled"
          ) {
            order.payment_status = paymentStatus;
            if (paymentStatus === "paid") {
              await supabase.from("cart_items").delete().eq("user_id", currentUserId);
              cart = {};
            }
            renderOrders();
            return;
          }
        }
        verifyButton.disabled = false;
        setNotice("Payment not found yet. Please try again in a moment.", "info");
      }
      return;
    }

    const cancelButton = event.target.closest<HTMLButtonElement>("[data-cancel-order]");
    if (cancelButton) {
      const orderId = cancelButton.dataset.cancelOrder;
      const order = orders.find((item) => item.id === orderId);
      if (order && canCancelOrder(order)) {
        const total = orderTotal(order);
        const paid = order.payment_status === "paid";
        const requesting = order.status === "confirmed";
        const confirmed = window.confirm(
          requesting
            ? `Request cancellation of order #${shortId(order.id)}? The admin team will review it${paid ? ` and arrange the refund of ${formatPrice(total)}` : ""}.`
            : paid
              ? `Cancel order #${shortId(order.id)}? You paid ${formatPrice(total)} and the supplier will arrange your refund.`
              : `Cancel order #${shortId(order.id)}? This cannot be undone.`,
        );
        if (!confirmed) {
          return;
        }
        cancelButton.disabled = true;
        const { data, error } = await supabase.rpc("request_order_cancellation", {
          p_order_id: order.id,
        });
        if (error) {
          cancelButton.disabled = false;
          setNotice(
            error instanceof Error ? error.message : "The order could not be cancelled.",
            "error",
          );
          return;
        }
        if (data === "requested") {
          order.cancel_requested = true;
          renderOrders();
          setNotice(
            `Cancellation of order #${shortId(order.id)} was requested. The admin team will review it.`,
            "info",
          );
        } else {
          order.status = "cancelled";
          renderOrders();
          setNotice(`Order #${shortId(order.id)} has been cancelled.`, "success");
        }
      }
      return;
    }

    const orderRow = event.target.closest<HTMLTableRowElement>("[data-order-toggle]");
    if (orderRow) {
      const orderId = orderRow.dataset.orderToggle;
      const detail = orderId
        ? root.querySelector<HTMLTableRowElement>(`[data-order-detail="${orderId}"]`)
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
  });

  root.addEventListener("submit", async (event) => {
    if (
      !(event.target instanceof HTMLFormElement) ||
      !event.target.matches("[data-complaint-form]")
    ) {
      return;
    }

    event.preventDefault();
    const form = event.target;
    if (!form.reportValidity()) {
      return;
    }

    const formData = new FormData(form);
    const subject = readFormText(formData, "subject").trim();
    const description = readFormText(formData, "description").trim();
    const fileInput = form.querySelector<HTMLInputElement>('[name="attachment"]');
    const file = fileInput?.files?.[0] ?? null;

    if (!subject || !description) {
      setFeedback(form, "Add a subject and some details.", "error", "[data-complaint-feedback]");
      return;
    }
    if (file) {
      const isImage = file.type.startsWith("image/");
      const isPdf = file.type === "application/pdf";
      if (!isImage && !isPdf) {
        setFeedback(
          form,
          "Please choose an image or PDF file.",
          "error",
          "[data-complaint-feedback]",
        );
        return;
      }
      if (file.size > MAX_COMPLAINT_FILE_BYTES) {
        setFeedback(
          form,
          "The file is too large. Please pick one under 5 MB.",
          "error",
          "[data-complaint-feedback]",
        );
        return;
      }
    }

    const submitButton = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    submitButton?.setAttribute("disabled", "true");
    try {
      let attachmentUrl: string | null = null;
      if (file) {
        setFeedback(form, "Uploading attachment…", "info", "[data-complaint-feedback]");
        const extension =
          file.type === "application/pdf"
            ? "pdf"
            : (file.type.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg");
        const objectPath = `${currentUserId}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from(COMPLAINT_FILES_BUCKET)
          .upload(objectPath, file, { contentType: file.type, cacheControl: "3600" });
        if (uploadError) {
          throw new Error(`The attachment could not be uploaded. ${uploadError.message}`);
        }
        attachmentUrl = supabase.storage.from(COMPLAINT_FILES_BUCKET).getPublicUrl(objectPath)
          .data.publicUrl;
      }

      const { data, error } = await supabase
        .from("complaints")
        .insert({ retailer_id: currentUserId, subject, description, attachment_url: attachmentUrl })
        .select("id, subject, description, attachment_url, status, created_at")
        .single();
      if (error || !data) {
        throw new Error(error?.message ?? "The complaint could not be filed.");
      }
      complaints = [
        {
          id: data.id,
          subject: data.subject,
          description: data.description,
          attachment_url: data.attachment_url,
          status: data.status as ComplaintStatus,
          created_at: data.created_at,
        },
        ...complaints,
      ];
      notice = { message: "Complaint filed. The admin team will review it.", state: "success" };
      renderComplaints();
    } catch (error) {
      setFeedback(
        form,
        error instanceof Error ? error.message : "The complaint could not be filed.",
        "error",
        "[data-complaint-feedback]",
      );
      submitButton?.removeAttribute("disabled");
    }
  });

  root.addEventListener("input", (event) => {
    if (
      !(event.target instanceof HTMLInputElement) ||
      !event.target.matches("[data-product-search]")
    ) {
      return;
    }
    searchTerm = event.target.value;
    const grid = root.querySelector<HTMLElement>("[data-catalog-grid]");
    const count = root.querySelector<HTMLElement>("[data-result-count]");
    if (grid) {
      grid.innerHTML = renderCatalogGrid();
    }
    if (count) {
      count.textContent = `${getFilteredProducts().length} of ${products.length} products`;
    }
  });

  root.addEventListener("change", (event) => {
    if (
      !(event.target instanceof HTMLInputElement) ||
      !event.target.matches('input[name="payment-method"]')
    ) {
      return;
    }
    updateCheckoutUI();
  });

  const refreshCatalog = (): void => {
    const pills = root.querySelector<HTMLElement>("[data-category-filters]");
    if (pills) {
      pills.innerHTML = renderCategoryButtons();
    }
    const grid = root.querySelector<HTMLElement>("[data-catalog-grid]");
    const count = root.querySelector<HTMLElement>("[data-result-count]");
    if (grid) {
      grid.innerHTML = renderCatalogGrid();
    }
    if (count) {
      count.textContent = `${getFilteredProducts().length} of ${products.length} products`;
    }
  };

  const getFilteredProducts = (): Product[] => {
    const query = searchTerm.trim().toLowerCase();
    return products.filter((product) => {
      if (selectedCategory && product.category !== selectedCategory) {
        return false;
      }
      if (!query) {
        return true;
      }
      return [product.name, product.description, product.seller_name ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  };

  const setNotice = (message: string, state: "info" | "success" | "error"): void => {
    const element = root.querySelector<HTMLElement>("[data-admin-notice]");
    if (!element) {
      notice = { message, state };
      return;
    }
    element.className = `admin-notice is-visible is-${state}`;
    element.textContent = message;
  };

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

function orderTotal(order: Order): number {
  return order.items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
}

function paymentBadge(order: Order): string {
  if (order.payment_status === "paid") {
    return '<span class="rt-pay-badge">Paid</span>';
  }
  if (order.payment_method === "cod") {
    return '<span class="rt-pay-badge is-cod">COD</span>';
  }
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function functionErrorMessage(error: unknown): string {
  if (isRecord(error) && isRecord(error.context) && typeof error.context.error === "string") {
    return error.context.error;
  }
  return error instanceof Error ? error.message : "The checkout could not be completed.";
}

function readFormText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function setFeedback(
  form: HTMLFormElement,
  message: string,
  state = "info",
  selector = "[data-form-feedback]",
): void {
  const feedback = form.querySelector<HTMLElement>(selector);
  if (!feedback) {
    return;
  }
  feedback.className = `admin-form-feedback is-visible is-${state}`;
  feedback.textContent = message;
}

function canCancelOrder(order: Order): boolean {
  return order.status === "pending" || (order.status === "confirmed" && !order.cancel_requested);
}

function statusLabel(status: OrderStatus): string {
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

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortId(value: string): string {
  return value.replaceAll("-", "").slice(0, 8).toUpperCase();
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
