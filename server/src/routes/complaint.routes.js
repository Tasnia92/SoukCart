import { Router } from 'express';
import { createComplaint, myComplaints } from '../controllers/complaint.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);
router.post('/', createComplaint);
router.get('/mine', myComplaints);
export default router;
