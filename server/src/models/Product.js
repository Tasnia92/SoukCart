import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    price: {
      type: Number,
      required: true,
      validate: {
        validator: (v) => Number.isFinite(Number(v)) && Number(v) > 0,
        message: 'Price must be greater than 0',
      },
    },
    unit: { type: String, required: true },
    stock: { type: Number, required: true, min: 0 },
    moq: { type: Number, required: true, min: 1, default: 1 },
    imageUrl: { type: String, default: '' },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'removed'],
      default: 'pending',
    },
    isActive: { type: Boolean, default: true },
    rejectReason: { type: String, default: '' },
    removedAt: Date,
  },
  { timestamps: true }
);

productSchema.index({ status: 1, isActive: 1, stock: 1 });
productSchema.index({ supplier: 1, status: 1 });

export default mongoose.model('Product', productSchema);
