import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, Card } from '@/components/ui'
import { useCart } from '@/context/CartContext'
import { api } from '@/services/api'
import { money, cn } from '@/lib/utils'

type Product = {
  _id: string
  name: string
  description: string
  price: number
  unit: string
  stock: number
  moq: number
  imageUrl: string
  category?: { _id: string; name: string }
  supplier: { _id: string; name: string; businessName?: string }
}

export function RetailerProducts() {
  const [products, setProducts] = useState<Product[]>([])
  const [sort, setSort] = useState('name')
  const [category, setCategory] = useState('all')
  const [qty, setQty] = useState<Record<string, number>>({})
  const [params] = useSearchParams()
  const q = (params.get('q') || '').trim().toLowerCase()
  const { add } = useCart()

  useEffect(() => {
    void api.get<{ products: Product[] }>('/products?scope=catalog').then((d) => {
      setProducts(d.products)
      const initial: Record<string, number> = {}
      for (const p of d.products) initial[p._id] = p.moq || 1
      setQty(initial)
    })
  }, [])

  const categories = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of products) {
      const name = p.category?.name || 'Uncategorized'
      map.set(name, (map.get(name) || 0) + 1)
    }
    return [...map.entries()]
  }, [products])

  const filtered = useMemo(() => {
    let list = [...products]
    if (category !== 'all') list = list.filter((p) => (p.category?.name || 'Uncategorized') === category)
    if (q) {
      list = list.filter((p) =>
        p.name.toLowerCase().includes(q)
        || (p.supplier?.businessName || p.supplier?.name || '').toLowerCase().includes(q)
        || (p.category?.name || '').toLowerCase().includes(q),
      )
    }
    if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name))
    if (sort === 'price-asc') list.sort((a, b) => a.price - b.price)
    if (sort === 'price-desc') list.sort((a, b) => b.price - a.price)
    return list
  }, [products, category, sort, q])

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="text-sm text-muted">{filtered.length} of {products.length} products{q ? ` matching “${q}”` : ''}</div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="h-9 rounded-lg border border-border bg-white px-3 text-sm"
        >
          <option value="name">Name A–Z</option>
          <option value="price-asc">Price low–high</option>
          <option value="price-desc">Price high–low</option>
        </select>
      </div>
      <div className="flex flex-wrap gap-2 mb-5">
        <button
          onClick={() => setCategory('all')}
          className={cn(
            'rounded-full px-3 py-1.5 text-sm border',
            category === 'all' ? 'bg-[#242526] text-white border-[#242526]' : 'bg-[#f3f4f6] border-transparent text-foreground',
          )}
        >
          All ({products.length})
        </button>
        {categories.map(([name, count]) => (
          <button
            key={name}
            onClick={() => setCategory(name)}
            className={cn(
              'rounded-full px-3 py-1.5 text-sm border',
              category === name ? 'bg-[#242526] text-white border-[#242526]' : 'bg-[#f3f4f6] border-transparent text-foreground',
            )}
          >
            {name} ({count})
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {filtered.map((p) => (
          <Card key={p._id} className="overflow-hidden flex flex-col rounded-[12px]">
            <Link to={`/retailer/products/${p._id}`} className="block aspect-[4/3] bg-canvas overflow-hidden">
              <img src={p.imageUrl || 'https://placehold.co/400x240'} alt={p.name} loading="lazy" className="h-full w-full object-contain" />
            </Link>
            <div className="p-3 flex flex-col gap-1.5 flex-1">
              <Link to={`/retailer/products/${p._id}`} className="font-semibold text-sm hover:text-primary line-clamp-1">{p.name}</Link>
              <p className="text-xs text-muted line-clamp-1">{p.supplier?.businessName || p.supplier?.name}</p>
              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <span className="font-semibold text-sm tabular-nums">{money(p.price)}</span>
                  <span className="text-xs text-muted"> per {p.unit}</span>
                </div>
                <span className="text-xs text-muted">{p.stock} in stock</span>
              </div>
              <p className="text-xs text-muted line-clamp-2 min-h-[2rem]">{p.description}</p>
              <div className="mt-auto pt-2 flex items-center gap-2">
                <div className="inline-flex items-center rounded-full border border-border">
                  <button
                    className="h-8 w-8 text-sm"
                    onClick={() => setQty((q) => ({ ...q, [p._id]: Math.max(p.moq, (q[p._id] || p.moq) - 1) }))}
                  >
                    −
                  </button>
                  <span className="w-7 text-center text-xs font-medium">{qty[p._id] || p.moq}</span>
                  <button
                    className="h-8 w-8 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                    disabled={qty[p._id] >= p.stock}
                    onClick={() => setQty((q) => ({ ...q, [p._id]: Math.min(p.stock, (q[p._id] || p.moq) + 1) }))}
                  >
                    +
                  </button>
                </div>
                <Button
                  className="flex-1 h-8 text-xs"
                  disabled={p.stock < p.moq}
                  onClick={() =>
                    add(
                      {
                        productId: p._id,
                        name: p.name,
                        price: p.price,
                        unit: p.unit,
                        moq: p.moq,
                        stock: p.stock,
                        imageUrl: p.imageUrl,
                        supplierId: p.supplier._id,
                      },
                      qty[p._id] || p.moq,
                    )
                  }
                >
                  {p.stock < p.moq ? 'Out of stock' : 'Add'}
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
