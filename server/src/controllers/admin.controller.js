import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Payout from '../models/Payout.js';
import Complaint from '../models/Complaint.js';
import Settings from '../models/Settings.js';
import {
  computeSupplierBalance,
  createPayoutForSupplier,
  processWeeklyPayouts,
  markPayoutAsPaid,
} from '../services/payout.service.js';
import { completeManualRefund } from '../services/refund.service.js';
import { DEFAULT_COMMISSION_RATE } from '../services/calculations.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { notifyUser } from '../services/notify.js';

// ════════════════════════════════════════════════════════════════════════════
// ADMIN-FLOW — MASTER MAP  (search "ADMIN-FLOW" to jump to every anchor)
// ────────────────────────────────────────────────────────────────────────────
// Everything an admin can do, grouped into 7 areas. Each one is tagged in code:
//   // ── ADMIN-FLOW <n>/7 · <AREA> ──
//
//   1/7 DASHBOARD ......... counts + revenue/commission figures for /admin
//         admin.controller.js   dashboard
//   2/7 USERS ............. list / create / (de)activate retailer & supplier
//         admin.controller.js   listUsers, createUser, updateUser
//   3/7 VERIFICATIONS ..... approve or reject supplier applications
//         admin.controller.js   listVerifications, reviewVerification
//   4/7 PAYOUTS ........... supplier balances, payouts, commission rate
//         admin.controller.js   listPayouts, createPayout, runWeeklyPayouts,
//                               payPayout, updateCommission
//         payout.service.js     accruePayoutsForOrder, computeSupplierBalance,
//                               createPayoutForSupplier, processWeeklyPayouts,
//                               markPayoutAsPaid
//   5/7 DISPUTES .......... read and reply to complaints/disputes
//         admin.controller.js   listComplaints, updateComplaint
//   6/7 REFUNDS ........... send manually-queued refunds (see REFUND-FLOW 6/6)
//         admin.controller.js   listRefunds, completeRefund
//         refund.service.js     completeManualRefund
//   7/7 PRODUCTS .......... approve/reject/hide/restore/remove products + categories
//         product.controller.js createCategory, updateCategory, deleteCategory,
//                               moderateProduct, deleteProduct
//         product.routes.js     admin-only category + moderate/delete routes
//
// OTHER ADMIN ABILITIES live in their own flows:
//   • start delivery / change delivery status → ORDER-FLOW 6/8
//   • collect COD cash                        → ORDER-FLOW 7/8
//   • cancel an order                         → ORDER-FLOW 8/8 / REFUND-FLOW
// HOW TO READ: every /api/admin route needs a logged-in admin
//   (requireRole('admin')). Actions that tell people something use notify.js
//   (see NOTIFY-FLOW).
// ════════════════════════════════════════════════════════════════════════════

// ── ADMIN-FLOW 1/7 · DASHBOARD (home numbers) ──
// SEARCH: admin-flow, dashboard, stats, revenue, commission, trend
// DOES:   counts users / orders / products / pending verifications / open
//         complaints / pending refunds, then builds revenue, commission,
//         this-vs-last-month and a 7-day trend for the admin home screen.
export const dashboard = asyncHandler(async (_req, res) => {
  const [users, orders, products, pendingProducts, pendingVerifications, openComplaints, pendingRefunds] = await Promise.all([
    User.countDocuments(),
    Order.countDocuments(),
    Product.countDocuments({ status: { $ne: 'removed' } }),
    Product.countDocuments({ status: 'pending' }),
    User.countDocuments({ role: 'supplier', verificationStatus: 'pending' }),
    Complaint.countDocuments({ status: { $in: ['open', 'in_review'] } }),
    Order.countDocuments({ manualRefundStatus: 'pending' }),
  ]);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '+06:00';
  const deliveredDateExpr = { $ifNull: ['$deliveredAt', '$createdAt'] };
  // Order value recognition date:
  // - Fully prepaid online orders count from the moment delivery is initiated.
  // - COD orders count once the order is delivered.
  const orderValueDateExpr = {
    $cond: [
      { $eq: ['$paymentMethod', 'online'] },
      { $ifNull: ['$deliveryInitiatedAt', { $ifNull: ['$deliveredAt', '$createdAt'] }] },
      { $ifNull: ['$deliveredAt', '$createdAt'] },
    ],
  };
  const orderValueMatch = {
    $or: [
      { paymentMethod: { $ne: 'online' }, status: 'delivered' },
      {
        paymentMethod: 'online',
        $or: [{ paymentStatus: 'paid' }, { productAmountPaid: true }],
        status: { $in: ['delivery_initiated', 'shipped', 'out_for_delivery', 'delivered'] },
      },
    ],
  };
  const revenue = await Order.aggregate([
    { $match: { status: 'delivered' } },
    {
      $group: {
        _id: null,
        subtotal: { $sum: '$subtotal' },
        commission: {
          $sum: {
            $cond: [
              { $or: [{ $eq: ['$paymentStatus', 'paid'] }, { $eq: ['$productAmountPaid', true] }] },
              '$commissionAmount',
              0,
            ],
          },
        },
      },
    },
  ]);
  const now = new Date();
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const monthlyAgg = await Order.aggregate([
    {
      $match: {
        status: 'delivered',
        $expr: { $gte: [deliveredDateExpr, prevMonthStart] },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m', date: deliveredDateExpr, timezone: tz } },
        subtotal: { $sum: '$subtotal' },
        commission: {
          $sum: {
            $cond: [
              { $or: [{ $eq: ['$paymentStatus', 'paid'] }, { $eq: ['$productAmountPaid', true] }] },
              '$commissionAmount',
              0,
            ],
          },
        },
        orders: { $sum: 1 },
      },
    },
  ]);
  const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const emptyMonth = { subtotal: 0, commission: 0, orders: 0 };
  const monthly = {
    thisMonth: monthlyAgg.find((m) => m._id === monthKey(now)) || emptyMonth,
    prevMonth: monthlyAgg.find((m) => m._id === monthKey(prevMonthStart)) || emptyMonth,
  };
  const orderValueAgg = await Order.aggregate([
    {
      $match: {
        ...orderValueMatch,
        $expr: { $gte: [orderValueDateExpr, prevMonthStart] },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m', date: orderValueDateExpr, timezone: tz } },
        subtotal: { $sum: '$subtotal' },
        orders: { $sum: 1 },
      },
    },
  ]);
  const emptyOrderValue = { subtotal: 0, orders: 0 };
  const orderValue = {
    thisMonth: orderValueAgg.find((m) => m._id === monthKey(now)) || emptyOrderValue,
    prevMonth: orderValueAgg.find((m) => m._id === monthKey(prevMonthStart)) || emptyOrderValue,
  };
  const since = new Date();
  since.setDate(since.getDate() - 6);
  since.setHours(0, 0, 0, 0);
  const byDay = await Order.aggregate([
    { $match: { createdAt: { $gte: since } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: tz } },
        count: { $sum: 1 },
        value: { $sum: '$subtotal' },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  const pad = (n) => String(n).padStart(2, '0');
  const toLocalDateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const trend = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = toLocalDateKey(d);
    const hit = byDay.find((x) => x._id === key);
    trend.push({ date: key, count: hit?.count || 0, value: hit?.value || 0 });
  }

  res.json({
    stats: {
      users,
      orders,
      products,
      pendingProducts,
      pendingVerifications,
      openComplaints,
      pendingRefunds,
      revenueSubtotal: revenue[0]?.subtotal || 0,
      commission: revenue[0]?.commission || 0,
      monthly,
      orderValue,
      trend,
    },
  });
});

// ── ADMIN-FLOW 2/7 · USERS — list accounts (optional ?role= filter) ──
// SEARCH: admin-flow, list users, accounts
export const listUsers = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.role) filter.role = req.query.role;
  const users = await User.find(filter).sort({ createdAt: -1 });
  res.json({ users });
});

// ── ADMIN-FLOW 2/7 · USERS — create an account ──
// SEARCH: admin-flow, create user, add account
// DOES:   validates name/email/password/role, rejects duplicate emails, and
//         stores the password hashed (bcrypt). Role must be retailer/supplier/admin.
export const createUser = asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) {
    return res.status(400).json({ message: 'Name, email, password, and role are required' });
  }
  if (!['retailer', 'supplier', 'admin'].includes(role)) {
    return res.status(400).json({ message: 'Invalid role' });
  }
  const exists = await User.findOne({ email: String(email).toLowerCase() });
  if (exists) return res.status(409).json({ message: 'Email already registered' });
  const user = await User.create({
    name,
    email: String(email).toLowerCase(),
    password: await bcrypt.hash(password, 10),
    role,
    verificationStatus: role === 'supplier' ? 'none' : 'none',
  });
  res.status(201).json({ user });
});

// ── ADMIN-FLOW 2/7 · USERS — activate / deactivate an account ──
// SEARCH: admin-flow, update user, deactivate, activate
// DO NOT: let an admin deactivate their own account (blocked below).
export const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'Not found' });
  if (String(user._id) === String(req.user._id) && req.body.isActive === false) {
    return res.status(400).json({ message: 'You cannot deactivate your own account' });
  }
  if (req.body.isActive != null) user.isActive = Boolean(req.body.isActive);
  await user.save();
  res.json({ user });
});

// ── ADMIN-FLOW 3/7 · VERIFICATIONS — list supplier applications ──
// SEARCH: admin-flow, verifications, supplier applications
export const listVerifications = asyncHandler(async (_req, res) => {
  const users = await User.find({
    role: 'supplier',
    verificationStatus: { $in: ['pending', 'approved', 'rejected'] },
  }).sort({ updatedAt: -1 });
  res.json({ users });
});

// ── ADMIN-FLOW 3/7 · VERIFICATIONS — approve or reject a supplier ──
// SEARCH: admin-flow, approve supplier, reject supplier, verification
// DOES:   sets verificationStatus; on "approved" the user is promoted to the
//         supplier role, on "rejected" a reason is saved. The supplier is then
//         told the result via notifyUser (NOTIFY-FLOW 1/5).
export const reviewVerification = asyncHandler(async (req, res) => {
  const { status, reason } = req.body;
  if (!['approved', 'rejected', 'pending'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status' });
  }
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'Not found' });
  user.verificationStatus = status;
  if (status === 'rejected') {
    user.verificationRejectReason = reason || 'Please resubmit with clearer documents.';
  }
  if (status === 'approved') {
    user.verificationRejectReason = '';
    user.role = 'supplier';
  }
  await user.save();
  if (status === 'approved' || status === 'rejected') {
    await notifyUser(user._id, {
      title: status === 'approved' ? 'Verification approved' : 'Verification rejected',
      body: status === 'approved'
        ? 'Your supplier verification was approved. You can list products.'
        : `Your supplier verification was rejected. ${user.verificationRejectReason}`,
      link: '/supplier/settings',
      type: status === 'approved' ? 'supplier_approved' : 'supplier_rejected',
    });
  }
  res.json({ user });
});

// ── ADMIN-FLOW 4/7 · PAYOUTS — list payouts + every supplier's balance ──
// SEARCH: admin-flow, payouts, supplier balance, commission rate
// DOES:   returns all payouts, each supplier's computed balance, and the current
//         commission rate (see computeSupplierBalance in payout.service.js).
export const listPayouts = asyncHandler(async (_req, res) => {
  const payouts = await Payout.find().populate('supplier', 'name businessName email').sort({ createdAt: -1 });
  const suppliers = await User.find({ role: 'supplier' });
  const balances = [];
  for (const s of suppliers) {
    balances.push({ supplier: s, ...(await computeSupplierBalance(s._id)) });
  }
  const settings = await Settings.findOne({ key: 'global' });
  res.json({ payouts, balances, commissionRate: settings?.commissionRate ?? DEFAULT_COMMISSION_RATE });
});

// ── ADMIN-FLOW 4/7 · PAYOUTS — pay or queue a payout for one supplier ──
// SEARCH: admin-flow, create payout, pay supplier
// DOES:   calls createPayoutForSupplier; when it comes back "paid" the supplier
//         gets a "Payout sent" notification (NOTIFY-FLOW 1/5).
export const createPayout = asyncHandler(async (req, res) => {
  try {
    const { supplierId, amount, note, status } = req.body;
    if (!supplierId) return res.status(400).json({ message: 'supplierId required' });
    const payout = await createPayoutForSupplier(supplierId, {
      status: status === 'pending' ? 'pending' : 'paid',
      note,
      amount: amount != null ? Number(amount) : undefined,
    });
    if (payout.status === 'paid') {
      await notifyUser(supplierId, {
        title: 'Payout sent',
        body: `A payout of Tk ${payout.amount} was marked paid.`,
        link: '/supplier/earnings',
        type: 'payout_paid',
      });
    }
    res.status(201).json({ payout });
  } catch (e) {
    res.status(e.status || 500).json({ message: e.message });
  }
});

// ── ADMIN-FLOW 4/7 · PAYOUTS — run the weekly payout batch ──
// SEARCH: admin-flow, weekly payouts, batch payouts
// DOES:   builds pending payouts for every supplier with a balance, and reports
//         who was created vs skipped (see processWeeklyPayouts).
export const runWeeklyPayouts = asyncHandler(async (_req, res) => {
  const result = await processWeeklyPayouts();
  res.json({
    ok: true,
    created: result.created.length,
    skipped: result.skipped.length,
    payouts: result.created,
    skippedDetails: result.skipped,
  });
});

// ── ADMIN-FLOW 4/7 · PAYOUTS — mark one payout as paid ──
// SEARCH: admin-flow, pay payout, mark paid
// DOES:   flips the payout to "paid" (markPayoutAsPaid) and notifies the supplier
//         (NOTIFY-FLOW 1/5).
export const payPayout = asyncHandler(async (req, res) => {
  try {
    const payout = await markPayoutAsPaid(req.params.id);
    await notifyUser(payout.supplier, {
      title: 'Payout sent',
      body: `A payout of Tk ${payout.amount} was marked paid.`,
      link: '/supplier/earnings',
      type: 'payout_paid',
    });
    res.json({ payout });
  } catch (e) {
    res.status(e.status || 500).json({ message: e.message });
  }
});

// ── ADMIN-FLOW 4/7 · PAYOUTS — change the platform commission rate ──
// SEARCH: admin-flow, commission, commission rate
// DOES:   accepts 0–1 or a 0–100 percent and saves it to the global Settings.
export const updateCommission = asyncHandler(async (req, res) => {
  let rate = Number(req.body.commissionRate);
  if (!Number.isNaN(rate) && rate > 1 && rate <= 100) rate = rate / 100;
  if (Number.isNaN(rate) || rate < 0 || rate > 1) {
    return res.status(400).json({ message: 'commissionRate must be 0–1 (or 0–100 as percent)' });
  }
  const settings = await Settings.findOneAndUpdate(
    { key: 'global' },
    { commissionRate: rate },
    { upsert: true, new: true }
  );
  res.json({ settings });
});

// ── ADMIN-FLOW 5/7 · DISPUTES — list all complaints ──
// SEARCH: admin-flow, complaints, disputes, list disputes
export const listComplaints = asyncHandler(async (_req, res) => {
  const complaints = await Complaint.find()
    .populate('reporter', 'name email role')
    .populate('order', 'orderNumber')
    .populate('product', 'name')
    .sort({ createdAt: -1 });
  res.json({ complaints });
});

// ── ADMIN-FLOW 5/7 · DISPUTES — update status and/or reply to the reporter ──
// SEARCH: admin-flow, update complaint, reply dispute, resolve dispute
// DOES:   saves status + admin note (stamping resolvedAt on "resolved"), appends
//         an admin message, and notifies the reporter (NOTIFY-FLOW 1/5).
export const updateComplaint = asyncHandler(async (req, res) => {
  const complaint = await Complaint.findById(req.params.id);
  if (!complaint) return res.status(404).json({ message: 'Not found' });
  if (req.body.status) complaint.status = req.body.status;
  if (req.body.adminNote !== undefined) complaint.adminNote = req.body.adminNote;
  if (req.body.status === 'resolved' && !complaint.resolvedAt) complaint.resolvedAt = new Date();
  const reply = String(req.body.reply || '').trim();
  if (reply) {
    complaint.messages = complaint.messages || [];
    complaint.messages.push({ from: 'admin', body: reply });
  }
  await complaint.save();
  if (reply) {
    await notifyUser(complaint.reporter, {
      title: 'Reply on your dispute',
      body: `${complaint.subject}: ${reply.slice(0, 120)}`,
      link: '/retailer/help',
      relatedOrder: complaint.order || undefined,
      relatedProduct: complaint.product || undefined,
      type: 'dispute',
    });
  }
  res.json({ complaint });
});

// ── ADMIN-FLOW 6/7 · REFUNDS — list pending/completed manual refunds ──
// SEARCH: admin-flow, refund-flow, refund list, pending refunds
export const listRefunds = asyncHandler(async (req, res) => {
  const filter = { manualRefundStatus: { $in: ['pending', 'completed'] } };
  if (req.query.status === 'pending' || req.query.status === 'completed') {
    filter.manualRefundStatus = req.query.status;
  }
  const orders = await Order.find(filter)
    .populate('retailer', 'name email')
    .populate('supplier', 'name businessName')
    .sort({ cancelledAt: -1, updatedAt: -1 });
  res.json({ refunds: orders });
});

// ── ADMIN-FLOW 6/7 · REFUNDS — complete a manual refund ──
// SEARCH: admin-flow, refund-flow, complete refund, refund sent
export const completeRefund = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: 'Not found' });
  try {
    const updated = await completeManualRefund(order, req.user, req.body.note);
    res.json({ order: updated });
  } catch (e) {
    res.status(e.status || 500).json({ message: e.message });
  }
});
