import mongoose from 'mongoose';

// ════════════════════════════════════════════════════════════════════════════
// NOTIFY-FLOW — data shape (search "NOTIFY-FLOW"). One row = one user + one event.
// Written by notifyUser (step 1/5); read/marked by notification.routes.js.
// ════════════════════════════════════════════════════════════════════════════

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true },
    body: String,
    type: { type: String, default: 'general' }, // NOTIFY-FLOW: free-form event tag (see notify.js master map)
    link: String,
    relatedOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    relatedProduct: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    // NOTIFY-FLOW 5/5 · flipped by PATCH /:id/read and POST /read-all
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model('Notification', notificationSchema);
