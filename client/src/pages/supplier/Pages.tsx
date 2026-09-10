import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, ImagePlus, MoreVertical, Package, Percent, RefreshCw, Wallet } from 'lucide-react'
import { Badge, Button, Card, Input, Label, StatCard } from '@/components/ui'
import { CancelOrderModal } from '@/components/CancelOrderModal'
import { NotificationsInbox } from '@/components/NotificationsInbox'
import { Brand } from '@/components/Brand'
import { api } from '@/services/api'
import { money, cn, statusLabel, canCancelStatus, downloadCsv } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import { usePoll } from '@/lib/poll'

/** Client-side mirror of server `toShopSlug` for names — lowercase alnum with dashes. */
function slugFromName(name: string) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function ImagePicker({ url, onUrl, onError }: { url: string; onUrl: (u: string) => void; onError: (m: string) => void }) {
  return (
    <label className="mt-1 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#f2ccc1] bg-[#fff4ef] min-h-[140px] cursor-pointer px-4 text-center overflow-hidden">
      {url ? <img src={url} alt="Product" className="h-28 w-full object-contain" /> : <ImagePlus className="text-primary" />}
      <span className="text-sm font-medium">{url ? 'Change image' : 'Drop image or click to upload'}</span>
      <span className="text-xs text-muted">PNG or JPG, up to 5 MB.</span>
      <input
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0]
          if (!f) return
          try {
            const up = await api.upload(f)
            onUrl(up.url)
          } catch (err) {
            onError(err instanceof Error ? err.message : 'Upload failed')
          }
        }}
      />
    </label>
  )
}

export function SupplierDashboard() {
  const { user } = useAuth()
  const [data, setData] = useState<any>(null)
  const [updated, setUpdated] = useState<Date | null>(null)
  async function load() {
    const d = await api.get('/supplier/dashboard')
    setData(d)
    setUpdated(new Date())
  }
  useEffect(() => { void load() }, [])
  if (!data) return <p className="text-muted">Loading…</p>
  const s = data.stats
  const first = user?.name?.split(' ')[0] || 'there'
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <p className="text-xs text-muted">Supplier dashboard</p>
          <h2 className="text-2xl font-semibold mt-1">Welcome, {first}.</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void load()} className="text-sm text-muted inline-flex items-center gap-1 hover:text-foreground">
            Updated {updated ? updated.toLocaleTimeString() : 'just now'} <RefreshCw size={14} />
          </button>
          <Link to="/supplier/products/new"><Button variant="secondary">+ Add product</Button></Link>
          <Link to="/supplier/orders"><Button><Package size={14} /> Process orders</Button></Link>
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <StatCard
          to="/supplier/earnings"
          Icon={Wallet}
          title="Available payout"
          note="Ready to transfer"
          value={money(s.available)}
          foot="Open earnings →"
        />
        <StatCard
          to="/supplier/orders"
          Icon={Package}
          title="Orders"
          note="Last 30 days"
          value={s.orders}
          foot="View orders →"
        />
      </div>
    </div>
  )
}

export function SupplierOrders() {
  const { user } = useAuth()
  const uid = String(user?.id || user?._id || '')
  const [orders, setOrders] = useState<any[]>([])
  const [tab, setTab] = useState('All')
  const [cancelTarget, setCancelTarget] = useState<any | null>(null)
  const [cancelling, setCancelling] = useState(false)
  async function load() { setOrders((await api.get<{ orders: any[] }>('/orders')).orders) }
  usePoll(() => void load(), [])
  async function act(id: string, status: string) {
    try {
      if (status === 'supplier_confirmed') {
        await api.post(`/orders/${id}/confirm`, {})
      } else {
        await api.patch(`/orders/${id}/status`, { status, cancelReason: undefined })
      }
      await load()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Action failed')
    }
  }
  async function confirmCancel(reason: string) {
    if (!cancelTarget) return
    setCancelling(true)
    try {
      await api.patch(`/orders/${cancelTarget._id}/status`, { status: 'supplier_cancelled', cancelReason: reason })
      setCancelTarget(null)
      await load()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Cancel failed')
    } finally {
      setCancelling(false)
    }
  }
  function mineUnconfirmed(o: any) {
    const lines = (o.items || []).filter((i: any) => String(i.supplier?._id || i.supplier || o.supplier?._id || o.supplier) === uid)
    const pool = lines.length ? lines : o.items || []
    return pool.some((i: any) => !i.confirmedAt)
  }
  const tabs = ['All', 'Pending', 'Confirmed', 'Cancelled'] as const
  const visible = orders.filter((o) => {
    if (tab === 'All') return true
    if (tab === 'Pending') return o.status === 'placed' || o.status === 'supplier_approved'
    if (tab === 'Confirmed') return ['supplier_confirmed', 'delivery_initiated', 'shipped', 'out_for_delivery', 'delivered'].includes(o.status)
    if (tab === 'Cancelled') return String(o.status).includes('cancel') || o.status === 'refunded'
    return true
  })
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-semibold">Orders</h2>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => downloadCsv('supplier-orders.csv', [
            ['Order', 'Retailer', 'Status', 'Total', 'Date'],
            ...visible.map((o) => [o.orderNumber, o.retailer?.name || '', o.status, o.subtotal, new Date(o.createdAt).toLocaleDateString()]),
          ])}>Export</Button>
          <Button variant="secondary" onClick={() => void load()}>Refresh</Button>
        </div>
      </div>
      <div className="flex gap-2 mb-4 flex-wrap">
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn('rounded-full px-3 py-1.5 text-sm', tab === t ? 'bg-[#242526] text-white' : 'bg-[#f3f4f6]')}>{t} {orders.filter((o)=>{
            if (t==='All') return true
            if (t==='Pending') return o.status==='placed'||o.status==='supplier_approved'
            if (t==='Confirmed') return ['supplier_confirmed','delivery_initiated','shipped','out_for_delivery','delivered'].includes(o.status)
            return String(o.status).includes('cancel') || o.status === 'refunded'
          }).length}</button>
        ))}
      </div>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-canvas text-muted text-left"><tr>
            <th className="px-3 py-3">Order</th><th className="px-3 py-3">Product</th><th className="px-3 py-3">Retailer</th><th className="px-3 py-3">Type</th><th className="px-3 py-3">Price</th><th className="px-3 py-3">Date</th><th className="px-3 py-3">Status</th><th className="px-3 py-3"></th>
          </tr></thead>
          <tbody>
            {visible.map((o) => (
              <tr key={o._id} className="border-t border-border">
                <td className="px-3 py-3 font-medium">{o.orderNumber}</td>
                <td className="px-3 py-3">{o.items?.[0]?.name || '—'}{o.items?.length>1?` +${o.items.length-1}`:''}</td>
                <td className="px-3 py-3">{o.retailer?.name}</td>
                <td className="px-3 py-3">{(o.paymentMethod||'cod').toUpperCase()}</td>
                <td className="px-3 py-3 tabular-nums">{money(o.subtotal)}</td>
                <td className="px-3 py-3 text-muted">{new Date(o.createdAt).toLocaleDateString()}</td>
                <td className="px-3 py-3"><Badge>{statusLabel(o.status)}</Badge></td>
                <td className="px-3 py-3">
                  <div className="flex gap-1 justify-end">
                    {['placed', 'supplier_approved'].includes(o.status) && mineUnconfirmed(o) && (
                      <Button className="h-8 text-xs" onClick={()=>act(o._id,'supplier_confirmed')}>Confirm</Button>
                    )}
                    {canCancelStatus(o.status) && (
                      <Button variant="secondary" className="h-8 text-xs" onClick={() => setCancelTarget(o)}>Cancel</Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length && <p className="p-8 text-center text-muted">No orders</p>}
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

export function SupplierProducts() {
  const [products, setProducts] = useState<any[]>([])
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const [category, setCategory] = useState('')
  const [sort, setSort] = useState('name')
  const [menu, setMenu] = useState<string | null>(null)
  async function load() { setProducts((await api.get<{ products: any[] }>('/products?mine=1')).products) }
  useEffect(() => { void load() }, [])
  const cats = [...new Set(products.map((p) => p.category?.name).filter(Boolean))]
  const filtered = products.filter((p) => {
    if (status === 'hidden' && p.isActive !== false) return false
    if (status !== 'all' && status !== 'hidden' && p.status !== status) return false
    if (status === 'approved' && p.isActive === false) return false
    if (category && (p.category?.name || '') !== category) return false
    if (q && !p.name.toLowerCase().includes(q.toLowerCase())) return false
    return true
  }).sort((a, b) => sort === 'price' ? a.price - b.price : a.name.localeCompare(b.name))
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Catalog</p>
          <h2 className="text-2xl font-semibold">Products</h2>
        </div>
        <Link to="/supplier/products/new"><Button>+ Add product</Button></Link>
      </div>
      <Card className="p-4 mb-4">
        <div className="flex flex-wrap gap-2 items-center">
          <Input className="max-w-xs" placeholder="Search products" value={q} onChange={(e)=>setQ(e.target.value)} />
          <select className="h-10 rounded-[8px] border border-border bg-[#f7f8f8] px-3 text-sm" value={category} onChange={(e)=>setCategory(e.target.value)}>
            <option value="">All categories</option>
            {cats.map((c)=><option key={c} value={c}>{c}</option>)}
          </select>
          <select className="h-10 rounded-[8px] border border-border bg-[#f7f8f8] px-3 text-sm" value={sort} onChange={(e)=>setSort(e.target.value)}>
            <option value="name">Name A–Z</option>
            <option value="price">Price low–high</option>
          </select>
          {[
            ['all', `All (${products.length})`],
            ['approved', 'Active'],
            ['pending', 'Pending'],
            ['rejected', 'Rejected'],
            ['hidden', 'Hidden'],
          ].map(([s, label])=>(
            <button key={s} onClick={()=>setStatus(s)} className={cn('rounded-full px-3 py-1.5 text-sm', status===s?'bg-[#242526] text-white':'bg-[#f3f4f6]')}>
              {label}
            </button>
          ))}
        </div>
      </Card>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        {filtered.map((p)=>(
          <Card key={p._id} className="overflow-hidden flex flex-col">
            <div className="relative">
              <img src={p.imageUrl} className="h-36 w-full object-cover bg-canvas" alt={p.name} />
              <div className="absolute top-2 right-2">
                <button type="button" className="p-1 rounded bg-white/90 text-muted" aria-label="Product actions" onClick={()=>setMenu(menu===p._id?null:p._id)}><MoreVertical size={14}/></button>
                {menu===p._id && (
                  <div className="absolute right-0 top-7 z-10 bg-white border border-border rounded-lg shadow-sm p-1 min-w-[120px]">
                    <Link to={`/supplier/products/${p._id}/edit`} className="block px-3 py-1.5 text-sm hover:bg-canvas rounded">Edit</Link>
                  </div>
                )}
              </div>
            </div>
            <div className="p-3 flex flex-col gap-1 flex-1">
              <div className="font-medium text-sm line-clamp-1">{p.name}</div>
              <div className="text-sm"><span className="font-semibold tabular-nums">{money(p.price)}</span> <span className="text-muted text-xs">per {p.unit}</span></div>
              <div className="flex gap-1 flex-wrap">
                <Badge className={p.status==='approved' && p.isActive!==false ?'bg-[#d1fae5] text-[#047857]': p.status==='pending' ? 'bg-[#fef3c7] text-[#b45309]' : ''}>{p.isActive===false ? 'Hidden' : p.status==='approved'?'Active':p.status==='pending'?'Pending':p.status}</Badge>
                <Badge>MOQ {p.moq}</Badge>
                {p.rejectReason ? <span className="text-[11px] text-danger">{p.rejectReason}</span> : null}
              </div>
              <Link to={`/supplier/products/${p._id}/edit`} className="mt-auto"><Button variant="secondary" className="w-full h-8 text-xs">Edit product</Button></Link>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

export function SupplierProductNew() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [cats, setCats] = useState<any[]>([])
  const [form, setForm] = useState({ name: '', description: '', price: '', unit: 'Piece', category: '', stock: '', moq: '1', imageUrl: '' })
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => { void api.get<{ categories: any[] }>('/products/categories').then((d) => setCats(d.categories)) }, [])
  async function submit(e: FormEvent) {
    e.preventDefault()
    setErr('')
    const priceNum = Number(form.price)
    const stockNum = Number(form.stock)
    const moqNum = Number(form.moq)
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      setErr('Price must be greater than 0')
      return
    }
    if (!Number.isFinite(stockNum) || stockNum < 1) {
      setErr('Initial stock must be at least 1 when adding a product')
      return
    }
    if (!Number.isFinite(moqNum) || moqNum < 1) {
      setErr('Minimum order quantity must be at least 1')
      return
    }
    if (!form.imageUrl) {
      setErr('Product image is required')
      return
    }
    try {
      await api.post('/products', { ...form, price: priceNum, stock: stockNum, moq: moqNum, category: form.category || undefined, imageUrl: form.imageUrl })
      setMsg('Product submitted for approval')
      setTimeout(() => navigate('/supplier/products'), 600)
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Failed')
    }
  }
  if (user?.verificationStatus !== 'approved') {
    return (
      <div className="max-w-xl">
        <h2 className="text-2xl font-semibold">Verification required</h2>
        <p className="text-sm text-muted mt-2">Admin must approve your supplier application before you can list products.</p>
        <Link to="/supplier/verification" className="inline-block mt-4"><Button>Open verification</Button></Link>
      </div>
    )
  }
  return (
    <div className="max-w-2xl">
      <Link to="/supplier/products" className="text-sm text-primary font-medium">← Back to my products</Link>
      <h2 className="text-2xl font-semibold mt-2">Add a product</h2>
      <p className="text-sm text-muted mt-1">New listings are reviewed before they appear in the retailer catalog.</p>
      <Card className="p-5 mt-4">
        <p className="text-sm font-semibold mb-4">New product details</p>
        <form className="space-y-3" onSubmit={submit}>
          <div><Label htmlFor="product-name">Product name *</Label><Input id="product-name" required value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})} /></div>
          <div>
            <Label>Long description</Label>
            <textarea maxLength={2000} className="w-full min-h-28 rounded-[8px] border border-border bg-[#f7f8f8] p-3 text-sm" value={form.description} onChange={(e)=>setForm({...form,description:e.target.value})} />
            <div className="text-xs text-muted text-right mt-1">{form.description.length}/2000</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="product-price">Price per unit (Tk) *</Label><Input id="product-price" required type="number" min="0.01" step="0.01" value={form.price} onChange={(e)=>setForm({...form,price:e.target.value})} /></div>
            <div><Label>Unit *</Label>
              <select className="w-full h-10 rounded-[8px] border border-border bg-[#f7f8f8] px-3 text-sm" value={form.unit} onChange={(e)=>setForm({...form,unit:e.target.value})}>
                {['Piece','kg','can','pouch','box','liter'].map(u=> <option key={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div><Label>Category</Label>
            <select className="w-full h-10 rounded-[8px] border border-border bg-[#f7f8f8] px-3 text-sm" value={form.category} onChange={(e)=>setForm({...form,category:e.target.value})}>
              <option value="">Select</option>
              {cats.map((c)=><option key={c._id} value={c._id}>{c.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Initial stock *</Label><Input required type="number" min="1" value={form.stock} onChange={(e)=>setForm({...form,stock:e.target.value})} /></div>
            <div><Label>Minimum order quantity *</Label><Input required type="number" min="1" value={form.moq} onChange={(e)=>setForm({...form,moq:e.target.value})} /></div>
          </div>
          <div>
            <Label>Product image *</Label>
            <ImagePicker url={form.imageUrl} onUrl={(url)=>setForm((prev)=>({...prev, imageUrl: url}))} onError={setErr} />
          </div>
          {msg ? <p className="text-sm text-primary">{msg}</p> : null}
          {err ? <p className="text-sm text-danger">{err}</p> : null}
          <div className="flex gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={()=>navigate('/supplier/products')}>Cancel</Button>
            <Button type="submit">Create product</Button>
          </div>
        </form>
      </Card>
    </div>
  )
}

export function SupplierProductEdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [cats, setCats] = useState<any[]>([])
  const [form, setForm] = useState({ name: '', description: '', price: '', unit: 'Piece', category: '', stock: '', moq: '1', imageUrl: '' })
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [status, setStatus] = useState('')
  useEffect(() => {
    void api.get<{ categories: any[] }>('/products/categories').then((d) => setCats(d.categories))
    if (!id) return
    void api.get<{ product: any }>(`/products/${id}`).then((d) => {
      const p = d.product
      setStatus(p.status)
      setForm({
        name: p.name || '',
        description: p.description || '',
        price: String(p.price ?? ''),
        unit: p.unit || 'Piece',
        category: p.category?._id || '',
        stock: String(p.stock ?? ''),
        moq: String(p.moq ?? '1'),
        imageUrl: p.imageUrl || '',
      })
    })
  }, [id])
  async function submit(e: FormEvent) {
    e.preventDefault()
    setErr('')
    const priceNum = Number(form.price)
    const stockNum = Number(form.stock)
    const moqNum = Number(form.moq)
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      setErr('Price must be greater than 0')
      return
    }
    if (!Number.isFinite(stockNum) || stockNum < 0) {
      setErr('Stock cannot be negative')
      return
    }
    if (!Number.isFinite(moqNum) || moqNum < 1) {
      setErr('Minimum order quantity must be at least 1')
      return
    }
    try {
      await api.patch(`/products/${id}`, {
        ...form,
        price: priceNum,
        stock: stockNum,
        moq: moqNum,
        category: form.category || undefined,
      })
      setMsg('Saved. Catalog edits go back to pending approval.')
      setTimeout(() => navigate('/supplier/products'), 700)
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Failed')
    }
  }
  return (
    <div className="max-w-2xl">
      <Link to="/supplier/products" className="text-sm text-primary font-medium">← Back to my products</Link>
      <h2 className="text-2xl font-semibold mt-2">Edit product</h2>
      <p className="text-sm text-muted mt-1">Status: {status || '…'}. Changing name, price, or description resubmits for admin approval. Stock-only updates stay live.</p>
      <Card className="p-5 mt-4">
        <form className="space-y-3" onSubmit={submit}>
          <div><Label htmlFor="product-name">Product name *</Label><Input id="product-name" required value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})} /></div>
          <div>
            <Label>Long description</Label>
            <textarea maxLength={2000} className="w-full min-h-28 rounded-[8px] border border-border bg-[#f7f8f8] p-3 text-sm" value={form.description} onChange={(e)=>setForm({...form,description:e.target.value})} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="product-price">Price per unit (Tk) *</Label><Input id="product-price" required type="number" min="0.01" step="0.01" value={form.price} onChange={(e)=>setForm({...form,price:e.target.value})} /></div>
            <div><Label>Unit *</Label>
              <select className="w-full h-10 rounded-[8px] border border-border bg-[#f7f8f8] px-3 text-sm" value={form.unit} onChange={(e)=>setForm({...form,unit:e.target.value})}>
                {['Piece','kg','can','pouch','box','liter'].map(u=> <option key={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div><Label>Category</Label>
            <select className="w-full h-10 rounded-[8px] border border-border bg-[#f7f8f8] px-3 text-sm" value={form.category} onChange={(e)=>setForm({...form,category:e.target.value})}>
              <option value="">Select</option>
              {cats.map((c)=><option key={c._id} value={c._id}>{c.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Stock *</Label><Input required type="number" min="0" value={form.stock} onChange={(e)=>setForm({...form,stock:e.target.value})} /></div>
            <div><Label>Minimum order quantity *</Label><Input required type="number" min="1" value={form.moq} onChange={(e)=>setForm({...form,moq:e.target.value})} /></div>
          </div>
          <div>
            <Label>Product image</Label>
            <ImagePicker url={form.imageUrl} onUrl={(url)=>setForm((prev)=>({...prev, imageUrl: url}))} onError={setErr} />
          </div>
          {msg ? <p className="text-sm text-primary">{msg}</p> : null}
          {err ? <p className="text-sm text-danger">{err}</p> : null}
          <div className="flex gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={()=>navigate('/supplier/products')}>Cancel</Button>
            <Button type="submit">Save product</Button>
          </div>
        </form>
      </Card>
    </div>
  )
}

export function SupplierInventory() {
  const [products, setProducts] = useState<any[]>([])
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [delta, setDelta] = useState('')
  const [bulkMsg, setBulkMsg] = useState('')
  const [bulkErr, setBulkErr] = useState('')
  const selectAllRef = useRef<HTMLInputElement>(null)
  async function load() {
    const d = await api.get<{ products: any[] }>('/supplier/inventory')
    setProducts(d.products)
    const m: Record<string,string> = {}
    d.products.forEach((p:any)=>{ m[p._id]=String(p.stock) })
    setDraft(m)
  }
  useEffect(() => { void load() }, [])
  const out = products.filter((p)=>p.stock<=0).length
  const allSelected = products.length > 0 && products.every((p)=>selected.has(p._id))
  const someSelected = selected.size > 0 && !allSelected
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected
  }, [someSelected])
  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const validDelta = /^[+-]?\d+$/.test(delta.trim())
  async function saveRow(id: string) {
    try {
      await api.patch(`/products/${id}`, { stock: Number(draft[id]||0) })
      await load()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Update failed')
    }
  }
  async function applyDelta() {
    setBulkErr('')
    setBulkMsg('')
    if (selected.size === 0) { setBulkErr('Select at least one product'); return }
    if (!validDelta) { setBulkErr('Enter a delta like +10 or -10'); return }
    const d = parseInt(delta.trim(), 10)
    if (d === 0) { setBulkErr('Delta cannot be 0'); return }
    try {
      const r = await api.post<{ updated: number }>('/supplier/inventory/apply-delta', { ids: [...selected], delta: d })
      setBulkMsg(`Updated ${r.updated} ${r.updated === 1 ? 'product' : 'products'} (${d > 0 ? '+' : ''}${d})`)
      setSelected(new Set())
      await load()
    } catch (e) {
      setBulkErr(e instanceof Error ? e.message : 'Apply failed')
    }
  }
  async function importCsv(file: File) {
    const text = await file.text()
    const lines = text.split(/\r?\n/).slice(1)
    for (const line of lines) {
      const [name, stock] = line.split(',').map((s) => s.replace(/"/g, '').trim())
      const p = products.find((x) => x.name === name)
      if (p && stock !== '') await api.patch(`/products/${p._id}`, { stock: Number(stock) })
    }
    await load()
  }
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-2xl font-semibold">Inventory management</h2>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void load()}>Refresh</Button>
          <Button variant="secondary" onClick={() => downloadCsv('inventory.csv', [['Product','Stock','MOQ'], ...products.map((p)=>[p.name, p.stock, p.moq])])}>Export</Button>
          <label className="inline-flex">
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e)=>{ const f=e.target.files?.[0]; if (f) void importCsv(f); e.target.value='' }} />
            <Button type="button" variant="secondary" onClick={(e)=>{(e.currentTarget.previousSibling as HTMLInputElement)?.click()}}>Import</Button>
          </label>
          <Button onClick={() => document.getElementById('inventory-table')?.scrollIntoView({ behavior: 'smooth' })}>Manage</Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 mb-4">
        <StatCard Icon={Package} title="Catalog" note="Listed products" value={products.length} foot="All inventory rows" />
        <StatCard Icon={AlertTriangle} title="Out of stock" note="Stock at or below zero" value={out} foot="Need restocking" />
      </div>
      <Card className="overflow-hidden" id="inventory-table">
        <div className="px-4 py-3 border-b border-border">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-medium">Manage Inventory</div>
              <p className="text-xs text-muted mt-0.5">Tick products (or select all) and apply a stock delta — e.g. +10 adds, -10 deducts. Single-row Update sets an exact value.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {selected.size > 0 ? <span className="text-xs text-muted">{selected.size} selected</span> : null}
              <Input className="w-28 h-9" placeholder="+10 / -10" inputMode="numeric" value={delta} onChange={(e)=>setDelta(e.target.value)} aria-label="Stock delta" />
              <Button className="h-9" onClick={() => void applyDelta()} disabled={selected.size === 0 || !validDelta}>Apply delta</Button>
            </div>
          </div>
          {bulkErr ? <p className="text-sm text-danger mt-2">{bulkErr}</p> : null}
          {bulkMsg ? <p className="text-sm text-primary mt-2">{bulkMsg}</p> : null}
        </div>
        <table className="w-full text-sm">
          <thead className="bg-canvas text-muted text-left"><tr>
            <th className="px-4 py-3 w-10"><input type="checkbox" ref={selectAllRef} checked={allSelected} onChange={(e)=>setSelected(e.target.checked ? new Set(products.map((p)=>p._id)) : new Set())} title="Select all" aria-label="Select all products" /></th>
            <th className="px-4 py-3">Product</th><th className="px-4 py-3">Stock</th><th className="px-4 py-3">MOQ</th><th className="px-4 py-3">Update</th>
          </tr></thead>
          <tbody>
            {products.map((p)=>(
              <tr key={p._id} className={cn('border-t border-border', selected.has(p._id) && 'bg-[#fff4ef]')}>
                <td className="px-4 py-3"><input type="checkbox" checked={selected.has(p._id)} onChange={()=>toggleRow(p._id)} aria-label={`Select ${p.name}`} /></td>
                <td className="px-4 py-3">{p.name}</td>
                <td className="px-4 py-3"><Input className="w-24 h-8" value={draft[p._id]||''} onChange={(e)=>setDraft({...draft,[p._id]:e.target.value})} /></td>
                <td className="px-4 py-3">{p.moq}</td>
                <td className="px-4 py-3"><Button className="h-8 text-xs" onClick={()=>saveRow(p._id)}>Update</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

export function SupplierEarnings() {
  const [data, setData] = useState<any>(null)
  const [chip, setChip] = useState<'All' | 'Payouts' | 'Orders'>('All')
  useEffect(() => { void api.get('/supplier/earnings').then(setData) }, [])
  if (!data) return <p className="text-muted">Loading…</p>
  const payouts = data.payouts || []
  const recent = data.recent || []
  return (
    <div>
      <h2 className="text-2xl font-semibold mb-4">Earnings and payouts.</h2>
      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        <StatCard Icon={Wallet} title="Available balance" note="Ready to transfer" value={money(data.balance.available)} foot="Accrued but not yet paid" />
        <StatCard Icon={CheckCircle2} title="Paid lifetime" note="Payouts completed" value={money(data.balance.alreadyPaid)} foot="All settled payouts" />
        <StatCard Icon={Percent} title="Commission rate" note="Platform commission" value={`${Math.round(Number(data.commissionRate ?? 0.1) * 1000) / 10}%`} foot="Applied to earnings" />
      </div>
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="font-medium">Payout ledger</div>
          <div className="flex gap-2 text-sm">
            {(['All', 'Payouts', 'Orders'] as const).map((c) => (
              <button key={c} type="button" onClick={() => setChip(c)} className={cn('px-3 py-1 rounded-full', chip === c ? 'bg-[#242526] text-white' : 'bg-[#f3f4f6]')}>{c}</button>
            ))}
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-canvas text-muted text-left"><tr><th className="px-4 py-3">Payout</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Status</th></tr></thead>
          <tbody>
            {(chip !== 'Orders' ? payouts : []).map((p:any)=>(
              <tr key={p._id} className="border-t border-border"><td className="px-4 py-3">{p.note || 'Payout'}</td><td className="px-4 py-3 tabular-nums">{money(p.amount)}</td><td className="px-4 py-3">{new Date(p.createdAt).toLocaleDateString()}</td><td className="px-4 py-3"><Badge>{p.status}</Badge></td></tr>
            ))}
            {(chip !== 'Payouts' ? recent : []).map((o:any)=>(
              <tr key={o._id} className="border-t border-border"><td className="px-4 py-3">{o.orderNumber}</td><td className="px-4 py-3 tabular-nums">{money(o.supplierAmount)}</td><td className="px-4 py-3">{new Date(o.updatedAt).toLocaleDateString()}</td><td className="px-4 py-3"><Badge>Delivered</Badge></td></tr>
            ))}
            {(chip === 'Payouts' ? !payouts.length : chip === 'Orders' ? !recent.length : !payouts.length && !recent.length) && <tr><td colSpan={4} className="p-8 text-center text-muted">No ledger entries yet</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

export function SupplierRetailers() {
  const [retailers, setRetailers] = useState<any[]>([])
  useEffect(() => { void api.get<{ retailers: any[] }>('/supplier/retailers').then((d) => setRetailers(d.retailers)) }, [])
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-semibold">Retailers.</h2>
        <Button variant="secondary" onClick={() => downloadCsv('retailers.csv', [
          ['Retailer', 'Email', 'Orders', 'Gross', 'Last order'],
          ...retailers.map((r)=>[r.businessName || r.name, r.email, r.orders ?? 0, r.gross || 0, r.lastOrderAt ? new Date(r.lastOrderAt).toLocaleDateString() : '']),
        ])}>Export CSV</Button>
      </div>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-canvas text-muted text-left"><tr><th className="px-4 py-3">Retailer</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Orders</th><th className="px-4 py-3">Gross</th><th className="px-4 py-3">Last order</th></tr></thead>
          <tbody>
            {retailers.map((r)=>(
              <tr key={r._id} className="border-t border-border">
                <td className="px-4 py-3 font-medium">{r.businessName || r.name}</td>
                <td className="px-4 py-3">{r.email}</td>
                <td className="px-4 py-3">{r.orders ?? 0}</td>
                <td className="px-4 py-3 tabular-nums">{money(r.gross || 0)}</td>
                <td className="px-4 py-3 text-muted">{r.lastOrderAt ? new Date(r.lastOrderAt).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
            {!retailers.length && <tr><td colSpan={5} className="p-8 text-center text-muted">No retailers yet</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

export function SupplierNotifications() {
  return <NotificationsInbox heading="Notifications." />
}

export function SupplierSettings() {
  const { user, refresh, updateProfile, changeEmail, changePassword } = useAuth()
  const [profile, setProfile] = useState({
    businessName: user?.businessName || user?.name || '',
    description: user?.businessDescription || '',
    shopLink: user?.shopSlug || user?.shopLink || '',
  })
  const [pw, setPw] = useState({ a: '', b: '' })
  const [email, setEmail] = useState(user?.email || '')
  const [emailPw, setEmailPw] = useState('')
  const [emailSaved, setEmailSaved] = useState('')
  const [emailErr, setEmailErr] = useState('')
  const [saved, setSaved] = useState('')
  const [err, setErr] = useState('')
  const [pwMsg, setPwMsg] = useState('')
  const approved = user?.verificationStatus === 'approved'

  useEffect(() => {
    setProfile({
      businessName: user?.businessName || user?.name || '',
      description: user?.businessDescription || '',
      shopLink: user?.shopSlug || user?.shopLink || '',
    })
    setEmail(user?.email || '')
    setEmailPw('')
    setEmailSaved('')
  }, [user])

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Settings.</h2>
        <Button variant="secondary" className="gap-2" onClick={() => void refresh()}><RefreshCw size={14} /> Refresh</Button>
      </div>

      <Card className="p-5 space-y-4">
        <div>
          <div className="font-semibold">Shop profile</div>
          <p className="text-sm text-muted mt-1">Public shop details retailers see across your catalog listings.</p>
        </div>
        <div><Label>Shop name *</Label><Input value={profile.businessName} onChange={(e)=>setProfile({...profile,businessName:e.target.value})} /></div>
        <div><Label>Description *</Label><textarea className="w-full min-h-24 rounded-[8px] border border-border bg-[#f7f8f8] p-3 text-sm" value={profile.description} onChange={(e)=>setProfile({...profile,description:e.target.value})} /></div>
        <div>
          <Label>Shop link *</Label>
          <Input value={profile.shopLink} onChange={(e)=>setProfile({...profile,shopLink:e.target.value})} />
          <p className="text-xs text-muted mt-1">Lowercase letters, numbers and dashes — used in your shop URL.</p>
        </div>

        <div className="pt-2 border-t border-border">
          <div className="font-semibold">Verification</div>
          <p className="text-sm text-muted mt-1">Review status is managed by SoukCart admins.</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Badge className={approved ? 'bg-primary text-white' : ''}>{user?.verificationStatus || 'none'}</Badge>
            {user?.verificationRejectReason ? <p className="text-sm text-danger mt-2">{user.verificationRejectReason}</p> : null}
            {approved && <span className="text-sm text-muted">Reviewed {user?.updatedAt ? new Date((user as any).updatedAt).toLocaleString() : '—'}</span>}
          </div>
          <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
            <div><div className="text-muted">Trade licence number</div><div>—</div></div>
            <div><div className="text-muted">Documents on file</div><Badge className="mt-1">NID document uploaded</Badge></div>
          </div>
          <Link to="/supplier/verification" className="inline-block mt-3 text-sm text-primary font-medium">Update verification →</Link>
        </div>

        <div className="flex justify-end">
          <Button onClick={async ()=>{
            setErr('')
            try {
              await updateProfile({
                businessName: profile.businessName,
                businessDescription: profile.description,
                shopLink: profile.shopLink,
              })
              setSaved('Saved')
              setTimeout(()=>setSaved(''), 1200)
            } catch (e) {
              setErr(e instanceof Error ? e.message : 'Save failed')
            }
          }}>Save settings</Button>
        </div>
        {saved ? <p className="text-sm text-primary text-right">{saved}</p> : null}
        {err ? <p className="text-sm text-danger text-right">{err}</p> : null}
      </Card>

      <Card className="p-5 space-y-3">
        <div className="font-semibold">Sign-in email</div>
        <p className="text-sm text-muted">Change the email you use to sign in. Your current password is required to confirm the change.</p>
        <div className="grid md:grid-cols-2 gap-3">
          <div><Label htmlFor="sup-email">Email *</Label><Input id="sup-email" type="email" value={email} onChange={(e)=>setEmail(e.target.value)} /></div>
          <div><Label htmlFor="sup-email-pw">Current password *</Label><Input id="sup-email-pw" type="password" value={emailPw} onChange={(e)=>setEmailPw(e.target.value)} placeholder="Confirm with your password" /></div>
        </div>
        {emailSaved ? <p className="text-sm text-primary text-right">{emailSaved}</p> : null}
        {emailErr ? <p className="text-sm text-danger text-right">{emailErr}</p> : null}
        <div className="flex justify-end"><Button variant="secondary" onClick={async () => {
          setEmailErr('')
          setEmailSaved('')
          const next = email.trim().toLowerCase()
          if (next === (user?.email || '').toLowerCase()) {
            setEmailErr('New email is the same as your current email')
            return
          }
          if (!next) {
            setEmailErr('Enter your new email address')
            return
          }
          if (!emailPw) {
            setEmailErr('Enter your current password to change your email')
            return
          }
          try {
            await changeEmail(next, emailPw)
            setEmailPw('')
            setEmailSaved('Email updated — use it to sign in from now on')
          } catch (e) {
            setEmailErr(e instanceof Error ? e.message : 'Update failed')
          }
        }}>Change email</Button></div>
      </Card>

      <Card className="p-5 space-y-3">
        <div className="font-semibold">Password</div>
        <p className="text-sm text-muted">Update the password for this supplier account.</p>
        <div className="grid md:grid-cols-2 gap-3">
          <div><Label htmlFor="sup-pw-a">New password *</Label><Input id="sup-pw-a" type="password" value={pw.a} onChange={(e)=>setPw({...pw,a:e.target.value})} /></div>
          <div><Label htmlFor="sup-pw-b">Confirm password *</Label><Input id="sup-pw-b" type="password" value={pw.b} onChange={(e)=>setPw({...pw,b:e.target.value})} /></div>
        </div>
        {pwMsg ? <p className="text-sm text-primary text-right">{pwMsg}</p> : null}
        <div className="flex justify-end"><Button variant="secondary" onClick={async ()=>{
          setPwMsg('')
          if (pw.a !== pw.b) { setPwMsg('Passwords do not match'); return }
          try {
            await changePassword(pw.a)
            setPw({ a: '', b: '' })
            setPwMsg('Password updated')
          } catch (e) {
            setPwMsg(e instanceof Error ? e.message : 'Update failed')
          }
        }}>Update password</Button></div>
      </Card>
    </div>
  )
}

export function SupplierVerification() {
  const { user, refresh, logout } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({
    businessName: user?.businessName || '',
    shopLink: user?.shopSlug || user?.shopLink || '',
    businessDescription: user?.businessDescription || '',
    nidDocUrl: '',
    fileName: '',
  })
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const status = user?.verificationStatus || 'none'
  /** True once the user edits the shop link by hand; auto-fill from the name stops. */
  const [slugDirty, setSlugDirty] = useState(() => Boolean(user?.shopSlug || user?.shopLink))

  useEffect(() => {
    setForm((f) => ({
      ...f,
      businessName: user?.businessName || f.businessName,
      shopLink:
        user?.shopSlug ||
        user?.shopLink ||
        (slugDirty ? f.shopLink : slugFromName(user?.businessName || f.businessName)),
      businessDescription: user?.businessDescription || f.businessDescription,
    }))
    if (user?.shopSlug || user?.shopLink) setSlugDirty(true)
  }, [user])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setErr('')
    if (!form.nidDocUrl) {
      setErr('NID document is required')
      return
    }
    await api.post('/supplier/verification', {
      businessName: form.businessName,
      shopLink: form.shopLink,
      businessDescription: form.businessDescription,
      nidDocUrl: form.nidDocUrl,
    })
    const wasApproved = status === 'approved'
    await refresh()
    setMsg(wasApproved ? 'You are verified — resubmitting queues a re-review.' : 'Submitted for review')
    if (wasApproved) setTimeout(() => navigate('/supplier/settings'), 900)
  }

  return (
    <div className="min-h-screen bg-[#f7f8f8] flex flex-col items-center p-6 relative">
      <div className="w-full max-w-xl mt-8">
        <Brand />
        <h1 className="text-3xl font-bold mt-8">Verification</h1>
        <p className="text-muted mt-2">Verified suppliers get the supplier account type and can manage products.</p>
        <Card className="w-full p-6 mt-6">
          <div className="font-semibold text-lg">Supplier application</div>
          <div className="mt-3 flex items-center gap-2 text-sm">
            <span className="text-muted">Verification status</span>
            <Badge className={status === 'approved' ? 'bg-primary text-white' : ''}>{status}</Badge>
          </div>
          <form className="mt-5 space-y-3" onSubmit={submit}>
            <div><Label>Business name *</Label><Input required value={form.businessName} onChange={(e) => {
              const name = e.target.value
              setForm((f) => ({
                ...f,
                businessName: name,
                shopLink: slugDirty ? f.shopLink : slugFromName(name),
              }))
            }} /></div>
            <div>
              <Label>Shop link *</Label>
              <Input required value={form.shopLink} onChange={(e) => {
                const v = e.target.value
                setSlugDirty(Boolean(v))
                setForm((f) => ({ ...f, shopLink: v }))
              }} />
              <p className="text-xs text-muted mt-1">Auto-generated from your business name (editable) — soukcart.com/@{form.shopLink || 'your-shop'}</p>
            </div>
            <div><Label>Description</Label><textarea className="w-full min-h-24 rounded-[8px] border border-border bg-[#f7f8f8] p-3 text-sm" value={form.businessDescription} onChange={(e)=>setForm({...form,businessDescription:e.target.value})} /></div>
            <div>
              <Label>NID document (required for approval)</Label>
              <div className="mt-1 flex items-center gap-3">
                <label className="inline-flex items-center justify-center h-10 px-4 rounded-[8px] bg-[#fff4ef] border border-[#f2ccc1] text-sm font-medium cursor-pointer">
                  Choose File
                  <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={async (e)=>{
                    const f = e.target.files?.[0]
                    if (!f) return
                    try {
                      const up = await api.upload(f)
                      setForm({...form, nidDocUrl: up.url, fileName: f.name})
                      setErr('')
                    } catch (e2) {
                      setErr(e2 instanceof Error ? e2.message : 'Upload failed')
                    }
                  }} />
                </label>
                <span className="text-sm text-muted">{form.fileName || 'No file chosen'}</span>
              </div>
              <p className="text-xs text-muted mt-1">PNG or JPG, up to 5 MB. Stored privately in the trade-licenses bucket.</p>
            </div>
            {err ? <p className="text-sm text-danger">{err}</p> : null}
            <div className="flex items-center gap-3 pt-2">
              <Button type="submit">Submit for review</Button>
              {msg ? <span className="text-sm text-muted">{msg}</span> : status === 'approved' ? <span className="text-sm text-muted">You are verified — resubmitting queues a re-review.</span> : null}
            </div>
          </form>
          <div className="mt-6 pt-4 border-t border-border flex items-center justify-between">
            <div className="text-sm"><div className="font-medium">Signed in</div><div className="text-muted">{user?.email}</div></div>
            <Button variant="secondary" onClick={logout}>Log out</Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
