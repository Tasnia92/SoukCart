import { Router } from 'express';
import {
  dashboard, submitVerification, retailers, inventory, applyDelta, earnings, notifications, markNotificationRead,
} from '../controllers/supplier.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

// ════════════════════════════════════════════════════════════════════════════
// SUPPLIER-FLOW routes — search "SUPPLIER-FLOW"  (see supplier.controller.js map)
//   1/8 POST  /verification              submitVerification
//   2/8 GET   /dashboard                 dashboard
//   3/8      products are served by product.routes.js (supplier role)
//   4/8 GET   /inventory                 inventory
//   4/8 POST  /inventory/apply-delta     applyDelta
//   5/8      orders are served by order.routes.js (see ORDER-FLOW 5/8)
//   6/8 GET   /retailers                 retailers
//   7/8 GET   /earnings                  earnings
//   8/8 GET   /notifications             notifications
//   8/8 PATCH /notifications/:id/read    markNotificationRead
// All routes require a logged-in supplier.
// ════════════════════════════════════════════════════════════════════════════

const router = Router();
router.use(requireAuth, requireRole('supplier'));
router.get('/dashboard', dashboard); // SUPPLIER-FLOW 2/8
router.post('/verification', submitVerification); // SUPPLIER-FLOW 1/8
router.get('/retailers', retailers); // SUPPLIER-FLOW 6/8
router.get('/inventory', inventory); // SUPPLIER-FLOW 4/8
router.post('/inventory/apply-delta', applyDelta); // SUPPLIER-FLOW 4/8
router.get('/earnings', earnings); // SUPPLIER-FLOW 7/8
router.get('/notifications', notifications); // SUPPLIER-FLOW 8/8
router.patch('/notifications/:id/read', markNotificationRead); // SUPPLIER-FLOW 8/8
export default router;
