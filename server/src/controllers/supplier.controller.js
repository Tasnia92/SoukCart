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

export const inventory = asyncHandler(async (req, res) => {
  const products = await Product.find({ supplier: req.user._id, status: { $ne: 'removed' } })
    .populate('category', 'name')
    .sort({ stock: 1 });
  res.json({ products });
});

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

export const notifications = asyncHandler(async (req, res) => {
  const items = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50);
  res.json({ notifications: items });
});

export const markNotificationRead = asyncHandler(async (req, res) => {
  const item = await Notification.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    { isRead: true },
    { new: true }
  );
  res.json({ notification: item });
});
