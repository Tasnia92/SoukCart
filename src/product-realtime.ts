import { useEffect, useRef } from "react";
import { supabase } from "./supabase.ts";

type ProductChangesOptions = {
  enabled: boolean;
  sellerId?: string;
  onChange: () => void;
};

export function useProductChanges({ enabled, sellerId, onChange }: ProductChangesOptions): void {
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!enabled) return;

    const filter = sellerId ? { filter: `seller_id=eq.${sellerId}` } : {};
    const channel = supabase
      .channel(`product-changes:${sellerId ?? "catalog"}:${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "products", ...filter }, () =>
        onChangeRef.current(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, sellerId]);
}
