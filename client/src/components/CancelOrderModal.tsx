import { useState } from 'react'
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
  onCancel: (reason: string) => void
  onClose: () => void
}) {
  const [reason, setReason] = useState('')

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
          Let the other party know why you're cancelling. The message is shown to the supplier, retailer, and admin.
        </p>

        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={busy}
          placeholder="Write a cancellation message (optional)"
          rows={4}
          autoFocus
          className="mt-3 w-full rounded-lg border border-border bg-[#f7f8f8] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
        />

        <div className="mt-5 flex gap-2 justify-end">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Back</Button>
          <Button variant="danger" disabled={busy} onClick={() => onCancel(reason)}>
            {busy ? 'Cancelling…' : 'Cancel order'}
          </Button>
        </div>
      </div>
    </div>
  )
}