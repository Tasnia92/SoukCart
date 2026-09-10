import Order from '../models/Order.js';
import { notifyUser, notifyMany } from './notify.js';
import { DELIVERY_FEE } from './calculations.js';
import { accruePayoutsForOrder, uniqueSupplierIds } from './payout.service.js';
import { CANCELLED_STATUSES } from './refund.service.js';
import { httpError } from '../utils/httpError.js';

// ════════════════════════════════════════════════════════════════════════════
// ORDER-FLOW (payment steps 2–4) — search "ORDER-FLOW"
//   2/8 START PAYMENT ... createSslCommerzSession   (amount due = fee only for
//                         COD, fee + merchandise for online)
//   3/8 PAYMENT RESULT .. validateSslPayment → activateOrderAfterPayment | markSslFailed
//   4/8 RETRY PAYMENT ... retryPayment
// See order.service.js for the full 1/8 … 8/8 master map.
// ════════════════════════════════════════════════════════════════════════════

// This project always uses the SSLCommerz SANDBOX environment — never live.
const SSL_API_BASE = 'https://sandbox.sslcommerz.com';

function cfg() {
  return {
    storeId: process.env.SSLCOMMERZ_STORE_ID || '',
    storePasswd: process.env.SSLCOMMERZ_STORE_PASSWD || '',
    initUrl: `${SSL_API_BASE}/gwprocess/v4/api.php`,
    validateUrl: `${SSL_API_BASE}/validator/api/validationserverAPI.php`,
    serverUrl: (process.env.SERVER_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/$/, ''),
    clientUrl: (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, ''),
  };
}

export function sslConfigured() {
  const { storeId, storePasswd } = cfg();
  return Boolean(storeId && storePasswd);
}

// ── ORDER-FLOW 2/8 · START PAYMENT (open SSLCommerz session) ──
// SEARCH: order-flow, start payment, sslcommerz, initiate payment, redirect
// DOES:   builds the SSLCommerz checkout params and returns { redirectUrl, tranId }.
//         Amount charged is order.amountDueNow (delivery fee for COD; fee + goods
//         for online). Called right after the order is placed (step 1).
// NEXT:   ORDER-FLOW 3/8 PAYMENT RESULT (SSL callback / IPN)
/**
 * Init SSLCommerz session. Amount = delivery fee only (COD) or subtotal+fee (online).
 * Returns { redirectUrl, tranId, sessionkey }.
 */
export async function createSslCommerzSession(order, retailer, { forceNew = false } = {}) {
  const c = cfg();
  if (!c.storeId || !c.storePasswd) {
    throw httpError('SSLCommerz store credentials missing in .env', 500);
  }

  const tranId = forceNew || !order.sslTranId
    ? `NEK-${order.orderNumber}-${Date.now()}`
    : order.sslTranId;
  const totalAmount = Number(order.amountDueNow || DELIVERY_FEE).toFixed(2);

  const params = new URLSearchParams({
    store_id: c.storeId,
    store_passwd: c.storePasswd,
    total_amount: totalAmount,
    currency: 'BDT',
    tran_id: tranId,
    success_url: `${c.serverUrl}/api/payments/ssl/success`,
    fail_url: `${c.serverUrl}/api/payments/ssl/fail`,
    cancel_url: `${c.serverUrl}/api/payments/ssl/cancel`,
    ipn_url: `${c.serverUrl}/api/payments/ssl/ipn`,
    cus_name: order.recipientName || retailer?.name || 'Retailer',
    cus_email: retailer?.email || 'retailer@soukcart.com',
    cus_add1: order.deliveryAddress || 'Dhaka',
    cus_city: 'Dhaka',
    cus_postcode: '1000',
    cus_country: 'Bangladesh',
    cus_phone: order.recipientMobile || retailer?.phone || '01700000000',
    shipping_method: 'NO',
    product_name: `Soukcart order ${order.orderNumber}`,
    product_category: 'grocery',
    product_profile: 'general',
    value_a: String(order._id),
    value_b: order.paymentMethod || 'cod',
    value_c: String(order.deliveryFee || DELIVERY_FEE),
  });

  const res = await fetch(c.initUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const data = await res.json().catch(() => ({}));

  if (!data?.GatewayPageURL) {
    const reason = data?.failedreason || data?.status || 'SSL session init failed';
    throw httpError(String(reason), 502, { ssl: data });
  }

  order.sslTranId = tranId;
  order.sslSessionKey = data.sessionkey || '';
  order.lastPaymentError = undefined;
  await order.save();

  return {
    provider: 'sslcommerz',
    sandbox: true,
    redirectUrl: data.GatewayPageURL,
    tranId,
    sessionkey: data.sessionkey,
    amount: Number(totalAmount),
  };
}

// ── ORDER-FLOW 3/8 · PAYMENT RESULT — validate the SSL payment ──
// SEARCH: order-flow, payment check, validate payment, ssl validate
// DOES:   asks SSLCommerz whether the transaction is VALID/VALIDATED and checks
//         the tran_id matches. Throws on failure; used by success + IPN handlers.
export async function validateSslPayment({ valId, tranId }) {
  const c = cfg();
  if (!valId) throw httpError('Missing val_id', 400);

  const qs = new URLSearchParams({
    val_id: valId,
    store_id: c.storeId,
    store_passwd: c.storePasswd,
    format: 'json',
  });
  const res = await fetch(`${c.validateUrl}?${qs.toString()}`);
  const data = await res.json().catch(() => ({}));

  const ok = ['VALID', 'VALIDATED'].includes(String(data?.status || '').toUpperCase());
  if (!ok) {
    throw httpError(data?.error || data?.status || 'Payment validation failed', 400, { ssl: data });
  }

  if (tranId && data.tran_id && String(data.tran_id) !== String(tranId)) {
    throw httpError('tran_id mismatch', 400, { ssl: data });
  }

  return data;
}

// ── ORDER-FLOW 3/8 · PAYMENT RESULT — activate order after payment ──
// SEARCH: order-flow, payment received, activate order, delivery fee paid
// DOES:   marks deliveryFeePaid (+ productAmountPaid/paymentStatus for online) and
//         moves status awaiting_payment → placed. Idempotent; stock NOT reserved.
// NEXT:   ORDER-FLOW 5/8 SUPPLIER CONFIRM (suppliers notified to confirm)
/** Activate order after validated delivery-fee (and merchandise if online) payment. Idempotent. Stock is NOT reserved here. */
export async function activateOrderAfterPayment(order, sslData = {}) {
  if (!order) throw httpError('Order not found', 404);

  if (CANCELLED_STATUSES.includes(order.status)) {
    throw httpError('Order is cancelled', 400);
  }

  if (order.deliveryFeePaid && order.status !== 'awaiting_payment') {
    return order;
  }

  order.deliveryFeePaid = true;
  order.deliveryPaymentStatus = 'paid';
  if (order.paymentMethod === 'online') {
    order.productAmountPaid = true;
    order.paymentStatus = 'paid';
  } else {
    order.productAmountPaid = false;
    if (order.paymentStatus !== 'paid') order.paymentStatus = 'unpaid';
  }
  if (sslData.val_id) order.sslValId = sslData.val_id;
  if (sslData.tran_id) order.sslTranId = sslData.tran_id;
  order.lastPaymentError = undefined;
  if (order.status === 'awaiting_payment') order.status = 'placed';
  await order.save();

  if (order.paymentMethod === 'online') {
    await notifyUser(order.retailer, {
      title: 'Payment received',
      body: `Payment confirmed for order ${order.orderNumber}. Waiting for supplier confirmation.`,
      relatedOrder: order._id,
      link: '/retailer/orders',
      type: 'payment_received',
    });
  } else {
    await notifyUser(order.retailer, {
      title: 'Delivery fee received',
      body: `Tk ${order.deliveryFee || DELIVERY_FEE} delivery fee received for order ${order.orderNumber}.`,
      relatedOrder: order._id,
      link: '/retailer/orders',
      type: 'delivery_fee_received',
    });
  }

  await notifyMany(uniqueSupplierIds(order), {
    title: 'Order ready to confirm',
    body: `Order ${order.orderNumber} — Tk ${order.subtotal} merchandise. Confirm your items or cancel.`,
    relatedOrder: order._id,
    link: '/supplier/orders',
    type: 'new_order',
  });

  return order;
}

// ── ORDER-FLOW 3/8 · PAYMENT RESULT — payment failed/cancelled ──
// SEARCH: order-flow, payment failed, payment cancelled
// DOES:   keeps the order alive so the retailer can retry (does NOT cancel it).
// NEXT:   ORDER-FLOW 4/8 RETRY PAYMENT
/** Failed/cancelled SSL: keep the order so the retailer can retry. */
export async function markSslFailed(order, reason = 'Payment failed') {
  if (!order) return order;
  if (order.deliveryFeePaid) return order;
  if (CANCELLED_STATUSES.includes(order.status)) return order;
  order.paymentStatus = 'failed';
  order.lastPaymentError = reason;
  await order.save();
  await notifyUser(order.retailer, {
    title: 'Payment failed',
    body: `Payment for order ${order.orderNumber} failed. You can retry from Orders.`,
    relatedOrder: order._id,
    link: '/retailer/orders',
    type: 'payment_failed',
  });
  return order;
}

// ── ORDER-FLOW 4/8 · RETRY PAYMENT ──
// SEARCH: order-flow, retry payment, pay again, payment retry
// DOES:   only the order's retailer (or admin) may retry, only while unpaid and
//         still awaiting_payment/placed. Clears the previous error, opens a fresh
//         SSLCommerz session (see ORDER-FLOW 2/8).
export async function retryPayment(order, retailer) {
  if (String(order.retailer) !== String(retailer._id) && retailer.role !== 'admin') {
    throw httpError('Forbidden', 403);
  }
  if (CANCELLED_STATUSES.includes(order.status)) throw httpError('Order is cancelled', 400);
  if (order.deliveryFeePaid) throw httpError('Payment already received', 400);
  if (!['awaiting_payment', 'placed'].includes(order.status)) {
    throw httpError('Cannot retry payment for this order', 400);
  }
  order.paymentStatus = 'unpaid';
  order.lastPaymentError = undefined;
  await order.save();
  return createSslCommerzSession(order, retailer, { forceNew: true });
}

export function clientRedirect(path, order) {
  const { clientUrl } = cfg();
  // Prefer the origin the retailer actually checked out from. Falling back to
  // the env CLIENT_URL keeps old orders / unknown-order callbacks working.
  const base = order?.clientOrigin || clientUrl;
  return `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function findOrderFromSslPayload(body = {}) {
  const id = body.value_a || body.value_A;
  const tranId = body.tran_id || body.tranId;
  if (id) {
    const byId = await Order.findById(id);
    if (byId) return byId;
  }
  if (tranId) return Order.findOne({ sslTranId: tranId });
  return null;
}
