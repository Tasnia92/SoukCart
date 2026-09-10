import { Button } from './ui'
import { X } from 'lucide-react'

export function CancelOrderModal({
  open,
  orderNumber,
  busy,
  onCancel,
  onClose,
}: {
  open: boolean
  orderNumber: string
  busy: boolean
  onCancel: () => void
  onClose: () => void
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl p-6" role="dialog" aria-modal="true" aria-labelledby="cancel-modal-title">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 id="cancel-modal-title" className="text-lg font-semibold">Cancel order</h3>
            <p className="text-sm text-muted mt-1">Order {orderNumber}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="p-1 text-muted hover:text-foreground disabled:opacity-50"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <p className="text-sm mt-4 text-foreground">
          Are you sure you want to cancel this order? Any prepaid amount will be refunded by admin. This cannot be undone.
        </p>

        <div className="mt-5 flex gap-2 justify-end">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Back</Button>
          <Button variant="danger" disabled={busy} onClick={() => onCancel()}>
            {busy ? 'Cancelling…' : 'Cancel order'}
          </Button>
        </div>
      </div>
    </div>
  )
}
