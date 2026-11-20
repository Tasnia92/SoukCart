import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { CartContext, type CartItem, type CartState } from '@/context/cart'

const STORAGE_KEY = 'soukcart_cart'
const STORAGE_VERSION = 1

function loadCart(): CartItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as unknown
    // v0 stored a bare array; v1 wraps it so future shape changes can be detected.
    if (Array.isArray(raw)) return raw as CartItem[]
    if (raw && typeof raw === 'object' && (raw as { v?: number }).v === STORAGE_VERSION) {
      const items = (raw as { items?: unknown }).items
      return Array.isArray(items) ? (items as CartItem[]) : []
    }
  } catch {
    /* corrupt storage: start empty */
  }
  return []
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(loadCart)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: STORAGE_VERSION, items }))
    } catch {
      /* storage full or unavailable */
    }
  }, [items])

  // Functional updates so back-to-back calls never work from a stale `items`,
  // and the actions keep a stable identity across renders.
  const actions = useMemo(() => ({
    add(item: Omit<CartItem, 'quantity'>, qty?: number) {
      const q = qty ?? item.moq
      setItems((prev) => {
        const existing = prev.find((i) => i.productId === item.productId)
        if (existing) {
          const combined = Math.max(existing.moq, existing.quantity + q)
          const next = item.stock != null ? Math.min(combined, item.stock) : combined
          return prev.map((i) => (i.productId === item.productId ? { ...i, stock: item.stock, quantity: next } : i))
        }
        const capped = item.stock != null ? Math.min(q, item.stock) : q
        return [...prev, { ...item, quantity: Math.max(item.moq, capped) }]
      })
    },
    setQty(productId: string, quantity: number) {
      setItems((prev) =>
        prev.map((i) => {
          if (i.productId !== productId) return i
          let next = Math.max(i.moq, quantity)
          if (i.stock != null) next = Math.min(next, i.stock)
          return { ...i, quantity: next }
        }),
      )
    },
    remove(productId: string) {
      setItems((prev) => prev.filter((i) => i.productId !== productId))
    },
    clear() {
      setItems([])
    },
  }), [])

  const value = useMemo<CartState>(() => ({
    items,
    ...actions,
    count: items.length,
    subtotal: items.reduce((s, i) => s + i.price * i.quantity, 0),
  }), [items, actions])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}
