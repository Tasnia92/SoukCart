import Order from '../models/Order.js';
import {
  createOrderFromCart,
  setOrderStatus,
  confirmSupplierLines,
  collectCod,
  assertOrderAccess,
} from '../services/order.service.js';
import { createSslCommerzSession, sslConfigured, retryPayment } from '../services/payment.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// ════════════════════════════════════════════════════════════════════════════
// ORDER-FLOW — HTTP entry points (search "ORDER-FLOW")
//   1/8 placeOrder        POST   /api/orders
//   4/8 retryOrderPayment POST   /api/orders/:id/pay
//   5/8 confirmOrder      POST   /api/orders/:id/confirm
//   6/8 updateStatus      PATCH  /api/orders/:id/status
//   7/8 collectCodPayment POST   /api/orders/:id/collect-cod
//   8/8 updateStatus      PATCH  /api/orders/:id/status  (cancel/refund statuses)
// See order.service.js for the full master map.
// ════════════════════════════════════════════════════════════════════════════

const populate = [
  { path: 'retailer', select: 'name email businessName phone' },
  { path: 'supplier', select: 'name businessName' },
  { path: 'suppliers', select: 'name businessName' },
  { path: 'items.supplier', select: 'name businessName' },
  { path: 'cancelledBy', select: 'name role' },
];

// ── ORDER-FLOW 1/8 · PLACE ORDER (HTTP entry — order starts here) ──
// SEARCH: order-flow, place order, checkout
// DOES:   requires SSLCommerz config, creates the order (createOrderFromCart),
//         then opens the payment session and returns the redirect URL.
export const placeOrder = asyncHandler(async (req, res) => {
  try {
    if (!sslConfigured()) {
      return res.status(500).json({ message: 'SSLCommerz is not configured. Add store id/password to .env.' });
    }
    const order = await createOrderFromCart({
      retailerId: req.user._id,
      items: req.body.items,
      paymentMethod: req.body.paymentMethod,
      deliveryAddress: req.body.deliveryAddress,
      recipientName: req.body.recipientName,
      recipientMobile: req.body.recipientMobile,
      notes: req.body.notes,
      clientOrigin: req.body.clientOrigin,
    });
    const payment = await createSslCommerzSession(order, req.user);
    res.status(201).json({
      order,
      payment,
      message: 'Redirect to SSLCommerz to pay. You can retry from Orders if payment fails.',
    });
  } catch (e) {
    res.status(e.status || 500).json({ message: e.message, ssl: e.ssl });
  }
});

export const myOrders = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.user.role === 'retailer') filter.retailer = req.user._id;
  if (req.user.role === 'supplier') {
    filter.$or = [
      { supplier: req.user._id },
      { suppliers: req.user._id },
      { 'items.supplier': req.user._id },
    ];
    filter.deliveryFeePaid = true;
  }

  if (req.query.status) {
    filter.status = req.query.status;
  } else if (req.query.all !== '1' && req.user.role === 'supplier') {
    filter.status = { $nin: ['awaiting_payment'] };
  }

  if (req.query.refund === 'pending') filter.manualRefundStatus = 'pending';
  if (req.query.refund === 'completed') filter.manualRefundStatus = 'completed';
  if (req.query.tracking === '1') {
    filter.status = { $in: ['placed', 'supplier_approved', 'supplier_confirmed', 'delivery_initiated', 'shipped', 'out_for_delivery'] };
  }

  const orders = await Order.find(filter).populate(populate).sort({ createdAt: -1 });
  res.json({ orders });
});

export const getOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate(populate);
  if (!order) return res.status(404).json({ message: 'Not found' });
  try {
    assertOrderAccess(order, req.user);
  } catch (e) {
    return res.status(e.status || 403).json({ message: e.message });
  }
  res.json({ order });
});

// ── ORDER-FLOW 6/8 & 8/8 · STATUS CHANGE (delivery / cancel / refund / confirm / COD) ──
// SEARCH: order-flow, status change, delivery, cancel
// DOES:   delegates to setOrderStatus, which routes to the right step. Also used
//         by suppliers/admins to confirm (5/8) and to change delivery status (6/8).
export const updateStatus = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: 'Not found' });
  try {
    const updated = await setOrderStatus(order, req.body.status, req.user);
    const fresh = await Order.findById(updated._id).populate(populate);
    res.json({ order: fresh || updated });
  } catch (e) {
    res.status(e.status || 500).json({ message: e.message, availableQty: e.availableQty });
  }
});

// ── ORDER-FLOW 5/8 · SUPPLIER CONFIRM (HTTP entry) ──
// SEARCH: order-flow, confirm order, supplier confirm
export const confirmOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: 'Not found' });
  try {
    const updated = await confirmSupplierLines(order, req.user);
    const fresh = await Order.findById(updated._id).populate(populate);
    res.json({ order: fresh || updated });
  } catch (e) {
    res.status(e.status || 500).json({ message: e.message, availableQty: e.availableQty });
  }
});

// ── ORDER-FLOW 4/8 · RETRY PAYMENT (HTTP entry) ──
// SEARCH: order-flow, retry payment, pay again
export const retryOrderPayment = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: 'Not found' });
  try {
    if (!sslConfigured()) {
      return res.status(500).json({ message: 'SSLCommerz is not configured.' });
    }
    const payment = await retryPayment(order, req.user);
    res.json({ order, payment });
  } catch (e) {
    res.status(e.status || 500).json({ message: e.message, ssl: e.ssl });
  }
});

// ── ORDER-FLOW 7/8 · COD COLLECTION (HTTP entry) ──
// SEARCH: order-flow, collect cod, cash on delivery
export const collectCodPayment = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: 'Not found' });
  try {
    const updated = await collectCod(order, req.user);
    const fresh = await Order.findById(updated._id).populate(populate);
    res.json({ order: fresh || updated });
  } catch (e) {
    res.status(e.status || 500).json({ message: e.message });
  }
});
