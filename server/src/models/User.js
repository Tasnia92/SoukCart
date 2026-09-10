import mongoose from 'mongoose';

// ════════════════════════════════════════════════════════════════════════════
// SUPPLIER-FLOW — supplier profile fields (search "SUPPLIER-FLOW")
//   1/8 VERIFICATION: businessName, shopLink, shopSlug, businessDescription,
//        nidDocUrl, verificationStatus (none|pending|approved|rejected) and
//        verificationRejectReason. Set by submitVerification; changed by admin
//        (ADMIN-FLOW 3/7). role becomes "supplier" once approved.
// ════════════════════════════════════════════════════════════════════════════

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
    // SUPPLIER-FLOW 1/8 · verification state (none → pending → approved/rejected)
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
