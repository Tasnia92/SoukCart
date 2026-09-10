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

// ════════════════════════════════════════════════════════════════════════════
// ADMIN-FLOW 7/7 routes — product & category moderation (search "ADMIN-FLOW")
//   POST   /categories        createCategory
//   PATCH  /categories/:id    updateCategory
//   DELETE /categories/:id    deleteCategory
//   PATCH  /:id/moderate      moderateProduct  (approve/reject/hide/restore/remove)
//   DELETE /:id               deleteProduct
// The other product routes are for suppliers/retailers, not admin.
// Supplier product routes (SUPPLIER-FLOW 3/8): POST / and PATCH /:id.
// See admin.controller.js for the full ADMIN-FLOW master map.
// ════════════════════════════════════════════════════════════════════════════

const router = Router();
router.get('/categories', listCategories);
router.post('/categories', requireAuth, requireRole('admin'), createCategory); // ADMIN-FLOW 7/7
router.patch('/categories/:id', requireAuth, requireRole('admin'), updateCategory); // ADMIN-FLOW 7/7
router.delete('/categories/:id', requireAuth, requireRole('admin'), deleteCategory); // ADMIN-FLOW 7/7
router.get('/', optionalAuth, listProducts);
router.get('/:id/stock-history', requireAuth, requireRole('supplier', 'admin'), stockHistory);
router.get('/:id', optionalAuth, getProduct);
router.post('/', requireAuth, requireRole('supplier'), requireApprovedSupplier, createProduct); // SUPPLIER-FLOW 3/8
router.patch('/:id', requireAuth, requireRole('supplier', 'admin'), requireApprovedSupplier, updateProduct); // SUPPLIER-FLOW 3/8
router.patch('/:id/moderate', requireAuth, requireRole('admin'), moderateProduct); // ADMIN-FLOW 7/7
router.delete('/:id', requireAuth, requireRole('admin'), deleteProduct); // ADMIN-FLOW 7/7
export default router;
