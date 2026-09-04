/* -----------------------------------------------------------------------------
 * SupplierGate — stands in front of the supplier workspace.
 *
 * A seller must submit their shop details, contact info, trade licence number,
 * and both sides of their NID card, then be approved by an admin before they
 * can use the supplier tools. This gate loads the seller's application and
 * shows the right screen: the onboarding form (first time or after a
 * rejection), a "waiting for review" screen while pending, or the real
 * workspace once approved.
 * -------------------------------------------------------------------------- */

import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { Clock, CreditCard, IdCard, MessageSquare, RefreshCw, type LucideIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Brand } from "../../components/ui/Brand.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { formatDateTime } from "../workspace/format.ts";
import {
  applicationValidationError,
  loadSupplierVerification,
  resolveSupplierGate,
  submitSupplierApplication,
  uploadSupplierDocument,
  type SupplierVerification,
} from "./supplier-verification-api.ts";

type Feedback = { message: string; state: "info" | "success" | "error" } | null;

function readText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

type SupplierGateProps = {
  children: ReactNode;
  load?: (userId: string) => Promise<SupplierVerification | null>;
};

function GateFrame({
  children,
  email,
  onLogout,
}: {
  children: ReactNode;
  email?: string;
  onLogout?: () => void;
}) {
  return (
    <main className="min-h-svh bg-muted/40 px-4 py-8 sm:py-12">
      <Card className="mx-auto w-full max-w-2xl">
        <CardHeader>
          <Brand />
        </CardHeader>
        <CardContent className="flex flex-col gap-6">{children}</CardContent>
        {onLogout ? (
          <CardFooter className="flex items-center justify-between gap-4 border-t">
            <div className="flex min-w-0 flex-col">
              <span className="text-sm font-medium">Signed in</span>
              <span className="truncate text-sm text-muted-foreground">{email}</span>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={onLogout}>
              Log out
            </Button>
          </CardFooter>
        ) : null}
      </Card>
    </main>
  );
}

function StatusPanel({
  icon: StatusIcon,
  tone,
  title,
  children,
}: {
  icon: LucideIcon;
  tone: "pending" | "rejected";
  title: string;
  children: ReactNode;
}) {
  return (
    <Alert variant={tone === "rejected" ? "destructive" : "default"}>
      <StatusIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">{children}</AlertDescription>
    </Alert>
  );
}

function DocumentField({
  id,
  name,
  label,
  description,
  fileName,
  icon: Icon,
  accept,
  inputRef,
  onFileChange,
}: {
  id: string;
  name: string;
  label: string;
  description: string;
  fileName: string | null;
  icon: LucideIcon;
  accept: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onFileChange: (event: FormEvent<HTMLInputElement>) => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <label
        htmlFor={id}
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center"
      >
        <Icon aria-hidden="true" />
        <span className="font-medium">{fileName ?? `Upload ${label.toLowerCase()}`}</span>
        <span className="text-sm text-muted-foreground">{description}</span>
      </label>
      <input
        id={id}
        ref={inputRef}
        className="sr-only"
        type="file"
        name={name}
        accept={accept}
        onChange={onFileChange}
      />
    </Field>
  );
}

function OnboardingForm({
  userId,
  email,
  verification,
  onSubmitted,
}: {
  userId: string;
  email: string;
  verification: SupplierVerification | null;
  onSubmitted: () => void;
}) {
  const isResubmit = verification?.status === "rejected";
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fileNames, setFileNames] = useState<{
    nidFront: string | null;
    nidBack: string | null;
  }>({
    nidFront: null,
    nidBack: null,
  });
  const nidFrontRef = useRef<HTMLInputElement>(null);
  const nidBackRef = useRef<HTMLInputElement>(null);

  const onFileChange = (key: "nidFront" | "nidBack") => (event: FormEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    setFileNames((current) => ({ ...current, [key]: file?.name ?? null }));
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    const formData = new FormData(form);
    const input = {
      shopName: readText(formData, "shopName"),
      shopDetails: readText(formData, "shopDetails"),
      location: readText(formData, "location"),
      tradeLicenseNumber: readText(formData, "tradeLicenseNumber"),
      contactPhone: readText(formData, "contactPhone"),
    };
    const files = {
      nidFront: nidFrontRef.current?.files?.[0] ?? null,
      nidBack: nidBackRef.current?.files?.[0] ?? null,
    };
    const existing = {
      nidFront: Boolean(verification?.nid_front_path),
      nidBack: Boolean(verification?.nid_back_path),
    };

    const validationMessage = applicationValidationError(input, files, existing);
    if (validationMessage) {
      setFeedback({ message: validationMessage, state: "error" });
      return;
    }

    setSubmitting(true);
    try {
      setFeedback({ message: "Uploading your documents…", state: "info" });
      const [nidFrontPath, nidBackPath] = await Promise.all([
        files.nidFront
          ? uploadSupplierDocument(userId, files.nidFront, "nid-front")
          : Promise.resolve(verification?.nid_front_path ?? ""),
        files.nidBack
          ? uploadSupplierDocument(userId, files.nidBack, "nid-back")
          : Promise.resolve(verification?.nid_back_path ?? ""),
      ]);
      await submitSupplierApplication(userId, input, {
        nidFrontPath,
        nidBackPath,
      });
      onSubmitted();
    } catch (submitError) {
      setFeedback({
        message:
          submitError instanceof Error
            ? submitError.message
            : "Your application could not be submitted.",
        state: "error",
      });
      setSubmitting(false);
    }
  };

  const keepCurrentHint = (hasExisting: boolean, kind: string) =>
    isResubmit && hasExisting ? `Leave empty to keep your current ${kind}` : undefined;

  return (
    <>
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">Supplier verification</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {isResubmit ? "Update your application." : "Tell us about your shop."}
        </h1>
        <p className="text-muted-foreground">
          Add your shop details, contact info, trade licence number, and both sides of your NID
          card. Our team reviews every supplier before your storefront goes live.
        </p>
      </header>

      {isResubmit ? (
        <StatusPanel icon={MessageSquare} tone="rejected" title="Rejected">
          {verification?.review_note ? (
            <p>
              <strong>Reason:</strong> {verification.review_note}
            </p>
          ) : (
            <p>Please review your shop details and documents, then resubmit.</p>
          )}
        </StatusPanel>
      ) : null}

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Shop details</CardTitle>
            <CardDescription>Tell retailers who you are and where you trade from.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldSet>
              <FieldLegend className="sr-only">Shop details</FieldLegend>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="supplier-shop-name">Shop name</FieldLabel>
                  <Input
                    id="supplier-shop-name"
                    name="shopName"
                    type="text"
                    maxLength={120}
                    placeholder="e.g. Rahman Traders"
                    defaultValue={verification?.shop_name ?? ""}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="supplier-shop-details">Shop details</FieldLabel>
                  <Textarea
                    id="supplier-shop-details"
                    name="shopDetails"
                    rows={4}
                    maxLength={2000}
                    placeholder="What do you sell, who do you supply, how long have you traded?"
                    defaultValue={verification?.shop_details ?? ""}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="supplier-location">Location</FieldLabel>
                  <Input
                    id="supplier-location"
                    name="location"
                    type="text"
                    maxLength={200}
                    placeholder="Shop address or market, city"
                    defaultValue={verification?.location ?? ""}
                    required
                  />
                </Field>
              </FieldGroup>
            </FieldSet>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Contact info</CardTitle>
            <CardDescription>
              We use this to reach you about your application and orders.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldSet>
              <FieldLegend className="sr-only">Contact info</FieldLegend>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="supplier-contact-email">Email</FieldLabel>
                  <Input id="supplier-contact-email" type="email" value={email} readOnly />
                  <FieldDescription>This is the email you signed in with.</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="supplier-contact-phone">Phone</FieldLabel>
                  <Input
                    id="supplier-contact-phone"
                    name="contactPhone"
                    type="tel"
                    inputMode="tel"
                    maxLength={20}
                    placeholder="01XXXXXXXXX"
                    defaultValue={verification?.contact_phone ?? ""}
                    required
                  />
                  <FieldDescription>A mobile number we can reach you on.</FieldDescription>
                </Field>
              </FieldGroup>
            </FieldSet>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Identity documents</CardTitle>
            <CardDescription>
              Enter your trade licence number and attach both sides of your NID card.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldSet>
              <FieldLegend className="sr-only">Identity documents</FieldLegend>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="supplier-trade-license-number">
                    Trade licence number
                  </FieldLabel>
                  <Input
                    id="supplier-trade-license-number"
                    name="tradeLicenseNumber"
                    type="text"
                    maxLength={60}
                    placeholder="e.g. TRAD/DNCC/1234/2024"
                    defaultValue={verification?.trade_license_number ?? ""}
                    required
                  />
                </Field>
                <DocumentField
                  id="supplier-nid-front"
                  name="nidFront"
                  label="NID card front"
                  description={
                    keepCurrentHint(Boolean(verification?.nid_front_path), "photo") ??
                    "Photo of the front of your national ID, up to 5 MB"
                  }
                  fileName={fileNames.nidFront}
                  icon={IdCard}
                  accept="image/png,image/jpeg,image/webp"
                  inputRef={nidFrontRef}
                  onFileChange={onFileChange("nidFront")}
                />
                <DocumentField
                  id="supplier-nid-back"
                  name="nidBack"
                  label="NID card back"
                  description={
                    keepCurrentHint(Boolean(verification?.nid_back_path), "photo") ??
                    "Photo of the back of your national ID, up to 5 MB"
                  }
                  fileName={fileNames.nidBack}
                  icon={CreditCard}
                  accept="image/png,image/jpeg,image/webp"
                  inputRef={nidBackRef}
                  onFileChange={onFileChange("nidBack")}
                />
              </FieldGroup>
            </FieldSet>
          </CardContent>
          <CardFooter className="flex flex-col items-stretch gap-3">
            <div className="flex justify-end">
              <Button type="submit" disabled={submitting}>
                {isResubmit ? "Resubmit for review" : "Submit for review"}
              </Button>
            </div>
            <div role="status" aria-live="polite">
              {feedback ? (
                <Alert variant={feedback.state === "error" ? "destructive" : "default"}>
                  <AlertTitle>
                    {feedback.state === "error" ? "Application update" : "Application status"}
                  </AlertTitle>
                  <AlertDescription>{feedback.message}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          </CardFooter>
        </Card>
      </form>
    </>
  );
}

function PendingScreen({
  verification,
  onRefresh,
}: {
  verification: SupplierVerification;
  onRefresh: () => void;
}) {
  return (
    <>
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">Supplier verification</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Your application is under review.
        </h1>
        <p className="text-muted-foreground">
          Thanks, {verification.shop_name}. An admin is reviewing your shop details, contact info,
          trade licence number, and NID card. We&apos;ll unlock your supplier workspace as soon as
          you&apos;re approved.
        </p>
      </header>

      <StatusPanel icon={Clock} tone="pending" title="Waiting for admin approval">
        <p>Submitted {formatDateTime(verification.created_at)}.</p>
      </StatusPanel>

      <div className="flex justify-end">
        <Button type="button" variant="secondary" onClick={onRefresh}>
          <RefreshCw data-icon="inline-start" />
          Check status
        </Button>
      </div>
    </>
  );
}

function CenteredMessage({
  title,
  copy,
  loading = false,
}: {
  title: string;
  copy: string;
  loading?: boolean;
}) {
  return (
    <header className="flex flex-col gap-3">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
      <p className="text-muted-foreground">{copy}</p>
      {loading ? (
        <div className="flex flex-col gap-2" aria-hidden="true">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : null}
    </header>
  );
}

export function SupplierGate({ children, load = loadSupplierVerification }: SupplierGateProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const [verification, setVerification] = useState<SupplierVerification | null | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);

  const userId = state.status === "seller" ? state.session.user.id : null;

  useEffect(() => {
    if (!userId) return;
    let active = true;
    setError(null);
    setVerification(undefined);

    void load(userId)
      .then((next) => {
        if (active) setVerification(next);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Please try again.");
        }
      });

    return () => {
      active = false;
    };
  }, [userId, load, reloadVersion]);

  if (state.status !== "seller") return null;

  const sellerId = state.session.user.id;
  const onLogout = () => void store.signOut();
  const email = state.profile.email;
  const reload = () => setReloadVersion((version) => version + 1);

  if (error) {
    return (
      <GateFrame email={email} onLogout={onLogout}>
        <CenteredMessage title="We could not load your verification." copy={error} />
        <div className="flex justify-end">
          <Button type="button" onClick={reload}>
            Try again
          </Button>
        </div>
      </GateFrame>
    );
  }

  if (verification === undefined) {
    return (
      <GateFrame>
        <CenteredMessage title="Loading…" copy="Fetching your supplier application." loading />
      </GateFrame>
    );
  }

  const stage = resolveSupplierGate(verification);
  if (stage === "approved") return <>{children}</>;

  if (stage === "pending" && verification) {
    return (
      <GateFrame email={email} onLogout={onLogout}>
        <PendingScreen verification={verification} onRefresh={reload} />
      </GateFrame>
    );
  }

  return (
    <GateFrame email={email} onLogout={onLogout}>
      <OnboardingForm
        userId={sellerId}
        email={email}
        verification={verification}
        onSubmitted={reload}
      />
    </GateFrame>
  );
}
