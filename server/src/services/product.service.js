import Product from '../models/Product.js';
import Order from '../models/Order.js';
import { recordStock } from './stock.service.js';
import { cancelAndQueueRefund, canCancelOrder } from './refund.service.js';
import { notifyUser, notifyAdmins } from './notify.js';
import { httpError } from '../utils/httpError.js';

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
