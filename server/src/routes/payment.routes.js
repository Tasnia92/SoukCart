import { Router } from 'express';
import { sslSuccess, sslFail, sslCancel, sslIpn } from '../controllers/payment.controller.js';

const router = Router();
// SSLCommerz redirects/posts without JWT
router.all('/ssl/success', sslSuccess);
router.all('/ssl/fail', sslFail);
router.all('/ssl/cancel', sslCancel);
router.all('/ssl/ipn', sslIpn);
export default router;
