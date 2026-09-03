import { Brand } from "@/components/ui/Brand";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  const feedbackClassName =
    feedback?.state === "error"
      ? "text-center text-sm font-medium text-destructive"
      : "text-center text-sm text-muted-foreground";

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 px-4 py-10">
      <div className="flex w-full max-w-lg flex-col gap-6">
        <Brand className="self-center" />
        <Card>
          <CardHeader className="text-center">
            <p className="text-sm font-medium text-primary">Signed in</p>
            <CardTitle>
              <h1 className="text-balance text-3xl font-semibold tracking-tight">
                You&apos;re signed in.
              </h1>
            </CardTitle>
            <CardDescription>Welcome to SoukCart. Your workspace is ready.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              className="w-full"
              type="button"
              data-logout=""
              disabled={pending}
              onClick={() => void onLogout()}
            >
              <span>Log out</span>
            </Button>
          </CardContent>
          {feedback ? (
            <CardFooter className="justify-center">
              <p className={feedbackClassName} data-form-feedback role="status" aria-live="polite">
                {feedback.message}
              </p>
            </CardFooter>
          ) : null}
        </Card>
      </div>
    </main>
  );
}
