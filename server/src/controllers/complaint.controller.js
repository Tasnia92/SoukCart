import { notifyAdmins } from '../services/notify.js';
import Complaint from '../models/Complaint.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const createComplaint = asyncHandler(async (req, res) => {
  const { subject, message, orderId, productId } = req.body;
  const sub = String(subject || '').trim();
  const msg = String(message || '').trim();
  if (sub.length < 3) return res.status(400).json({ message: 'Subject must be at least 3 characters' });
  if (msg.length < 10) return res.status(400).json({ message: 'Description must be at least 10 characters' });
  const complaint = await Complaint.create({
    reporter: req.user._id,
    subject: sub,
    message: msg,
    messages: [{ from: 'retailer', body: msg }],
    order: orderId || undefined,
    product: productId || undefined,
  });
  await notifyAdmins({
    title: 'New dispute filed',
    body: `${sub}: ${msg.slice(0, 120)}`,
    link: '/admin/disputes',
    relatedOrder: orderId || undefined,
    relatedProduct: productId || undefined,
    type: 'dispute',
  });
  res.status(201).json({ complaint });
});

export const myComplaints = asyncHandler(async (req, res) => {
  const complaints = await Complaint.find({ reporter: req.user._id })
    .populate('order', 'orderNumber')
    .populate('product', 'name')
    .sort({ createdAt: -1 });
  res.json({ complaints });
});
