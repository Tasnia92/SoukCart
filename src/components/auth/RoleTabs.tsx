import { Icon, type IconName } from "../ui/Icon.tsx";
import type { AuthRole } from "./types.ts";

type RoleTab = {
  role: AuthRole;
  label: string;
  hint: string;
  icon: IconName;
};

const ROLE_TABS: readonly RoleTab[] = [
  { role: "retailer", label: "Retailer", hint: "Buy for my shop", icon: "store" },
  { role: "seller", label: "Supplier", hint: "Sell on SoukCart", icon: "package" },
] as const;

export type RoleTabsProps = {
  value: AuthRole;
  onChange?: (role: AuthRole) => void;
  disabled?: boolean;
};

/**
 * Segmented control that switches the auth screen between the retailer and
 * supplier paths. Built on the SoukCart design system (flat, sharp geometry)
 * rather than a raw radio group so it reads as a pair of tabs.
 */
export function RoleTabs({ value, onChange, disabled = false }: RoleTabsProps) {
  return (
    <div className="role-tabs" role="tablist" aria-label="Choose account type" data-role-tabs>
      {ROLE_TABS.map((tab) => {
        const selected = tab.role === value;
        return (
          <button
            key={tab.role}
            type="button"
            role="tab"
            className="role-tab"
            data-role-tab={tab.role}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange?.(tab.role)}
          >
            <span className="role-tab-icon">
              <Icon name={tab.icon} />
            </span>
            <span className="role-tab-text">
              <span className="role-tab-label">{tab.label}</span>
              <span className="role-tab-hint">{tab.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
