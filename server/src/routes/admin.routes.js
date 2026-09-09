import { Router } from 'express';
import {
  dashboard,
  listUsers,
  createUser,
  updateUser,
  listVerifications,
  reviewVerification,
  listPayouts,
  createPayout,
  runWeeklyPayouts,
  payPayout,
  updateCommission,
  listComplaints,
  updateComplaint,
  listRefunds,
  completeRefund,
} from '../controllers/admin.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));
router.get('/dashboard', dashboard);
router.get('/users', listUsers);
router.post('/users', createUser);
router.patch('/users/:id', updateUser);
router.get('/verifications', listVerifications);
router.patch('/verifications/:id', reviewVerification);
router.get('/payouts', listPayouts);
router.post('/payouts', createPayout);
router.post('/payouts/weekly', runWeeklyPayouts);
router.patch('/payouts/:id/pay', payPayout);
router.patch('/commission', updateCommission);
router.get('/complaints', listComplaints);
router.patch('/complaints/:id', updateComplaint);
router.get('/refunds', listRefunds);
router.patch('/refunds/:id/complete', completeRefund);
export default router;
