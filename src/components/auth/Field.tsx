import { useState } from "react";
import { EyeIcon, EyeOffIcon, type LucideIcon } from "lucide-react";
import { Field as UIField, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";

export type FieldType = "email" | "password" | "text";

export type FieldProps = {
  autoComplete: string;
  id: string;
  icon: LucideIcon;
  label: string;
  name: string;
  placeholder: string;
  type: FieldType;
};

export function Field({
  autoComplete,
  id,
  icon: LeadingIcon,
  label,
  name,
  placeholder,
  type,
}: FieldProps) {
  const isPassword = type === "password";
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const inputType = isPassword && isPasswordVisible ? "text" : type;
  const PasswordVisibilityIcon = isPasswordVisible ? EyeIcon : EyeOffIcon;

  return (
    <UIField>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <InputGroup>
        <InputGroupInput
          id={id}
          name={name}
          type={inputType}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required
        />
        <InputGroupAddon align="inline-start">
          <LeadingIcon aria-hidden="true" />
        </InputGroupAddon>
        {isPassword ? (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              type="button"
              data-password-toggle=""
              aria-controls={id}
              aria-label={`${isPasswordVisible ? "Hide" : "Show"} ${label.toLowerCase()}`}
              aria-pressed={isPasswordVisible}
              onClick={() => setIsPasswordVisible((visible) => !visible)}
            >
              <PasswordVisibilityIcon aria-hidden="true" />
            </InputGroupButton>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
    </UIField>
  );
}
