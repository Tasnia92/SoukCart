import { Router } from 'express';
import { sslSuccess, sslFail, sslCancel, sslIpn } from '../controllers/payment.controller.js';

// ════════════════════════════════════════════════════════════════════════════
// ORDER-FLOW payment callbacks (step 3/8) — search "ORDER-FLOW"
// SSLCommerz hits these without a JWT (note: no requireAuth).
// ════════════════════════════════════════════════════════════════════════════
const router = Router();
// SSLCommerz redirects/posts without JWT
router.all('/ssl/success', sslSuccess);
router.all('/ssl/fail', sslFail);
router.all('/ssl/cancel', sslCancel);
router.all('/ssl/ipn', sslIpn);
export default router;
