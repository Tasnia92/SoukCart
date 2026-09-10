import Product from '../models/Product.js';
import StockHistory from '../models/StockHistory.js';
import { httpError } from '../utils/httpError.js';

export async function recordStock(product, { delta, reason, order, actor, note } = {}) {
  if (!product) return null;
  return StockHistory.create({
    product: product._id,
    supplier: product.supplier,
    delta,
    quantityAfter: product.stock,
    reason,
    order: order || undefined,
    actor: actor || undefined,
    note: note || '',
  });
}

export async function setStock(product, nextStock, { reason = 'adjust', actor, note } = {}) {
  const next = Math.max(0, Number(nextStock));
  const delta = next - Number(product.stock || 0);
  product.stock = next;
  await product.save();
  if (delta !== 0) {
    await recordStock(product, { delta, reason, actor, note });
  }
  return product;
}

/** Atomically reserve qty for each item. Rolls back previous lines if one fails. */
export async function reserveStockForItems(items, { orderId, actorId } = {}) {
  const reserved = [];
  try {
    for (const item of items) {
      const updated = await Product.findOneAndUpdate(
        { _id: item.product, stock: { $gte: item.quantity } },
        { $inc: { stock: -item.quantity } },
        { new: true }
      );
      if (!updated) {
        const p = await Product.findById(item.product).select('name stock');
        throw httpError(
          `Insufficient stock for ${item.name || p?.name || 'product'}. Available: ${p?.stock ?? 0}`,
          400,
          { availableQty: p?.stock ?? 0, productId: item.product }
        );
      }
      reserved.push({ product: updated, qty: item.quantity });
      await recordStock(updated, {
        delta: -item.quantity,
        reason: 'confirm',
        order: orderId,
        actor: actorId,
      });
    }
  } catch (e) {
    for (const r of reserved) {
      const restored = await Product.findByIdAndUpdate(
        r.product._id,
        { $inc: { stock: r.qty } },
        { new: true }
      );
      if (restored) {
        await recordStock(restored, {
          delta: r.qty,
          reason: 'cancel',
          order: orderId,
          actor: actorId,
          note: 'rollback incomplete confirm',
        });
      }
    }
    throw e;
  }
  return reserved;
}

// ── REFUND-FLOW 5/6 · SIDE EFFECTS — restore reserved stock ──
// SEARCH: refund-flow, release stock, restore stock
// DOES:   adds each reserved/confirmed item's qty back to Product.stock and logs a
//         StockHistory entry with reason "cancel". Called by cancelAndQueueRefund.
export async function releaseStockForItems(items, { orderId, actorId, note } = {}) {
  for (const item of items) {
    if (!item.stockReserved && !item.confirmedAt) continue;
    const updated = await Product.findByIdAndUpdate(
      item.product,
      { $inc: { stock: item.quantity } },
      { new: true }
    );
    if (updated) {
      await recordStock(updated, {
        delta: item.quantity,
        reason: 'cancel',
        order: orderId,
        actor: actorId,
        note,
      });
    }
  }
}
