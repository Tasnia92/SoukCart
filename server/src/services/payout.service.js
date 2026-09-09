import Order from '../models/Order.js';
import Payout from '../models/Payout.js';
import User from '../models/User.js';
import { DEFAULT_COMMISSION_RATE, supplierShare } from './calculations.js';
import { httpError } from '../utils/httpError.js';

function weekWindow(ref = new Date()) {
  const end = new Date(ref);
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  start.setHours(0, 0, 0, 0);
  return { periodStart: start, periodEnd: end };
}

export function uniqueSupplierIds(order) {
  const ids = new Set();
  if (order.supplier) ids.add(String(order.supplier._id || order.supplier));
  for (const s of order.suppliers || []) ids.add(String(s._id || s));
  for (const item of order.items || []) {
    if (item.supplier) ids.add(String(item.supplier._id || item.supplier));
  }
  return [...ids];
}

/** Create a pending payout per supplier when merchandise is paid and order is delivered. Idempotent. */
export async function accruePayoutsForOrder(order) {
  if (order.status !== 'delivered') return [];
  const merchandisePaid =
    order.productAmountPaid === true || order.paymentStatus === 'paid';
  if (!merchandisePaid) return [];

  const rate = order.commissionRate ?? DEFAULT_COMMISSION_RATE;
  const created = [];
  for (const sid of uniqueSupplierIds(order)) {
    const existing = await Payout.findOne({
      supplier: sid,
      orderIds: order._id,
      status: { $in: ['pending', 'paid'] },
    });
    if (existing) continue;

    const share = supplierShare(order.items, sid, rate);
    const amount =
      share.subtotal > 0
        ? share.supplierAmount
        : Number((order.supplierAmount || 0).toFixed(2));
    const commissionTotal =
      share.subtotal > 0 ? share.commissionAmount : Number((order.commissionAmount || 0).toFixed(2));
    if (amount <= 0) continue;

    const payout = await Payout.create({
      supplier: sid,
      amount,
      commissionTotal,
      orderIds: [order._id],
      status: 'pending',
      note: `Order ${order.orderNumber}`,
    });
    created.push(payout);
  }
  return created;
}

export async function reversePendingPayouts(order, note = 'Reversed on cancel') {
  return Payout.updateMany(
    { orderIds: order._id, status: 'pending' },
    { $set: { status: 'reversed', reversedAt: new Date(), note } }
  );
}

/** Delivered orders that are merchandise-paid and not already in a pending/paid payout (legacy fallback). */
export async function getEligibleOrders(supplierId) {
  const reserved = await Payout.find({
    supplier: supplierId,
    status: { $in: ['pending', 'paid'] },
  }).select('orderIds');
  const reservedIds = reserved.flatMap((p) => p.orderIds || []);

  const filter = {
    $or: [{ supplier: supplierId }, { suppliers: supplierId }, { 'items.supplier': supplierId }],
    status: 'delivered',
    paymentStatus: 'paid',
  };
  if (reservedIds.length) filter._id = { $nin: reservedIds };

  return Order.find(filter).sort({ createdAt: 1 });
}

export async function computeSupplierBalance(supplierId) {
  const paidAgg = await Payout.aggregate([
    { $match: { supplier: supplierId, status: 'paid' } },
    { $group: { _id: null, total: { $sum: '$amount' }, commission: { $sum: '$commissionTotal' } } },
  ]);
  const pendingAgg = await Payout.aggregate([
    { $match: { supplier: supplierId, status: 'pending' } },
    { $group: { _id: null, total: { $sum: '$amount' }, commission: { $sum: '$commissionTotal' } } },
  ]);
  const alreadyPaid = paidAgg[0]?.total || 0;
  const pendingPayouts = pendingAgg[0]?.total || 0;
  const totalPaidComm = paidAgg[0]?.commission || 0;
  const totalPendingComm = pendingAgg[0]?.commission || 0;

  const eligible = await getEligibleOrders(supplierId);
  const legacyAvailable = Number(eligible.reduce((s, o) => {
    const share = supplierShare(o.items || [], supplierId, o.commissionRate ?? DEFAULT_COMMISSION_RATE);
    return s + (share.subtotal > 0 ? share.supplierAmount : o.supplierAmount || 0);
  }, 0).toFixed(2));
  const legacyCommission = Number(eligible.reduce((s, o) => {
    const share = supplierShare(o.items || [], supplierId, o.commissionRate ?? DEFAULT_COMMISSION_RATE);
    return s + (share.subtotal > 0 ? share.commissionAmount : o.commissionAmount || 0);
  }, 0).toFixed(2));

  const available = Number((pendingPayouts + legacyAvailable).toFixed(2));
  const earned = Number((alreadyPaid + pendingPayouts + legacyAvailable).toFixed(2));
  const totalCommission = Number((totalPaidComm + totalPendingComm + legacyCommission).toFixed(2));
  const grossEarned = Number((earned + totalCommission).toFixed(2));
  const commissionPending = Number((totalPendingComm + legacyCommission).toFixed(2));

  return {
    earned,
    grossEarned,
    alreadyPaid,
    pendingPayouts,
    available,
    commissionPending,
    orderCount: eligible.length,
    eligibleOrderCount: eligible.length,
    eligibleOrderIds: eligible.map((o) => o._id),
  };
}

async function updateOrdersPayoutSettled(orderIds) {
  for (const orderId of orderIds) {
    const order = await Order.findById(orderId);
    if (!order) continue;
    const allSids = uniqueSupplierIds(order);
    const paidPayouts = await Payout.find({ orderIds: orderId, status: 'paid' });
    const paidSids = new Set(paidPayouts.map((p) => String(p.supplier)));
    if (allSids.every((sid) => paidSids.has(sid))) {
      order.payoutSettled = true;
      await order.save();
    }
  }
}

/**
 * Pay existing pending payouts, or create from legacy eligible delivered orders.
 * status: 'pending' (weekly batch) or 'paid' (immediate).
 */
export async function createPayoutForSupplier(supplierId, { status = 'paid', note = '', amount } = {}) {
  const existingPending = await Payout.find({ supplier: supplierId, status: 'pending' }).sort({ createdAt: 1 });

  if (existingPending.length) {
    if (status === 'pending') {
      throw httpError('Pending payouts already exist for this supplier', 400);
    }
    const total = Number(existingPending.reduce((s, p) => s + (p.amount || 0), 0).toFixed(2));
    if (amount != null && amount - total > 0.01) {
      throw httpError(`Amount exceeds available Tk ${total}`, 400);
    }
    let remainingToPay = amount != null ? Number(amount) : total;
    let last = null;
    for (const p of existingPending) {
      if (remainingToPay <= 0) break;
      if (p.amount <= remainingToPay + 0.01) {
        remainingToPay = Number((remainingToPay - p.amount).toFixed(2));
        last = await markPayoutAsPaid(p._id);
        if (note && last) {
          last.note = note;
          await last.save();
        }
      } else {
        // Partial: split this pending payout
        const paidPortion = remainingToPay;
        const remainingPortion = Number((p.amount - paidPortion).toFixed(2));
        const commRatio = p.amount > 0 ? paidPortion / p.amount : 0;
        const paidComm = Number(((p.commissionTotal || 0) * commRatio).toFixed(2));
        const remainingComm = Number(((p.commissionTotal || 0) - paidComm).toFixed(2));

        p.amount = remainingPortion;
        p.commissionTotal = remainingComm;
        await p.save();

        const paidPayout = await Payout.create({
          supplier: supplierId,
          amount: paidPortion,
          commissionTotal: paidComm,
          orderIds: p.orderIds,
          status: 'paid',
          note: note || p.note,
        });
        if (paidPayout.orderIds?.length) {
          await updateOrdersPayoutSettled(paidPayout.orderIds);
        }
        last = paidPayout;
        remainingToPay = 0;
        break;
      }
    }
    return last || existingPending[0];
  }

  const eligible = await getEligibleOrders(supplierId);
  if (!eligible.length) {
    throw httpError('No eligible payouts to pay', 400);
  }

  const orderIds = eligible.map((o) => o._id);
  const supplierAmount = Number(eligible.reduce((s, o) => {
    const share = supplierShare(o.items || [], supplierId, o.commissionRate ?? DEFAULT_COMMISSION_RATE);
    return s + (share.subtotal > 0 ? share.supplierAmount : o.supplierAmount || 0);
  }, 0).toFixed(2));
  const commissionTotal = Number(eligible.reduce((s, o) => {
    const share = supplierShare(o.items || [], supplierId, o.commissionRate ?? DEFAULT_COMMISSION_RATE);
    return s + (share.subtotal > 0 ? share.commissionAmount : o.commissionAmount || 0);
  }, 0).toFixed(2));
  const payAmount = amount != null ? Number(amount) : supplierAmount;

  if (payAmount <= 0) throw httpError('Payout amount must be > 0', 400);
  if (payAmount - supplierAmount > 0.01) {
    throw httpError(`Amount exceeds available Tk ${supplierAmount}`, 400);
  }

  const { periodStart, periodEnd } = weekWindow();
  const payout = await Payout.create({
    supplier: supplierId,
    amount: payAmount,
    commissionTotal,
    orderIds,
    status,
    periodStart,
    periodEnd,
    note: note || (status === 'pending' ? 'Weekly payout batch' : 'Supplier payout'),
  });

  if (status === 'paid') {
    await updateOrdersPayoutSettled(orderIds);
  }

  return payout;
}

/** Build pending weekly payouts for every supplier with available (legacy) balance. */
export async function processWeeklyPayouts() {
  const suppliers = await User.find({ role: 'supplier', isActive: true }).select('_id');
  const created = [];
  const skipped = [];
  for (const s of suppliers) {
    const eligible = await getEligibleOrders(s._id);
    if (!eligible.length) {
      const existingPending = await Payout.findOne({ supplier: s._id, status: 'pending' });
      if (existingPending) {
        skipped.push({ supplierId: s._id, reason: 'already_pending', payoutId: existingPending._id });
      } else {
        skipped.push({ supplierId: s._id, reason: 'no_balance' });
      }
      continue;
    }
    try {
      const payout = await createPayoutForSupplier(s._id, {
        status: 'pending',
        note: 'Weekly payout',
      });
      created.push(payout);
    } catch (e) {
      skipped.push({ supplierId: s._id, reason: e.message });
    }
  }
  return { created, skipped };
}

export async function markPayoutAsPaid(payoutId) {
  const payout = await Payout.findById(payoutId);
  if (!payout) throw httpError('Payout not found', 404);
  if (payout.status === 'paid') return payout;
  if (payout.status === 'failed') throw httpError('Cannot pay a failed payout', 400);
  if (payout.status === 'reversed') throw httpError('Cannot pay a reversed payout', 400);

  payout.status = 'paid';
  await payout.save();
  if (payout.orderIds?.length) {
    await updateOrdersPayoutSettled(payout.orderIds);
  }
  return payout;
}
