import { X } from 'lucide-react'
import { Button } from '@/components/ui'
import { cn, money } from '@/lib/utils'

type InvoiceItem = {
  name?: string
  unit?: string
  price?: number
  quantity?: number
  lineTotal?: number
  supplier?: { businessName?: string; name?: string }
}

export type InvoiceOrder = {
  _id: string
  orderNumber?: string
  createdAt?: string | null
  confirmedAt?: string | null
  deliveredAt?: string | null
  status?: string
  items?: InvoiceItem[]
  subtotal?: number
  deliveryFee?: number
  paymentMethod?: string
  paymentStatus?: string
  deliveryFeePaid?: boolean
  productAmountPaid?: boolean
  recipientName?: string
  recipientMobile?: string
  deliveryAddress?: string
  retailer?: { name?: string; businessName?: string; phone?: string; email?: string }
  supplier?: { businessName?: string; name?: string }
  notes?: string
}

function fmtDate(at?: string | null) {
  return at ? new Date(at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'
}

function supplierName(s?: { businessName?: string; name?: string }) {
  return s?.businessName || s?.name || 'SoukCart Supplier'
}

export function InvoiceSheet({ order, className }: { order: InvoiceOrder; className?: string }) {
  const items = order.items || []
  const subtotal = order.subtotal || 0
  const deliveryFee = order.deliveryFee ?? 120
  const total = subtotal + deliveryFee
  const placedOn = fmtDate(order.createdAt)
  const completedOn = order.deliveredAt ? fmtDate(order.deliveredAt) : fmtDate(order.confirmedAt)
  const billTo = order.retailer?.businessName || order.retailer?.name || 'Retailer'

  const paymentStatus = order.paymentStatus === 'paid' || order.productAmountPaid
    ? 'Paid'
    : order.paymentStatus === 'refunded'
      ? 'Refunded'
      : order.paymentMethod === 'cod'
        ? 'Collect on delivery'
        : 'Unpaid'

  const rows = items.map((it, i) => ({
    key: i,
    name: it.name || 'Item',
    unit: it.unit || 'unit',
    qty: it.quantity || 0,
    price: it.price || 0,
    lineTotal: it.lineTotal ?? ((it.price || 0) * (it.quantity || 0)),
  }))

  return (
    <div className={cn('bg-white text-[#0b0c0d]', className)}>
      {/* Header */}
      <div className="flex items-start justify-between gap-6 border-b-[3px] border-[#d45b39] pb-5">
        <div className="flex items-center gap-3">
          <img
            src="/brand/logo-soukcart.png"
            alt="SoukCart"
            className="h-14 w-auto object-contain"
          />
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold tracking-tight text-[#121315]">INVOICE</div>
          <div className="mt-1 font-medium text-[#d45b39]">{order.orderNumber || '—'}</div>
        </div>
      </div>

      {/* Meta / bill / supplier */}
      <div className="mt-5 grid grid-cols-2 gap-6 sm:grid-cols-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9aa0a6]">Billed to</p>
          <p className="mt-1 font-semibold">{billTo}</p>
          <p className="text-sm text-[#565b60]">{order.recipientName || ''}</p>
          {order.deliveryAddress ? <p className="mt-1 text-sm text-[#565b60]">{order.deliveryAddress}</p> : null}
          {order.recipientMobile ? <p className="mt-1 text-sm text-[#565b60]">{order.recipientMobile}</p> : null}
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9aa0a6]">Supplied by</p>
          <p className="mt-1 font-semibold">{supplierName(order.supplier)}</p>
          {order.paymentMethod === 'cod' ? (
            <p className="mt-1 text-sm text-[#565b60]">Payment: Collect on delivery</p>
          ) : (
            <p className="mt-1 text-sm text-[#565b60]">Payment: Online ({paymentStatus})</p>
          )}
        </div>
        <div className="col-span-2 sm:col-span-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9aa0a6]">Details</p>
          <div className="mt-1 space-y-1 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-[#565b60]">Order date</span>
              <span className="font-medium">{placedOn}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-[#565b60]">Status</span>
              <span className="font-medium">{order.deliveredAt ? 'Delivered' : (order.confirmedAt ? 'Confirmed' : 'In transit')}</span>
            </div>
            {order.confirmedAt && (
              <div className="flex justify-between gap-4">
                <span className="text-[#565b60]">Completed</span>
                <span className="font-medium">{completedOn}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Items */}
      <div className="mt-7">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-[#faf7f2] text-left text-[11px] font-semibold uppercase tracking-wider text-[#8b6b5b]">
              <th className="rounded-l-md px-3 py-2.5 font-semibold">Item</th>
              <th className="px-3 py-2.5 text-right font-semibold">Unit</th>
              <th className="px-3 py-2.5 text-center font-semibold">Qty</th>
              <th className="px-3 py-2.5 text-right font-semibold">Unit price</th>
              <th className="rounded-r-md px-3 py-2.5 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-[#eeeeea]">
                <td className="px-3 py-2.5 font-medium text-[#121315]">{r.name}</td>
                <td className="px-3 py-2.5 text-right text-[#565b60] capitalize">{r.unit}</td>
                <td className="px-3 py-2.5 text-center text-[#565b60]">{r.qty}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-[#565b60]">{money(r.price)}</td>
                <td className="px-3 py-2.5 text-right font-medium tabular-nums">{money(r.lineTotal)}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td className="px-3 py-2.5 text-[#565b60]">No line items.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <div className="mt-5 flex justify-end">
        <div className="w-full max-w-xs space-y-1.5 text-sm">
          <div className="flex justify-between gap-6">
            <span className="text-[#565b60]">Subtotal</span>
            <span className="tabular-nums">{money(subtotal)}</span>
          </div>
          <div className="flex justify-between gap-6">
            <span className="text-[#565b60]">Delivery fee</span>
            <span className="tabular-nums">{money(deliveryFee)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-6 border-t-2 border-[#d45b39] pt-2.5">
            <span className="text-base font-bold">Total</span>
            <span className="text-lg font-bold tabular-nums text-[#d45b39]">{money(total)}</span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-8 flex items-center justify-between border-t border-[#eeeeea] pt-4 text-sm">
        <p className="text-[#565b60]">
          Thank you for ordering with SoukCart{order.notes ? ` · ${order.notes}` : ''}.
        </p>
        <p className="font-semibold text-[#d45b39]">soukcart</p>
      </div>
    </div>
  )
}

export function PrintInvoiceModal({ order, onClose }: { order: InvoiceOrder | null; onClose: () => void }) {
  if (!order) return null
  return (
    <div className="invoice-overlay fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      <div className="invoice-modal-card w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
        <div className="invoice-toolbar flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <p className="text-sm font-semibold">Invoice preview</p>
          <div className="flex items-center gap-2">
            <Button onClick={() => window.print()}>Print</Button>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="rounded-lg p-2 text-muted transition hover:bg-canvas"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="invoice-sheet p-6 sm:p-8">
          <InvoiceSheet order={order} />
        </div>
      </div>
    </div>
  )
}