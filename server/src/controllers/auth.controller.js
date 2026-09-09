import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { signToken } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { toShopSlug } from '../utils/slug.js';

function publicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone || '',
    verificationStatus: user.verificationStatus,
    verificationRejectReason: user.verificationRejectReason,
    businessName: user.businessName,
    shopSlug: user.shopSlug,
    shopLink: user.shopLink,
    businessDescription: user.businessDescription,
    updatedAt: user.updatedAt,
  };
}

export const register = asyncHandler(async (req, res) => {
  const { name, email, password, role, phone, businessName } = req.body;
  if (!name || !email || !password || !role) {
    return res.status(400).json({ message: 'Missing required fields' });
  }
  if (!['retailer', 'supplier'].includes(role)) {
    return res.status(400).json({ message: 'Role must be retailer or supplier' });
  }
  const exists = await User.findOne({ email: email.toLowerCase() });
  if (exists) return res.status(409).json({ message: 'Email already registered' });

  const hash = await bcrypt.hash(password, 10);
  const user = await User.create({
    name,
    email,
    password: hash,
    role,
    phone,
    businessName,
    verificationStatus: role === 'supplier' ? 'none' : 'none',
  });

  const token = signToken(user);
  res.status(201).json({
    token,
    user: publicUser(user),
  });
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: (email || '').toLowerCase() }).select('+password');
  if (!user) return res.status(401).json({ message: 'Invalid credentials' });
  const ok = await bcrypt.compare(password || '', user.password);
  if (!ok) return res.status(401).json({ message: 'Invalid credentials' });
  const token = signToken(user);
  res.json({
    token,
    user: publicUser(user),
  });
});

export const me = asyncHandler(async (req, res) => {
  res.json({ user: publicUser(req.user) });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const patch = {};
  if (req.body.name != null) patch.name = String(req.body.name).trim();
  if (req.body.phone != null) patch.phone = String(req.body.phone).trim();
  if (req.body.businessName != null) patch.businessName = String(req.body.businessName).trim();
  if (req.body.businessDescription != null) patch.businessDescription = String(req.body.businessDescription).trim();
  if (req.body.shopLink != null) {
    const shopLink = String(req.body.shopLink).trim();
    patch.shopLink = shopLink;
    const shopSlug = toShopSlug(shopLink);
    if (shopSlug) {
      const taken = await User.findOne({ shopSlug, _id: { $ne: req.user._id } });
      if (taken) return res.status(409).json({ message: 'That shop slug is already taken' });
      patch.shopSlug = shopSlug;
    }
  }
  const user = await User.findByIdAndUpdate(req.user._id, patch, { new: true });
  res.json({ user: publicUser(user) });
});

export const changeEmail = asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ message: 'Enter a valid email address' });
  }
  if (!password) {
    return res.status(400).json({ message: 'Enter your current password to change your email' });
  }
  const user = await User.findById(req.user._id).select('+password');
  if (!user) return res.status(404).json({ message: 'Not found' });
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ message: 'Current password is incorrect' });
  if (user.email === email) return res.json({ user: publicUser(user) });
  const taken = await User.findOne({ email, _id: { $ne: user._id } });
  if (taken) return res.status(409).json({ message: 'That email is already registered' });
  user.email = email;
  await user.save();
  res.json({ user: publicUser(user) });
});

export const changePassword = asyncHandler(async (req, res) => {
  const password = String(req.body.password || '');
  if (password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' });
  const user = await User.findById(req.user._id).select('+password');
  if (!user) return res.status(404).json({ message: 'Not found' });
  user.password = await bcrypt.hash(password, 10);
  await user.save();
  res.json({ ok: true });
});
