import { useCallback, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { MoreVertical } from 'lucide-react'
import { Badge, Button, Card, DropdownMenu } from '@/components/ui'
import { CancelOrderModal } from '@/components/CancelOrderModal'
import { api } from '@/services/api'
import { money, cn, statusLabel, canCancelStatus, needsPaymentRetry } from '@/lib/utils'
import { usePoll } from '@/lib/poll'

const filters = ['All', 'Pending', 'Shipped', 'Delivered', 'Cancelled'] as const

function statusTone(status: string) {
  if (status === 'cancelled' || status === 'supplier_cancelled' || status === 'refunded') return 'bg-[#f6b2be] text-[#e84461]'
  if (status === 'delivered') return 'bg-[#d1fae5] text-[#047857]'
  if (status === 'out_for_delivery' || status === 'shipped' || status === 'delivery_initiated') return 'bg-[#dbeafe] text-[#1d4ed8]'
  if (status === 'placed' || status === 'supplier_approved' || status === 'awaiting_payment') return 'bg-[#fef3c7] text-[#b45309]'
  return ''
}

function payBadges(o: any) {
  const bits: string[] = []
  if (o.paymentStatus === 'failed') bits.push('Payment failed — retry')
  if (o.deliveryFeePaid) bits.push(`Delivery ${money(120)} paid`)
  if (o.productAmountPaid) bits.push('Products paid')
  else if (o.paymentMethod === 'cod' && o.deliveryFeePaid) bits.push('COD due')
  if (o.manualRefundStatus === 'pending') bits.push(`Refund pending ${money(o.refundAmount)}`)
  if (o.manualRefundStatus === 'completed') bits.push('Refund sent')
  return bits
}

function mapFilter(status: string, filter: string) {
  if (filter === 'All') return true
  if (filter === 'Pending') return ['placed', 'supplier_approved', 'supplier_confirmed', 'awaiting_payment'].includes(status)
  if (filter === 'Shipped') return ['delivery_initiated', 'shipped', 'out_for_delivery'].includes(status)
  if (filter === 'Delivered') return status === 'delivered'
  if (filter === 'Cancelled') return ['cancelled', 'supplier_cancelled', 'refunded'].includes(status)
  return true
}

export function RetailerOrders() {
  const [orders, setOrders] = useState<any[]>([])
  const [filter, setFilter] = useState<(typeof filters)[number]>('All')
  const [selected, setSelected] = useState<string[]>([])
  const [params] = useSearchParams()
  const payHint = params.get('pay')
  const paid = params.get('paid')
  const [cancelTarget, setCancelTarget] = useState<any | null>(null)
  const [cancelling, setCancelling] = useState(false)

  const load = useCallback(async () => {
    const d = await api.get<{ orders: any[] }>('/orders')
    setOrders(d.orders)
  }, [])

  usePoll(() => void load(), [load])

  const visible = useMemo(() => orders.filter((o) => mapFilter(o.status, filter)), [orders, filter])

  async function confirmCancel(reason: string) {
    if (!cancelTarget) return
    setCancelling(true)
    try {
      await api.patch(`/orders/${cancelTarget._id}/status`, { status: 'cancelled', cancelReason: reason })
      setCancelTarget(null)
      await load()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Cancel failed')
    } finally {
      setCancelling(false)
    }
  }

  async function retry(id: string) {
    const res = await api.post<{ payment: { redirectUrl: string } }>(`/orders/${id}/pay`, {})
    const url = res.payment?.redirectUrl
    if (!url) throw new Error('No payment URL')
    window.location.href = url
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-2xl font-semibold">Orders</h2>
        <Link to="/retailer/products"><Button>+ Place order</Button></Link>
      </div>
      {payHint === 'fail' || payHint === 'cancel' ? (
        <p className="mb-3 text-sm text-danger">Payment {payHint === 'cancel' ? 'cancelled' : 'failed'}. Retry below — the order is still open.</p>
      ) : null}
      {paid ? <p className="mb-3 text-sm text-primary">Payment received for {paid}.</p> : null}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {filters.map((f) => {
          const count = orders.filter((o) => mapFilter(o.status, f)).length
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'rounded-full px-3 py-1.5 text-sm',
                filter === f ? 'bg-[#242526] text-white' : 'bg-[#f3f4f6] text-foreground',
              )}
            >
              {f} {count}
            </button>
          )
        })}
        <Button variant="secondary" className="h-8 ml-auto" onClick={() => setFilter('All')}>Filters</Button>
      </div>
      <Card className="overflow-hidden rounded-[12px]">
        <table className="w-full text-sm">
          <thead className="bg-canvas text-left text-muted">
            <tr>
              <th className="px-3 py-3 w-8">
                <input
                  type="checkbox"
                  checked={visible.length > 0 && visible.every((o) => selected.includes(o._id))}
                  onChange={(e) => setSelected(e.target.checked ? visible.map((o) => o._id) : [])}
                  aria-label="Select all orders"
                />
              </th>
              <th className="px-3 py-3 font-medium">Order</th>
              <th className="px-3 py-3 font-medium">Product</th>
              <th className="px-3 py-3 font-medium">Type</th>
              <th className="px-3 py-3 font-medium">Price</th>
              <th className="px-3 py-3 font-medium">Date</th>
              <th className="px-3 py-3 font-medium">Status</th>
              <th className="px-3 py-3 font-medium w-10"></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((o) => {
              const first = o.items?.[0]
              const suppliers = [...new Set((o.items || []).map((i: any) => i.supplier?.businessName || i.supplier?.name || o.supplier?.businessName).filter(Boolean))]
              return (
                <tr key={o._id} className="border-t border-border">
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selected.includes(o._id)}
                      onChange={(e) => setSelected((s) => e.target.checked ? [...s, o._id] : s.filter((id) => id !== o._id))}
                      aria-label={`Select ${o.orderNumber}`}
                    />
                  </td>
                  <td className="px-3 py-3 font-medium">{o.orderNumber}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2 min-w-[160px]">
                      <img src={first?.imageUrl || 'https://placehold.co/72x72'} alt={first?.name || 'Product'} className="h-9 w-9 rounded-md object-cover bg-canvas border border-border" />
                      <div>
                        <div className="font-medium line-clamp-1">{first?.name || '—'}</div>
                        <div className="text-xs text-muted">{o.items?.length || 0} item(s){suppliers.length ? ` · ${suppliers.join(', ')}` : ''}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 capitalize">{(o.paymentMethod || 'cod').toUpperCase() === 'COD' ? 'COD' : (o.paymentMethod || 'Online')}</td>
                  <td className="px-3 py-3 tabular-nums">{money(o.subtotal)}</td>
                  <td className="px-3 py-3 text-muted">{new Date(o.createdAt).toLocaleDateString()}</td>
                  <td className="px-3 py-3">
                    <div className="space-y-1">
                      <Badge className={statusTone(o.status)}>{statusLabel(o.status)}</Badge>
                      {payBadges(o).map((b) => (
                        <div key={b} className="text-[11px] text-muted">{b}</div>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col items-end gap-1">
                      {needsPaymentRetry(o) && (
                        <Button className="h-8 text-xs" onClick={() => void retry(o._id).catch((e) => window.alert(e instanceof Error ? e.message : 'Retry failed'))}>Retry pay</Button>
                      )}
                      {canCancelStatus(o.status) && (
                        <DropdownMenu
                          button={<span className="inline-flex p-1 text-muted" aria-label="Order actions"><MoreVertical size={16} /></span>}
                        >
                          <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-canvas rounded" onClick={() => setCancelTarget(o)}>Cancel</button>
                        </DropdownMenu>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!visible.length && <p className="p-8 text-center text-muted">No orders yet.</p>}
      </Card>
      <CancelOrderModal
        open={!!cancelTarget}
        orderNumber={cancelTarget?.orderNumber || ''}
        busy={cancelling}
        onCancel={(r) => void confirmCancel(r)}
        onClose={() => setCancelTarget(null)}
      />
    </div>
  )
}
