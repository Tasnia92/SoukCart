import { supabase } from "../supabase.ts";
import { renderAuthShell } from "./AuthShell.ts";
import { renderBrand } from "./Brand.ts";
import { renderIcon } from "./Icon.ts";

type AdminUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
};

type AdminUsersResponse = {
  users: AdminUser[];
};

type ActivityLine = {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  amount: number;
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_email: string | null;
};

type ActivityOrder = {
  id: string;
  status: string;
  cancel_requested: boolean;
  payment_status: string;
  payment_method: string;
  created_at: string;
  retailer_id: string;
  retailer_name: string;
  retailer_email: string;
  total: number;
  lines: ActivityLine[];
};

type ActivitySummary = {
  orders: number;
  revenue: number;
  retailers: number;
  suppliers: number;
  units: number;
};

type ActivityResponse = {
  summary: ActivitySummary;
  orders: ActivityOrder[];
};

type Complaint = {
  id: string;
  subject: string;
  description: string;
  attachment_url: string | null;
  status: "open" | "resolved";
  created_at: string;
  retailer_id: string;
  retailer_name: string;
  retailer_email: string;
};

type ComplaintsResponse = {
  complaints: Complaint[];
};

type Notice = {
  message: string;
  state: "info" | "success" | "error";
};

const ORDER_STATUSES = ["pending", "confirmed", "shipped", "delivered", "cancelled"] as const;
const ADMIN_FUNCTION = "admin-user-management";
const ADMIN_ACTIVITY_FUNCTION = "admin-order-overview";
const ADMIN_COMPLAINTS_FUNCTION = "admin-complaints";

export function renderAdminApp(root: HTMLDivElement): void {
  let users: AdminUser[] = [];
  let activityOrders: ActivityOrder[] = [];
  let activitySummary: ActivitySummary | null = null;
  let complaints: Complaint[] = [];
  let currentAdminId = "";
  let currentAdminName = "";
  let currentAdminEmail = "";
  let searchTerm = "";
  let activitySearch = "";
  let complaintSearch = "";
  let notice: Notice | null = null;
  const isUsersPage = window.location.pathname.endsWith("/users");
  const isActivityPage = window.location.pathname.endsWith("/activity");
  const isComplaintsPage = window.location.pathname.endsWith("/complaints");

  const render = (html: string) => {
    root.innerHTML = html;
  };

  const renderAuth = (message = "") => {
    render(
      `<div class="admin-login">${renderAuthShell("login", {
        title: "Admin sign in",
        showEyebrow: false,
        showLegal: false,
        showCreateAccount: false,
        showForgotPassword: false,
      })}</div>`,
    );
    if (message) {
      setFeedback(root.querySelector<HTMLFormElement>("[data-auth-form]"), message, "error");
    }
  };

  const getFilteredUsers = (): AdminUser[] => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) {
      return users;
    }

    return users.filter((user) =>
      [user.id, user.email, user.name].some((value) => value.toLowerCase().includes(query)),
    );
  };

  const renderRows = () => {
    const tableBody = root.querySelector<HTMLTableSectionElement>("[data-users-body]");
    if (!tableBody) {
      return;
    }

    const filteredUsers = getFilteredUsers();
    tableBody.innerHTML = filteredUsers.length
      ? filteredUsers.map((user) => renderUserRow(user, currentAdminId)).join("")
      : `<tr><td class="admin-empty" colspan="7">
          <strong>No matching users</strong>
          <span>Try a different ID, email, or name.</span>
        </td></tr>`;

    const resultCount = root.querySelector<HTMLElement>("[data-result-count]");
    if (resultCount) {
      resultCount.textContent = `${filteredUsers.length} of ${users.length} accounts`;
    }
  };

  const renderStats = () => {
    const now = Date.now();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const recentlyActive = users.filter(
      (user) =>
        user.last_sign_in_at && now - new Date(user.last_sign_in_at).getTime() <= thirtyDays,
    ).length;
    const newThisWeek = users.filter(
      (user) => now - new Date(user.created_at).getTime() <= sevenDays,
    ).length;
    const needsSetup = users.filter((user) => !user.role).length;

    setStat("total", String(users.length));
    setStat("active", String(recentlyActive));
    setStat("new", String(newThisWeek));
    setStat("setup", String(needsSetup));
  };

  const renderSidebar = () => `
    <aside class="admin-sidebar">
      <div class="admin-sidebar-top">
        ${renderBrand("dark")}
      </div>
      <nav class="admin-nav" aria-label="Admin navigation">
        <a class="admin-tab${isUsersPage || isActivityPage || isComplaintsPage ? "" : " is-active"}" href="/admin">
          ${renderIcon("layers")}
          <span>Overview</span>
        </a>
        <a class="admin-tab${isActivityPage ? " is-active" : ""}" href="/admin/activity">
          ${renderIcon("activity")}
          <span>Order activity</span>
        </a>
        <a class="admin-tab${isComplaintsPage ? " is-active" : ""}" href="/admin/complaints">
          ${renderIcon("message")}
          <span>Disputes &amp; Claims</span>
        </a>
        <a class="admin-tab${isUsersPage ? " is-active" : ""}" href="/admin/users">
          ${renderIcon("person")}
          <span>User directory</span>
        </a>
      </nav>
      <div class="admin-sidebar-footer">
        <div class="admin-user">
          <span class="admin-user-info">
            <strong>${escapeHtml(currentAdminName || "Administrator")}</strong>
            <small>${escapeHtml(currentAdminEmail)}</small>
          </span>
        </div>
        <button class="button button-secondary button-block" type="button" data-logout>
          <span>Log out</span>
        </button>
      </div>
    </aside>`;

  const renderOverview = () => {
    render(`<div class="admin-layout">
      ${renderSidebar()}
      <main class="admin-main">
        <header class="admin-header">
          <div>
            <p class="eyebrow">System overview</p>
            <h1 class="display-xl">Everything in sync.</h1>
          </div>
          <div class="admin-header-actions">
            <button class="button button-subtle" type="button" data-refresh>${renderIcon("refresh")}<span>Refresh</span></button>
          </div>
        </header>

        <p class="admin-notice${notice ? ` is-visible is-${notice.state}` : ""}" data-admin-notice role="status">${notice ? escapeHtml(notice.message) : ""}</p>

        <section class="admin-stats" aria-label="System statistics">
          ${renderStat("total", "Total accounts", "All registered users")}
          ${renderStat("active", "Seen in 30 days", "Recent sign-ins")}
          ${renderStat("new", "New this week", "Fresh registrations")}
          ${renderStat("setup", "Needs setup", "No account type yet")}
        </section>
      </main>
    </div>`);
    renderStats();
  };

  const renderUsers = () => {
    const filteredUsers = getFilteredUsers();
    render(`<div class="admin-layout">
      ${renderSidebar()}
      <main class="admin-main">
        <header class="admin-header">
          <div>
            <p class="eyebrow">People &amp; access</p>
            <h1 class="display-xl">User directory</h1>
            <p>Search by ID number, inspect account activity, or manage access.</p>
          </div>
          <div class="admin-header-actions">
            <button class="button button-primary" type="button" data-toggle-create>
              <span>+ New user</span>
            </button>
          </div>
        </header>

        <p class="admin-notice${notice ? ` is-visible is-${notice.state}` : ""}" data-admin-notice role="status">${notice ? escapeHtml(notice.message) : ""}</p>

        <div class="admin-create-panel" data-create-panel hidden>
          <div class="admin-create-heading">
            <div>
              <p class="eyebrow">Add to workspace</p>
              <h3 class="display-sm">Create a user</h3>
            </div>
            <button class="icon-button" type="button" data-cancel-create aria-label="Close create user form">&times;</button>
          </div>
          <form class="admin-create-form" data-create-user>
            <label class="admin-field">
              <span>Full name</span>
              <input name="name" type="text" autocomplete="name" maxlength="100" required />
            </label>
            <label class="admin-field">
              <span>Email address</span>
              <input name="email" type="email" autocomplete="email" required />
            </label>
            <label class="admin-field">
              <span>Temporary password</span>
              <input name="password" type="password" minlength="8" autocomplete="new-password" required />
            </label>
            <label class="admin-field">
              <span>Account type</span>
              <select name="role">
                <option value="">Let the user choose later</option>
                <option value="seller">Seller</option>
                <option value="retailer">Retailer</option>
                <option value="admin">Administrator</option>
              </select>
            </label>
            <div class="admin-create-actions">
              <button class="button button-secondary" type="button" data-cancel-create>Cancel</button>
              <button class="button button-primary" type="submit"><span>Create user</span></button>
            </div>
            <p class="admin-form-feedback" data-create-feedback role="status" aria-live="polite"></p>
          </form>
        </div>

        <div class="admin-toolbar">
          <label class="admin-search">
            ${renderIcon("search")}
            <span class="sr-only">Search users</span>
            <input type="search" data-user-search placeholder="Search by user ID number" value="${escapeHtml(searchTerm)}" />
          </label>
          <span class="admin-result-count" data-result-count>${filteredUsers.length} of ${users.length} accounts</span>
        </div>

        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead><tr><th>User</th><th>Email</th><th>User ID</th><th>Type</th><th>Joined</th><th>Last active</th><th><span class="sr-only">Actions</span></th></tr></thead>
            <tbody data-users-body>${filteredUsers.length ? filteredUsers.map((user) => renderUserRow(user, currentAdminId)).join("") : `<tr><td class="admin-empty" colspan="7"><strong>No users yet</strong><span>New registrations will appear here automatically.</span></td></tr>`}</tbody>
          </table>
        </div>
      </main>
    </div>`);
  };

  const getFilteredActivityOrders = (): ActivityOrder[] => {
    const query = activitySearch.trim().toLowerCase();
    if (!query) {
      return activityOrders;
    }

    return activityOrders.filter((order) => {
      if (
        shortId(order.id).toLowerCase().includes(query) ||
        `${order.retailer_name} ${order.retailer_email}`.toLowerCase().includes(query)
      ) {
        return true;
      }
      return order.lines.some((line) =>
        `${line.product_name} ${line.supplier_name ?? ""}`.toLowerCase().includes(query),
      );
    });
  };

  const renderActivityOrderRows = (order: ActivityOrder): string => `
    <tr class="rt-order-row" data-activity-toggle="${order.id}" aria-expanded="false">
      <td><strong class="rt-order-id">#${shortId(order.id)}</strong></td>
      <td>${formatDate(order.created_at)}</td>
      <td><div class="admin-user-cell"><span class="admin-avatar">${escapeHtml(getInitials(order.retailer_name))}</span><span><strong>${escapeHtml(order.retailer_name)}</strong><small>${escapeHtml(order.retailer_email)}</small></span></div></td>
      <td>${order.lines.reduce((sum, line) => sum + line.quantity, 0)}</td>
      <td><strong>${formatPrice(order.total)}</strong></td>
      <td>${activityPaymentBadge(order)}</td>
      <td><span class="rt-status rt-status-${order.status}">${statusLabel(order.status)}</span>${order.cancel_requested ? '<span class="rt-cancel-flag">Cancel requested</span>' : ""}</td>
      <td class="rt-order-toggle">${renderIcon("plus")}</td>
    </tr>
    <tr class="rt-order-detail" data-activity-detail="${order.id}" hidden>
      <td colspan="8">
        <div class="rt-order-detail-body">
          ${order.lines
            .map(
              (line) => `
            <div class="ad-activity-line">
              <span class="ad-activity-product"><strong>${escapeHtml(line.product_name)}</strong><small>from ${escapeHtml(line.supplier_name ?? "an unassigned supplier")}</small></span>
              <span>${line.quantity} × ${formatPrice(line.unit_price)}</span>
              <strong>${formatPrice(line.amount)}</strong>
            </div>`,
            )
            .join("")}
          <div class="ad-order-admin">
            <label class="ad-order-status-field">
              <span>Status</span>
              <select data-order-status-select="${order.id}" aria-label="Order status for #${shortId(order.id)}">
                ${ORDER_STATUSES.map(
                  (value) =>
                    `<option value="${value}"${order.status === value ? " selected" : ""}>${statusLabel(value)}</option>`,
                ).join("")}
              </select>
            </label>
            ${
              order.cancel_requested
                ? `<div class="ad-cancel-request">
                    <span class="rt-cancel-flag">Cancellation requested by ${escapeHtml(order.retailer_name)}</span>
                    <button class="delete-button" type="button" data-approve-cancel="${order.id}">Approve &amp; cancel</button>
                    <button class="button button-subtle" type="button" data-reject-cancel="${order.id}"><span>Reject request</span></button>
                  </div>`
                : ""
            }
          </div>
        </div>
      </td>
    </tr>`;

  const renderActivityRows = () => {
    const tableBody = root.querySelector<HTMLTableSectionElement>("[data-activity-body]");
    if (!tableBody) {
      return;
    }

    const filteredOrders = getFilteredActivityOrders();
    tableBody.innerHTML = filteredOrders.length
      ? filteredOrders.map((order) => renderActivityOrderRows(order)).join("")
      : `<tr><td class="admin-empty" colspan="8">
          <strong>No matching orders</strong>
          <span>Try a different retailer, supplier, or product.</span>
        </td></tr>`;

    const resultCount = root.querySelector<HTMLElement>("[data-activity-count]");
    if (resultCount) {
      resultCount.textContent = `${filteredOrders.length} of ${activityOrders.length} orders`;
    }
  };

  const renderActivity = () => {
    render(`<div class="admin-layout">
      ${renderSidebar()}
      <main class="admin-main">
        <header class="admin-header">
          <div>
            <p class="eyebrow">Order activity</p>
            <h1 class="display-xl">Every order, end to end.</h1>
            <p>Who bought what, from whom, and how much.</p>
          </div>
          <div class="admin-header-actions">
            <button class="button button-subtle" type="button" data-refresh>${renderIcon("refresh")}<span>Refresh</span></button>
          </div>
        </header>

        <p class="admin-notice${notice ? ` is-visible is-${notice.state}` : ""}" data-admin-notice role="status">${notice ? escapeHtml(notice.message) : ""}</p>

        <section class="admin-stats" aria-label="Order activity summary">
          ${renderStat("orders", "Orders", "All time")}
          ${renderStat("revenue", "Revenue", "Paid only")}
          ${renderStat("retailers", "Retailers")}
          ${renderStat("suppliers", "Suppliers")}
        </section>

        <div class="admin-toolbar">
          <label class="admin-search">
            ${renderIcon("search")}
            <span class="sr-only">Search orders</span>
            <input type="search" data-activity-search placeholder="Search orders" value="${escapeHtml(activitySearch)}" />
          </label>
          <span class="admin-result-count" data-activity-count>${activityOrders.length} of ${activityOrders.length} orders</span>
        </div>

        ${
          activityOrders.length
            ? `<div class="admin-table-wrap">
          <table class="admin-table rt-orders-table">
            <thead><tr><th>Order</th><th>Placed</th><th>Retailer</th><th>Units</th><th>Total</th><th>Payment</th><th>Status</th><th><span class="sr-only">Order lines</span></th></tr></thead>
            <tbody data-activity-body>${activityOrders.map((order) => renderActivityOrderRows(order)).join("")}</tbody>
          </table>
        </div>`
            : `<div class="rt-empty-card">
        <span class="rt-empty-icon">${renderIcon("activity")}</span>
        <strong>No orders yet</strong>
        <span>New orders show up here.</span>
      </div>`
        }
      </main>
    </div>`);

    const summary = activitySummary;
    if (summary) {
      setStat("orders", String(summary.orders));
      setStat("revenue", formatPrice(summary.revenue));
      setStat("retailers", String(summary.retailers));
      setStat("suppliers", String(summary.suppliers));
    }
  };

  const getFilteredComplaints = (): Complaint[] => {
    const query = complaintSearch.trim().toLowerCase();
    if (!query) {
      return complaints;
    }
    return complaints.filter((complaint) =>
      [complaint.subject, complaint.description, complaint.retailer_name, complaint.retailer_email]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  };

  const renderComplaintRows = () => {
    const tableBody = root.querySelector<HTMLTableSectionElement>("[data-complaints-body]");
    if (!tableBody) {
      return;
    }
    const filtered = getFilteredComplaints();
    tableBody.innerHTML = filtered.length
      ? filtered
          .map(
            (complaint) => `
        <tr>
          <td><div class="cp-cell"><strong>${escapeHtml(complaint.subject)}</strong><small>${escapeHtml(complaint.description)}</small></div></td>
          <td><div class="admin-user-cell"><span class="admin-avatar">${escapeHtml(getInitials(complaint.retailer_name))}</span><span><strong>${escapeHtml(complaint.retailer_name)}</strong><small>${escapeHtml(complaint.retailer_email)}</small></span></div></td>
          <td>${complaint.attachment_url ? `<a class="text-button" href="${escapeHtml(complaint.attachment_url)}" target="_blank" rel="noopener noreferrer">${renderIcon("download")}<span>Attachment</span></a>` : '<span class="admin-muted">None</span>'}</td>
          <td>${formatDate(complaint.created_at)}</td>
          <td><span class="cp-status cp-status-${complaint.status}">${complaint.status === "open" ? "Open" : "Resolved"}</span></td>
          <td class="admin-action-cell">${complaint.status === "open" ? `<button class="delete-button" type="button" data-resolve-complaint="${complaint.id}">Mark resolved</button>` : ""}</td>
        </tr>`,
          )
          .join("")
      : `<tr><td class="admin-empty" colspan="6">
          <strong>No matching complaints</strong>
          <span>Try a different retailer or subject.</span>
        </td></tr>`;

    const resultCount = root.querySelector<HTMLElement>("[data-complaints-count]");
    if (resultCount) {
      resultCount.textContent = `${filtered.length} of ${complaints.length} filed`;
    }
  };

  const renderComplaints = () => {
    const open = complaints.filter((complaint) => complaint.status === "open").length;
    const resolved = complaints.length - open;
    const retailers = new Set(complaints.map((complaint) => complaint.retailer_id)).size;
    render(`<div class="admin-layout">
      ${renderSidebar()}
      <main class="admin-main">
        <header class="admin-header">
          <div>
            <p class="eyebrow">Retailer support</p>
            <h1 class="display-xl">Disputes &amp; Claims.</h1>
            <p>Filed by retailers, with status.</p>
          </div>
        </header>

        <p class="admin-notice${notice ? ` is-visible is-${notice.state}` : ""}" data-admin-notice role="status">${notice ? escapeHtml(notice.message) : ""}</p>

        <section class="admin-stats" aria-label="Complaints summary">
          ${renderStat("c-total", "Total filed")}
          ${renderStat("c-open", "Open")}
          ${renderStat("c-resolved", "Resolved")}
          ${renderStat("c-retailers", "Retailers filing")}
        </section>

        <div class="admin-toolbar">
          <label class="admin-search">
            ${renderIcon("search")}
            <span class="sr-only">Search complaints</span>
            <input type="search" data-complaint-search placeholder="Search complaints" value="${escapeHtml(complaintSearch)}" />
          </label>
          <span class="admin-result-count" data-complaints-count>${complaints.length} of ${complaints.length} filed</span>
        </div>

        ${
          complaints.length
            ? `<div class="admin-table-wrap">
          <table class="admin-table cp-table">
            <thead><tr><th>Complaint</th><th>Retailer</th><th>Attachment</th><th>Filed</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
            <tbody data-complaints-body>${complaints.map((complaint) => renderComplaintRow(complaint)).join("")}</tbody>
          </table>
        </div>`
            : `<div class="rt-empty-card">
        <span class="rt-empty-icon">${renderIcon("message")}</span>
        <strong>No complaints yet</strong>
      </div>`
        }
      </main>
    </div>`);

    setStat("c-total", String(complaints.length));
    setStat("c-open", String(open));
    setStat("c-resolved", String(resolved));
    setStat("c-retailers", String(retailers));
  };

  const renderComplaintRow = (complaint: Complaint): string => `
    <tr>
      <td><div class="cp-cell"><strong>${escapeHtml(complaint.subject)}</strong><small>${escapeHtml(complaint.description)}</small></div></td>
      <td><div class="admin-user-cell"><span class="admin-avatar">${escapeHtml(getInitials(complaint.retailer_name))}</span><span><strong>${escapeHtml(complaint.retailer_name)}</strong><small>${escapeHtml(complaint.retailer_email)}</small></span></div></td>
      <td>${complaint.attachment_url ? `<a class="text-button" href="${escapeHtml(complaint.attachment_url)}" target="_blank" rel="noopener noreferrer">${renderIcon("download")}<span>Attachment</span></a>` : '<span class="admin-muted">None</span>'}</td>
      <td>${formatDate(complaint.created_at)}</td>
      <td><span class="cp-status cp-status-${complaint.status}">${complaint.status === "open" ? "Open" : "Resolved"}</span></td>
      <td class="admin-action-cell">${complaint.status === "open" ? `<button class="delete-button" type="button" data-resolve-complaint="${complaint.id}">Mark resolved</button>` : ""}</td>
    </tr>`;

  const renderPanel = () => {
    if (isUsersPage) {
      renderUsers();
    } else if (isActivityPage) {
      renderActivity();
    } else if (isComplaintsPage) {
      renderComplaints();
    } else {
      renderOverview();
    }
  };

  const loadDashboard = async () => {
    if (isActivityPage) {
      const response = await invokeAdmin<ActivityResponse>(
        { action: "list" },
        ADMIN_ACTIVITY_FUNCTION,
      );
      activitySummary = response.summary;
      activityOrders = response.orders;
      renderPanel();
      return;
    }

    if (isComplaintsPage) {
      const response = await invokeAdmin<ComplaintsResponse>(
        { action: "list" },
        ADMIN_COMPLAINTS_FUNCTION,
      );
      complaints = response.complaints;
      renderPanel();
      return;
    }

    const response = await invokeAdmin<AdminUsersResponse>({ action: "list" });
    users = response.users;
    renderPanel();
  };

  const renderError = (message: string) => {
    render(`<div class="admin-error-screen">
      <p class="eyebrow">Admin workspace</p>
      <h1 class="display-lg">We could not load the admin workspace.</h1>
      <p>${escapeHtml(message)}</p>
      <div class="admin-error-actions">
        <button class="button button-primary" type="button" data-refresh><span>Try again</span></button>
        <button class="button button-subtle" type="button" data-logout>Log out</button>
      </div>
    </div>`);
  };

  const boot = async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      renderAuth();
      return;
    }

    currentAdminId = data.session.user.id;
    const { data: profile, error: profileError } = await supabase
      .from("users")
      .select("role, name, email")
      .eq("id", currentAdminId)
      .single();

    if (profileError || profile?.role !== "admin") {
      await supabase.auth.signOut();
      renderAuth("This account is not an admin.");
      return;
    }

    currentAdminName = profile?.name ?? "";
    currentAdminEmail = profile?.email ?? "";

    try {
      await loadDashboard();
    } catch (error) {
      renderError(error instanceof Error ? error.message : "Please try again.");
    }
  };

  root.addEventListener("click", async (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const logout = event.target.closest<HTMLButtonElement>("[data-logout]");
    if (logout) {
      await supabase.auth.signOut();
      renderAuth();
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

    const toggleCreate = event.target.closest<HTMLButtonElement>("[data-toggle-create]");
    if (toggleCreate) {
      const panel = root.querySelector<HTMLElement>("[data-create-panel]");
      if (panel) {
        panel.hidden = false;
        root.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
      }
      return;
    }

    const cancelCreate = event.target.closest<HTMLButtonElement>("[data-cancel-create]");
    if (cancelCreate) {
      const panel = root.querySelector<HTMLElement>("[data-create-panel]");
      const form = root.querySelector<HTMLFormElement>("[data-create-user]");
      if (panel && form) {
        panel.hidden = true;
        form.reset();
        setFeedback(form, "", "info", "[data-create-feedback]");
      }
      return;
    }

    const activityRow = event.target.closest<HTMLTableRowElement>("[data-activity-toggle]");
    if (activityRow) {
      const orderId = activityRow.dataset.activityToggle;
      const detail = orderId
        ? root.querySelector<HTMLTableRowElement>(`[data-activity-detail="${orderId}"]`)
        : null;
      if (orderId && detail) {
        const expanded = detail.hidden;
        detail.hidden = !expanded;
        activityRow.setAttribute("aria-expanded", String(expanded));
        const toggleCell = activityRow.querySelector<HTMLElement>(".rt-order-toggle");
        if (toggleCell) {
          toggleCell.innerHTML = renderIcon(expanded ? "minus" : "plus");
        }
      }
      return;
    }

    const approveButton = event.target.closest<HTMLButtonElement>("[data-approve-cancel]");
    if (approveButton) {
      await setOrderStatus(approveButton, approveButton.dataset.approveCancel, "cancelled");
      return;
    }

    const rejectButton = event.target.closest<HTMLButtonElement>("[data-reject-cancel]");
    if (rejectButton) {
      const orderId = rejectButton.dataset.rejectCancel;
      const order = activityOrders.find((item) => item.id === orderId);
      if (order) {
        await setOrderStatus(rejectButton, orderId, order.status);
      }
      return;
    }

    const resolveButton = event.target.closest<HTMLButtonElement>("[data-resolve-complaint]");
    if (resolveButton) {
      const complaintId = resolveButton.dataset.resolveComplaint;
      const complaint = complaints.find((item) => item.id === complaintId);
      if (complaint) {
        resolveButton.disabled = true;
        try {
          await invokeAdmin(
            { action: "update", complaintId, status: "resolved" },
            ADMIN_COMPLAINTS_FUNCTION,
          );
          complaint.status = "resolved";
          notice = { message: "Complaint marked as resolved.", state: "success" };
          renderComplaints();
        } catch (error) {
          resolveButton.disabled = false;
          setAdminNotice(
            error instanceof Error ? error.message : "The complaint could not be updated.",
            "error",
          );
        }
      }
      return;
    }

    const deleteButton = event.target.closest<HTMLButtonElement>("[data-delete-user]");
    if (deleteButton) {
      const userId = deleteButton.dataset.deleteUser;
      const userName = deleteButton.dataset.userName || "this user";
      if (!userId || !window.confirm(`Delete ${userName}'s account? This cannot be undone.`)) {
        return;
      }

      deleteButton.disabled = true;
      try {
        await invokeAdmin({ action: "delete", userId });
        notice = { message: `${userName}'s account was deleted.`, state: "success" };
        await loadDashboard();
      } catch (error) {
        deleteButton.disabled = false;
        setAdminNotice(
          error instanceof Error ? error.message : "The user could not be deleted.",
          "error",
        );
      }
      return;
    }

    const passwordToggle = event.target.closest<HTMLButtonElement>("[data-password-toggle]");
    if (passwordToggle) {
      const inputId = passwordToggle.getAttribute("aria-controls");
      const input = inputId ? document.getElementById(inputId) : null;
      if (!(input instanceof HTMLInputElement)) {
        return;
      }

      const shouldShow = input.type === "password";
      input.type = shouldShow ? "text" : "password";
      passwordToggle.setAttribute("aria-pressed", String(shouldShow));
      passwordToggle.setAttribute(
        "aria-label",
        `${shouldShow ? "Hide" : "Show"} ${input.labels?.[0]?.textContent?.toLowerCase() ?? "password"}`,
      );
      passwordToggle.innerHTML = renderIcon(shouldShow ? "eye" : "eye-off", "input-action-icon");
      return;
    }
  });

  root.addEventListener("change", async (event) => {
    if (
      !(event.target instanceof HTMLSelectElement) ||
      !event.target.matches("[data-order-status-select]")
    ) {
      return;
    }
    const orderId = event.target.dataset.orderStatusSelect;
    const order = activityOrders.find((item) => item.id === orderId);
    if (!order) {
      return;
    }
    const status = event.target.value;
    if (status === order.status && !order.cancel_requested) {
      return;
    }
    await setOrderStatus(event.target, orderId, status);
  });

  const setOrderStatus = async (
    control: HTMLElement,
    orderId: string | undefined,
    status: string,
  ): Promise<void> => {
    const order = activityOrders.find((item) => item.id === orderId);
    if (!order || !orderId) {
      return;
    }
    const approved = status === "cancelled" && order.status !== "cancelled";
    const rejecting = order.cancel_requested && status === order.status;
    const confirmed = window.confirm(
      rejecting
        ? `Reject the cancellation request for order #${shortId(orderId)}?`
        : approved
          ? `Cancel order #${shortId(orderId)} for ${order.retailer_name}? ${order.cancel_requested ? "This approves their cancellation request." : ""}`.trim()
          : `Set order #${shortId(orderId)} to ${statusLabel(status)}?`,
    );
    if (!confirmed) {
      renderActivityRows();
      return;
    }
    control.setAttribute("disabled", "true");
    try {
      await invokeAdmin({ action: "update-status", orderId, status }, ADMIN_ACTIVITY_FUNCTION);
      order.status = status;
      order.cancel_requested = false;
      notice = rejecting
        ? { message: `Cancellation request for #${shortId(orderId)} was rejected.`, state: "info" }
        : approved
          ? { message: `Order #${shortId(orderId)} was cancelled.`, state: "success" }
          : {
              message: `Order #${shortId(orderId)} is now ${statusLabel(status)}.`,
              state: "success",
            };
      renderActivityRows();
      setAdminNotice(notice.message, notice.state);
    } catch (error) {
      control.removeAttribute("disabled");
      setAdminNotice(
        error instanceof Error ? error.message : "The order status could not be updated.",
        "error",
      );
    }
  };

  root.addEventListener("input", (event) => {
    if (!(event.target instanceof HTMLInputElement)) {
      return;
    }

    if (event.target.matches("[data-user-search]")) {
      searchTerm = event.target.value;
      renderRows();
      return;
    }

    if (event.target.matches("[data-activity-search]")) {
      activitySearch = event.target.value;
      renderActivityRows();
      return;
    }

    if (event.target.matches("[data-complaint-search]")) {
      complaintSearch = event.target.value;
      renderComplaintRows();
    }
  });

  root.addEventListener("submit", async (event) => {
    if (!(event.target instanceof HTMLFormElement)) {
      return;
    }

    if (event.target.matches("[data-auth-form]")) {
      event.preventDefault();
      const form = event.target;
      if (!form.reportValidity()) {
        return;
      }

      const formData = new FormData(form);
      const email = readFormText(formData, "email");
      const password = readFormText(formData, "password");
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setFeedback(form, error.message, "error");
        return;
      }
      await boot();
      return;
    }

    if (!event.target.matches("[data-create-user]")) {
      return;
    }

    event.preventDefault();
    const form = event.target;
    if (!form.reportValidity()) {
      return;
    }

    const submitButton = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    submitButton?.setAttribute("disabled", "true");
    setFeedback(form, "Creating account...", "info", "[data-create-feedback]");
    const formData = new FormData(form);
    try {
      await invokeAdmin({
        action: "create",
        name: readFormText(formData, "name"),
        email: readFormText(formData, "email"),
        password: readFormText(formData, "password"),
        role: readFormText(formData, "role"),
      });
      form.reset();
      const panel = root.querySelector<HTMLElement>("[data-create-panel]");
      if (panel) {
        panel.hidden = true;
      }
      notice = { message: "The new user was created successfully.", state: "success" };
      await loadDashboard();
    } catch (error) {
      setFeedback(
        form,
        error instanceof Error ? error.message : "The user could not be created.",
        "error",
        "[data-create-feedback]",
      );
      submitButton?.removeAttribute("disabled");
    }
  });

  void boot();
}

async function invokeAdmin<T>(
  body: Record<string, unknown>,
  functionName = ADMIN_FUNCTION,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(functionName, { body });
  if (error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      try {
        const payload = (await context.json()) as { error?: unknown };
        if (typeof payload.error === "string") {
          throw new Error(payload.error);
        }
      } catch (responseError) {
        if (
          responseError instanceof Error &&
          responseError.message !== "Unexpected end of JSON input"
        ) {
          throw responseError;
        }
      }
    }
    throw new Error(error.message || "The admin service is unavailable.");
  }
  if (!data) {
    throw new Error("The admin service returned no data.");
  }
  return data;
}

function renderStat(key: string, label: string, detail = ""): string {
  return `<article class="admin-stat">
    <p class="admin-stat-label">${label}</p>
    <strong data-stat="${key}">0</strong>
    ${detail ? `<small>${detail}</small>` : ""}
  </article>`;
}

function renderUserRow(user: AdminUser, currentAdminId: string): string {
  const isCurrentAdmin = user.id === currentAdminId;
  const role = user.role || "Needs setup";
  const status = user.email_confirmed_at ? "Verified" : "Pending";
  return `<tr>
    <td><div class="admin-user-cell"><span class="admin-avatar">${escapeHtml(getInitials(user.name || user.email))}</span><span><strong>${escapeHtml(user.name || "Unnamed user")}</strong><small>${status}</small></div></td>
    <td>${escapeHtml(user.email)}</td>
    <td><code class="admin-user-id" title="${escapeHtml(user.id)}">${escapeHtml(user.id)}</code></td>
    <td><span class="admin-role">${escapeHtml(role)}</span></td>
    <td>${formatDate(user.created_at)}</td>
    <td>${user.last_sign_in_at ? formatDate(user.last_sign_in_at) : '<span class="admin-muted">Never</span>'}</td>
    <td class="admin-action-cell">${isCurrentAdmin ? '<span class="admin-current-user">You</span>' : `<button class="delete-button" type="button" data-delete-user="${escapeHtml(user.id)}" data-user-name="${escapeHtml(user.name || user.email)}">Delete</button>`}</td>
  </tr>`;
}

function setStat(key: string, value: string): void {
  const element = document.querySelector<HTMLElement>(`[data-stat="${key}"]`);
  if (element) {
    element.textContent = value;
  }
}

function readFormText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function setAdminNotice(message: string, state: Notice["state"]): void {
  const element = document.querySelector<HTMLElement>("[data-admin-notice]");
  if (!element) {
    return;
  }
  element.className = `admin-notice is-${state}`;
  element.textContent = message;
}

function setFeedback(
  form: HTMLFormElement | null,
  message: string,
  state = "info",
  selector = "[data-form-feedback]",
): void {
  const feedback = form?.querySelector<HTMLElement>(selector);
  if (!feedback) {
    return;
  }

  const baseClass = selector === "[data-create-feedback]" ? "admin-form-feedback" : "form-feedback";
  feedback.className = `${baseClass} is-visible is-${state}`;
  feedback.textContent = message;
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

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatPrice(value: number): string {
  return `৳${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function shortId(value: string): string {
  return value.replaceAll("-", "").slice(0, 8).toUpperCase();
}

function statusLabel(status: string): string {
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
    default:
      return status;
  }
}

function activityPaymentBadge(order: ActivityOrder): string {
  if (order.payment_status === "paid") {
    return '<span class="rt-pay-badge">Paid</span>';
  }
  if (order.payment_method === "cod") {
    return '<span class="rt-pay-badge is-cod">COD</span>';
  }
  if (order.payment_status === "failed") {
    return '<span class="admin-muted">Failed</span>';
  }
  return "";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
