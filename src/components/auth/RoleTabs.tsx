import { PackageIcon, StoreIcon, type LucideIcon } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
    <Tabs
      className="w-full"
      value={value}
      onValueChange={(nextValue) => onChange?.(nextValue as AuthRole)}
    >
      <TabsList
        className="grid h-auto w-full grid-cols-2"
        aria-label="Choose account type"
        data-role-tabs="true"
      >
        {ROLE_TABS.map((tab) => {
          const TabIcon = tab.icon;
          return (
            <TabsTrigger
              key={tab.role}
              className="h-auto min-w-0 justify-start rounded-2xl px-3 py-3 text-left whitespace-normal sm:px-4"
              type="button"
              value={tab.role}
              data-role-tab={tab.role}
              disabled={disabled}
              onClick={tab.role === value ? () => onChange?.(tab.role) : undefined}
            >
              <TabIcon data-icon="inline-start" aria-hidden="true" />
              <span className="flex min-w-0 flex-col items-start gap-0.5">
                <span>{tab.label}</span>
                <span className="text-xs font-normal text-muted-foreground">{tab.hint}</span>
              </span>
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}
