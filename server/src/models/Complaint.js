import mongoose from 'mongoose';

const complaintSchema = new mongoose.Schema(
  {
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    subject: { type: String, required: true },
    message: { type: String, required: true },
    status: {
      type: String,
      enum: ['open', 'in_review', 'resolved', 'closed'],
      default: 'open',
    },
    messages: [
      {
        from: { type: String, enum: ['retailer', 'admin'], default: 'retailer' },
        body: { type: String, required: true },
        at: { type: Date, default: Date.now },
      },
    ],
    adminNote: String,
    resolvedAt: Date,
  },
  { timestamps: true }
);

export default mongoose.model('Complaint', complaintSchema);
