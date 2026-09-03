import { useState } from "react";
import { Field as UIField, FieldLabel } from "../ui/field.tsx";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "../ui/input-group.tsx";
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
    <UIField>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <InputGroup>
        <InputGroupAddon>
          <Icon name={icon} />
        </InputGroupAddon>
        <InputGroupInput
          id={id}
          name={name}
          type={inputType}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required
        />
        {isPassword ? (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              data-password-toggle=""
              aria-controls={id}
              aria-label={`${isPasswordVisible ? "Hide" : "Show"} ${label.toLowerCase()}`}
              aria-pressed={isPasswordVisible}
              onClick={() => setIsPasswordVisible((visible) => !visible)}
            >
              <Icon name={isPasswordVisible ? "eye" : "eye-off"} className="input-action-icon" />
            </InputGroupButton>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
    </UIField>
  );
}
