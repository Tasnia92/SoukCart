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

// ════════════════════════════════════════════════════════════════════════════
// ADMIN-FLOW routes — search "ADMIN-FLOW"  (see admin.controller.js master map)
//   1/7 GET   /dashboard                 dashboard
//   2/7 GET   /users                     listUsers
//   2/7 POST  /users                     createUser
//   2/7 PATCH /users/:id                 updateUser
//   3/7 GET   /verifications             listVerifications
//   3/7 PATCH /verifications/:id         reviewVerification
//   4/7 GET   /payouts                   listPayouts
//   4/7 POST  /payouts                   createPayout
//   4/7 POST  /payouts/weekly            runWeeklyPayouts
//   4/7 PATCH /payouts/:id/pay           payPayout
//   4/7 PATCH /commission                updateCommission
//   5/7 GET   /complaints                listComplaints
//   5/7 PATCH /complaints/:id            updateComplaint
//   6/7 GET   /refunds                   listRefunds      (REFUND-FLOW 6/6)
//   6/7 PATCH /refunds/:id/complete      completeRefund   (REFUND-FLOW 6/6)
//   7/7 product/category moderation lives in product.routes.js (also ADMIN-FLOW)
// ════════════════════════════════════════════════════════════════════════════

const router = Router();
router.use(requireAuth, requireRole('admin'));
router.get('/dashboard', dashboard); // ADMIN-FLOW 1/7
router.get('/users', listUsers); // ADMIN-FLOW 2/7
router.post('/users', createUser); // ADMIN-FLOW 2/7
router.patch('/users/:id', updateUser); // ADMIN-FLOW 2/7
router.get('/verifications', listVerifications); // ADMIN-FLOW 3/7
router.patch('/verifications/:id', reviewVerification); // ADMIN-FLOW 3/7
router.get('/payouts', listPayouts); // ADMIN-FLOW 4/7
router.post('/payouts', createPayout); // ADMIN-FLOW 4/7
router.post('/payouts/weekly', runWeeklyPayouts); // ADMIN-FLOW 4/7
router.patch('/payouts/:id/pay', payPayout); // ADMIN-FLOW 4/7
router.patch('/commission', updateCommission); // ADMIN-FLOW 4/7
router.get('/complaints', listComplaints); // ADMIN-FLOW 5/7
router.patch('/complaints/:id', updateComplaint); // ADMIN-FLOW 5/7
router.get('/refunds', listRefunds); // ADMIN-FLOW 6/7 · REFUND-FLOW 6/6
router.patch('/refunds/:id/complete', completeRefund); // ADMIN-FLOW 6/7 · REFUND-FLOW 6/6
export default router;
