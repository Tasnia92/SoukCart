import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ['retailer', 'supplier', 'admin'], required: true },
    phone: String,
    businessName: String,
    shopLink: String,
    shopSlug: { type: String, lowercase: true, trim: true, sparse: true, unique: true },
    businessDescription: String,
    nidDocUrl: String,
    verificationStatus: {
      type: String,
      enum: ['none', 'pending', 'approved', 'rejected'],
      default: 'none',
    },
    verificationRejectReason: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model('User', userSchema);
