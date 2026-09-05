import { useEffect, useRef } from "react";
import { supabase } from "../../supabase.ts";

type OrderChangesOptions = {
  enabled: boolean;
  retailerId?: string;
  onChange: () => void;
  /**
   * Milliseconds to wait for further changes before invalidating. A fulfillment
   * update can touch the order and its shipments together, so the Orders page
   * coalesces them into one refresh.
   */
  coalesceMs?: number;
};

/**
 * Live order + shipment updates for the retailer session, following the same
 * pattern as `useProductChanges`. Both tables are in the `supabase_realtime`
 * publication and readable under RLS, so postgres_changes delivers only the
 * rows this retailer may see.
 */
export function useRetailerOrderChanges({
  enabled,
  retailerId,
  onChange,
  coalesceMs = 500,
}: OrderChangesOptions): void {
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!enabled || !retailerId) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const invalidate = () => {
      if (coalesceMs <= 0) {
        onChangeRef.current();
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        onChangeRef.current();
      }, coalesceMs);
    };

    const channel = supabase
      .channel(`retailer-orders:${retailerId}:${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `retailer_id=eq.${retailerId}` },
        invalidate,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_shipments" },
        invalidate,
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [coalesceMs, enabled, retailerId]);
}
