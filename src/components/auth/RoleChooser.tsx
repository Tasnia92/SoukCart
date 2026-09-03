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

export type AccountRole = "retailer" | "seller";

export type RoleChooserProps = {
  feedback?: AuthFeedback | null;
  onSelectRole: (role: AccountRole) => void | Promise<void>;
  pending?: boolean;
};

export function RoleChooser({ feedback = null, onSelectRole, pending = false }: RoleChooserProps) {
  const feedbackClassName =
    feedback?.state === "error"
      ? "min-h-5 text-center text-sm font-medium text-destructive"
      : "min-h-5 text-center text-sm text-muted-foreground";

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 px-4 py-10">
      <div className="flex w-full max-w-lg flex-col gap-6">
        <Brand className="self-center" />
        <Card>
          <CardHeader className="text-center">
            <p className="text-sm font-medium text-primary">Account type</p>
            <CardTitle>
              <h1 className="text-balance text-3xl font-semibold tracking-tight">
                Choose your account type
              </h1>
            </CardTitle>
            <CardDescription>
              Tell us how you&apos;ll use SoukCart so we can set up the right workspace for you.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row">
            <Button
              className="w-full"
              type="button"
              data-role="seller"
              disabled={pending}
              onClick={() => void onSelectRole("seller")}
            >
              <span>I&apos;m a seller</span>
            </Button>
            <Button
              className="w-full"
              variant="ghost"
              type="button"
              data-role="retailer"
              disabled={pending}
              onClick={() => void onSelectRole("retailer")}
            >
              <span>I&apos;m a retailer</span>
            </Button>
          </CardContent>
          <CardFooter className="justify-center">
            <p className={feedbackClassName} data-form-feedback role="status" aria-live="polite">
              {feedback?.message}
            </p>
          </CardFooter>
        </Card>
      </div>
    </main>
  );
}
