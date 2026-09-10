import {
  activateOrderAfterPayment,
  markSslFailed,
  validateSslPayment,
  findOrderFromSslPayload,
  clientRedirect,
} from '../services/payment.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

function pick(body, ...keys) {
  for (const k of keys) {
    if (body?.[k] != null && body[k] !== '') return body[k];
  }
  return undefined;
}

async function finalizeSuccess(req, res) {
  const body = { ...req.query, ...req.body };
  const valId = pick(body, 'val_id', 'valId');
  const tranId = pick(body, 'tran_id', 'tranId');
  const order = await findOrderFromSslPayload(body);
  if (!order) {
    return res.redirect(clientRedirect('/retailer/orders?pay=missing', null));
  }
  try {
    const ssl = await validateSslPayment({ valId, tranId: tranId || order.sslTranId });
    const paid = Number(ssl.amount || ssl.store_amount || 0);
    if (paid && Math.abs(paid - Number(order.amountDueNow)) > 0.5) {
      console.warn('SSL amount mismatch', { paid, due: order.amountDueNow, order: order.orderNumber });
    }
    await activateOrderAfterPayment(order, ssl);
    return res.redirect(clientRedirect(`/retailer/orders?paid=${encodeURIComponent(order.orderNumber)}`, order));
  } catch (e) {
    console.error('SSL success finalize failed', e.message);
    await markSslFailed(order, e.message);
    return res.redirect(clientRedirect(`/retailer/orders?pay=fail&reason=${encodeURIComponent(e.message)}`, order));
  }
}

async function finalizeFail(req, res, label) {
  const body = { ...req.query, ...req.body };
  const order = await findOrderFromSslPayload(body);
  if (order) await markSslFailed(order, label);
  return res.redirect(clientRedirect(`/retailer/orders?pay=${label}`, order));
}

export const sslSuccess = asyncHandler(async (req, res) => finalizeSuccess(req, res));
export const sslFail = asyncHandler(async (req, res) => finalizeFail(req, res, 'fail'));
export const sslCancel = asyncHandler(async (req, res) => finalizeFail(req, res, 'cancel'));

/** IPN — validate + activate; respond 200 always after handling. Failures do not cancel the order. */
export const sslIpn = asyncHandler(async (req, res) => {
  const body = { ...req.body, ...req.query };
  const valId = pick(body, 'val_id', 'valId');
  const tranId = pick(body, 'tran_id', 'tranId');
  const order = await findOrderFromSslPayload(body);
  if (!order) return res.status(200).json({ ok: false, message: 'order not found' });
  try {
    if (order.deliveryFeePaid && order.status !== 'awaiting_payment') {
      return res.status(200).json({ ok: true, already: true });
    }
    const ssl = await validateSslPayment({ valId, tranId: tranId || order.sslTranId });
    await activateOrderAfterPayment(order, ssl);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('IPN error', e.message);
    return res.status(200).json({ ok: false, message: e.message });
  }
});
