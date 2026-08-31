import type { IconName } from "./Icon.ts";
import { renderIcon } from "./Icon.ts";

export type FieldConfig = {
  autocomplete: string;
  id: string;
  icon: IconName;
  label: string;
  name: string;
  placeholder: string;
  type: "email" | "password" | "text";
};

export function renderField(config: FieldConfig): string {
  const passwordToggle =
    config.type === "password"
      ? `<button class="input-action" type="button" data-password-toggle aria-controls="${config.id}" aria-label="Show ${config.label.toLowerCase()}" aria-pressed="false">
          ${renderIcon("eye-off", "input-action-icon")}
        </button>`
      : "";

  return `<div class="field">
    <label class="field-label" for="${config.id}">${config.label}</label>
    <div class="input-shell">
      <span class="input-icon">${renderIcon(config.icon)}</span>
      <input id="${config.id}" name="${config.name}" type="${config.type}" placeholder="${config.placeholder}" autocomplete="${config.autocomplete}" required />
      ${passwordToggle}
    </div>
  </div>`;
}
