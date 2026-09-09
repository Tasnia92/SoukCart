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
  const revenue = await Order.aggregate([
    { $match: { status: 'delivered' } },
    { $group: { _id: null, subtotal: { $sum: '$subtotal' }, commission: { $sum: '$commissionAmount' } } },
  ]);
  const now = new Date();
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const monthlyAgg = await Order.aggregate([
    { $match: { createdAt: { $gte: prevMonthStart }, status: 'delivered' } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
        subtotal: { $sum: '$subtotal' },
        commission: { $sum: '$commissionAmount' },
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
  const since = new Date();
  since.setDate(since.getDate() - 6);
  since.setHours(0, 0, 0, 0);
  const byDay = await Order.aggregate([
    { $match: { createdAt: { $gte: since } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        count: { $sum: 1 },
        value: { $sum: '$subtotal' },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  const trend = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
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
      trend,
    },
  });
});

export const listUsers = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.role) filter.role = req.query.role;
  const users = await User.find(filter).sort({ createdAt: -1 });
  res.json({ users });
});

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

export const listVerifications = asyncHandler(async (_req, res) => {
  const users = await User.find({
    role: 'supplier',
    verificationStatus: { $in: ['pending', 'approved', 'rejected'] },
  }).sort({ updatedAt: -1 });
  res.json({ users });
});

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

export const listComplaints = asyncHandler(async (_req, res) => {
  const complaints = await Complaint.find()
    .populate('reporter', 'name email role')
    .populate('order', 'orderNumber')
    .populate('product', 'name')
    .sort({ createdAt: -1 });
  res.json({ complaints });
});

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
