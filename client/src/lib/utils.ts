import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Reads `--sidebar` from index.css (`left` | `right`) and mirrors it onto `<html data-sidebar>`. */
export type SidebarSide = 'left' | 'right'

export function applySidebarSide(): SidebarSide {
  if (typeof document === 'undefined') return 'left'
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--sidebar').trim().toLowerCase()
  const side: SidebarSide = raw === 'right' ? 'right' : 'left'
  document.documentElement.dataset.sidebar = side
  return side
}

export function money(n: number) {
  return `Tk ${Number(n || 0).toLocaleString('en-BD')}`
}

export function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export const STATUS_LABEL: Record<string, string> = {
  awaiting_payment: 'Awaiting payment',
  placed: 'Pending confirm',
  supplier_approved: 'Pending confirm',
  supplier_confirmed: 'Confirmed',
  delivery_initiated: 'Delivery initiated',
  shipped: 'Shipped',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  supplier_cancelled: 'Cancelled',
  refunded: 'Refunded',
}

export function statusLabel(status: string) {
  return STATUS_LABEL[status] || status
}

export function canCancelStatus(status: string) {
  return ['awaiting_payment', 'placed', 'supplier_approved', 'supplier_confirmed'].includes(status)
}

export function needsPaymentRetry(o: { status?: string; deliveryFeePaid?: boolean; paymentStatus?: string }) {
  if (o.deliveryFeePaid) return false
  return o.status === 'awaiting_payment' || o.paymentStatus === 'failed' || o.paymentStatus === 'unpaid'
}
