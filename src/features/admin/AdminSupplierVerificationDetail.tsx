import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "../../components/ui/Icon.tsx";
import {
  InlineNotice,
  LoadingState,
  PageHeader,
  WorkspaceError,
  type NoticeState,
} from "../../components/ui/Workspace.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { formatDateTime, initials } from "../workspace/format.ts";
import { RouterLink, WorkspaceShell } from "../workspace/WorkspaceShell.tsx";
import {
  approveSupplier,
  loadSupplierVerifications,
  rejectSupplier,
  tradeLicenseKind,
  type AdminSupplierVerification,
} from "./admin-supplier-verifications-api.ts";
import { ADMIN_NAV_ITEMS } from "./admin-nav.ts";

type AdminSupplierVerificationDetailProps = {
  userId: string;
  loadVerifications?: () => Promise<AdminSupplierVerification[]>;
  approve?: (userId: string) => Promise<void>;
  reject?: (userId: string, note: string) => Promise<void>;
};

type Notice = { message: string; state: NoticeState } | null;

const STATUS_LABELS: Record<AdminSupplierVerification["status"], string> = {
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
};

function LicencePreview({ verification }: { verification: AdminSupplierVerification }) {
  const url = verification.trade_license_url;
  const kind = tradeLicenseKind(url);

  if (!url) {
    return (
      <div className="sv-licence-empty">
        <Icon name="image" />
        <strong>Trade licence unavailable</strong>
        <span>The uploaded file could not be loaded. Ask the supplier to resubmit.</span>
      </div>
    );
  }

  return (
    <figure className="sv-licence">
      <figcaption>
        <span>Trade licence</span>
        <Button asChild variant="link" className="h-auto p-0">
          <a href={url} target="_blank" rel="noopener noreferrer">
            <Icon name="arrow-up-right" />
            <span>Open original</span>
          </a>
        </Button>
      </figcaption>
      {kind === "image" ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="sv-licence-image">
          <img src={url} alt={`${verification.shop_name} trade licence`} />
        </a>
      ) : kind === "pdf" ? (
        <object className="sv-licence-pdf" data={url} type="application/pdf">
          <div className="sv-licence-empty">
            <Icon name="package" />
            <strong>PDF preview unavailable</strong>
            <Button asChild variant="secondary" size="sm">
              <a href={url} target="_blank" rel="noopener noreferrer">
                <Icon name="download" />
                <span>Download licence</span>
              </a>
            </Button>
          </div>
        </object>
      ) : (
        <div className="sv-licence-empty">
          <Icon name="download" />
          <strong>Downloadable file</strong>
          <Button asChild variant="secondary" size="sm">
            <a href={url} target="_blank" rel="noopener noreferrer">
              <Icon name="download" />
              <span>Download licence</span>
            </a>
          </Button>
        </div>
      )}
    </figure>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="sv-detail-row">
      <span className="sv-detail-label">{label}</span>
      <span className="sv-detail-value">{value}</span>
    </div>
  );
}

export function AdminSupplierVerificationDetail({
  userId,
  loadVerifications = loadSupplierVerifications,
  approve = approveSupplier,
  reject = rejectSupplier,
}: AdminSupplierVerificationDetailProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/admin/verifications/$userId" });
  const [verification, setVerification] = useState<AdminSupplierVerification | null | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    setError(null);
    setVerification(undefined);

    void loadVerifications()
      .then((rows) => {
        if (!current) return;
        const match = rows.find((row) => row.user_id === userId) ?? null;
        setVerification(match);
        setNote(match?.review_note ?? "");
      })
      .catch((loadError: unknown) => {
        if (current) {
          setError(loadError instanceof Error ? loadError.message : "Please try again.");
        }
      });

    return () => {
      current = false;
    };
  }, [loadVerifications, userId, loadVersion]);

  if (state.status !== "admin") return null;

  const onLogout = () => {
    void store.signOut();
  };
  const retry = () => setLoadVersion((version) => version + 1);
  const userName = state.profile.name || "Administrator";
  const backToList = () => void navigate({ to: "/admin/verifications" });

  if (error) {
    return (
      <WorkspaceError
        eyebrow="Admin workspace"
        title="We could not load this application."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  const shell = (children: ReactNode) => (
    <WorkspaceShell
      navigationLabel="Admin navigation"
      items={ADMIN_NAV_ITEMS.map((item) => ({
        ...item,
        active: item.to === "/admin/verifications",
      }))}
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      {children}
    </WorkspaceShell>
  );

  if (verification === undefined) {
    return shell(<LoadingState title="Loading application…" />);
  }

  if (verification === null) {
    return shell(
      <>
        <Button asChild variant="link" className="sv-back h-auto p-0">
          <RouterLink to="/admin/verifications">
            <Icon name="arrow-right" />
            <span>Back to verifications</span>
          </RouterLink>
        </Button>
        <PageHeader
          eyebrow="Supplier onboarding"
          title="Application not found."
          copy="This supplier application no longer exists or has not been submitted yet."
        />
      </>,
    );
  }

  const runReview = (action: "approve" | "reject") => {
    const trimmed = note.trim();
    if (action === "reject" && trimmed.length === 0) {
      setNotice({ message: "Add a reason so the supplier knows what to fix.", state: "error" });
      return;
    }
    setBusy(true);
    setNotice(null);
    const work =
      action === "approve" ? approve(verification.user_id) : reject(verification.user_id, trimmed);
    void work
      .then(() => {
        backToList();
      })
      .catch((reviewError: unknown) => {
        setNotice({
          message:
            reviewError instanceof Error
              ? reviewError.message
              : `The supplier could not be ${action === "approve" ? "approved" : "rejected"}.`,
          state: "error",
        });
        setBusy(false);
      });
  };

  const decided = verification.status !== "pending";

  return shell(
    <>
      <Button asChild variant="link" className="sv-back h-auto p-0">
        <RouterLink to="/admin/verifications">
          <Icon name="arrow-right" />
          <span>Back to verifications</span>
        </RouterLink>
      </Button>
      <PageHeader
        eyebrow="Supplier onboarding"
        title={verification.shop_name}
        copy="Review the attached trade licence and shop details, then approve or reject the supplier."
        actions={
          <Badge
            variant={
              verification.status === "rejected"
                ? "destructive"
                : verification.status === "approved"
                  ? "default"
                  : "outline"
            }
          >
            {STATUS_LABELS[verification.status]}
          </Badge>
        }
      />
      <InlineNotice message={notice?.message} state={notice?.state} />

      <div className="sv-detail">
        <div className="sv-detail-main">
          <LicencePreview verification={verification} />
        </div>

        <div className="sv-detail-side">
          <section className="sv-panel">
            <h2 className="sv-panel-title">Supplier</h2>
            <div className="sv-card-supplier">
              <span className="admin-avatar">{initials(verification.supplier_name)}</span>
              <span>
                <strong>{verification.supplier_name || "Unnamed supplier"}</strong>
                <small>{verification.supplier_email}</small>
              </span>
            </div>
          </section>

          <section className="sv-panel">
            <h2 className="sv-panel-title">Shop details</h2>
            <DetailRow label="Location" value={verification.location} />
            <DetailRow label="Submitted" value={formatDateTime(verification.created_at)} />
            {decided && verification.reviewed_at ? (
              <DetailRow label="Last reviewed" value={formatDateTime(verification.reviewed_at)} />
            ) : null}
            <div className="sv-detail-row is-block">
              <span className="sv-detail-label">About the shop</span>
              <p className="sv-detail-text">{verification.shop_details}</p>
            </div>
          </section>

          <section className="sv-panel">
            <h2 className="sv-panel-title">Review</h2>
            {decided ? (
              <div className={`sv-decided is-${verification.status}`}>
                <p className="sv-decided-head">
                  <Icon name="lock" />
                  <span>
                    Already {verification.status}
                    {verification.reviewed_at
                      ? ` on ${formatDateTime(verification.reviewed_at)}`
                      : ""}
                    .
                  </span>
                </p>
                {verification.status === "rejected" && verification.review_note ? (
                  <p className="sv-current-note">
                    <strong>Reason:</strong> {verification.review_note}
                  </p>
                ) : verification.review_note ? (
                  <p className="sv-current-note">
                    <strong>Note:</strong> {verification.review_note}
                  </p>
                ) : null}
                <p className="sv-decided-hint">
                  This application is locked. The supplier must edit and resubmit before it can be
                  reviewed again.
                </p>
              </div>
            ) : (
              <>
                <label className="admin-field">
                  <span>
                    Review note{" "}
                    <em className="sv-field-hint">(required to reject, optional to approve)</em>
                  </span>
                  <textarea
                    rows={4}
                    maxLength={1000}
                    placeholder="Explain what looks good or what the supplier needs to fix."
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </label>
                <div className="sv-review-actions">
                  <Button onClick={() => runReview("approve")} disabled={busy}>
                    <Icon name="check" />
                    <span>Approve supplier</span>
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => runReview("reject")}
                    disabled={busy || note.trim().length === 0}
                  >
                    <Icon name="trash" />
                    <span>Reject supplier</span>
                  </Button>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </>,
  );
}
