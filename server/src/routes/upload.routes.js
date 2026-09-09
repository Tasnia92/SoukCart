import { Router } from 'express';
import { handleUpload, upload } from '../controllers/upload.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.post('/', requireAuth, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.message || 'Upload failed' });
    next();
  });
}, handleUpload);
export default router;
