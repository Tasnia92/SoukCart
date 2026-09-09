import mongoose from 'mongoose';

const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, required: true },
    commissionRate: { type: Number, default: 0.1 },
  },
  { timestamps: true }
);

export default mongoose.model('Settings', settingsSchema);
