import { Brand } from "../ui/Brand.tsx";
import { Button } from "../ui/Button.tsx";
import type { AuthFeedback } from "./types.ts";

export type SignedInFallbackProps = {
  feedback?: AuthFeedback | null;
  onLogout: () => void | Promise<void>;
  pending?: boolean;
};

export function SignedInFallback({
  feedback = null,
  onLogout,
  pending = false,
}: SignedInFallbackProps) {
  const feedbackClassName = `form-feedback is-visible is-${feedback?.state ?? "info"}`;

  return (
    <div className="plain-screen">
      <Brand />
      <p className="eyebrow">Signed in</p>
      <h1 className="display-xl plain-title">You&apos;re signed in.</h1>
      <p className="plain-copy">Welcome to SoukCart. Your workspace is ready.</p>
      <Button
        className="done-button"
        type="button"
        data-logout=""
        disabled={pending}
        onClick={() => void onLogout()}
      >
        <span>Log out</span>
      </Button>
      {feedback ? (
        <p className={feedbackClassName} data-form-feedback role="status" aria-live="polite">
          {feedback.message}
        </p>
      ) : null}
    </div>
  );
}
