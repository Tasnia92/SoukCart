import mongoose from 'mongoose';

const stockHistorySchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    delta: { type: Number, required: true },
    quantityAfter: { type: Number, required: true },
    reason: {
      type: String,
      enum: ['create', 'confirm', 'cancel', 'adjust', 'restore'],
      required: true,
    },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    note: { type: String, default: '' },
  },
  { timestamps: true }
);

export default mongoose.model('StockHistory', stockHistorySchema);
