import mongoose from 'mongoose';

const orderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: String,
    unit: String,
    price: Number,
    quantity: Number,
    lineTotal: Number,
    imageUrl: String,
    confirmedAt: Date,
    stockReserved: { type: Boolean, default: false },
  },
  { _id: true }
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, unique: true, required: true },
    retailer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    /** First / primary supplier (legacy + populate convenience). */
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    suppliers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    items: [orderItemSchema],
    subtotal: { type: Number, required: true },
    deliveryFee: { type: Number, default: 120 },
    commissionRate: { type: Number, default: 0.1 },
    commissionAmount: { type: Number, default: 0 },
    supplierAmount: { type: Number, default: 0 },
    /** Amount charged in the current SSL session (fee only for COD; fee+merchandise for online). */
    amountDueNow: { type: Number, default: 0 },
    paymentMethod: { type: String, enum: ['cod', 'online'], default: 'cod' },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'failed', 'paid', 'refunded', 'partial_refund'],
      default: 'unpaid',
    },
    deliveryFeePaid: { type: Boolean, default: false },
    deliveryPaymentStatus: { type: String, enum: ['unpaid', 'paid'], default: 'unpaid' },
    productAmountPaid: { type: Boolean, default: false },
    sslTranId: String,
    sslValId: String,
    sslSessionKey: String,
    lastPaymentError: String,
    status: {
      type: String,
      enum: [
        'awaiting_payment',
        'placed',
        'supplier_approved',
        'supplier_confirmed',
        'supplier_cancelled',
        'delivery_initiated',
        'shipped',
        'out_for_delivery',
        'delivered',
        'cancelled',
        'refunded',
      ],
      default: 'awaiting_payment',
    },
    recipientName: String,
    recipientMobile: String,
    deliveryAddress: String,
    notes: String,
    cancelReason: String,
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cancelledByRole: String,
    cancelledAt: Date,
    confirmedAt: Date,
    deliveryStarted: { type: Boolean, default: false },
    deliveryInitiatedAt: Date,
    shippedAt: Date,
    outForDeliveryAt: Date,
    deliveredAt: Date,
    codCollectedAt: Date,
    codCollectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    payoutSettled: { type: Boolean, default: false },
    manualRefundStatus: {
      type: String,
      enum: ['none', 'pending', 'completed'],
      default: 'none',
    },
    refundAmount: { type: Number, default: 0 },
    refundedAt: Date,
    refundNote: String,
  },
  { timestamps: true }
);

orderSchema.index({ retailer: 1, createdAt: -1 });
orderSchema.index({ supplier: 1, createdAt: -1 });
orderSchema.index({ 'items.supplier': 1, status: 1 });
orderSchema.index({ status: 1, paymentStatus: 1, createdAt: 1 });
orderSchema.index({ manualRefundStatus: 1 });

export default mongoose.model('Order', orderSchema);
