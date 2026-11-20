import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button, Card } from '@/components/ui'
import { useCart } from '@/context/cart'
import { api } from '@/services/api'
import { money } from '@/lib/utils'

export function RetailerProductDetail() {
  const { id } = useParams()
  const [product, setProduct] = useState<any>(null)
  const [related, setRelated] = useState<any[]>([])
  const [qty, setQty] = useState(1)
  const [error, setError] = useState('')
  const { add } = useCart()
  const [prevId, setPrevId] = useState(id)
  if (id !== prevId) {
    setPrevId(id)
    setError('')
    setProduct(null)
    setRelated([])
  }

  useEffect(() => {
    let ignore = false
    // Start both requests together; the catalog doesn't depend on the product.
    const productP = api.get<{ product: any }>(`/products/${id}`)
    const catalogP = api
      .get<{ products: any[] }>('/products?scope=catalog')
      .then((d) => d.products || [])
      .catch(() => [] as any[])
    void (async () => {
      try {
        const { product: p } = await productP
        if (ignore) return
        setProduct(p)
        setQty(p.moq || 1)
        const catId = String(p.category?._id || p.category || '')
        const catalog = await catalogP
        if (ignore) return
        const others = catalog.filter((x) => x._id !== p._id)
        const same = others.filter((x) => String(x.category?._id || x.category || '') === catId)
        setRelated((same.length ? same : others).slice(0, 4))
      } catch (e) {
        if (!ignore) setError(e instanceof Error ? e.message : 'Not found')
      }
    })()
    return () => {
      ignore = true
    }
  }, [id])

  if (error) {
    return (
      <div>
        <Link to="/retailer/products" className="text-primary text-sm font-medium">Back to storefront</Link>
        <p className="mt-4 text-muted">{error === 'Not found' ? 'This product is not in the catalog.' : error}</p>
      </div>
    )
  }
  if (!product) return <p className="text-muted">Loading…</p>

  return (
    <div>
      <Link to="/retailer/products" className="text-primary text-sm font-medium">Back to storefront</Link>
      <div className="mt-4 grid md:grid-cols-2 gap-8">
        <img src={product.imageUrl} alt={product.name} className="img-outline rounded-2xl w-full aspect-square object-cover bg-canvas" />
        <div>
          <p className="text-xs uppercase text-muted">Product details</p>
          <h2 className="text-3xl font-semibold mt-1 text-balance">{product.name}</h2>
          <p className="text-muted mt-1 text-pretty">{product.supplier?.businessName || product.supplier?.name}</p>
          <p className="text-2xl font-semibold mt-4 tabular-nums">{money(product.price)} <span className="text-base text-muted">/ {product.unit}</span></p>
          <p className="text-sm text-muted mt-1">MOQ {product.moq} · {product.stock} in stock</p>
          <p className="mt-4 text-sm leading-relaxed">{product.description}</p>
          <div className="mt-6 flex items-center gap-3">
            <div className="inline-flex items-center rounded-full border border-border">
              <button className="h-10 w-10" onClick={() => setQty((q) => Math.max(product.moq, q - 1))}>−</button>
              <span className="w-10 text-center text-sm font-medium">{qty}</span>
              <button className="h-10 w-10 disabled:opacity-40 disabled:cursor-not-allowed" disabled={qty >= product.stock} onClick={() => setQty((q) => Math.min(product.stock, q + 1))}>+</button>
            </div>
            <Button
              disabled={product.stock < product.moq}
              onClick={() =>
                add(
                  {
                    productId: product._id,
                    name: product.name,
                    price: product.price,
                    unit: product.unit,
                    moq: product.moq,
                    stock: product.stock,
                    imageUrl: product.imageUrl,
                    supplierId: product.supplier._id,
                  },
                  qty,
                )
              }
            >
              {product.stock < product.moq ? 'Out of stock' : 'Add to order'}
            </Button>
          </div>
        </div>
      </div>
      <div className="mt-8">
        <h3 className="font-semibold mb-3">Related products</h3>
        {related.length ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {related.map((p) => (
              <Link key={p._id} to={`/retailer/products/${p._id}`} className="rounded-xl border border-border overflow-hidden hover:border-primary">
                <img src={p.imageUrl} alt={p.name} className="img-outline h-28 w-full object-cover bg-canvas" />
                <div className="p-3">
                  <div className="text-sm font-medium line-clamp-1">{p.name}</div>
                  <div className="text-sm text-muted tabular-nums">{money(p.price)}</div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <Card className="p-4 text-sm text-muted">No other catalog items share this category yet.</Card>
        )}
      </div>
    </div>
  )
}
