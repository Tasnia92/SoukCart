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

// ════════════════════════════════════════════════════════════════════════════
// ORDER-FLOW routes — search "ORDER-FLOW"  (see order.service.js master map)
//   1/8 POST  /              placeOrder        (retailer)
//       GET   /              myOrders          (list, not a flow step)
//       GET   /:id           getOrder
//   6/8 PATCH /:id/status    updateStatus      (delivery / cancel / refund)
//   8/8 PATCH /:id/status    updateStatus      (cancelled / supplier_cancelled / refunded)
//   5/8 POST  /:id/confirm   confirmOrder      (supplier, admin)
//   4/8 POST  /:id/pay       retryOrderPayment (retailer, admin)
//   7/8 POST  /:id/collect-cod collectCodPayment (admin)
// ════════════════════════════════════════════════════════════════════════════

const router = Router();
router.use(requireAuth);
router.post('/', requireRole('retailer'), placeOrder);
router.get('/', myOrders);
router.get('/:id', getOrder);
router.patch('/:id/status', updateStatus);
router.post('/:id/confirm', requireRole('supplier', 'admin'), confirmOrder); // ORDER-FLOW 5/8 · SUPPLIER-FLOW 5/8
router.post('/:id/pay', requireRole('retailer', 'admin'), retryOrderPayment);
router.post('/:id/collect-cod', requireRole('admin'), collectCodPayment);
export default router;
