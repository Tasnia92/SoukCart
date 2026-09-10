import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  BadgeCheck,
  Banknote,
  CheckCircle2,
  Clock,
  EyeOff,
  Folder,
  Layers,
  MoreVertical,
  Percent,
  RefreshCw,
  Scale,
  Search,
  ShoppingCart,
  UserCheck,
  Users,
  Wallet,
  X,
  XCircle,
} from 'lucide-react'
import { Badge, Button, Card, DropdownMenu, EmptyState, Input, Label, StatCard } from '@/components/ui'
import { NotificationsInbox } from '@/components/NotificationsInbox'
import { api } from '@/services/api'
import { money, cn, statusLabel } from '@/lib/utils'
import { usePoll } from '@/lib/poll'

function statusTone(status: string) {
  if (String(status).includes('cancel')) return 'bg-[#f6b2be] text-[#e84461]'
  if (status === 'delivered') return 'bg-[#d1fae5] text-[#047857]'
  if (status === 'out_for_delivery') return 'bg-[#dbeafe] text-[#1d4ed8]'
  if (status === 'placed' || status === 'pending') return 'bg-[#fef3c7] text-[#b45309]'
  if (status === 'approved') return 'bg-[#d1fae5] text-[#047857]'
  if (status === 'resolved') return 'bg-[#d1fae5] text-[#047857]'
  return 'bg-[#f3f4f6]'
}

function pctDelta(cur: number, prev: number): number | null {
  if (!prev || prev <= 0) return null
  return Math.round(((cur - prev) / prev) * 1000) / 10
}

function dayLabel(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function AdminHome() {
  const [stats, setStats] = useState<any>(null)
  const load = () => api.get<{ stats: any }>('/admin/dashboard').then((d) => setStats(d.stats))
  useEffect(() => { void load() }, [])
  if (!stats) return <p className="text-muted">Loading…</p>
  const trend = stats.trend || []
  const monthly = stats.monthly
  const orderValue = stats.orderValue
  const max = Math.max(1, ...trend.map((x: any) => x.count))
  const totalOrders = trend.reduce((s: number, x: any) => s + (x.count || 0), 0)
  const todayCount = trend.length ? trend[trend.length - 1].count || 0 : 0

  const cards = [
    {
      Icon: Banknote,
      title: 'Order value',
      note: `${money(orderValue?.prevMonth?.subtotal)} previous month`,
      value: money(orderValue?.thisMonth?.subtotal),
      delta: pctDelta(orderValue?.thisMonth?.subtotal, orderValue?.prevMonth?.subtotal),
      to: '/admin/orders',
    },
    {
      Icon: Wallet,
      title: 'Collected revenue',
      note: `${money(monthly?.prevMonth?.commission)} previous month`,
      value: money(monthly?.thisMonth?.commission),
      delta: pctDelta(monthly?.thisMonth?.commission, monthly?.prevMonth?.commission),
      to: '/admin/payouts',
    },
    {
      Icon: Scale,
      title: 'Open disputes',
      note: `${stats.pendingRefunds || 0} refunds queued`,
      value: stats.openComplaints,
      foot: 'Awaiting review',
      to: '/admin/disputes',
    },
    {
      Icon: UserCheck,
      title: 'Pending verifications',
      note: `${stats.pendingProducts} products pending`,
      value: stats.pendingVerifications,
      foot: 'Suppliers awaiting approval',
      to: '/admin/verifications',
    },
  ]

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-semibold">Welcome back.</h2>
          <p className="text-sm text-muted mt-1">
            Today you have <span className="font-semibold text-foreground">{todayCount} orders</span> placed,{' '}
            <span className="font-semibold text-foreground">{stats.openComplaints} disputes</span> open
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" className="gap-2" onClick={() => void load()}>
            <RefreshCw size={14} /> Refresh
          </Button>
          <Link to="/admin/orders">
            <Button className="gap-2">
              <ShoppingCart size={14} /> View orders
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {cards.map((c) => (
          <StatCard key={c.title} {...c} />
        ))}
      </div>

      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-3xl font-semibold tracking-tight">{totalOrders.toLocaleString()}</div>
            <div className="text-sm text-muted mt-1">Orders · last 7 days</div>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-primary" /> Orders
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-border" /> No orders
            </span>
          </div>
        </div>
        <div className="relative h-60 mt-8">
          <div className="absolute inset-0 flex flex-col justify-between">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="border-t border-border/60" />
            ))}
          </div>
          <div className="absolute inset-0 flex items-end gap-1.5 sm:gap-2">
            {trend.map((day: any) => (
              <div key={day.date} className="relative flex-1 h-full flex items-end group">
                <span className="absolute left-1/2 -translate-x-1/2 -translate-y-full top-0 opacity-0 group-hover:opacity-100 transition bg-foreground text-white text-[10px] rounded-md px-2 py-1 whitespace-nowrap pointer-events-none z-10">
                  {day.count} orders · {money(day.value)}
                </span>
                <div
                  className={cn('w-full rounded-t-lg transition-colors group-hover:bg-primary/80', day.count ? 'bg-primary' : 'bg-border')}
                  style={{ height: `${Math.max(day.count ? 6 : 3, (day.count / max) * 100)}%` }}
                />
              </div>
            ))}
          </div>
        </div>
        <div className="mt-2 flex gap-1.5 sm:gap-2">
          {trend.map((day: any) => (
            <div key={day.date} className="flex-1 text-center text-[11px] text-muted">
              {dayLabel(day.date)}
            </div>
          ))}
        </div>
        <div className="mt-3 text-xs text-muted">Live order data · hover a bar for daily value</div>
      </Card>
    </div>
  )
}

export function AdminOrders() {
  const [orders, setOrders] = useState<any[]>([])
  const [tab, setTab] = useState('All')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('newest')
  async function load() { setOrders((await api.get<{ orders: any[] }>('/orders')).orders) }
  usePoll(() => void load(), [])
  async function act(id: string, status: string) {
    try {
      if (status === 'collect_cod') {
        await api.post(`/orders/${id}/collect-cod`, {})
      } else {
        await api.patch(`/orders/${id}/status`, { status })
      }
      await load()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Update failed')
    }
  }
  const tabs = ['All', 'Pending', 'Confirmed', 'Shipped', 'Delivered', 'Cancelled']
  const visible = useMemo(() => {
    const term = q.trim().toLowerCase()
    const filtered = orders.filter((o) => {
      if (tab !== 'All') {
        const ok =
          (tab === 'Pending' && ['awaiting_payment', 'placed', 'supplier_approved'].includes(o.status)) ||
          (tab === 'Confirmed' && ['supplier_confirmed', 'delivery_initiated'].includes(o.status)) ||
          (tab === 'Shipped' && ['shipped', 'out_for_delivery'].includes(o.status)) ||
          (tab === 'Delivered' && o.status === 'delivered') ||
          (tab === 'Cancelled' && (String(o.status).includes('cancel') || o.status === 'refunded'))
        if (!ok) return false
      }
      if (!term) return true
      const haystack = [
        o.orderNumber,
        o.retailer?.name,
        o.supplier?.businessName,
        o.supplier?.name,
        ...(o.suppliers || []).map((s: any) => s.businessName || s.name),
        ...(o.items || []).map((i: any) => i.name),
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(term)
    })
    return [...filtered].sort((a, b) => {
      if (sort === 'oldest') return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      if (sort === 'amount-desc') return (b.subtotal || 0) - (a.subtotal || 0)
      if (sort === 'amount-asc') return (a.subtotal || 0) - (b.subtotal || 0)
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })
  }, [orders, q, sort, tab])
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-semibold">Orders</h2>
        <Button variant="secondary" onClick={() => void load()}>Refresh</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative w-full sm:max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search order, retailer, supplier…"
            className="pl-9"
            aria-label="Search orders"
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="h-10 rounded-[8px] border border-border bg-[#f7f8f8] px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          aria-label="Sort orders"
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="amount-desc">Total: high to low</option>
          <option value="amount-asc">Total: low to high</option>
        </select>
      </div>
      <div className="flex flex-wrap gap-2 mb-4">
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn('rounded-full px-3 py-1.5 text-sm', tab === t ? 'bg-[#242526] text-white' : 'bg-[#f3f4f6]')}>{t}</button>
        ))}
      </div>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-canvas text-muted text-left"><tr>
            <th className="px-3 py-3">Order</th><th className="px-3 py-3">Retailer</th><th className="px-3 py-3">Supplier</th><th className="px-3 py-3">Products</th><th className="px-3 py-3">Total</th><th className="px-3 py-3">Status</th><th className="px-3 py-3"></th>
          </tr></thead>
          <tbody>
            {visible.map((o) => {
              const names = [...new Set([o.supplier?.businessName || o.supplier?.name, ...(o.suppliers || []).map((s: any) => s.businessName || s.name)].filter(Boolean))]
              return (
              <tr key={o._id} className="border-t border-border">
                <td className="px-3 py-3 font-medium">{o.orderNumber}</td>
                <td className="px-3 py-3">{o.retailer?.name || 'Unknown retailer'}</td>
                <td className="px-3 py-3">{names.join(', ') || 'Unknown supplier'}</td>
                <td className="px-3 py-3">
                  {(o.items || []).length ? (
                    <ul className="space-y-0.5">
                      {(o.items as any[]).map((i, idx) => (
                        <li key={idx} className="text-sm">
                          <span className="text-muted">{i.quantity}×</span> {i.name}
                          {i.unit ? <span className="text-muted"> /{i.unit}</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="px-3 py-3 tabular-nums">{money(o.subtotal)}</td>
                <td className="px-3 py-3"><Badge className={statusTone(o.status)}>{statusLabel(o.status)}</Badge></td>
                <td className="px-3 py-3 text-right">
                  <div className="flex gap-1 justify-end flex-wrap">
                    {o.status === 'supplier_confirmed' && <Button className="h-8 text-xs" onClick={() => act(o._id, 'delivery_initiated')}>Initiate delivery</Button>}
                    {o.status === 'delivery_initiated' && <Button className="h-8 text-xs" onClick={() => act(o._id, 'shipped')}>Mark shipped</Button>}
                    {o.status === 'shipped' && <Button className="h-8 text-xs" onClick={() => act(o._id, 'out_for_delivery')}>Out for delivery</Button>}
                    {o.status === 'out_for_delivery' && <Button className="h-8 text-xs" onClick={() => act(o._id, 'delivered')}>Mark delivered</Button>}
                    {o.status === 'delivered' && o.paymentMethod === 'cod' && !o.productAmountPaid && (
                      <Button className="h-8 text-xs" onClick={() => act(o._id, 'collect_cod')}>Collect COD</Button>
                    )}
                  </div>
                </td>
              </tr>
            )})}
          </tbody>
        </table>
        {!visible.length && <p className="p-8 text-center text-muted">No matching orders</p>}
      </Card>
    </div>
  )
}

export function AdminRefunds() {
  const [refunds, setRefunds] = useState<any[]>([])
  const [tab, setTab] = useState('Pending')
  const [selected, setSelected] = useState<any>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function load() { setRefunds((await api.get<{ refunds: any[] }>('/admin/refunds')).refunds) }
  usePoll(() => void load(), [])
  function openComplete(o: any) {
    setSelected(o)
    setNote('')
    setError('')
  }
  function closeComplete() {
    if (busy) return
    setSelected(null)
    setError('')
  }
  async function complete() {
    if (!selected) return
    setBusy(true)
    setError('')
    try {
      await api.patch(`/admin/refunds/${selected._id}/complete`, { note })
      await load()
      setSelected(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark refunded')
    } finally {
      setBusy(false)
    }
  }
  const visible = refunds.filter((o) => {
    if (tab === 'All') return true
    if (tab === 'Pending') return o.manualRefundStatus === 'pending'
    return o.manualRefundStatus === 'completed'
  })
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-semibold">Refund</h2>
        <Button variant="secondary" onClick={() => void load()}>Refresh</Button>
      </div>
      <p className="text-sm text-muted mb-3">Refunds are sent manually outside the gateway. Mark complete after you transfer the money.</p>
      <div className="flex flex-wrap gap-2 mb-4">
        {['All', 'Pending', 'Completed'].map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn('rounded-full px-3 py-1.5 text-sm', t === tab ? 'bg-[#242526] text-white' : 'bg-[#f3f4f6]')}>{t}</button>
        ))}
      </div>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-canvas text-muted text-left"><tr>
            <th className="px-3 py-3">Order</th><th className="px-3 py-3">Retailer</th><th className="px-3 py-3">Amount</th><th className="px-3 py-3">Reason</th><th className="px-3 py-3">Status</th><th className="px-3 py-3"></th>
          </tr></thead>
          <tbody>
            {visible.map((o) => (
              <tr key={o._id} className="border-t border-border">
                <td className="px-3 py-3 font-medium">{o.orderNumber}</td>
                <td className="px-3 py-3">{o.retailer?.name}</td>
                <td className="px-3 py-3 tabular-nums">{money(o.refundAmount)}</td>
                <td className="px-3 py-3 text-muted max-w-xs truncate">{o.cancelReason || '—'}</td>
                <td className="px-3 py-3"><Badge>{o.manualRefundStatus}</Badge></td>
                <td className="px-3 py-3 text-right">
                  {o.manualRefundStatus === 'pending' && <Button className="h-8 text-xs" onClick={() => openComplete(o)}>Mark refunded</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length && <EmptyState title="No matching refunds" body="Cancelled prepaid orders appear here for manual payout." />}
      </Card>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={closeComplete} aria-hidden />
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl p-6" role="dialog" aria-modal="true" aria-labelledby="refund-modal-title">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="refund-modal-title" className="text-lg font-semibold">Mark refunded</h3>
                <p className="text-sm text-muted mt-1">Order {selected.orderNumber} · {selected.retailer?.name}</p>
              </div>
              <button
                type="button"
                onClick={closeComplete}
                disabled={busy}
                className="p-1 text-muted hover:text-foreground disabled:opacity-50"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 rounded-xl bg-[#f7f8f8] border border-border p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Refund amount</span>
                <span className="font-semibold tabular-nums">{money(selected.refundAmount)}</span>
              </div>
              {selected.cancelReason ? (
                <div className="mt-2 text-muted">Reason: <span className="text-foreground">{selected.cancelReason}</span></div>
              ) : null}
            </div>

            <p className="text-sm mt-4 text-foreground">
              Refunds are sent manually outside the gateway. Confirm only after you have transferred the money to the retailer.
            </p>

            <label className="block text-sm font-semibold mt-4 mb-1.5" htmlFor="refund-note">Note (optional)</label>
            <textarea
              id="refund-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={busy}
              placeholder="Add a note (optional)"
              rows={3}
              autoFocus
              className="w-full rounded-lg border border-border bg-[#f7f8f8] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
            />

            {error ? <p className="text-sm text-danger mt-3">{error}</p> : null}

            <div className="mt-5 flex gap-2 justify-end">
              <Button variant="secondary" onClick={closeComplete} disabled={busy}>Back</Button>
              <Button variant="danger" disabled={busy} onClick={() => void complete()}>
                {busy ? 'Marking…' : 'Confirm refund'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function AdminPayouts() {
  const [data, setData] = useState<any>(null)
  const [ratePct, setRatePct] = useState('10')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  async function load() {
    const d = await api.get('/admin/payouts')
    setData(d)
    setRatePct(String(Math.round(Number((d as any).commissionRate || 0) * 1000) / 10))
  }
  useEffect(() => { void load() }, [])
  async function saveRate(e: FormEvent) {
    e.preventDefault()
    setMsg('')
    await api.patch('/admin/commission', { commissionRate: Number(ratePct) / 100 })
    setMsg(`Commission saved at ${ratePct}% (applies to new orders).`)
    await load()
  }
  async function payNow(supplierId: string) {
    setBusy(true)
    setMsg('')
    try {
      await api.post('/admin/payouts', { supplierId, status: 'paid' })
      setMsg('Payout marked paid.')
      await load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Pay failed')
    } finally {
      setBusy(false)
    }
  }
  async function runWeekly() {
    setBusy(true)
    setMsg('')
    try {
      const r = await api.post<{ created: number; skipped: number }>('/admin/payouts/weekly', {})
      setMsg(`Weekly batch: ${r.created} pending payout(s), ${r.skipped} skipped.`)
      await load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Weekly run failed')
    } finally {
      setBusy(false)
    }
  }
  async function markPaid(id: string) {
    setBusy(true)
    try {
      await api.patch(`/admin/payouts/${id}/pay`, {})
      await load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Mark paid failed')
    } finally {
      setBusy(false)
    }
  }
  if (!data) return <p className="text-muted">Loading…</p>
  const grossEarned = data.balances.reduce((s: number, b: any) => s + (b.grossEarned ?? b.earned ?? 0), 0)
  const available = data.balances.reduce((s: number, b: any) => s + (b.available || 0), 0)
  const pendingBatch = data.balances.reduce((s: number, b: any) => s + (b.pendingPayouts || 0), 0)
  const paid = data.balances.reduce((s: number, b: any) => s + (b.alreadyPaid || 0), 0)
  const rate = Number(data.commissionRate || 0)
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted">Finance</p>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-2xl font-semibold">Commission and payouts.</h2>
        <Button disabled={busy} onClick={() => void runWeekly()}>Process weekly payouts</Button>
      </div>
      {msg ? <p className="text-sm text-muted mb-3">{msg}</p> : null}
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <StatCard Icon={Percent} title="Commission rate" note="Platform commission on merchandise" value={`${(rate * 100).toFixed(1)}%`} foot="Delivery fee excluded" />
        <StatCard Icon={Wallet} title="Supplier earned" note="Gross earned by suppliers" value={money(grossEarned)} foot="Before commission deducted" />
        <StatCard Icon={Banknote} title="Available to pay" note="Ready for payout this cycle" value={money(available)} foot="After commission and payouts" />
        <StatCard Icon={CheckCircle2} title="Paid out" note="Payouts already settled" value={money(paid)} foot="Lifetime transferred to suppliers" />
      </div>
      <Card className="p-4 mb-4 max-w-lg">
        <p className="text-sm text-muted mb-2">Platform commission on merchandise (delivery fee excluded). Applies to <span className="font-medium text-foreground">new</span> orders only.</p>
        <form onSubmit={saveRate} className="flex gap-2 items-end">
          <div className="flex-1"><Label>Rate (%)</Label><Input value={ratePct} onChange={(e) => setRatePct(e.target.value)} placeholder="10" /></div>
          <Button type="submit">Save rate</Button>
        </form>
        <p className="text-xs text-muted mt-2 tabular-nums">Pending weekly batches: {money(pendingBatch)}</p>
      </Card>
      <Card className="overflow-hidden mb-6">
        <div className="px-4 py-3 font-medium border-b border-border">Supplier balances (pending payouts accrued at payment / COD collect)</div>
        <table className="w-full text-sm">
          <thead className="bg-canvas text-muted text-left"><tr><th className="px-4 py-3">Supplier</th><th className="px-4 py-3">Earned</th><th className="px-4 py-3">Paid</th><th className="px-4 py-3">Pending batch</th><th className="px-4 py-3">Available</th><th className="px-4 py-3"></th></tr></thead>
          <tbody>
            {data.balances.map((b: any) => (
              <tr key={b.supplier._id} className="border-t border-border">
                <td className="px-4 py-3 font-medium">{b.supplier.businessName || b.supplier.name}</td>
                <td className="px-4 py-3 tabular-nums">{money(b.earned)}</td>
                <td className="px-4 py-3 tabular-nums">{money(b.alreadyPaid)}</td>
                <td className="px-4 py-3 tabular-nums">{money(b.pendingPayouts || 0)}</td>
                <td className="px-4 py-3 tabular-nums">{money(b.available)}</td>
                <td className="px-4 py-3 text-right">
                  <Button className="h-8 text-xs" disabled={busy || b.available <= 0} onClick={() => void payNow(b.supplier._id)}>Pay now</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card className="overflow-hidden">
        <div className="px-4 py-3 font-medium border-b border-border">Payout ledger</div>
        <table className="w-full text-sm">
          <thead className="bg-canvas text-muted text-left"><tr><th className="px-4 py-3">Supplier</th><th className="px-4 py-3">Net to supplier</th><th className="px-4 py-3">Commission</th><th className="px-4 py-3">Orders</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Date</th><th className="px-4 py-3"></th></tr></thead>
          <tbody>
            {data.payouts.map((p: any) => (
              <tr key={p._id} className="border-t border-border">
                <td className="px-4 py-3">{p.supplier?.businessName || p.supplier?.name || 'Unknown supplier'}</td>
                <td className="px-4 py-3 tabular-nums">{money(p.amount)}</td>
                <td className="px-4 py-3 tabular-nums">{money(p.commissionTotal || 0)}</td>
                <td className="px-4 py-3">{p.orderIds?.length || 0}</td>
                <td className="px-4 py-3"><Badge>{p.status}</Badge></td>
                <td className="px-4 py-3">{new Date(p.createdAt).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-right">
                  {p.status === 'pending' && (
                    <Button className="h-8 text-xs" disabled={busy} onClick={() => void markPaid(p._id)}>Mark paid</Button>
                  )}
                </td>
              </tr>
            ))}
            {!data.payouts.length && <tr><td colSpan={7} className="p-8 text-center text-muted">No payouts yet</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

export function AdminDisputes() {
  const [items, setItems] = useState<any[]>([])
  const [q, setQ] = useState('')
  const [viewing, setViewing] = useState<any>(null)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function load() { setItems((await api.get<{ complaints: any[] }>('/admin/complaints')).complaints) }
  useEffect(() => { void load() }, [])
  async function refreshViewing(id: string) {
    const d = await api.get<{ complaints: any[] }>('/admin/complaints')
    setItems(d.complaints)
    setViewing(d.complaints.find((i) => i._id === id) || null)
  }
  function open(c: any) {
    setViewing(c)
    setReply('')
    setError('')
  }
  async function act(id: string, status: string) {
    setBusy(true)
    setError('')
    try {
      await api.patch(`/admin/complaints/${id}`, { status })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }
  async function setStatus(status: string) {
    if (!viewing) return
    setBusy(true)
    setError('')
    try {
      await api.patch(`/admin/complaints/${viewing._id}`, { status })
      await refreshViewing(viewing._id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }
  async function sendReply() {
    if (!viewing) return
    const text = reply.trim()
    if (!text) return
    setBusy(true)
    setError('')
    try {
      await api.patch(`/admin/complaints/${viewing._id}`, { reply: text })
      setReply('')
      await refreshViewing(viewing._id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reply failed')
    } finally {
      setBusy(false)
    }
  }
  const filtered = items.filter((c) => !q || c.subject.toLowerCase().includes(q.toLowerCase()))
  const openCount = items.filter((c) => c.status === 'open').length
  const review = items.filter((c) => c.status === 'in_review').length
  const resolved = items.filter((c) => c.status === 'resolved').length
  const thread: any[] = viewing
    ? viewing.messages?.length
      ? viewing.messages
      : [{ from: 'retailer', body: viewing.message, at: viewing.createdAt }]
    : []
  return (
    <div>
      <h2 className="text-2xl font-semibold mb-4">Disputes</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <StatCard Icon={Scale} title="Total" value={items.length} foot="All reported disputes" />
        <StatCard Icon={AlertTriangle} title="Open" value={openCount} foot="Awaiting review" />
        <StatCard Icon={Clock} title="In review" value={review} foot="Being worked on" />
        <StatCard Icon={CheckCircle2} title="Resolved" value={resolved} foot="Closed disputes" />
      </div>
      <Input className="max-w-sm mb-4" placeholder="Search complaints" value={q} onChange={(e) => setQ(e.target.value)} />
      {error ? <p className="text-sm text-danger mb-2">{error}</p> : null}
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-canvas text-muted text-left"><tr><th className="px-4 py-3">Subject</th><th className="px-4 py-3">Related</th><th className="px-4 py-3">Reporter</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actions</th></tr></thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c._id} className="border-t border-border">
                <td className="px-4 py-3">
                  <div className="font-medium"><button type="button" className="hover:text-primary text-left" onClick={() => open(c)}>{c.subject}</button></div>
                  <div className="text-xs text-muted line-clamp-1">{c.message}</div>
                </td>
                <td className="px-4 py-3 text-xs text-muted">{c.order?.orderNumber || c.product?.name || '—'}</td>
                <td className="px-4 py-3">{c.reporter?.email}</td>
                <td className="px-4 py-3"><Badge className={statusTone(c.status)}>{c.status}{c.resolvedAt ? ` · ${new Date(c.resolvedAt).toLocaleDateString()}` : ''}</Badge></td>
                <td className="px-4 py-3">
                  <div className="flex gap-1 justify-end flex-wrap">
                    <Button variant="secondary" className="h-8 text-xs" onClick={() => open(c)}>View</Button>
                    {c.status === 'open' && (
                      <Button variant="secondary" className="h-8 text-xs" disabled={busy} onClick={() => void act(c._id, 'in_review')}>In review</Button>
                    )}
                    {(c.status === 'open' || c.status === 'in_review') && (
                      <Button className="h-8 text-xs" disabled={busy} onClick={() => void act(c._id, 'resolved')}>Resolve</Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && <EmptyState title="No disputes" />}
      </Card>

      {viewing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => { if (!busy) setViewing(null) }} aria-hidden />
          <div className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-white shadow-xl p-6" role="dialog" aria-modal="true" aria-labelledby="dispute-modal-title">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="dispute-modal-title" className="text-lg font-semibold">{viewing.subject}</h3>
                <p className="text-sm text-muted mt-1">
                  {viewing.reporter?.email || 'Unknown reporter'}
                  {viewing.order?.orderNumber ? ` · Order ${viewing.order.orderNumber}` : ''}
                  {viewing.product?.name ? ` · ${viewing.product.name}` : ''}
                </p>
              </div>
              <button type="button" onClick={() => { if (!busy) setViewing(null) }} disabled={busy} className="p-1 text-muted hover:text-foreground disabled:opacity-50" aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="mt-3"><Badge className={statusTone(viewing.status)}>{viewing.status}{viewing.resolvedAt ? ` · resolved ${new Date(viewing.resolvedAt).toLocaleDateString()}` : ''}</Badge></div>

            <div className="mt-4 rounded-xl bg-[#f7f8f8] border border-border p-3 space-y-3">
              {thread.map((m, i) => (
                <div key={i} className={cn('rounded-lg p-3', m.from === 'admin' ? 'ml-8 bg-[#fff4ef] border border-[#f2ccc1]' : 'bg-white border border-border')}>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold">{m.from === 'admin' ? 'SoukCart support' : 'Retailer'}</span>
                    <span className="text-muted">{m.at ? new Date(m.at).toLocaleString() : ''}</span>
                  </div>
                  <p className="text-sm mt-1 whitespace-pre-wrap">{m.body}</p>
                </div>
              ))}
            </div>

            <div className="mt-4">
              <Label htmlFor="dispute-reply">Write a reply</Label>
              <textarea
                id="dispute-reply"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                disabled={busy}
                rows={3}
                placeholder={`Reply to ${viewing.reporter?.name || 'the retailer'}…`}
                className="w-full rounded-lg border border-border bg-[#f7f8f8] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
              />
            </div>

            {error ? <p className="text-sm text-danger mt-3">{error}</p> : null}

            <div className="mt-5 flex gap-2 justify-end flex-wrap">
              {viewing.status === 'open' && (
                <Button variant="secondary" disabled={busy} onClick={() => void setStatus('in_review')}>Mark in review</Button>
              )}
              {(viewing.status === 'open' || viewing.status === 'in_review') && (
                <Button disabled={busy} onClick={() => void setStatus('resolved')}>Resolve</Button>
              )}
              <Button variant="secondary" disabled={busy} onClick={() => setViewing(null)}>Close</Button>
              <Button disabled={busy || !reply.trim()} onClick={() => void sendReply()}>{busy ? 'Sending…' : 'Send reply'}</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function AdminProducts() {
  const [products, setProducts] = useState<any[]>([])
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('newest')
  const [preview, setPreview] = useState<string | null>(null)
  async function load() { setProducts((await api.get<{ products: any[] }>('/products')).products) }
  useEffect(() => { void load() }, [])
  const stats = useMemo(() => ({
    total: products.length,
    pending: products.filter((p) => p.status === 'pending').length,
    active: products.filter((p) => p.status === 'approved' && p.isActive !== false).length,
    hidden: products.filter((p) => p.isActive === false && p.status !== 'removed').length,
  }), [products])
  const visible = useMemo(() => {
    let list = products.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || (p.supplier?.businessName || p.supplier?.name || '').toLowerCase().includes(q.toLowerCase()) || (p.supplier?.email || '').toLowerCase().includes(q.toLowerCase()))
    if (sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name))
    if (sort === 'newest') list = [...list].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    if (sort === 'status') list = [...list].sort((a, b) => a.status.localeCompare(b.status))
    return list
  }, [products, q, sort])

  async function moderate(id: string, action: string, reason?: string) {
    try {
      await api.patch(`/products/${id}/moderate`, { action, status: action, reason })
      await load()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Action failed')
    }
  }

  async function removeProduct(p: any) {
    if (!window.confirm(`Remove "${p.name}"? Unused products are deleted; products with order history are hidden as Removed. Pending orders will be cancelled and prepaid amounts queued for refund.`)) return
    try {
      await api.delete(`/products/${p._id}`)
      await load()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Remove failed')
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-semibold mb-4">Product moderation.</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <StatCard Icon={Layers} title="Total" value={stats.total} foot="All catalog products" />
        <StatCard Icon={Clock} title="Pending" value={stats.pending} foot="Awaiting approval" />
        <StatCard Icon={CheckCircle2} title="Active" value={stats.active} foot="Live in catalog" />
        <StatCard Icon={EyeOff} title="Hidden" value={stats.hidden} foot="Not visible to buyers" />
      </div>
      <div className="flex flex-wrap gap-2 mb-4">
        <Input className="max-w-xs" placeholder="Search products or suppliers" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="h-10 rounded-[8px] border border-border bg-[#f7f8f8] px-3 text-sm" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="newest">Newest</option>
          <option value="name">Name A–Z</option>
          <option value="status">Status</option>
        </select>
      </div>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-canvas text-muted text-left"><tr><th className="px-3 py-3">Product</th><th className="px-3 py-3">Supplier</th><th className="px-3 py-3">Email</th><th className="px-3 py-3">Price</th><th className="px-3 py-3">Stock</th><th className="px-3 py-3">Status</th><th className="px-3 py-3"></th></tr></thead>
          <tbody>
            {visible.map((p) => (
              <tr key={p._id} className="border-t border-border">
                <td className="px-3 py-3">
                  <div className="flex items-center gap-3 min-w-[180px]">
                    <button
                      type="button"
                      className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-border bg-canvas"
                      onClick={() => p.imageUrl && setPreview(p.imageUrl)}
                      title={p.imageUrl ? 'View image' : 'No image'}
                    >
                      {p.imageUrl ? (
                        <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-[10px] text-muted">No img</span>
                      )}
                    </button>
                    <div className="min-w-0">
                      <div className="font-medium truncate">{p.name}</div>
                      <div className="text-xs text-muted">{p.unit} · MOQ {p.moq}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3">{p.supplier?.businessName || p.supplier?.name || '—'}</td>
                <td className="px-3 py-3 text-muted">{p.supplier?.email || '—'}</td>
                <td className="px-3 py-3 tabular-nums">{money(p.price)}</td>
                <td className="px-3 py-3 tabular-nums">
                  {p.stock <= 0 ? <span className="text-danger">{p.stock}</span> : p.stock}
                </td>
                <td className="px-3 py-3"><Badge className={statusTone(p.isActive === false && p.status !== 'removed' ? 'hidden' : p.status)}>{p.isActive === false && p.status !== 'removed' ? 'Hidden' : p.status}</Badge></td>
                <td className="px-3 py-3 text-right">
                  <div className="flex gap-2 justify-end flex-wrap">
                    {p.status === 'pending' && (
                      <>
                        <Button className="h-8 text-xs" onClick={() => void moderate(p._id, 'approved')}>Approve</Button>
                        <Button variant="secondary" className="h-8 text-xs" onClick={() => {
                          const reason = window.prompt('Rejection reason') || ''
                          void moderate(p._id, 'rejected', reason)
                        }}>Reject</Button>
                      </>
                    )}
                    {p.status !== 'pending' && p.isActive !== false && p.status !== 'removed' && (
                      <Button variant="secondary" className="h-8 text-xs" onClick={() => void moderate(p._id, 'hide')}>Hide</Button>
                    )}
                    {(p.isActive === false || p.status === 'removed' || p.status === 'rejected') && (
                      <Button variant="secondary" className="h-8 text-xs" onClick={() => void moderate(p._id, 'restore')}>Restore</Button>
                    )}
                    {p.status !== 'pending' && (
                      <Button variant="danger" className="h-8 text-xs" onClick={() => void removeProduct(p)}>Remove</Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {preview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setPreview(null)}>
          <img src={preview} alt="Product" className="max-h-[85vh] max-w-[90vw] rounded-xl object-contain shadow-lg" onClick={(e) => e.stopPropagation()} />
        </div>
      ) : null}
    </div>
  )
}

export function AdminCategories() {
  const [cats, setCats] = useState<any[]>([])
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  async function load() { setCats((await api.get<{ categories: any[] }>('/products/categories?all=1')).categories) }
  useEffect(() => { void load() }, [])
  async function add(e: FormEvent) { e.preventDefault(); await api.post('/products/categories', { name }); setName(''); await load() }
  async function saveEdit(id: string) {
    await api.patch(`/products/categories/${id}`, { name: editName })
    setEditing(null)
    await load()
  }
  async function hide(id: string, isActive: boolean) {
    await api.patch(`/products/categories/${id}`, { isActive: !isActive })
    await load()
  }
  async function remove(id: string) {
    await api.delete(`/products/categories/${id}`)
    await load()
  }
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-2xl font-semibold whitespace-nowrap">Categories</h2>
        <form onSubmit={add} className="flex gap-2 shrink-0">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category" required className="w-40" />
          <Button type="submit" className="whitespace-nowrap">+ Add category</Button>
        </form>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <StatCard Icon={Folder} title="Total" value={cats.length} foot="All categories" />
        <StatCard Icon={CheckCircle2} title="Active" value={cats.filter((c)=>c.isActive !== false).length} foot="Visible in catalog" />
      </div>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-canvas text-muted text-left"><tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Slug</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actions</th></tr></thead>
          <tbody>
            {cats.map((c) => (
              <tr key={c._id} className="border-t border-border">
                <td className="px-4 py-3 font-medium">
                  {editing === c._id ? (
                    <Input className="h-8" value={editName} onChange={(e) => setEditName(e.target.value)} />
                  ) : c.name}
                </td>
                <td className="px-4 py-3 text-muted">{c.slug}</td>
                <td className="px-4 py-3"><Badge>{c.isActive === false ? 'Hidden' : 'Active'}</Badge></td>
                <td className="px-4 py-3">
                  {editing === c._id ? (
                    <Button className="h-8 text-xs mr-2" onClick={() => saveEdit(c._id)}>Save</Button>
                  ) : (
                    <Button variant="secondary" className="h-8 text-xs mr-2" onClick={() => { setEditing(c._id); setEditName(c.name) }}>Edit</Button>
                  )}
                  <Button variant="secondary" className="h-8 text-xs mr-2" onClick={() => hide(c._id, c.isActive !== false)}>{c.isActive === false ? 'Show' : 'Hide'}</Button>
                  <Button variant="ghost" className="h-8 text-xs" onClick={() => { if (window.confirm(`Delete category "${c.name}"?`)) void remove(c._id) }}>Delete</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

export function AdminVerifications() {
  const navigate = useNavigate()
  const [users, setUsers] = useState<any[]>([])
  const [query, setQuery] = useState('')
  async function load() { setUsers((await api.get<{ users: any[] }>('/admin/verifications')).users) }
  useEffect(() => { void load() }, [])
  const pending = users.filter((u) => u.verificationStatus === 'pending').length
  const approved = users.filter((u) => u.verificationStatus === 'approved').length
  const rejected = users.filter((u) => u.verificationStatus === 'rejected').length
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return users
    return users.filter((u) =>
      [u.businessName, u.name, u.email, u.shopSlug || u.shopLink, u.verificationStatus]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    )
  }, [users, query])
  return (
    <div>
      <h2 className="text-2xl font-semibold mb-1">Supplier applications.</h2>
      <p className="text-sm text-muted mb-4">Review NID and business details before approving suppliers.</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <StatCard Icon={Users} title="Total" value={users.length} foot="Supplier applications" />
        <StatCard Icon={Clock} title="Pending" value={pending} foot="Waiting for review" />
        <StatCard Icon={BadgeCheck} title="Approved" value={approved} foot="Verified suppliers" />
        <StatCard Icon={XCircle} title="Rejected" value={rejected} foot="Declined applications" />
      </div>
      <div className="mb-4 max-w-md">
        <Input
          placeholder="Search by name, email, shop, or status…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-canvas text-muted text-left">
            <tr>
              <th className="px-4 py-3">Supplier</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Shop</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr
                key={u._id}
                className="border-t border-border cursor-pointer hover:bg-canvas"
                onClick={() => navigate(`/admin/verifications/${u._id}`)}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="h-8 w-8 rounded-full bg-[#374151] text-white text-xs flex items-center justify-center">{(u.businessName || u.name)?.charAt(0)}</span>
                    <div>
                      <div className="font-medium">{u.businessName || u.name}</div>
                      {u.businessName && u.name && u.businessName !== u.name ? <div className="text-xs text-muted">{u.name}</div> : null}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">{u.email}</td>
                <td className="px-4 py-3 text-muted">{u.shopSlug || u.shopLink || '—'}</td>
                <td className="px-4 py-3"><Badge className={cn('w-fit', statusTone(u.verificationStatus))}>{u.verificationStatus}</Badge></td>
                <td className="px-4 py-3 text-right text-muted">→</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr className="border-t border-border">
                <td colSpan={5} className="px-4 py-10 text-center text-muted">{users.length === 0 ? 'No applications yet.' : 'No applications match your search.'}</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

export function AdminVerificationDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [user, setUser] = useState<any>(null)
  const [reason, setReason] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => {
    void api.get<{ users: any[] }>('/admin/verifications').then((d) => {
      const u = d.users.find((x) => x._id === id)
      setUser(u)
      setReason(u?.verificationRejectReason || '')
    })
  }, [id])
  if (!user) return <p className="text-muted">Loading…</p>
  async function decide(status: string) {
    await api.patch(`/admin/verifications/${id}`, { status, reason })
    navigate('/admin/verifications')
  }
  const nidSrc = user.nidDocUrl
    ? (user.nidDocUrl.startsWith('http') || user.nidDocUrl.startsWith('/uploads') || /\.(png|jpe?g|webp)$/i.test(user.nidDocUrl) ? user.nidDocUrl : '')
    : ''
  return (
    <div>
      <button onClick={() => navigate('/admin/verifications')} className="text-sm text-primary font-medium">← Back to applications</button>
      <h2 className="text-2xl font-semibold mt-2">{user.businessName || user.name}</h2>
      <div className="grid md:grid-cols-2 gap-4 mt-4">
        <Card className="p-4"><div className="font-semibold mb-2">NID</div><button
          type="button"
          className="h-48 rounded-xl bg-[#fff4ef] border border-[#f2ccc1] overflow-hidden flex items-center justify-center text-sm text-muted w-full cursor-zoom-in"
          onClick={() => nidSrc && setPreview(nidSrc)}
          title={nidSrc ? 'View full size' : 'No document'}
        >
          {nidSrc ? (
            <img src={nidSrc} alt="NID document" className="h-full w-full object-contain" />
          ) : 'No document'}
        </button></Card>
        <Card className="p-4 space-y-2">
          <div className="font-semibold">Supplier</div>
          <div className="text-sm"><span className="text-muted">Name:</span> {user.name}</div>
          <div className="text-sm"><span className="text-muted">Email:</span> {user.email}</div>
          <div className="text-sm"><span className="text-muted">Shop slug:</span> {user.shopSlug || user.shopLink || '—'}</div>
          <div className="font-semibold pt-3">Identity</div>
          <p className="text-sm text-muted">{user.businessDescription || 'No description provided.'}</p>
          <div className="font-semibold pt-3">Review</div>
          {user.verificationStatus === 'pending' ? (
            <>
              <div>
                <Label>Rejection reason</Label>
                <textarea className="w-full min-h-20 rounded-[8px] border border-border bg-[#f7f8f8] p-3 text-sm" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Sent to the supplier if you reject" />
              </div>
              <div className="flex gap-2">
                <Button onClick={() => decide('approved')}>Approve</Button>
                <Button variant="secondary" onClick={() => decide('rejected')}>Reject</Button>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <Badge className={cn('w-fit', statusTone(user.verificationStatus))}>{user.verificationStatus}</Badge>
              <p className="text-sm text-muted">
                {user.verificationStatus === 'rejected' && user.verificationRejectReason
                  ? `Rejected: ${user.verificationRejectReason}`
                  : 'This application has already been reviewed.'}
              </p>
            </div>
          )}
        </Card>
      </div>
      {preview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setPreview(null)}>
          <img src={preview} alt="NID document full size" className="max-h-[85vh] max-w-[90vw] rounded-xl object-contain shadow-lg" onClick={(e) => e.stopPropagation()} />
        </div>
      ) : null}
    </div>
  )
}

export function AdminUsers() {
  const [users, setUsers] = useState<any[]>([])
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'retailer' })
  const [err, setErr] = useState('')
  async function load() { setUsers((await api.get<{ users: any[] }>('/admin/users')).users) }
  useEffect(() => { void load() }, [])
  async function create(e: FormEvent) {
    e.preventDefault()
    setErr('')
    try {
      await api.post('/admin/users', form)
      setOpen(false)
      setForm({ name: '', email: '', password: '', role: 'retailer' })
      await load()
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Failed')
    }
  }
  async function toggleActive(u: any) {
    await api.patch(`/admin/users/${u._id}`, { isActive: u.isActive === false })
    await load()
  }
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted">Users</p>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-semibold">Accounts.</h2>
        <Button onClick={() => setOpen((v) => !v)}>+ New user</Button>
      </div>
      {open && (
        <Card className="p-4 mb-4 max-w-xl">
          <form onSubmit={create} className="grid sm:grid-cols-2 gap-3">
            <div><Label htmlFor="new-user-name">Name</Label><Input id="new-user-name" required value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})} /></div>
            <div><Label htmlFor="new-user-email">Email</Label><Input id="new-user-email" type="email" required value={form.email} onChange={(e)=>setForm({...form,email:e.target.value})} /></div>
            <div><Label htmlFor="new-user-password">Password</Label><Input id="new-user-password" type="password" required minLength={6} value={form.password} onChange={(e)=>setForm({...form,password:e.target.value})} /></div>
            <div>
              <Label htmlFor="new-user-role">Role</Label>
              <select id="new-user-role" className="w-full h-10 rounded-[8px] border border-border bg-[#f7f8f8] px-3 text-sm" value={form.role} onChange={(e)=>setForm({...form,role:e.target.value})}>
                <option value="retailer">Retailer</option>
                <option value="supplier">Supplier</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            {err ? <p className="text-sm text-danger sm:col-span-2">{err}</p> : null}
            <div className="sm:col-span-2 flex gap-2">
              <Button type="submit">Create user</Button>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-canvas text-muted text-left"><tr><th className="px-4 py-3">User</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Verified</th><th className="px-4 py-3">ID</th><th className="px-4 py-3"></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u._id} className="border-t border-border">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="h-8 w-8 rounded-full bg-[#374151] text-white text-xs flex items-center justify-center">{u.name?.charAt(0)}</span>
                    <span className="font-medium">{u.name}{u.isActive === false ? ' (inactive)' : ''}</span>
                  </div>
                </td>
                <td className="px-4 py-3">{u.email}</td>
                <td className="px-4 py-3"><Badge>{u.role}</Badge></td>
                <td className="px-4 py-3">{u.role === 'admin' || u.verificationStatus === 'approved' ? 'Yes' : 'No'}</td>
                <td className="px-4 py-3 text-xs text-muted font-mono">{u._id?.slice(-8)}</td>
                <td className="px-4 py-3 text-right">
                  <DropdownMenu
                    button={<span className="inline-flex p-1 text-muted"><MoreVertical size={16} /></span>}
                  >
                    <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-canvas rounded" onClick={() => void toggleActive(u)}>
                      {u.isActive === false ? 'Activate' : 'Deactivate'}
                    </button>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

export function AdminNotifications() {
  return <NotificationsInbox heading="Notifications." />
}
