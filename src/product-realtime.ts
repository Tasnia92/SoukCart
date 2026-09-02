import { useEffect, useRef } from "react";
import { supabase } from "./supabase.ts";

type ProductChangesOptions = {
  enabled: boolean;
  sellerId?: string;
  onChange: () => void;
  /**
   * Milliseconds to wait for further changes before invalidating. A stock edit can
   * fire several row events in a row, and the supplier dashboard reloads orders and
   * products together, so it opts into coalescing them into one refresh.
   * Omit (or pass 0) to invalidate on every event, which is the original behavior.
   */
  coalesceMs?: number;
};

export function useProductChanges({
  enabled,
  sellerId,
  onChange,
  coalesceMs = 0,
}: ProductChangesOptions): void {
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!enabled) return;

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

    const filter = sellerId ? { filter: `seller_id=eq.${sellerId}` } : {};
    const channel = supabase
      .channel(`product-changes:${sellerId ?? "catalog"}:${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "products", ...filter },
        invalidate,
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [coalesceMs, enabled, sellerId]);
}
