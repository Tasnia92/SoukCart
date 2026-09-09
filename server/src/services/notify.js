import Notification from '../models/Notification.js';
import User from '../models/User.js';

export async function notifyUser(
  userId,
  { title, body = '', link = '', relatedOrder = null, relatedProduct = null, type = 'general' } = {}
) {
  if (!userId || !title) return null;
  return Notification.create({
    user: userId,
    title,
    body,
    link,
    type,
    relatedOrder: relatedOrder || undefined,
    relatedProduct: relatedProduct || undefined,
  });
}

export async function notifyAdmins(payload) {
  const admins = await User.find({ role: 'admin', isActive: true }).select('_id');
  const out = [];
  for (const a of admins) {
    out.push(await notifyUser(a._id, payload));
  }
  return out;
}

export async function notifyMany(userIds, payload) {
  const unique = [...new Set((userIds || []).filter(Boolean).map((id) => String(id)))];
  const out = [];
  for (const id of unique) {
    out.push(await notifyUser(id, payload));
  }
  return out;
}
