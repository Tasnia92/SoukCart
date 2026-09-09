import { Router } from 'express';
import {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  moderateProduct,
  stockHistory,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from '../controllers/product.controller.js';
import { requireAuth, requireRole, optionalAuth, requireApprovedSupplier } from '../middleware/auth.js';

const router = Router();
router.get('/categories', listCategories);
router.post('/categories', requireAuth, requireRole('admin'), createCategory);
router.patch('/categories/:id', requireAuth, requireRole('admin'), updateCategory);
router.delete('/categories/:id', requireAuth, requireRole('admin'), deleteCategory);
router.get('/', optionalAuth, listProducts);
router.get('/:id/stock-history', requireAuth, requireRole('supplier', 'admin'), stockHistory);
router.get('/:id', optionalAuth, getProduct);
router.post('/', requireAuth, requireRole('supplier'), requireApprovedSupplier, createProduct);
router.patch('/:id', requireAuth, requireRole('supplier', 'admin'), requireApprovedSupplier, updateProduct);
router.patch('/:id/moderate', requireAuth, requireRole('admin'), moderateProduct);
router.delete('/:id', requireAuth, requireRole('admin'), deleteProduct);
export default router;
