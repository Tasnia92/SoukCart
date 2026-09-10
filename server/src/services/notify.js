import Notification from '../models/Notification.js';
import User from '../models/User.js';

// ════════════════════════════════════════════════════════════════════════════
// NOTIFY-FLOW — MASTER MAP  (search "NOTIFY-FLOW" to jump to every anchor)
// ────────────────────────────────────────────────────────────────────────────
// One notification = one row in the Notification collection for ONE user.
// This file is the WRITE side; notification.routes.js is the READ side.
// Each step is tagged in code as:
//   // ── NOTIFY-FLOW <n>/5 · <TITLE> ──
//
//   1/5 SEND TO ONE USER ..... notifyUser   (creates one Notification row)
//   2/5 SEND TO ADMINS ....... notifyAdmins (fan-out to every active admin)
//   3/5 SEND TO MANY ......... notifyMany   (fan-out, de-duplicated user ids)
//   4/5 READ FEED ............ GET / and GET /unread-count   (notification.routes.js)
//   5/5 MARK AS READ ......... PATCH /:id/read and POST /read-all (notification.routes.js)
//
// WHO CALLS THIS: order.service.js, payment.service.js, refund.service.js,
//   product.service.js, expiry.service.js and several controllers.
// TYPES USED (payload.type): new_order, supplier_confirmed, payment_received,
//   delivery_fee_received, payment_failed, refund_pending, refund_completed,
//   order_cancelled, cod_collected, delivery_initiated, order_dispatched,
//   out_for_delivery, delivered, stale_order, product_submitted, product_approved,
//   product_removed, product_hidden, supplier_application, payout_paid, dispute.
// ════════════════════════════════════════════════════════════════════════════

// ── NOTIFY-FLOW 1/5 · SEND TO ONE USER ──
// SEARCH: notify-flow, send notification, create notification
// DOES:   writes a single Notification row for `userId`. Returns null if there is
//         no user or no title. This is the ONLY place notifications are created.
export async function notifyUser(
  userId,
  { title, body = '', link = '', relatedOrder = null, relatedProduct = null, type = 'general' } = {}
) {
  if (!userId || !title) return null;
  return Notification.create({
    user: userId,
    title,
    body,
    link,
    type,
    relatedOrder: relatedOrder || undefined,
    relatedProduct: relatedProduct || undefined,
  });
}

// ── NOTIFY-FLOW 2/5 · SEND TO ALL ADMINS ──
// SEARCH: notify-flow, notify admins, admin alert
// DOES:   finds every active admin and sends each one the same payload via
//         notifyUser (1/5). Used for refunds, disputes, payouts, stale orders.
export async function notifyAdmins(payload) {
  const admins = await User.find({ role: 'admin', isActive: true }).select('_id');
  const out = [];
  for (const a of admins) {
    out.push(await notifyUser(a._id, payload));
  }
  return out;
}

// ── NOTIFY-FLOW 3/5 · SEND TO MANY USERS ──
// SEARCH: notify-flow, notify many, fan-out, suppliers
// DOES:   de-duplicates the id list (Set) then sends each user the same payload
//         via notifyUser (1/5). Used to alert every supplier on an order.
export async function notifyMany(userIds, payload) {
  const unique = [...new Set((userIds || []).filter(Boolean).map((id) => String(id)))];
  const out = [];
  for (const id of unique) {
    out.push(await notifyUser(id, payload));
  }
  return out;
}
