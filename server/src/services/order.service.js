import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Settings from '../models/Settings.js';
import {
  lineTotal,
  orderTotals,
  amountDueNow,
  DELIVERY_FEE,
  DEFAULT_COMMISSION_RATE,
} from './calculations.js';
import { notifyUser, notifyAdmins, notifyMany } from './notify.js';
import { reserveStockForItems } from './stock.service.js';
import { accruePayoutsForOrder, uniqueSupplierIds } from './payout.service.js';
import { cancelAndQueueRefund, CANCELLED_STATUSES, canCancelOrder } from './refund.service.js';
import { httpError } from '../utils/httpError.js';

// ════════════════════════════════════════════════════════════════════════════
// ORDER-FLOW — MASTER MAP  (search "ORDER-FLOW" to jump to every anchor)
// ────────────────────────────────────────────────────────────────────────────
// The full life of one order. Each step in the code is tagged as:
//   // ── ORDER-FLOW <n>/8 · <TITLE> ──
//
//   1/8 PLACE ORDER ........ order starts here (creates awaiting_payment order)
//         order.controller.js   placeOrder
//         order.service.js      createOrderFromCart   ← anchor in this file
//   2/8 START PAYMENT ...... create SSLCommerz session / redirect
//         payment.service.js    createSslCommerzSession
//   3/8 PAYMENT RESULT ..... validate SSL, activate order, or mark failed
//         payment.controller.js sslSuccess / sslFail / sslCancel / sslIpn
//         payment.service.js    validateSslPayment / activateOrderAfterPayment / markSslFailed
//   4/8 RETRY PAYMENT ...... retailer pays again after a failure
//         payment.service.js    retryPayment
//   5/8 SUPPLIER CONFIRM ... payment check + reserve stock + confirm lines
//         order.service.js      isPaidEnoughToConfirm / confirmSupplierLines
//   6/8 DELIVERY STATUS .... initiated → shipped → out_for_delivery → delivered
//         order.service.js      setOrderStatus
//   7/8 COD COLLECTION ..... admin collects cash after delivery
//         order.service.js      collectCod
//   8/8 CANCEL / REFUND .... cancel before delivery, queue refund
//         order.service.js      setOrderStatus → cancelAndQueueRefund
//         ↳ full detail in REFUND-FLOW 1/6 … 6/6 (search "REFUND-FLOW")
//
// Order status badges: awaiting_payment → placed → supplier_confirmed →
//   delivery_initiated → shipped → out_for_delivery → delivered
// Payment flags: deliveryFeePaid, productAmountPaid, paymentStatus
// ════════════════════════════════════════════════════════════════════════════

async function nextOrderNumber() {
  const count = await Order.countDocuments();
  const stamp = Date.now().toString(36).toUpperCase().slice(-4);
  return `SC-${String(count + 1).padStart(5, '0')}-${stamp}`;
}

export function orderHasSupplier(order, supplierId) {
  const sid = String(supplierId);
  if (String(order.supplier?._id || order.supplier) === sid) return true;
  if ((order.suppliers || []).some((s) => String(s._id || s) === sid)) return true;
  return (order.items || []).some((i) => String(i.supplier?._id || i.supplier) === sid);
}

export function assertOrderAccess(order, user) {
  if (!user) throw httpError('Forbidden', 403);
  if (user.role === 'admin') return;
  const uid = String(user._id);
  if (user.role === 'retailer' && String(order.retailer?._id || order.retailer) === uid) return;
  if (user.role === 'supplier' && orderHasSupplier(order, uid)) return;
  throw httpError('Forbidden', 403);
}

// ── ORDER-FLOW 5/8 · SUPPLIER CONFIRM — payment check ──
// SEARCH: order-flow, payment check, can confirm, delivery fee paid, paid enough
// DOES:   a supplier may only confirm once enough is paid — COD requires the
//         delivery fee paid; online requires the product amount paid (or fee paid).
// USED BY: confirmSupplierLines() below (ORDER-FLOW 5/8)
export function isPaidEnoughToConfirm(order) {
  if (order.paymentMethod === 'online') {
    return Boolean(order.productAmountPaid && (order.paymentStatus === 'paid' || order.deliveryFeePaid));
  }
  return order.deliveryFeePaid === true;
}

function supplierItems(order, supplierId) {
  const sid = String(supplierId);
  return (order.items || []).filter((i) => String(i.supplier || order.supplier) === sid);
}

function allLinesConfirmed(order) {
  return (order.items || []).length > 0 && order.items.every((i) => i.confirmedAt);
}

// ── ORDER-FLOW 1/8 · PLACE ORDER (order starts here) ──
// SEARCH: order-flow, place order, checkout, cart, awaiting_payment, create order
// DOES:   validates cart items & stock, builds line items + totals, then creates
//         the order with status "awaiting_payment". Stock is NOT reserved yet.
// NEXT:   ORDER-FLOW 2/8 START PAYMENT → payment.service.js createSslCommerzSession()
/**
 * Build an awaiting_payment order. Stock is NOT reserved until supplier confirm.
 * Suppliers are notified at checkout; they can confirm only after payment.
 */
export async function createOrderFromCart({
  retailerId,
  items,
  paymentMethod,
  deliveryAddress,
  recipientName,
  recipientMobile,
  notes,
  clientOrigin,
}) {
  if (!items?.length) throw httpError('Cart is empty', 400);
  if (!recipientName?.trim()) throw httpError('Full name required', 400);
  if (!recipientMobile?.trim()) throw httpError('Mobile required', 400);
  if (!deliveryAddress?.trim()) throw httpError('Full address required', 400);
  const mobile = recipientMobile.trim().replace(/\s+/g, '');
  if (!/^01\d{9}$/.test(mobile)) {
    throw httpError('Mobile must be 11 digits starting with 01', 400);
  }

  const method = paymentMethod === 'online' ? 'online' : 'cod';
  const productIds = items.map((i) => i.productId);
  const products = await Product.find({ _id: { $in: productIds } }).populate(
    'supplier',
    'name businessName verificationStatus isActive'
  );
  if (products.length !== items.length) throw httpError('Invalid product in cart', 400);

  const orderItems = [];
  const supplierIds = [];
  for (const item of items) {
    const product = products.find((p) => String(p._id) === String(item.productId));
    if (!product) throw httpError('Invalid product in cart', 400);
    if (product.status !== 'approved' || !product.isActive) {
      throw httpError(`${product.name} is not available`, 400);
    }
    const supplier = product.supplier;
    if (!supplier || supplier.verificationStatus !== 'approved' || supplier.isActive === false) {
      throw httpError(`${product.name} is not available`, 400);
    }
    if (product.stock < product.moq) {
      throw httpError(`${product.name} is below minimum stock`, 400);
    }
    const qty = Number(item.quantity);
    if (qty < product.moq) throw httpError(`${product.name} MOQ is ${product.moq}`, 400);
    if (qty > product.stock) throw httpError(`${product.name} is out of stock`, 400);
    const sid = supplier._id;
    if (!supplierIds.some((id) => String(id) === String(sid))) supplierIds.push(sid);
    orderItems.push({
      product: product._id,
      supplier: sid,
      name: product.name,
      unit: product.unit,
      price: product.price,
      quantity: qty,
      lineTotal: lineTotal(product.price, qty),
      imageUrl: product.imageUrl || '',
      stockReserved: false,
    });
  }

  const settings = await Settings.findOne({ key: 'global' });
  const rate = settings?.commissionRate ?? DEFAULT_COMMISSION_RATE;
  const totals = orderTotals(orderItems, rate);
  const due = amountDueNow(method, totals.subtotal, totals.deliveryFee);

  const order = await Order.create({
    orderNumber: await nextOrderNumber(),
    retailer: retailerId,
    supplier: supplierIds[0],
    suppliers: supplierIds,
    items: orderItems,
    ...totals,
    amountDueNow: due,
    paymentMethod: method,
    recipientName: recipientName.trim(),
    recipientMobile: mobile,
    deliveryAddress: deliveryAddress.trim(),
    clientOrigin: clientOrigin || undefined,
    notes,
    status: 'awaiting_payment',
    paymentStatus: 'unpaid',
    deliveryFeePaid: false,
    deliveryPaymentStatus: 'unpaid',
    productAmountPaid: false,
    deliveryFee: totals.deliveryFee || DELIVERY_FEE,
    manualRefundStatus: 'none',
  });

  await notifyMany(supplierIds, {
    title: 'New order placed',
    body: `Order ${order.orderNumber} was placed and is awaiting payment.`,
    relatedOrder: order._id,
    link: '/supplier/orders',
    type: 'new_order',
  });

  return order;
}

// ── ORDER-FLOW 5/8 · SUPPLIER CONFIRM (payment + stock check) ──
// SEARCH: order-flow, confirm order, supplier confirm, reserve stock, supplier_confirmed
// DOES:   requires "paid enough" (isPaidEnoughToConfirm above), reserves stock, and
//         marks this supplier's lines confirmed. When every supplier confirms the
//         status becomes "supplier_confirmed", otherwise it stays/becomes "placed".
// NEXT:   ORDER-FLOW 6/8 DELIVERY STATUS → setOrderStatus() below
// ALSO:   SUPPLIER-FLOW 5/8 (this is the supplier's "confirm order" action).
export async function confirmSupplierLines(order, supplierUser) {
  if (!orderHasSupplier(order, supplierUser._id)) throw httpError('Forbidden', 403);
  if (CANCELLED_STATUSES.includes(order.status)) throw httpError('Order is cancelled', 400);
  if (!isPaidEnoughToConfirm(order)) {
    throw httpError('Cannot confirm until payment is received', 400);
  }
  if (['delivery_initiated', 'shipped', 'out_for_delivery', 'delivered'].includes(order.status)) {
    throw httpError('Order is already in delivery', 400);
  }

  const mine = supplierItems(order, supplierUser._id);
  if (!mine.length) throw httpError('No lines to confirm on this order', 400);
  const pending = mine.filter((i) => !i.confirmedAt);
  if (!pending.length) return order;

  await reserveStockForItems(pending, { orderId: order._id, actorId: supplierUser._id });
  const now = new Date();
  for (const item of order.items) {
    if (String(item.supplier || order.supplier) === String(supplierUser._id) && !item.confirmedAt) {
      item.confirmedAt = now;
      item.stockReserved = true;
    }
  }
  order.markModified('items');

  const fullyConfirmed = allLinesConfirmed(order);
  if (fullyConfirmed) {
    order.status = 'supplier_confirmed';
    order.confirmedAt = now;
  } else if (order.status === 'awaiting_payment') {
    order.status = 'placed';
  }

  await order.save();

  const who = supplierUser.businessName || supplierUser.name || 'Supplier';
  await notifyUser(order.retailer, {
    title: fullyConfirmed ? 'Order confirmed' : 'Supplier confirmed items',
    body: fullyConfirmed
      ? `Order ${order.orderNumber} is confirmed and waiting for delivery.`
      : `${who} confirmed their items on order ${order.orderNumber}. Waiting for remaining suppliers.`,
    relatedOrder: order._id,
    link: '/retailer/orders',
    type: 'supplier_confirmed',
  });
  await notifyAdmins({
    title: fullyConfirmed ? 'Order ready for delivery' : 'Partial supplier confirmation',
    body: fullyConfirmed
      ? `Order ${order.orderNumber} confirmed by all suppliers. Start delivery when ready.`
      : `${who} confirmed lines on ${order.orderNumber}. Waiting for remaining suppliers.`,
    relatedOrder: order._id,
    link: '/admin/orders',
    type: 'supplier_confirmed',
  });
  return order;
}

// ── ORDER-FLOW 7/8 · COD COLLECTION (admin collects cash) ──
// SEARCH: order-flow, collect cod, cash on delivery, payment collected
// DOES:   only for COD orders already "delivered". Marks the product amount paid,
//         records who collected it, and accrues supplier payouts.
export async function collectCod(order, admin) {
  if (order.paymentMethod !== 'cod') throw httpError('Not a COD order', 400);
  if (order.status !== 'delivered') throw httpError('Collect cash after the order is delivered', 400);
  if (order.productAmountPaid && order.paymentStatus === 'paid') return order;

  order.productAmountPaid = true;
  order.paymentStatus = 'paid';
  order.codCollectedAt = new Date();
  if (admin?._id) order.codCollectedBy = admin._id;
  await order.save();
  await accruePayoutsForOrder(order);

  await notifyUser(order.retailer, {
    title: 'Payment collected',
    body: `COD merchandise for order ${order.orderNumber} was collected.`,
    relatedOrder: order._id,
    link: '/retailer/orders',
    type: 'cod_collected',
  });
  return order;
}

function notifyDelivery(order, nextStatus) {
  const supplierIds = uniqueSupplierIds(order);
  if (nextStatus === 'delivery_initiated') {
    return Promise.all([
      notifyUser(order.retailer, {
        title: 'Delivery initiated',
        body: `Admin started fulfillment for order ${order.orderNumber}.`,
        relatedOrder: order._id,
        link: '/retailer/tracking',
        type: 'delivery_initiated',
      }),
      notifyMany(supplierIds, {
        title: 'Delivery initiated',
        body: `Admin initiated delivery for order ${order.orderNumber}.`,
        relatedOrder: order._id,
        link: '/supplier/orders',
        type: 'delivery_initiated',
      }),
    ]);
  }
  if (nextStatus === 'shipped') {
    return Promise.all([
      notifyUser(order.retailer, {
        title: 'Order dispatched',
        body: `Order ${order.orderNumber} has been shipped.`,
        relatedOrder: order._id,
        link: '/retailer/tracking',
        type: 'order_dispatched',
      }),
      notifyMany(supplierIds, {
        title: 'Order dispatched',
        body: `Order ${order.orderNumber} has been shipped.`,
        relatedOrder: order._id,
        link: '/supplier/orders',
        type: 'order_dispatched',
      }),
    ]);
  }
  if (nextStatus === 'out_for_delivery') {
    return notifyUser(order.retailer, {
      title: 'Out for delivery',
      body: `Order ${order.orderNumber} is on the way.`,
      relatedOrder: order._id,
      link: '/retailer/tracking',
      type: 'out_for_delivery',
    });
  }
  if (nextStatus === 'delivered') {
    return notifyUser(order.retailer, {
      title: 'Order delivered',
      body: `Order ${order.orderNumber} was delivered successfully.`,
      relatedOrder: order._id,
      link: '/retailer/orders',
      type: 'delivered',
    });
  }
  return null;
}

// ── ORDER-FLOW 6/8 & 8/8 · DELIVERY STATUS + CANCEL / REFUND ──
// SEARCH: order-flow, status change, delivery, cancel, refund
// DOES:   single gateway for every status change:
//         • cancel/refund statuses → ORDER-FLOW 8/8 → REFUND-FLOW 1/6-6/6
//         • supplier confirm      → ORDER-FLOW 5/8 (confirmSupplierLines)
//         • collect_cod           → ORDER-FLOW 7/8 (collectCod)
//         • delivery transitions  → ORDER-FLOW 6/8 (initiated→shipped→… below)
// SUB-FLOW: see refund.service.js "REFUND-FLOW" master map for cancellation detail.
export async function setOrderStatus(order, nextStatus, actor) {
  assertOrderAccess(order, actor);

  // REFUND-FLOW 1/6 · CANCEL TRIGGER — retailer/supplier cancels before delivery
  if (['cancelled', 'supplier_cancelled', 'refunded'].includes(nextStatus)) {
    if (actor.role !== 'retailer' && actor.role !== 'supplier') {
      throw httpError('Only suppliers and retailers can cancel an order', 403);
    }
    if (!canCancelOrder(order)) {
      throw httpError('Cannot cancel after delivery has started', 400);
    }
    return cancelAndQueueRefund(order, actor);
  }

  if (nextStatus === 'supplier_approved' || nextStatus === 'supplier_confirmed') {
    if (actor.role !== 'supplier' && actor.role !== 'admin') {
      throw httpError('Only the supplier can confirm this order', 403);
    }
    const supplierActor = actor.role === 'supplier' ? actor : { ...actor, _id: order.supplier, role: 'supplier' };
    return confirmSupplierLines(order, supplierActor);
  }

  // ORDER-FLOW 7/8 · COD COLLECTION branch
  if (nextStatus === 'collect_cod') {
    if (actor.role !== 'admin') throw httpError('Only admin can collect COD', 403);
    return collectCod(order, actor);
  }

  const allowed = {
    admin: {
      placed: [],
      supplier_approved: [],
      supplier_confirmed: ['delivery_initiated'],
      delivery_initiated: ['shipped'],
      shipped: ['out_for_delivery'],
      out_for_delivery: ['delivered'],
    },
    retailer: {
      awaiting_payment: ['cancelled'],
      placed: ['cancelled'],
      supplier_approved: ['cancelled'],
      supplier_confirmed: ['cancelled'],
    },
    supplier: {
      placed: ['supplier_cancelled'],
      supplier_approved: ['supplier_cancelled'],
      supplier_confirmed: ['supplier_cancelled'],
    },
  };

  const map = allowed[actor.role] || {};
  const nexts = map[order.status] || [];
  if (!nexts.includes(nextStatus)) {
    throw httpError(`Cannot move ${order.status} → ${nextStatus}`, 400);
  }

  if (actor.role !== 'admin' && ['delivery_initiated', 'shipped', 'out_for_delivery', 'delivered'].includes(nextStatus)) {
    throw httpError('Only admin can change delivery status', 403);
  }

  // ORDER-FLOW 6/8 · DELIVERY STATUS transition (only admin reaches this point)
  order.status = nextStatus;
  if (nextStatus === 'delivery_initiated') {
    order.deliveryStarted = true;
    order.deliveryInitiatedAt = new Date();
  }
  if (nextStatus === 'shipped') {
    order.deliveryStarted = true;
    order.shippedAt = new Date();
  }
  if (nextStatus === 'out_for_delivery') {
    order.deliveryStarted = true;
    order.outForDeliveryAt = new Date();
  }
  if (nextStatus === 'delivered') {
    order.deliveredAt = new Date();
    if (order.productAmountPaid || order.paymentStatus === 'paid') {
      await accruePayoutsForOrder(order);
    }
  }

  await notifyDelivery(order, nextStatus);
  await order.save();
  return order;
}
