import { createContext, useContext } from 'react'

export type CartItem = {
  productId: string
  name: string
  price: number
  unit: string
  moq: number
  stock?: number
  imageUrl?: string
  supplierId: string
  quantity: number
}

export type CartState = {
  items: CartItem[]
  add: (item: Omit<CartItem, 'quantity'>, qty?: number) => void
  setQty: (productId: string, quantity: number) => void
  remove: (productId: string) => void
  clear: () => void
  count: number
  subtotal: number
}

export const CartContext = createContext<CartState | null>(null)

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart outside provider')
  return ctx
}
