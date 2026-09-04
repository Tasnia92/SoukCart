import { PackageIcon, StoreIcon, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AuthRole } from "./types.ts";

type RoleTab = {
  role: AuthRole;
  label: string;
  hint: string;
  icon: LucideIcon;
};

const ROLE_TABS: readonly RoleTab[] = [
  { role: "retailer", label: "Retailer", hint: "Buy for my shop", icon: StoreIcon },
  { role: "seller", label: "Supplier", hint: "Sell on SoukCart", icon: PackageIcon },
] as const;

export type RoleTabsProps = {
  value: AuthRole;
  onChange?: (role: AuthRole) => void;
  disabled?: boolean;
};

export function RoleTabs({ value, onChange, disabled = false }: RoleTabsProps) {
  return (
    <div
      className="grid w-full grid-cols-2 gap-1 rounded-2xl bg-muted p-1"
      role="tablist"
      aria-label="Choose account type"
      data-role-tabs="true"
    >
      {ROLE_TABS.map((tab) => {
        const TabIcon = tab.icon;
        const selected = tab.role === value;
        return (
          <button
            key={tab.role}
            type="button"
            role="tab"
            aria-selected={selected}
            data-role-tab={tab.role}
            data-state={selected ? "active" : "inactive"}
            disabled={disabled}
            className={cn(
              "flex min-h-14 min-w-0 items-start gap-2 rounded-xl px-3 py-2.5 text-left transition-colors",
              "focus-visible:border-ring focus-visible:outline-1 focus-visible:outline-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
              "disabled:pointer-events-none disabled:opacity-50",
              selected
                ? "bg-background text-foreground shadow-sm"
                : "text-foreground/70 hover:text-foreground",
            )}
            onClick={() => onChange?.(tab.role)}
          >
            <TabIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span className="flex min-w-0 flex-col gap-0.5 leading-tight">
              <span className="text-sm font-medium">{tab.label}</span>
              <span className="text-xs font-normal text-muted-foreground">{tab.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
