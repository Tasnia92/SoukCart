import { Router } from 'express';
import {
  dashboard, submitVerification, retailers, inventory, applyDelta, earnings, notifications, markNotificationRead,
} from '../controllers/supplier.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireRole('supplier'));
router.get('/dashboard', dashboard);
router.post('/verification', submitVerification);
router.get('/retailers', retailers);
router.get('/inventory', inventory);
router.post('/inventory/apply-delta', applyDelta);
router.get('/earnings', earnings);
router.get('/notifications', notifications);
router.patch('/notifications/:id/read', markNotificationRead);
export default router;
