import Product from '../models/Product.js';
import Category from '../models/Category.js';
import StockHistory from '../models/StockHistory.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { notifyUser, notifyAdmins } from '../services/notify.js';
import { recordStock, setStock } from '../services/stock.service.js';
import {
  isCatalogVisible,
  removeProductWithOrders,
  hideProduct,
  restoreProduct,
} from '../services/product.service.js';

function catalogScope(req) {
  return req.query.scope === 'catalog' || req.user?.role === 'retailer' || !req.user;
}

export const listProducts = asyncHandler(async (req, res) => {
  const filter = {};
  if (catalogScope(req)) {
    filter.status = 'approved';
    filter.isActive = true;
  }
  if (req.query.supplier) filter.supplier = req.query.supplier;
  if (req.query.mine === '1' && req.user?.role === 'supplier') filter.supplier = req.user._id;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.q) filter.name = { $regex: req.query.q, $options: 'i' };
  if (req.query.category) filter.category = req.query.category;

  let products = await Product.find(filter)
    .populate('category', 'name')
    .populate('supplier', 'name businessName email verificationStatus isActive')
    .sort({ createdAt: -1 });

  if (catalogScope(req)) {
    products = products.filter(isCatalogVisible);
  }
  res.json({ products });
});

export const getProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id)
    .populate('category', 'name')
    .populate('supplier', 'name businessName email verificationStatus isActive');
  if (!product) return res.status(404).json({ message: 'Not found' });

  const owner = req.user?.role === 'supplier' && String(product.supplier?._id || product.supplier) === String(req.user._id);
  if (catalogScope(req) && req.user?.role !== 'admin' && !owner && !isCatalogVisible(product)) {
    return res.status(404).json({ message: 'Not found' });
  }
  res.json({ product });
});

export const createProduct = asyncHandler(async (req, res) => {
  const { name, description, price, unit, stock, moq, imageUrl, category } = req.body;
  if (!name || price == null || !unit || stock == null || moq == null) {
    return res.status(400).json({ message: 'Missing required fields' });
  }
  if (!imageUrl) return res.status(400).json({ message: 'Product image is required' });
  const priceNum = Number(price);
  const stockNum = Number(stock);
  const moqNum = Number(moq);
  if (!Number.isFinite(priceNum) || priceNum <= 0) {
    return res.status(400).json({ message: 'Price must be greater than 0' });
  }
  if (!Number.isFinite(stockNum) || stockNum < 1) {
    return res.status(400).json({ message: 'Initial stock must be at least 1 when adding a product' });
  }
  if (!Number.isFinite(moqNum) || moqNum < 1) {
    return res.status(400).json({ message: 'Minimum order quantity must be at least 1' });
  }
  const product = await Product.create({
    name,
    description,
    price: priceNum,
    unit,
    stock: stockNum,
    moq: moqNum,
    imageUrl,
    category: category || undefined,
    supplier: req.user._id,
    status: 'pending',
    isActive: true,
  });
  await recordStock(product, {
    delta: stockNum,
    reason: 'create',
    actor: req.user._id,
    note: 'Initial stock',
  });
  await notifyAdmins({
    title: 'Product awaiting approval',
    body: `${req.user.businessName || req.user.name} submitted "${product.name}".`,
    relatedProduct: product._id,
    link: '/admin/products',
    type: 'product_submitted',
  });
  res.status(201).json({ product });
});

export const updateProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ message: 'Not found' });
  if (req.user.role === 'supplier' && String(product.supplier) !== String(req.user._id)) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  if (product.status === 'removed' && req.user.role !== 'admin') {
    return res.status(400).json({ message: 'Removed products cannot be edited' });
  }

  const catalogFields = ['name', 'description', 'price', 'unit', 'imageUrl', 'category'];
  let catalogChanged = false;
  if (req.body.price !== undefined) {
    const priceNum = Number(req.body.price);
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      return res.status(400).json({ message: 'Price must be greater than 0' });
    }
  }
  if (req.body.moq !== undefined && (Number(req.body.moq) < 1 || !Number.isFinite(Number(req.body.moq)))) {
    return res.status(400).json({ message: 'Minimum order quantity must be at least 1' });
  }
  for (const f of catalogFields) {
    if (req.body[f] !== undefined && String(req.body[f]) !== String(product[f] ?? '')) {
      catalogChanged = true;
    }
    if (req.body[f] !== undefined) product[f] = req.body[f];
  }
  if (req.body.moq !== undefined) product.moq = req.body.moq;
  if (req.body.isActive !== undefined && req.user.role === 'admin') product.isActive = req.body.isActive;

  if (req.user.role === 'supplier' && catalogChanged) {
    product.status = 'pending';
    product.rejectReason = '';
  }

  if (req.body.stock !== undefined) {
    await setStock(product, req.body.stock, {
      reason: 'adjust',
      actor: req.user._id,
      note: 'Inventory update',
    });
  } else {
    await product.save();
  }

  if (req.user.role === 'supplier' && catalogChanged) {
    await notifyAdmins({
      title: 'Product awaiting approval',
      body: `"${product.name}" was resubmitted for approval.`,
      relatedProduct: product._id,
      link: '/admin/products',
      type: 'product_submitted',
    });
  }
  res.json({ product });
});

export const deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ message: 'Not found' });
  const result = await removeProductWithOrders(product, req.user);
  res.json({ ok: true, ...result });
});

export const moderateProduct = asyncHandler(async (req, res) => {
  const { status, action, reason } = req.body;
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ message: 'Not found' });

  const act = action || status;
  if (act === 'hide') {
    return res.json({ product: await hideProduct(product) });
  }
  if (act === 'restore') {
    return res.json({ product: await restoreProduct(product) });
  }
  if (act === 'remove' || act === 'deleted') {
    const result = await removeProductWithOrders(product, req.user);
    return res.json(result);
  }

  if (!['approved', 'rejected', 'pending'].includes(act)) {
    return res.status(400).json({ message: 'Invalid status' });
  }
  product.status = act;
  if (act === 'rejected') {
    product.rejectReason = reason || 'Please resubmit with clearer details.';
  }
  if (act === 'approved') {
    product.isActive = true;
    product.rejectReason = '';
  }
  await product.save();
  if (['approved', 'rejected'].includes(act)) {
    await notifyUser(product.supplier, {
      title: act === 'approved' ? 'Product approved' : 'Product rejected',
      body:
        act === 'approved'
          ? `Your product "${product.name}" was approved.`
          : `Your product "${product.name}" was rejected.${product.rejectReason ? ` ${product.rejectReason}` : ''}`,
      link: '/supplier/products',
      relatedProduct: product._id,
      type: act === 'approved' ? 'product_approved' : 'product_rejected',
    });
  }
  res.json({ product });
});

export const stockHistory = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ message: 'Not found' });
  if (req.user.role === 'supplier' && String(product.supplier) !== String(req.user._id)) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  const items = await StockHistory.find({ product: product._id }).sort({ createdAt: -1 }).limit(100);
  res.json({ history: items });
});

export const listCategories = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.all !== '1') filter.isActive = true;
  const categories = await Category.find(filter).sort({ name: 1 });
  res.json({ categories });
});

export const createCategory = asyncHandler(async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ message: 'Name required' });
  const slug = name.toLowerCase().replace(/\s+/g, '-');
  const category = await Category.create({ name, slug, description: req.body.description });
  res.status(201).json({ category });
});

export const updateCategory = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) return res.status(404).json({ message: 'Not found' });
  if (req.body.name !== undefined) {
    category.name = req.body.name.trim();
    category.slug = category.name.toLowerCase().replace(/\s+/g, '-');
  }
  if (req.body.description !== undefined) category.description = req.body.description;
  if (req.body.isActive !== undefined) category.isActive = !!req.body.isActive;
  await category.save();
  res.json({ category });
});

export const deleteCategory = asyncHandler(async (req, res) => {
  const category = await Category.findByIdAndDelete(req.params.id);
  if (!category) return res.status(404).json({ message: 'Not found' });
  res.json({ ok: true });
});
