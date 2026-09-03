import { useEffect, useState } from "react";
import { ArrowRight, Clock3, FileText, ImageIcon, Search, ShieldCheck, Store } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
      <div className="aspect-video overflow-hidden rounded-xl border">
        <img
          className="size-full object-cover"
          src={verification.trade_license_url}
          alt={`${verification.shop_name} trade licence`}
        />
      </div>
    );
  }

  const PlaceholderIcon = kind === "pdf" ? FileText : ImageIcon;
  return (
    <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-xl border bg-muted text-muted-foreground">
      <PlaceholderIcon className="size-8" aria-hidden="true" />
      <small className="text-xs font-medium">{kind === "pdf" ? "PDF" : "Licence"}</small>
    </div>
  );
}

function VerificationCard({ verification }: { verification: AdminSupplierVerification }) {
  return (
    <RouterLink
      className="block h-full rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
      to="/admin/verifications/$userId"
      params={{ userId: verification.user_id }}
    >
      <Card className="h-full">
        <CardHeader>
          <CardTitle>{verification.shop_name}</CardTitle>
          <CardAction>
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
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <LicenceThumb verification={verification} />
          <div className="flex items-center gap-3">
            <Avatar size="sm">
              <AvatarFallback>{initials(verification.supplier_name)}</AvatarFallback>
            </Avatar>
            <span className="flex min-w-0 flex-col gap-1">
              <strong className="truncate font-medium">
                {verification.supplier_name || "Unnamed supplier"}
              </strong>
              <small className="truncate text-xs text-muted-foreground">
                {verification.supplier_email}
              </small>
            </span>
          </div>
          <div className="flex flex-col gap-2 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <Store className="size-4 shrink-0" aria-hidden="true" />
              {verification.location}
            </span>
            <span className="flex items-center gap-2">
              <Clock3 className="size-4 shrink-0" aria-hidden="true" />
              {formatDateTime(verification.created_at)}
            </span>
          </div>
        </CardContent>
        <CardFooter className="text-sm font-medium">
          Review application
          <ArrowRight className="ml-auto size-4" aria-hidden="true" />
        </CardFooter>
      </Card>
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
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {filtered.map((verification) => (
                  <VerificationCard key={verification.user_id} verification={verification} />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={Search}
                title="No matching applications"
                copy="Try a different shop, supplier, or location."
              />
            )
          ) : (
            <EmptyState
              icon={ShieldCheck}
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
