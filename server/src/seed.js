import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { connectDB } from './config/db.js';
import User from './models/User.js';
import Category from './models/Category.js';
import Product from './models/Product.js';
import Settings from './models/Settings.js';
import Notification from './models/Notification.js';
import StockHistory from './models/StockHistory.js';
import Order from './models/Order.js';
import Payout from './models/Payout.js';
import Complaint from './models/Complaint.js';

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/nekcart';

await connectDB(uri);

// Wipe existing data so a re-seed always starts from a clean slate.
// Only the admin user below is re-created — no categories, products,
// orders, suppliers, retailers, notifications, settings or payouts.
await Promise.all([
  User.deleteMany({}),
  Category.deleteMany({}),
  Product.deleteMany({}),
  Settings.deleteMany({}),
  Notification.deleteMany({}),
  StockHistory.deleteMany({}),
  Order.deleteMany({}),
  Payout.deleteMany({}),
  Complaint.deleteMany({}),
]);

const password = await bcrypt.hash('admin123456', 10);

const admin = await User.create({
  name: 'Admin',
  email: 'admin@soukcart.com',
  password,
  role: 'admin',
});

console.log('Seed complete — only the admin user was created.');
console.log({ name: admin.name, email: admin.email, password: 'admin123456' });
await mongoose.disconnect();