import { Router } from 'express';
import {
  placeOrder,
  myOrders,
  getOrder,
  updateStatus,
  confirmOrder,
  retryOrderPayment,
  collectCodPayment,
} from '../controllers/order.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);
router.post('/', requireRole('retailer'), placeOrder);
router.get('/', myOrders);
router.get('/:id', getOrder);
router.patch('/:id/status', updateStatus);
router.post('/:id/confirm', requireRole('supplier', 'admin'), confirmOrder);
router.post('/:id/pay', requireRole('retailer', 'admin'), retryOrderPayment);
router.post('/:id/collect-cod', requireRole('admin'), collectCodPayment);
export default router;
