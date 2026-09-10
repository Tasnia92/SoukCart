import Product from '../models/Product.js';
import Order from '../models/Order.js';
import { recordStock } from './stock.service.js';
import { cancelAndQueueRefund, canCancelOrder } from './refund.service.js';
import { notifyUser, notifyAdmins } from './notify.js';
import { httpError } from '../utils/httpError.js';

// ── SUPPLIER-FLOW 3/8 · PRODUCTS — is this product visible in the catalog? ──
// SEARCH: supplier-flow, catalog visible, product visible
// DOES:   true only when the product is approved + active, has at least MOQ stock,
//         and its supplier is verified and active.
export function isCatalogVisible(product) {
  const supplier = product.supplier;
  const verified = !supplier || supplier.verificationStatus === 'approved';
  const activeSupplier = !supplier || supplier.isActive !== false;
  return (
    product.status === 'approved' &&
    product.isActive !== false &&
    Number(product.stock) >= Number(product.moq || 1) &&
    verified &&
    activeSupplier
  );
}

// ── REFUND-FLOW 1/6 · CANCEL TRIGGER (product removed from catalog) ──
// SEARCH: refund-flow, cancel trigger, product removed
// DOES:   cancels still-cancellable pending orders containing a product being
//         removed (via cancelAndQueueRefund), then marks the product removed.
export async function removeProductWithOrders(product, admin) {
  const historyCount = await Order.countDocuments({ 'items.product': product._id });

  if (historyCount === 0) {
    await product.deleteOne();
    await notifyUser(product.supplier, {
      title: 'Product removed',
      body: `Your product "${product.name}" was permanently deleted.`,
      link: '/supplier/products',
      relatedProduct: product._id,
      type: 'product_removed',
    });
    return { deleted: true };
  }

  const pending = await Order.find({
    'items.product': product._id,
    status: { $in: ['awaiting_payment', 'placed', 'supplier_approved', 'supplier_confirmed'] },
  });
  for (const o of pending) {
    if (!canCancelOrder(o)) continue;
    await cancelAndQueueRefund(o, admin, `Product "${product.name}" was removed`);
  }

  product.status = 'removed';
  product.isActive = false;
  product.removedAt = new Date();
  await product.save();
  await notifyUser(product.supplier, {
    title: 'Product removed',
    body: `Your product "${product.name}" was removed from the catalog. Historical orders were kept.`,
    link: '/supplier/products',
    relatedProduct: product._id,
    type: 'product_removed',
  });
  return { deleted: false, product };
}

// ── SUPPLIER-FLOW 3/8 · PRODUCTS — hide a product from the catalog ──
// SEARCH: supplier-flow, hide product
// DOES:   sets isActive = false and notifies the supplier (NOTIFY-FLOW 1/5).
export async function hideProduct(product) {
  product.isActive = false;
  await product.save();
  await notifyUser(product.supplier, {
    title: 'Product hidden',
    body: `Your product "${product.name}" was hidden from the catalog.`,
    link: '/supplier/products',
    relatedProduct: product._id,
    type: 'product_hidden',
  });
  return product;
}

// ── SUPPLIER-FLOW 3/8 · PRODUCTS — restore a hidden / rejected product ──
// SEARCH: supplier-flow, restore product
// DOES:   makes the product active again and, if it was removed/rejected, sets it
//         back to "approved"; then notifies the supplier (NOTIFY-FLOW 1/5).
export async function restoreProduct(product) {
  product.isActive = true;
  if (product.status === 'removed' || product.status === 'rejected') product.status = 'approved';
  product.removedAt = undefined;
  await product.save();
  await notifyUser(product.supplier, {
    title: 'Product restored',
    body: `Your product "${product.name}" is visible in the catalog again.`,
    link: '/supplier/products',
    relatedProduct: product._id,
    type: 'product_approved',
  });
  return product;
}

export { recordStock, notifyAdmins, httpError, Product };
