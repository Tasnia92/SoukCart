import { useEffect, useRef } from "react";
import { supabase } from "./supabase.ts";

type TableChangesOptions = {
  enabled: boolean;
  tables: readonly string[];
  onChange: () => void;
  /**
   * Milliseconds to wait for further changes before invalidating. Order and
   * complaint updates often arrive as a burst of row events.
   */
  coalesceMs?: number;
};

/** Subscribes to Postgres changes on one or more public tables. */
export function useTableChanges({
  enabled,
  tables,
  onChange,
  coalesceMs = 1500,
}: TableChangesOptions): void {
  const onChangeRef = useRef(onChange);
  const tablesKey = tables.join(",");

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!enabled || tables.length === 0) return;

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

    let channel = supabase.channel(`table-changes:${tablesKey}:${crypto.randomUUID()}`);
    for (const table of tables) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, invalidate);
    }
    channel.subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [coalesceMs, enabled, tables, tablesKey]);
}
