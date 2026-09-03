import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Icon } from "../../components/ui/Icon.tsx";
import {
  EmptyState,
  LoadingState,
  PageHeader,
  SearchToolbar,
  StatCard,
  StatGrid,
  WorkspaceError,
} from "../../components/ui/Workspace.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { formatDateTime, initials } from "../workspace/format.ts";
import { RouterLink, WorkspaceShell } from "../workspace/WorkspaceShell.tsx";
import {
  filterVerifications,
  getVerificationStats,
  loadSupplierVerifications,
  sortVerificationsForReview,
  tradeLicenseKind,
  type AdminSupplierVerification,
} from "./admin-supplier-verifications-api.ts";
import { ADMIN_NAV_ITEMS } from "./admin-nav.ts";

type AdminSupplierVerificationsProps = {
  loadVerifications?: () => Promise<AdminSupplierVerification[]>;
};

const STATUS_LABELS: Record<AdminSupplierVerification["status"], string> = {
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
};

function LicenceThumb({ verification }: { verification: AdminSupplierVerification }) {
  const kind = tradeLicenseKind(verification.trade_license_url);

  if (kind === "image" && verification.trade_license_url) {
    return (
      <span className="sv-thumb">
        <img src={verification.trade_license_url} alt={`${verification.shop_name} trade licence`} />
      </span>
    );
  }

  return (
    <span className={`sv-thumb is-placeholder is-${kind}`}>
      <Icon name={kind === "pdf" ? "package" : "image"} />
      <small>{kind === "pdf" ? "PDF" : "Licence"}</small>
    </span>
  );
}

function VerificationCard({ verification }: { verification: AdminSupplierVerification }) {
  return (
    <RouterLink
      className="sv-card"
      to="/admin/verifications/$userId"
      params={{ userId: verification.user_id }}
    >
      <LicenceThumb verification={verification} />
      <span className="sv-card-body">
        <span className="sv-card-head">
          <strong>{verification.shop_name}</strong>
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
        </span>
        <span className="sv-card-supplier">
          <span className="admin-avatar">{initials(verification.supplier_name)}</span>
          <span>
            <strong>{verification.supplier_name || "Unnamed supplier"}</strong>
            <small>{verification.supplier_email}</small>
          </span>
        </span>
        <span className="sv-card-meta">
          <span>
            <Icon name="store" />
            {verification.location}
          </span>
          <span>
            <Icon name="clock" />
            {formatDateTime(verification.created_at)}
          </span>
        </span>
      </span>
      <span className="sv-card-go" aria-hidden="true">
        <Icon name="arrow-right" />
      </span>
    </RouterLink>
  );
}

export function AdminSupplierVerifications({
  loadVerifications = loadSupplierVerifications,
}: AdminSupplierVerificationsProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const [verifications, setVerifications] = useState<AdminSupplierVerification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    let current = true;
    setError(null);

    void loadVerifications()
      .then((next) => {
        if (current) setVerifications(next);
      })
      .catch((loadError: unknown) => {
        if (current) {
          setError(loadError instanceof Error ? loadError.message : "Please try again.");
        }
      });

    return () => {
      current = false;
    };
  }, [loadVerifications, loadVersion]);

  if (state.status !== "admin") return null;

  const onLogout = () => {
    void store.signOut();
  };
  const retry = () => setLoadVersion((version) => version + 1);
  const userName = state.profile.name || "Administrator";

  if (error) {
    return (
      <WorkspaceError
        eyebrow="Admin workspace"
        title="We could not load supplier verifications."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  const stats = verifications ? getVerificationStats(verifications) : null;
  const filtered = verifications
    ? sortVerificationsForReview(filterVerifications(verifications, searchTerm))
    : [];

  return (
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
      <PageHeader
        eyebrow="Supplier onboarding"
        title="Supplier verifications."
        copy="Open a submission to review the trade licence and shop details, then approve or reject it."
      />
      {verifications && stats ? (
        <>
          <StatGrid label="Verification summary">
            <StatCard label="Total submitted" value={stats.total} />
            <StatCard label="Pending review" value={stats.pending} />
            <StatCard label="Approved" value={stats.approved} />
            <StatCard label="Rejected" value={stats.rejected} />
          </StatGrid>

          <SearchToolbar
            label="Search supplier applications"
            placeholder="Search by shop, supplier, or location"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            result={`${filtered.length} of ${verifications.length} submitted`}
          />

          {verifications.length ? (
            filtered.length ? (
              <div className="sv-grid">
                {filtered.map((verification) => (
                  <VerificationCard key={verification.user_id} verification={verification} />
                ))}
              </div>
            ) : (
              <EmptyState
                icon="search"
                title="No matching applications"
                copy="Try a different shop, supplier, or location."
              />
            )
          ) : (
            <EmptyState
              icon="shield-check"
              title="No supplier applications yet"
              copy="New supplier submissions will appear here for review."
            />
          )}
        </>
      ) : (
        <LoadingState title="Loading supplier verifications…" />
      )}
    </WorkspaceShell>
  );
}
