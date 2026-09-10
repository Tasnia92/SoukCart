import { DELIVERY_FEE } from './calculations.js';
import { notifyUser, notifyAdmins, notifyMany } from './notify.js';
import { releaseStockForItems } from './stock.service.js';
import { reversePendingPayouts, uniqueSupplierIds } from './payout.service.js';
import { httpError } from '../utils/httpError.js';

// ════════════════════════════════════════════════════════════════════════════
// REFUND-FLOW — MASTER MAP  (search "REFUND-FLOW" to jump to every anchor)
// ────────────────────────────────────────────────────────────────────────────
// Cancellation + refund is the sub-flow of ORDER-FLOW 8/8. An order can be
// cancelled only before delivery starts; any money already paid is queued as a
// MANUAL refund that an admin sends later. Each step is tagged in the code as:
//   // ── REFUND-FLOW <n>/6 · <TITLE> ──
//
//   1/6 CANCEL TRIGGERS ..... who/what starts a cancellation
//         order.service.js     setOrderStatus (retailer / supplier cancel)
//         expiry.service.js    expireStaleOrders (system: unpaid past TTL)
//         product.service.js   removeProductWithOrders (product removed)
//   2/6 CANCEL GUARD ........ can this order still be cancelled?
//         refund.service.js    canCancelOrder   ← anchor in this file
//   3/6 REFUND AMOUNT ....... how much is owed back (fee and/or merchandise)
//         refund.service.js    refundAmountFor
//   4/6 CANCEL + QUEUE ...... release stock, reverse payouts, set status,
//         queue the manual refund
//         refund.service.js    cancelAndQueueRefund   ← core anchor
//   5/6 SIDE EFFECTS ........ restore stock + reverse pending supplier payouts
//         stock.service.js     releaseStockForItems
//         payout.service.js    reversePendingPayouts
//   6/6 COMPLETE REFUND ..... admin marks the manual refund as sent
//         refund.service.js    completeManualRefund
//         admin.controller.js  listRefunds / completeRefund
//
// Refund fields on Order: manualRefundStatus (none|pending|completed),
//   refundAmount, refundedAt, refundNote
// Cancel fields on Order: cancelledBy, cancelledByRole, cancelledAt
// ════════════════════════════════════════════════════════════════════════════

// Shared status lists used by the guard (2/6) and the cancel core (4/6).
export const CANCELLED_STATUSES = ['cancelled', 'supplier_cancelled', 'refunded'];
export const DELIVERY_IN_PROGRESS = ['delivery_initiated', 'shipped', 'out_for_delivery', 'delivered'];

// ── REFUND-FLOW 3/6 · REFUND AMOUNT (how much is owed back) ──
// SEARCH: refund-flow, refund amount, how much refund
// DOES:   online-paid orders refund subtotal + delivery fee; otherwise only the
//         delivery fee if it was paid; nothing if no money was taken.
// USED BY: cancelAndQueueRefund() below (ORDER-FLOW 8/8).
export function refundAmountFor(order) {
  const fee = Number(order.deliveryFee || DELIVERY_FEE);
  const onlinePaid =
    order.paymentMethod === 'online' &&
    (order.productAmountPaid || order.paymentStatus === 'paid' || order.deliveryFeePaid);
  if (onlinePaid) return Number((Number(order.subtotal || 0) + fee).toFixed(2));
  if (order.deliveryFeePaid) return Number(fee.toFixed(2));
  return 0;
}

// ── REFUND-FLOW 2/6 · CANCEL GUARD (may this order still be cancelled?) ──
// SEARCH: refund-flow, can cancel, cancel guard, delivery started
// DOES:   false once already cancelled, once delivery has started, or once the
//         status is in delivery progress. Checked before every cancellation.
export function canCancelOrder(order) {
  if (CANCELLED_STATUSES.includes(order.status)) return false;
  if (order.deliveryStarted) return false;
  if (DELIVERY_IN_PROGRESS.includes(order.status)) return false;
  return true;
}

// ── REFUND-FLOW 4/6 · CANCEL + QUEUE REFUND (core cancellation) ──
// SEARCH: refund-flow, cancel order, queue refund, cancelAndQueueRefund
// DOES:   1) guards with canCancelOrder (2/6)
//         2) restores reserved stock (5/6, stock.service.js)
//         3) reverses pending supplier payouts (5/6, payout.service.js)
//         4) computes the refund (3/6) and sets manualRefundStatus = "pending"
//         5) sets status cancelled / supplier_cancelled and notifies everyone
// NOTES:  `stale` marks the automatic (expiry) cancellation. Idempotent.
export async function cancelAndQueueRefund(order, actor, reason = '', { stale = false } = {}) {
  if (CANCELLED_STATUSES.includes(order.status)) return order;
  if (!canCancelOrder(order)) {
    throw httpError('Cannot cancel after delivery has started', 400);
  }

  // REFUND-FLOW 5/6 · restore stock that was reserved on supplier confirm
  const confirmedItems = (order.items || []).filter((i) => i.confirmedAt || i.stockReserved);
  if (confirmedItems.length) {
    await releaseStockForItems(confirmedItems, {
      orderId: order._id,
      actorId: actor?._id,
      note: reason,
    });
    for (const item of order.items) {
      if (item.confirmedAt || item.stockReserved) item.stockReserved = false;
    }
  }

  // REFUND-FLOW 5/6 · reverse any still-pending supplier payouts for this order
  await reversePendingPayouts(order, `Reversed: ${reason || 'cancelled'}`);

  // REFUND-FLOW 3/6 · work out how much money to give back
  const amount = refundAmountFor(order);
  const bySupplier = actor?.role === 'supplier';
  order.status = bySupplier ? 'supplier_cancelled' : 'cancelled';
  if (actor?._id) order.cancelledBy = actor._id;
  order.cancelledByRole = actor?.role || (stale ? 'system' : undefined);
  order.cancelledAt = new Date();
  order.commissionAmount = 0;
  order.supplierAmount = 0;
  order.payoutSettled = false;
  order.markModified('items');

  // REFUND-FLOW 6/6 · queue the manual refund for admin to send
  if (amount > 0) {
    order.manualRefundStatus = 'pending';
    order.refundAmount = amount;
    await notifyAdmins({
      title: 'Refund pending',
      body: `Order ${order.orderNumber}: Tk ${amount} queued for manual refund.`,
      relatedOrder: order._id,
      link: '/admin/refunds',
      type: 'refund_pending',
    });
    await notifyUser(order.retailer, {
      title: 'Refund pending',
      body: `Order ${order.orderNumber} was cancelled. A Tk ${amount} refund will be sent by admin.`,
      relatedOrder: order._id,
      link: '/retailer/orders',
      type: 'refund_pending',
    });
  } else {
    order.manualRefundStatus = order.manualRefundStatus || 'none';
    order.refundAmount = 0;
    await notifyUser(order.retailer, {
      title: 'Order cancelled',
      body: `Order ${order.orderNumber} was cancelled.`,
      relatedOrder: order._id,
      link: '/retailer/orders',
      type: 'order_cancelled',
    });
  }

  const supplierIds = uniqueSupplierIds(order);
  await notifyMany(supplierIds, {
    title: stale ? 'Order expired' : 'Order cancelled',
    body: `Order ${order.orderNumber} was cancelled.`,
    relatedOrder: order._id,
    link: '/supplier/orders',
    type: 'order_cancelled',
  });

  await order.save();
  return order;
}

// ── REFUND-FLOW 6/6 · COMPLETE MANUAL REFUND (admin marks it sent) ──
// SEARCH: refund-flow, complete refund, refund sent, manual refund
// DOES:   only for orders with manualRefundStatus = "pending". Marks it
//         "completed", stamps refundedAt, sets paymentStatus = "refunded",
//         stores the note, and notifies the retailer.
export async function completeManualRefund(order, admin, note = '') {
  if (order.manualRefundStatus !== 'pending') {
    throw httpError('No pending refund on this order', 400);
  }
  order.manualRefundStatus = 'completed';
  order.refundedAt = new Date();
  order.paymentStatus = 'refunded';
  if (note) order.refundNote = note;
  await order.save();

  await notifyUser(order.retailer, {
    title: 'Refund completed',
    body: `Tk ${order.refundAmount} refund for order ${order.orderNumber} has been sent.`,
    relatedOrder: order._id,
    link: '/retailer/orders',
    type: 'refund_completed',
  });
  return order;
}
