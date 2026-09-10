import User from '../models/User.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Payout from '../models/Payout.js';
import Notification from '../models/Notification.js';
import Settings from '../models/Settings.js';
import { computeSupplierBalance } from '../services/payout.service.js';
import { setStock } from '../services/stock.service.js';
import { notifyAdmins } from '../services/notify.js';
import { DEFAULT_COMMISSION_RATE } from '../services/calculations.js';
import { toShopSlug } from '../utils/slug.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// ════════════════════════════════════════════════════════════════════════════
// SUPPLIER-FLOW — MASTER MAP  (search "SUPPLIER-FLOW" to jump to every anchor)
// ────────────────────────────────────────────────────────────────────────────
// Everything a supplier can do, grouped into 8 areas. Each is tagged in code:
//   // ── SUPPLIER-FLOW <n>/8 · <AREA> ──
//
//   1/8 VERIFICATION ....... apply to become a supplier (admin approves: ADMIN-FLOW 3/7)
//         supplier.controller.js  submitVerification
//   2/8 DASHBOARD .......... home counts + balance + low-stock list
//         supplier.controller.js  dashboard
//   3/8 PRODUCTS ........... add / edit / hide / restore products
//         product.controller.js   createProduct, updateProduct
//         product.service.js      isCatalogVisible, hideProduct, restoreProduct
//   4/8 INVENTORY .......... stock levels + bulk +/- adjustments
//         supplier.controller.js  inventory, applyDelta
//         stock.service.js        setStock / recordStock
//   5/8 ORDERS ............. see and confirm orders (confirm = ORDER-FLOW 5/8)
//         order.routes.js         GET /api/orders, POST /api/orders/:id/confirm
//         order.service.js        confirmSupplierLines / setOrderStatus
//   6/8 RETAILERS .......... list of retailers who ordered from this supplier
//         supplier.controller.js  retailers
//   7/8 EARNINGS ........... balance, payout history, commission rate
//         supplier.controller.js  earnings
//         payout.service.js       computeSupplierBalance
//   8/8 NOTIFICATIONS ...... supplier notification feed (see NOTIFY-FLOW)
//         supplier.controller.js  notifications, markNotificationRead
//
// HOW TO READ: every /api/supplier route needs a logged-in supplier
//   (requireRole('supplier')). Products must be admin-approved before they show
//   in the catalog. Payout money is covered in detail by ADMIN-FLOW 4/7.
// ════════════════════════════════════════════════════════════════════════════

// ── SUPPLIER-FLOW 2/8 · DASHBOARD — supplier home numbers ──
// SEARCH: supplier-flow, supplier dashboard, stats, low stock
// DOES:   counts this supplier's orders / products / pending orders, adds their
//         balance (computeSupplierBalance) and lists up to 5 low-stock products.
export const dashboard = asyncHandler(async (req, res) => {
  const supplierId = req.user._id;
  const supplierMatch = {
    $or: [{ supplier: supplierId }, { suppliers: supplierId }, { 'items.supplier': supplierId }],
  };
  const [orders, products, pendingOrders] = await Promise.all([
    Order.countDocuments({ ...supplierMatch, status: { $nin: ['awaiting_payment'] }, deliveryFeePaid: true }),
    Product.countDocuments({ supplier: supplierId, status: { $ne: 'removed' } }),
    Order.countDocuments({ ...supplierMatch, status: 'placed', deliveryFeePaid: true }),
  ]);
  const balance = await computeSupplierBalance(supplierId);
  const lowStock = await Product.find({ supplier: supplierId, stock: { $lte: 10 }, status: { $ne: 'removed' } }).limit(5);
  res.json({ stats: { orders, products, pendingOrders, ...balance }, lowStock });
});

// ── SUPPLIER-FLOW 1/8 · VERIFICATION — apply to become a supplier ──
// SEARCH: supplier-flow, supplier application, verification, shop link
// DOES:   validates business name / shop link / NID doc, builds a unique shop
//         slug, saves the profile, sets verificationStatus = "pending", and alerts
//         admins (NOTIFY-FLOW 2/5). Admin approval happens in ADMIN-FLOW 3/7.
export const submitVerification = asyncHandler(async (req, res) => {
  const { businessName, shopLink, businessDescription, nidDocUrl } = req.body;
  if (!businessName || !shopLink || !nidDocUrl) {
    return res.status(400).json({ message: 'businessName, shopLink, and nidDocUrl are required' });
  }
  const shopSlug = toShopSlug(shopLink);
  if (!shopSlug) return res.status(400).json({ message: 'Shop slug is required (letters, numbers, dashes)' });
  const taken = await User.findOne({ shopSlug, _id: { $ne: req.user._id } });
  if (taken) return res.status(409).json({ message: 'That shop slug is already taken' });

  const user = await User.findByIdAndUpdate(
    req.user._id,
    {
      businessName,
      shopLink,
      shopSlug,
      businessDescription,
      nidDocUrl,
      verificationStatus: 'pending',
      verificationRejectReason: '',
    },
    { new: true }
  );
  await notifyAdmins({
    title: 'Supplier application submitted',
    body: `${user.businessName || user.name} submitted a verification application.`,
    link: `/admin/verifications/${user._id}`,
    type: 'supplier_application',
  });
  res.json({ user });
});

// ── SUPPLIER-FLOW 6/8 · RETAILERS — retailers who ordered from this supplier ──
// SEARCH: supplier-flow, retailer list, customers
// DOES:   groups this supplier's paid orders by retailer and totals each one's
//         order count, gross value and last order date.
export const retailers = asyncHandler(async (req, res) => {
  const orders = await Order.find({
    $or: [{ supplier: req.user._id }, { suppliers: req.user._id }, { 'items.supplier': req.user._id }],
    status: { $nin: ['awaiting_payment'] },
    deliveryFeePaid: true,
  }).populate('retailer', 'name email businessName phone');
  const map = new Map();
  for (const o of orders) {
    if (!o.retailer) continue;
    const id = String(o.retailer._id);
    const row = map.get(id) || {
      _id: o.retailer._id,
      name: o.retailer.name,
      email: o.retailer.email,
      businessName: o.retailer.businessName,
      phone: o.retailer.phone,
      orders: 0,
      gross: 0,
      lastOrderAt: null,
    };
    row.orders += 1;
    row.gross += o.subtotal || 0;
    const t = new Date(o.createdAt).getTime();
    if (!row.lastOrderAt || t > new Date(row.lastOrderAt).getTime()) row.lastOrderAt = o.createdAt;
    map.set(id, row);
  }
  res.json({ retailers: [...map.values()] });
});

// ── SUPPLIER-FLOW 4/8 · INVENTORY — this supplier's stock levels ──
// SEARCH: supplier-flow, inventory, stock levels
// DOES:   lists all of this supplier's non-removed products with category, sorted
//         lowest stock first so restocking is easy.
export const inventory = asyncHandler(async (req, res) => {
  const products = await Product.find({ supplier: req.user._id, status: { $ne: 'removed' } })
    .populate('category', 'name')
    .sort({ stock: 1 });
  res.json({ products });
});

// ── SUPPLIER-FLOW 4/8 · INVENTORY — bulk add/subtract stock ──
// SEARCH: supplier-flow, bulk stock, apply delta, adjust stock
// DOES:   takes a list of product ids owned by this supplier and a +/- delta, then
//         applies it through setStock (which writes StockHistory). Refuses ids
//         that are not the supplier's own.
export const applyDelta = asyncHandler(async (req, res) => {
  const { ids, delta } = req.body;
  const list = Array.isArray(ids) ? [...new Set(ids.map((id) => String(id)).filter(Boolean))] : [];
  if (list.length === 0) {
    return res.status(400).json({ message: 'Select at least one product' });
  }
  const d = Number(delta);
  if (!Number.isFinite(d)) {
    return res.status(400).json({ message: 'Delta must be a number like +10 or -10' });
  }
  const products = await Product.find({
    _id: { $in: list },
    supplier: req.user._id,
    status: { $ne: 'removed' },
  });
  const owned = new Set(products.map((p) => String(p._id)));
  const missing = list.filter((id) => !owned.has(id));
  if (missing.length > 0) {
    return res.status(403).json({ message: 'Some selected products are not yours' });
  }
  const sign = d >= 0 ? '+' : '';
  await Promise.all(
    products.map((p) =>
      setStock(p, Number(p.stock || 0) + d, {
        reason: 'adjust',
        actor: req.user._id,
        note: `Bulk ${sign}${d} applied`,
      })
    )
  );
  res.json({ updated: products.length, products });
});

// ── SUPPLIER-FLOW 7/8 · EARNINGS — balance, payouts, recent delivered orders ──
// SEARCH: supplier-flow, earnings, payouts, balance, commission
// DOES:   returns the computed balance (computeSupplierBalance), up to 50 payouts,
//         20 recent delivered orders and the current commission rate.
export const earnings = asyncHandler(async (req, res) => {
  const balance = await computeSupplierBalance(req.user._id);
  const payouts = await Payout.find({ supplier: req.user._id }).sort({ createdAt: -1 }).limit(50);
  const settings = await Settings.findOne({ key: 'global' });
  const recent = await Order.find({
    $or: [{ supplier: req.user._id }, { suppliers: req.user._id }, { 'items.supplier': req.user._id }],
    status: 'delivered',
  })
    .sort({ updatedAt: -1 })
    .limit(20);
  res.json({
    balance,
    payouts,
    recent,
    commissionRate: settings?.commissionRate ?? DEFAULT_COMMISSION_RATE,
  });
});

// ── SUPPLIER-FLOW 8/8 · NOTIFICATIONS — this supplier's feed (latest 50) ──
// SEARCH: supplier-flow, supplier notifications
// NOTE:   same Notification data as NOTIFY-FLOW 4/5, scoped to the supplier.
export const notifications = asyncHandler(async (req, res) => {
  const items = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50);
  res.json({ notifications: items });
});

// ── SUPPLIER-FLOW 8/8 · NOTIFICATIONS — mark one supplier notification read ──
// SEARCH: supplier-flow, mark notification read
// NOTE:   same as NOTIFY-FLOW 5/5, scoped to the supplier.
export const markNotificationRead = asyncHandler(async (req, res) => {
  const item = await Notification.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    { isRead: true },
    { new: true }
  );
  res.json({ notification: item });
});
