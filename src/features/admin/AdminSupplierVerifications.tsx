import { useEffect, useState } from "react";
import {
  ArrowRight,
  Clock3,
  FileText,
  ImageIcon,
  Phone,
  Search,
  ShieldCheck,
  Store,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
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
import { RouterLink } from "../workspace/WorkspaceShell.tsx";
import { AdminWorkspaceShell } from "./admin-workspace-shell.tsx";
import {
  filterVerifications,
  getVerificationStats,
  loadSupplierVerifications,
  sortVerificationsForReview,
  tradeLicenseKind,
  type AdminSupplierVerification,
} from "./admin-supplier-verifications-api.ts";
import { TradeLicenseCopyField } from "./trade-license-copy-field.tsx";

type AdminSupplierVerificationsProps = {
  loadVerifications?: () => Promise<AdminSupplierVerification[]>;
};

const STATUS_LABELS: Record<AdminSupplierVerification["status"], string> = {
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
};

function LicenceThumb({ verification }: { verification: AdminSupplierVerification }) {
  const kind = tradeLicenseKind(verification.nid_front_url);

  if (kind === "image" && verification.nid_front_url) {
    return (
      <div className="aspect-video overflow-hidden rounded-xl border">
        <img
          className="size-full object-cover"
          src={verification.nid_front_url}
          alt={`${verification.shop_name} NID card front`}
        />
      </div>
    );
  }

  const PlaceholderIcon = kind === "pdf" ? FileText : ImageIcon;
  return (
    <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-xl border bg-muted text-muted-foreground">
      <PlaceholderIcon className="size-8" aria-hidden="true" />
      <small className="text-xs font-medium">NID</small>
    </div>
  );
}

function VerificationCard({ verification }: { verification: AdminSupplierVerification }) {
  return (
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
        <Item size="sm">
          <ItemMedia>
            <Avatar size="sm">
              <AvatarFallback>{initials(verification.supplier_name)}</AvatarFallback>
            </Avatar>
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{verification.supplier_name || "Unnamed supplier"}</ItemTitle>
            <ItemDescription>{verification.supplier_email}</ItemDescription>
          </ItemContent>
        </Item>
        <TradeLicenseCopyField
          compact
          id={`trade-license-${verification.user_id}`}
          value={verification.trade_license_number}
        />
        <ItemGroup>
          <Item size="xs">
            <ItemMedia variant="icon">
              <Store />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Location</ItemTitle>
              <ItemDescription>{verification.location}</ItemDescription>
            </ItemContent>
          </Item>
          {verification.contact_phone ? (
            <Item size="xs">
              <ItemMedia variant="icon">
                <Phone />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>Phone</ItemTitle>
                <ItemDescription>{verification.contact_phone}</ItemDescription>
              </ItemContent>
            </Item>
          ) : null}
          <Item size="xs">
            <ItemMedia variant="icon">
              <Clock3 />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Submitted</ItemTitle>
              <ItemDescription>{formatDateTime(verification.created_at)}</ItemDescription>
            </ItemContent>
          </Item>
        </ItemGroup>
      </CardContent>
      <CardFooter>
        <Button asChild className="w-full">
          <RouterLink to="/admin/verifications/$userId" params={{ userId: verification.user_id }}>
            Review application
            <ArrowRight data-icon="inline-end" />
          </RouterLink>
        </Button>
      </CardFooter>
    </Card>
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
    <AdminWorkspaceShell
      activePath="/admin/verifications"
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Supplier onboarding"
        title="Supplier verifications."
        copy="Open a submission to review the trade licence number, NID card, and contact info, then approve or reject it."
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
            placeholder="Search by shop, supplier, location, or licence number"
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
                copy="Try a different shop, supplier, location, or licence number."
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
    </AdminWorkspaceShell>
  );
}
