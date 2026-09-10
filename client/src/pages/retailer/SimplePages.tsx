import { Fragment, useCallback, useEffect, useState, type FormEvent } from 'react'
import { Check, ChevronDown, Download, Home, Printer, Truck, type LucideIcon } from 'lucide-react'
import { Button, Card, EmptyState, Input, Label, Badge } from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
import { api } from '@/services/api'
import { NotificationsInbox } from '@/components/NotificationsInbox'
import { PrintInvoiceModal, type InvoiceOrder } from '@/components/Invoice'
import { cn, downloadCsv, money, statusLabel } from '@/lib/utils'
import { usePoll } from '@/lib/poll'

const TRACKING_STATUSES = ['placed', 'supplier_approved', 'supplier_confirmed', 'delivery_initiated', 'shipped', 'out_for_delivery', 'delivered'] as const

function stepIndex(status: string) {
  const i = (TRACKING_STATUSES as readonly string[]).indexOf(status)
  return i < 0 ? 0 : i
}

function fmtDateTime(at?: string | null) {
  return at ? new Date(at).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', month: 'long', day: 'numeric', year: 'numeric' }) : null
}

function fmtDate(at?: string | null) {
  return at ? new Date(at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null
}

function StepNode({ Icon, done, title, subtitle }: { Icon: LucideIcon; done: boolean; title: string; subtitle: string | null }) {
  return (
    <div className="flex w-28 flex-col items-center text-center sm:w-36">
      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', done ? 'bg-[#111213] text-white' : 'bg-[#eef0f1] text-muted')}>
        <Icon size={15} strokeWidth={2.2} />
      </span>
      <div className="mt-2 text-sm font-semibold leading-snug">{title}</div>
      <div className="mt-0.5 text-xs text-muted leading-snug">{subtitle ?? ''}</div>
    </div>
  )
}

function OrderTimeline({ status, createdAt, confirmedAt, deliveryInitiatedAt, shippedAt, outForDeliveryAt }: any) {
  const idx = stepIndex(status)
  const courierAt = deliveryInitiatedAt || shippedAt || confirmedAt
  const estimated = fmtDate(new Date(new Date(createdAt).getTime() + 5 * 24 * 60 * 60 * 1000).toISOString())
  const nodes: { Icon: LucideIcon; done: boolean; title: string; subtitle: string | null }[] = [
    { Icon: Check, done: idx >= 0, title: 'Order Placed', subtitle: fmtDateTime(createdAt) },
    { Icon: Truck, done: idx >= 3, title: 'Delivered to the Courier', subtitle: courierAt ? fmtDateTime(courierAt) : 'Pending pickup' },
    { Icon: Home, done: idx >= 6, title: 'Delivery', subtitle: outForDeliveryAt ? fmtDateTime(outForDeliveryAt) : `Estimated date: ${estimated}` },
  ]
  return (
    <div className="flex w-full items-start">
      {nodes.map((n, i) => (
        <Fragment key={n.title}>
          {i > 0 && <div className={cn('mt-[17px] h-[2px] flex-1', nodes[i].done ? 'bg-[#111213]' : 'bg-[#eef0f1]')} />}
          <StepNode Icon={n.Icon} done={n.done} title={n.title} subtitle={n.subtitle} />
        </Fragment>
      ))}
    </div>
  )
}

function invoiceCsv(o: any) {
  const rows: Array<Array<string | number>> = [['Item', 'Quantity', 'Unit price', 'Line total']]
  for (const it of o.items || []) rows.push([it.name, it.quantity, it.price, it.lineTotal])
  rows.push(['Subtotal', '', '', o.subtotal])
  rows.push(['Delivery fee', '', '', o.deliveryFee ?? 120])
  return rows
}

export function RetailerTracking() {
  const [orders, setOrders] = useState<any[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [invoiceTarget, setInvoiceTarget] = useState<InvoiceOrder | null>(null)
  const load = useCallback(async () => {
    const d = await api.get<{ orders: any[] }>('/orders?tracking=1')
    setOrders(d.orders.filter((o: any) => o.status !== 'delivered' && o.status !== 'cancelled' && o.status !== 'supplier_cancelled' && o.status !== 'refunded'))
  }, [])
  usePoll(() => void load(), [load])

  if (!orders.length) {
    return (
      <div>
        <h2 className="text-2xl font-semibold mb-2">Tracking</h2>
        <EmptyState title="Nothing in transit" body="Orders that are not delivered yet will show up here." />
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-2xl font-semibold mb-4">Tracking</h2>
      <div className="space-y-3">
        {orders.map((o) => {
          const open = openId === o._id
          return (
            <Card key={o._id} className="overflow-hidden">
              <button
                type="button"
                onClick={() => setOpenId(open ? null : o._id)}
                className="flex w-full items-center gap-3 p-4 text-left transition hover:bg-canvas"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">#{o.orderNumber}</span>
                    <Badge>{statusLabel(o.status)}</Badge>
                  </div>
                  <div className="mt-1 truncate text-xs text-muted tabular-nums">
                    {o.items?.[0]?.name}{o.items?.length > 1 ? ` +${o.items.length - 1} more` : ''}
                    {' · '}{money(o.subtotal)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-muted">{fmtDate(o.createdAt)}</span>
                  <ChevronDown size={16} className={cn('text-muted transition-transform', open && 'rotate-180')} />
                </div>
              </button>
              {open && (
                <div className="border-t border-border p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-xl font-bold tracking-tight">Order Details #{o.orderNumber}</h3>
                      <p className="mt-1 text-sm text-muted">
                        Order placed on <span className="font-medium text-foreground">{fmtDateTime(o.createdAt)}</span>
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" onClick={() => downloadCsv(`invoice-${o.orderNumber}.csv`, invoiceCsv(o))}>
                        Download CSV <Download size={14} />
                      </Button>
                      <Button onClick={() => setInvoiceTarget(o)}>
                        Print Invoice <Printer size={14} />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-8 mb-2">
                    <OrderTimeline {...o} />
                  </div>
                  <div className="mt-8 space-y-2 border-t border-border pt-4 text-sm">
                    {(o.items || []).map((it: any, i: number) => (
                      <div key={i} className="flex items-center justify-between gap-3">
                        <span className="truncate text-muted">{it.name} × {it.quantity}</span>
                        <span className="shrink-0 font-medium tabular-nums">{money(it.lineTotal)}</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between gap-3 pt-2">
                      <span className="text-muted">Delivery fee</span>
                      <span className="font-medium tabular-nums">{money(o.deliveryFee ?? 120)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold">Total</span>
                      <span className="font-semibold tabular-nums">{money((o.subtotal || 0) + (o.deliveryFee ?? 120))}</span>
                    </div>
                    {o.deliveryAddress ? (
                      <p className="pt-2 text-xs text-muted">Deliver to: {o.recipientName ? `${o.recipientName}, ` : ''}{o.deliveryAddress}</p>
                    ) : null}
                  </div>
                </div>
              )}
            </Card>
          )
        })}
      </div>
      <PrintInvoiceModal order={invoiceTarget} onClose={() => setInvoiceTarget(null)} />
    </div>
  )
}

export function RetailerHelp() {
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [mine, setMine] = useState<any[]>([])
  const [ok, setOk] = useState('')
  const [err, setErr] = useState('')

  async function load() {
    const c = await api.get<{ complaints: any[] }>('/complaints/mine')
    setMine(c.complaints)
  }
  useEffect(() => { void load() }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setErr('')
    setOk('')
    try {
      await api.post('/complaints', { subject, message })
      setSubject('')
      setMessage('')
      setOk('Complaint submitted')
      await load()
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Failed')
    }
  }

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div>
        <p className="text-xs uppercase text-muted">Support</p>
        <h2 className="text-2xl font-semibold mb-4">Help Center</h2>
        <Card className="p-5">
          <form onSubmit={submit} className="space-y-3">
            <div><Label htmlFor="help-subject">Subject (min 3 characters)</Label><Input id="help-subject" value={subject} onChange={(e) => setSubject(e.target.value)} required minLength={3} /></div>
            <div><Label htmlFor="help-message">Description (min 10 characters)</Label><textarea id="help-message" className="w-full min-h-28 rounded-[8px] border border-border bg-[#f7f8f8] p-3 text-sm" value={message} onChange={(e) => setMessage(e.target.value)} required minLength={10} /></div>
            {ok ? <p className="text-sm text-primary">{ok}</p> : null}
            {err ? <p className="text-sm text-danger">{err}</p> : null}
            <Button type="submit">Submit complaint</Button>
          </form>
        </Card>
      </div>
      <div>
        <p className="text-xs uppercase text-muted mb-2">Your reports</p>
        <div className="space-y-3">
          {mine.map((c) => (
            <Card key={c._id} className="p-4">
              <div className="font-medium">{c.subject}</div>
              <div className="text-sm text-muted mt-1">{c.status}{c.order?.orderNumber ? ` · ${c.order.orderNumber}` : ''}{c.resolvedAt ? ` · resolved ${new Date(c.resolvedAt).toLocaleString()}` : ''}</div>
              <p className="text-sm mt-2">{c.message}</p>
              {(c.messages || []).filter((m: any) => m.from === 'admin').map((m: any, i: number) => (
                <div key={i} className="mt-3 rounded-lg bg-[#fff4ef] border border-[#f2ccc1] p-3">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-[#991B1B]">SoukCart support</span>
                    <span className="text-muted">{m.at ? new Date(m.at).toLocaleString() : ''}</span>
                  </div>
                  <p className="text-sm mt-1 whitespace-pre-wrap">{m.body}</p>
                </div>
              ))}
            </Card>
          ))}
          {!mine.length && <EmptyState title="No complaints yet" body="Submitted reports will show up here." />}
        </div>
      </div>
    </div>
  )
}

export function RetailerNotifications() {
  return <NotificationsInbox heading="Notifications" />
}

type Address = { id: string; label: string; line: string; phone: string }

function addressKey(userId?: string) {
  return `nekcart_addresses_${userId || 'anon'}`
}

export function RetailerSettings() {
  const { user, logout, updateProfile, changeEmail, changePassword } = useAuth()
  const [tab, setTab] = useState<'profile' | 'addresses' | 'password'>('profile')
  const [profile, setProfile] = useState({
    name: user?.name || '',
    email: user?.email || '',
    phone: user?.phone || '',
    businessName: user?.businessName || '',
  })
  const [emailPw, setEmailPw] = useState('')
  const [profileMsg, setProfileMsg] = useState('')
  const [profileErr, setProfileErr] = useState('')
  const [addresses, setAddresses] = useState<Address[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(addressKey(user?.id)) || '[]') as Address[]
    } catch {
      return []
    }
  })
  const [draft, setDraft] = useState({ label: '', line: '', phone: '' })
  const [pw, setPw] = useState({ a: '', b: '' })
  const [pwMsg, setPwMsg] = useState('')
  const [pwErr, setPwErr] = useState('')

  useEffect(() => {
    setProfile({
      name: user?.name || '',
      email: user?.email || '',
      phone: user?.phone || '',
      businessName: user?.businessName || '',
    })
    setEmailPw('')
    try {
      setAddresses(JSON.parse(localStorage.getItem(addressKey(user?.id)) || '[]') as Address[])
    } catch {
      setAddresses([])
    }
  }, [user])

  function saveAddresses(next: Address[]) {
    setAddresses(next)
    localStorage.setItem(addressKey(user?.id), JSON.stringify(next))
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault()
    setProfileErr('')
    const nextEmail = profile.email.trim().toLowerCase()
    try {
      if (nextEmail !== (user?.email || '').toLowerCase()) {
        if (!emailPw) {
          setProfileErr('Enter your current password to change your email')
          return
        }
        await changeEmail(profile.email, emailPw)
      }
      await updateProfile({ name: profile.name, phone: profile.phone })
      setEmailPw('')
      setProfileMsg('Saved')
      setTimeout(() => setProfileMsg(''), 1200)
    } catch (err) {
      setProfileErr(err instanceof Error ? err.message : 'Save failed')
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault()
    setPwErr('')
    if (pw.a !== pw.b) {
      setPwErr('Passwords do not match')
      return
    }
    try {
      await changePassword(pw.a)
      setPw({ a: '', b: '' })
      setPwMsg('Password updated')
      setTimeout(() => setPwMsg(''), 1200)
    } catch (err) {
      setPwErr(err instanceof Error ? err.message : 'Update failed')
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-semibold mb-4">Account</h2>
      <div className="inline-flex rounded-xl bg-[#f3f4f6] p-1 mb-4">
        {([
          ['profile', 'Profile'],
          ['addresses', 'Delivery addresses'],
          ['password', 'Password'],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`h-9 px-4 rounded-lg text-sm font-medium ${tab === k ? 'bg-[#242526] text-white' : 'text-muted'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <Card className="p-5 max-w-xl">
        {tab === 'profile' && (
          <form className="space-y-3" onSubmit={saveProfile}>
            <div><Label htmlFor="settings-name">Name</Label><Input id="settings-name" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} required /></div>
            <div><Label htmlFor="settings-email">Email</Label><Input id="settings-email" type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} required />
              <p className="text-xs text-muted mt-1">This is the address you sign in with. Changing it requires your current password.</p>
            </div>
            {profile.email.trim().toLowerCase() !== (user?.email || '').toLowerCase() && (
              <div><Label htmlFor="settings-email-pw">Current password</Label><Input id="settings-email-pw" type="password" value={emailPw} onChange={(e) => setEmailPw(e.target.value)} placeholder="Password to confirm the change" /></div>
            )}
            <div><Label htmlFor="settings-phone">Phone</Label><Input id="settings-phone" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} placeholder="01XXXXXXXXX" /></div>
            {profileMsg ? <p className="text-sm text-primary">{profileMsg}</p> : null}
            {profileErr ? <p className="text-sm text-danger">{profileErr}</p> : null}
            <div className="flex gap-2">
              <Button type="submit">Save profile</Button>
              <Button type="button" variant="danger" onClick={logout}>Log out</Button>
            </div>
          </form>
        )}
        {tab === 'addresses' && (
          <div className="space-y-4">
            {addresses.map((a) => (
              <div key={a.id} className="flex items-start justify-between gap-3 rounded-xl border border-border p-3">
                <div>
                  <div className="text-sm text-muted">{a.line}</div>
                  <div className="text-sm text-muted">{a.phone}</div>
                </div>
                <button type="button" className="text-sm text-danger" onClick={() => saveAddresses(addresses.filter((x) => x.id !== a.id))}>Remove</button>
              </div>
            ))}
            {!addresses.length && <p className="text-sm text-muted">No saved addresses yet.</p>}
            <form
              className="space-y-3 pt-2 border-t border-border"
              onSubmit={(e) => {
                e.preventDefault()
                if (!draft.line.trim()) return
                saveAddresses([...addresses, { id: String(Date.now()), ...draft }])
                setDraft({ label: '', line: '', phone: '' })
              }}
            >
              <div className="font-medium">Add address</div>
              <div><Label htmlFor="addr-line">Address</Label><Input id="addr-line" value={draft.line} onChange={(e) => setDraft({ ...draft, line: e.target.value })} placeholder="Road, area, city" required /></div>
              <div><Label htmlFor="addr-phone">Phone</Label><Input id="addr-phone" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="01XXXXXXXXX" /></div>
              <Button type="submit">Save address</Button>
            </form>
          </div>
        )}
        {tab === 'password' && (
          <form className="space-y-3" onSubmit={savePassword}>
            <div><Label htmlFor="pw-new">New password</Label><Input id="pw-new" type="password" value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} required minLength={6} /></div>
            <div><Label htmlFor="pw-confirm">Confirm password</Label><Input id="pw-confirm" type="password" value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} required minLength={6} /></div>
            {pwMsg ? <p className="text-sm text-primary">{pwMsg}</p> : null}
            {pwErr ? <p className="text-sm text-danger">{pwErr}</p> : null}
            <Button type="submit">Update password</Button>
          </form>
        )}
      </Card>
    </div>
  )
}
