import Order from '../models/Order.js';
import { cancelAndQueueRefund } from './refund.service.js';
import { notifyAdmins } from './notify.js';

const HOUR = 60 * 60 * 1000;
const COD_TTL = 24 * HOUR;
const ONLINE_TTL = 48 * HOUR;

let running = false;

// ── REFUND-FLOW 1/6 · CANCEL TRIGGER (system auto-cancel of stale orders) ──
// SEARCH: refund-flow, auto cancel, stale order, expiry
// DOES:   cancels unpaid orders older than the COD/online TTL via
//         cancelAndQueueRefund(..., { stale: true }), which also queues any refund.
export async function expireStaleOrders() {
  if (running) return { expired: 0, skipped: true };
  running = true;
  try {
    const now = Date.now();
    const unpaid = {
      deliveryFeePaid: { $ne: true },
      status: { $in: ['awaiting_payment', 'placed'] },
      paymentStatus: { $in: ['unpaid', 'failed'] },
    };
    const [cod, online] = await Promise.all([
      Order.find({ ...unpaid, paymentMethod: 'cod', createdAt: { $lte: new Date(now - COD_TTL) } }),
      Order.find({ ...unpaid, paymentMethod: 'online', createdAt: { $lte: new Date(now - ONLINE_TTL) } }),
    ]);
    const all = [...cod, ...online];
    const expired = [];
    for (const order of all) {
      try {
        await cancelAndQueueRefund(
          order,
          { role: 'system' },
          'Automatically cancelled: payment not completed in time',
          { stale: true }
        );
        expired.push(order.orderNumber);
      } catch (e) {
        console.error('stale-order expire failed', order.orderNumber, e.message);
      }
    }
    if (expired.length) {
      await notifyAdmins({
        title: 'Stale orders auto-cancelled',
        body: `${expired.length} unpaid order(s) expired: ${expired.slice(0, 8).join(', ')}${expired.length > 8 ? '…' : ''}`,
        type: 'stale_order',
        link: '/admin/orders',
      });
    }
    return { expired: expired.length, orders: expired };
  } finally {
    running = false;
  }
}

export function startStaleOrderCron() {
  const delay = 15 * 1000;
  setTimeout(() => {
    expireStaleOrders().catch((e) => console.error('stale-order cron', e));
  }, delay);
  setInterval(() => {
    expireStaleOrders().catch((e) => console.error('stale-order cron', e));
  }, HOUR);
}
