import { DELIVERY_FEE } from './calculations.js';
import { notifyUser, notifyAdmins, notifyMany } from './notify.js';
import { releaseStockForItems } from './stock.service.js';
import { reversePendingPayouts, uniqueSupplierIds } from './payout.service.js';
import { httpError } from '../utils/httpError.js';

export const CANCELLED_STATUSES = ['cancelled', 'supplier_cancelled', 'refunded'];
export const DELIVERY_IN_PROGRESS = ['delivery_initiated', 'shipped', 'out_for_delivery', 'delivered'];

export function refundAmountFor(order) {
  const fee = Number(order.deliveryFee || DELIVERY_FEE);
  const onlinePaid =
    order.paymentMethod === 'online' &&
    (order.productAmountPaid || order.paymentStatus === 'paid' || order.deliveryFeePaid);
  if (onlinePaid) return Number((Number(order.subtotal || 0) + fee).toFixed(2));
  if (order.deliveryFeePaid) return Number(fee.toFixed(2));
  return 0;
}

export function canCancelOrder(order) {
  if (CANCELLED_STATUSES.includes(order.status)) return false;
  if (order.deliveryStarted) return false;
  if (DELIVERY_IN_PROGRESS.includes(order.status)) return false;
  return true;
}

export async function cancelAndQueueRefund(order, actor, reason = '', { stale = false } = {}) {
  if (CANCELLED_STATUSES.includes(order.status)) return order;
  if (!canCancelOrder(order)) {
    throw httpError('Cannot cancel after delivery has started', 400);
  }

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

  await reversePendingPayouts(order, `Reversed: ${reason || 'cancelled'}`);

  const amount = refundAmountFor(order);
  const bySupplier = actor?.role === 'supplier';
  order.status = bySupplier ? 'supplier_cancelled' : 'cancelled';
  order.cancelReason = reason || (stale ? 'Automatically cancelled: payment not completed in time' : 'Cancelled');
  if (actor?._id) order.cancelledBy = actor._id;
  order.cancelledByRole = actor?.role || (stale ? 'system' : undefined);
  order.cancelledAt = new Date();
  order.commissionAmount = 0;
  order.supplierAmount = 0;
  order.payoutSettled = false;
  order.markModified('items');

  if (amount > 0) {
    order.manualRefundStatus = 'pending';
    order.refundAmount = amount;
    await notifyAdmins({
      title: 'Refund pending',
      body: `Order ${order.orderNumber}: Tk ${amount} queued for manual refund (${order.cancelReason}).`,
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
      body: `Order ${order.orderNumber} was cancelled.${reason ? ` ${reason}` : ''}`,
      relatedOrder: order._id,
      link: '/retailer/orders',
      type: 'order_cancelled',
    });
  }

  const supplierIds = uniqueSupplierIds(order);
  await notifyMany(supplierIds, {
    title: stale ? 'Order expired' : 'Order cancelled',
    body: `Order ${order.orderNumber} was cancelled.${reason ? ` ${reason}` : ''}`,
    relatedOrder: order._id,
    link: '/supplier/orders',
    type: 'order_cancelled',
  });

  await order.save();
  return order;
}

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
