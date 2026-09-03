import { Brand } from "../ui/Brand.tsx";
import { Button } from "@/components/ui/button";
import type { AuthFeedback } from "./types.ts";

export type AccountRole = "retailer" | "seller";

export type RoleChooserProps = {
  feedback?: AuthFeedback | null;
  onSelectRole: (role: AccountRole) => void | Promise<void>;
  pending?: boolean;
};

export function RoleChooser({ feedback = null, onSelectRole, pending = false }: RoleChooserProps) {
  const feedbackClassName = feedback
    ? `form-feedback is-visible is-${feedback.state ?? "info"}`
    : "form-feedback";

  return (
    <div className="plain-screen">
      <Brand />
      <p className="eyebrow">Account type</p>
      <h1 className="display-xl plain-title">Choose your account type</h1>
      <p className="plain-copy">
        Tell us how you&apos;ll use SoukCart so we can set up the right workspace for you.
      </p>
      <div className="role-options">
        <Button
          type="button"
          data-role="seller"
          disabled={pending}
          onClick={() => void onSelectRole("seller")}
        >
          <span>I&apos;m a seller</span>
        </Button>
        <Button
          variant="ghost"
          type="button"
          data-role="retailer"
          disabled={pending}
          onClick={() => void onSelectRole("retailer")}
        >
          <span>I&apos;m a retailer</span>
        </Button>
      </div>
      <p className={feedbackClassName} data-form-feedback role="status" aria-live="polite">
        {feedback?.message}
      </p>
    </div>
  );
}
