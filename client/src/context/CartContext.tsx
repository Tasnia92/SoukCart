import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

export type CartItem = {
  productId: string
  name: string
  price: number
  unit: string
  moq: number
  imageUrl?: string
  supplierId: string
  quantity: number
}

type CartState = {
  items: CartItem[]
  add: (item: Omit<CartItem, 'quantity'>, qty?: number) => void
  setQty: (productId: string, quantity: number) => void
  remove: (productId: string) => void
  clear: () => void
  count: number
  subtotal: number
}

const CartContext = createContext<CartState | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('nekcart_cart') || '[]') as CartItem[]
    } catch {
      return []
    }
  })

  const persist = (next: CartItem[]) => {
    setItems(next)
    localStorage.setItem('nekcart_cart', JSON.stringify(next))
  }

  const value = useMemo<CartState>(() => ({
    items,
    add(item, qty) {
      const q = qty ?? item.moq
      const existing = items.find((i) => i.productId === item.productId)
      if (existing) {
        persist(items.map((i) => (i.productId === item.productId ? { ...i, quantity: i.quantity + q } : i)))
      } else {
        persist([...items, { ...item, quantity: q }])
      }
    },
    setQty(productId, quantity) {
      persist(items.map((i) => (i.productId === productId ? { ...i, quantity: Math.max(i.moq, quantity) } : i)))
    },
    remove(productId) {
      persist(items.filter((i) => i.productId !== productId))
    },
    clear() {
      persist([])
    },
    count: items.length,
    subtotal: items.reduce((s, i) => s + i.price * i.quantity, 0),
  }), [items])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart outside provider')
  return ctx
}
