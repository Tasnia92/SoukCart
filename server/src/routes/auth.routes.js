import { Router } from 'express';
import { register, login, me, updateProfile, changeEmail, changePassword } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.post('/register', register);
router.post('/login', login);
router.get('/me', requireAuth, me);
router.patch('/me', requireAuth, updateProfile);
router.patch('/email', requireAuth, changeEmail);
router.patch('/password', requireAuth, changePassword);
export default router;
