/* -----------------------------------------------------------------------------
 * SupplierGate — stands in front of the supplier workspace.
 *
 * A seller must submit their shop details + trade licence and be approved by an
 * admin before they can use the supplier tools. This gate loads the seller's
 * application and shows the right screen: the onboarding form (first time or
 * after a rejection), a "waiting for review" screen while pending, or the real
 * workspace once approved.
 * -------------------------------------------------------------------------- */

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Brand } from "../../components/ui/Brand.tsx";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "../../components/ui/Icon.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { formatDateTime } from "../workspace/format.ts";
import {
  applicationValidationError,
  loadSupplierVerification,
  resolveSupplierGate,
  submitSupplierApplication,
  uploadTradeLicense,
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
    <div className="supplier-gate">
      <div className="supplier-gate-inner">
        <Brand />
        {children}
        {onLogout ? (
          <div className="supplier-gate-foot">
            <span className="supplier-gate-user">
              <strong>Signed in</strong>
              <small>{email}</small>
            </span>
            <Button variant="secondary" size="sm" onClick={onLogout}>
              Log out
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StatusPanel({
  icon,
  tone,
  title,
  children,
}: {
  icon: IconName;
  tone: "pending" | "rejected";
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={`supplier-gate-status is-${tone}`}>
      <span className="supplier-gate-status-icon">
        <Icon name={icon} />
      </span>
      <div>
        <strong>{title}</strong>
        {children}
      </div>
    </div>
  );
}

function OnboardingForm({
  userId,
  verification,
  onSubmitted,
}: {
  userId: string;
  verification: SupplierVerification | null;
  onSubmitted: () => void;
}) {
  const isResubmit = verification?.status === "rejected";
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onFileChange = (event: FormEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    setFileName(file?.name ?? null);
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
    };
    const file = fileInputRef.current?.files?.[0] ?? null;
    const hasExistingLicense = Boolean(verification?.trade_license_path);

    const validationMessage = applicationValidationError(input, file, hasExistingLicense);
    if (validationMessage) {
      setFeedback({ message: validationMessage, state: "error" });
      return;
    }

    setSubmitting(true);
    try {
      let licensePath = verification?.trade_license_path ?? "";
      if (file) {
        setFeedback({ message: "Uploading trade licence…", state: "info" });
        licensePath = await uploadTradeLicense(userId, file);
      }
      await submitSupplierApplication(userId, input, licensePath);
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

  return (
    <>
      <header className="supplier-gate-head">
        <p className="eyebrow">Supplier verification</p>
        <h1 className="display-lg">
          {isResubmit ? "Update your application." : "Tell us about your shop."}
        </h1>
        <p>
          Add your shop details and trade licence. Our team reviews every supplier before your
          storefront goes live.
        </p>
      </header>

      {isResubmit ? (
        <StatusPanel icon="message" tone="rejected" title="Rejected">
          {verification?.review_note ? (
            <p>
              <strong>Reason:</strong> {verification.review_note}
            </p>
          ) : (
            <p>Please review your shop details and trade licence, then resubmit.</p>
          )}
        </StatusPanel>
      ) : null}

      <form className="sp-form-card" onSubmit={onSubmit} noValidate>
        <div className="sp-form-grid">
          <label className="admin-field sp-field-full">
            <span>Shop name</span>
            <input
              name="shopName"
              type="text"
              maxLength={120}
              placeholder="e.g. Rahman Traders"
              defaultValue={verification?.shop_name ?? ""}
              required
            />
          </label>
          <label className="admin-field sp-field-full">
            <span>Shop details</span>
            <textarea
              name="shopDetails"
              rows={4}
              maxLength={2000}
              placeholder="What do you sell, who do you supply, how long have you traded?"
              defaultValue={verification?.shop_details ?? ""}
              required
            />
          </label>
          <label className="admin-field sp-field-full">
            <span>Location</span>
            <input
              name="location"
              type="text"
              maxLength={200}
              placeholder="Shop address or market, city"
              defaultValue={verification?.location ?? ""}
              required
            />
          </label>
          <div className="sp-image-picker admin-field sp-field-full">
            <span>Trade licence</span>
            <label className="sp-image-drop supplier-license-drop">
              <Icon name="shield-check" />
              <strong>{fileName ?? "Upload your trade licence"}</strong>
              <small>
                {isResubmit && verification?.trade_license_path
                  ? "PDF or image up to 5 MB — leave empty to keep your current file"
                  : "PDF or image (PNG, JPG, WebP), up to 5 MB"}
              </small>
              <input
                ref={fileInputRef}
                className="sr-only"
                type="file"
                name="tradeLicense"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                onChange={onFileChange}
              />
            </label>
          </div>
        </div>
        <div className="sp-form-actions">
          <Button type="submit" disabled={submitting}>
            <span>{isResubmit ? "Resubmit for review" : "Submit for review"}</span>
          </Button>
        </div>
        <p
          className={`admin-form-feedback${feedback ? ` is-visible is-${feedback.state}` : ""}`}
          role="status"
          aria-live="polite"
        >
          {feedback?.message}
        </p>
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
      <header className="supplier-gate-head">
        <p className="eyebrow">Supplier verification</p>
        <h1 className="display-lg">Your application is under review.</h1>
        <p>
          Thanks, {verification.shop_name}. An admin is reviewing your shop details and trade
          licence. We&apos;ll unlock your supplier workspace as soon as you&apos;re approved.
        </p>
      </header>

      <StatusPanel icon="clock" tone="pending" title="Waiting for admin approval">
        <p>Submitted {formatDateTime(verification.created_at)}.</p>
      </StatusPanel>

      <div className="sp-form-actions">
        <Button variant="secondary" onClick={onRefresh}>
          <Icon name="refresh" />
          <span>Check status</span>
        </Button>
      </div>
    </>
  );
}

function CenteredMessage({ title, copy }: { title: string; copy: string }) {
  return (
    <header className="supplier-gate-head">
      <h1 className="display-lg">{title}</h1>
      <p>{copy}</p>
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
        <div className="sp-form-actions">
          <Button onClick={reload}>Try again</Button>
        </div>
      </GateFrame>
    );
  }

  if (verification === undefined) {
    return (
      <GateFrame>
        <CenteredMessage title="Loading…" copy="Fetching your supplier application." />
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
      <OnboardingForm userId={sellerId} verification={verification} onSubmitted={reload} />
    </GateFrame>
  );
}
