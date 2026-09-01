import { useState } from "react";
import { Icon, type IconName } from "../ui/Icon.tsx";

export type FieldType = "email" | "password" | "text";

export type FieldProps = {
  autoComplete: string;
  id: string;
  icon: IconName;
  label: string;
  name: string;
  placeholder: string;
  type: FieldType;
};

export function Field({ autoComplete, id, icon, label, name, placeholder, type }: FieldProps) {
  const isPassword = type === "password";
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const inputType = isPassword && isPasswordVisible ? "text" : type;

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="input-shell">
        <span className="input-icon">
          <Icon name={icon} />
        </span>
        <input
          id={id}
          name={name}
          type={inputType}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required
        />
        {isPassword ? (
          <button
            className="input-action"
            type="button"
            data-password-toggle=""
            aria-controls={id}
            aria-label={`${isPasswordVisible ? "Hide" : "Show"} ${label.toLowerCase()}`}
            aria-pressed={isPasswordVisible}
            onClick={() => setIsPasswordVisible((visible) => !visible)}
          >
            <Icon name={isPasswordVisible ? "eye" : "eye-off"} className="input-action-icon" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
