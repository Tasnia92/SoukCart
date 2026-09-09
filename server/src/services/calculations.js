export const DELIVERY_FEE = 120;
export const DEFAULT_COMMISSION_RATE = 0.1;

export function lineTotal(price, quantity) {
  return Number((price * quantity).toFixed(2));
}

export function orderTotals(items, commissionRate = DEFAULT_COMMISSION_RATE) {
  const subtotal = Number(items.reduce((s, i) => s + i.lineTotal, 0).toFixed(2));
  const commissionAmount = Number((subtotal * commissionRate).toFixed(2));
  const supplierAmount = Number((subtotal - commissionAmount).toFixed(2));
  const deliveryFee = DELIVERY_FEE;
  return { subtotal, commissionRate, commissionAmount, supplierAmount, deliveryFee };
}

/** COD pays delivery fee only online; online pays merchandise + delivery fee. */
export function amountDueNow(paymentMethod, subtotal, deliveryFee = DELIVERY_FEE) {
  if (paymentMethod === 'online') return Number((subtotal + deliveryFee).toFixed(2));
  return Number(deliveryFee.toFixed(2));
}

export function supplierShare(items, supplierId, commissionRate = DEFAULT_COMMISSION_RATE) {
  const sid = String(supplierId);
  const subtotal = Number(
    items
      .filter((i) => String(i.supplier) === sid)
      .reduce((s, i) => s + (i.lineTotal || 0), 0)
      .toFixed(2)
  );
  const commissionAmount = Number((subtotal * commissionRate).toFixed(2));
  const supplierAmount = Number((subtotal - commissionAmount).toFixed(2));
  return { subtotal, commissionAmount, supplierAmount };
}
