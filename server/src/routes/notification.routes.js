import { Router } from 'express';
import Notification from '../models/Notification.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// ════════════════════════════════════════════════════════════════════════════
// NOTIFY-FLOW — READ side (steps 4/5–5/5). Search "NOTIFY-FLOW".
//   4/5 GET   /             latest 50 notifications for the logged-in user
//   4/5 GET   /unread-count unread badge count
//   5/5 PATCH /:id/read     mark one notification as read
//   5/5 POST  /read-all     mark all as read
// All routes require auth and are scoped to req.user._id.
// See notify.js for the master map (write side = steps 1/5–3/5).
// ════════════════════════════════════════════════════════════════════════════

const router = Router();
router.use(requireAuth);

// NOTIFY-FLOW 4/5 · read feed (latest 50 for the current user)
router.get('/', asyncHandler(async (req, res) => {
  const notifications = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50);
  res.json({ notifications });
}));

// NOTIFY-FLOW 4/5 · unread count badge
router.get('/unread-count', asyncHandler(async (req, res) => {
  const count = await Notification.countDocuments({ user: req.user._id, isRead: false });
  res.json({ count });
}));

// NOTIFY-FLOW 5/5 · mark one notification as read
router.patch('/:id/read', asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    { isRead: true },
    { new: true }
  );
  if (!notification) return res.status(404).json({ message: 'Not found' });
  res.json({ notification });
}));

// NOTIFY-FLOW 5/5 · mark all notifications as read
router.post('/read-all', asyncHandler(async (req, res) => {
  const result = await Notification.updateMany(
    { user: req.user._id, isRead: false },
    { $set: { isRead: true } }
  );
  res.json({ ok: true, modified: result.modifiedCount });
}));

export default router;
