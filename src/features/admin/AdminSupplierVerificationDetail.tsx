import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  Download,
  ExternalLink,
  FileText,
  ImageIcon,
  LockKeyhole,
  Mail,
  MapPin,
  Phone,
  X,
  type LucideIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  InlineNotice,
  LoadingState,
  PageHeader,
  WorkspaceError,
  type NoticeState,
} from "../../components/ui/Workspace.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { formatDateTime, initials } from "../workspace/format.ts";
import { RouterLink } from "../workspace/WorkspaceShell.tsx";
import { AdminWorkspaceShell } from "./admin-workspace-shell.tsx";
import {
  approveSupplier,
  loadSupplierVerifications,
  rejectSupplier,
  tradeLicenseKind,
  type AdminSupplierVerification,
} from "./admin-supplier-verifications-api.ts";
import { TradeLicenseCopyField } from "./trade-license-copy-field.tsx";

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

function DocumentEmpty({
  icon: EmptyIcon,
  title,
  copy,
  action,
  compact = false,
}: {
  icon: LucideIcon;
  title: string;
  copy?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <Empty className={compact ? "min-h-48 border" : "min-h-80 border"}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <EmptyIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {copy ? <EmptyDescription>{copy}</EmptyDescription> : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}

function DocumentPreview({
  title,
  description,
  url,
  alt,
  compact = false,
}: {
  title: string;
  description: string;
  url: string | null;
  alt: string;
  compact?: boolean;
}) {
  const kind = tradeLicenseKind(url);
  const openOriginal = url ? (
    <Button asChild variant="outline" size="sm">
      <a href={url} target="_blank" rel="noopener noreferrer">
        <ExternalLink data-icon="inline-start" />
        Open original
      </a>
    </Button>
  ) : null;
  const imageClass = compact
    ? "max-h-[24rem] w-full object-contain"
    : "max-h-[48rem] w-full object-contain";
  const pdfClass = compact
    ? "h-[24rem] w-full rounded-xl border"
    : "h-[48rem] w-full rounded-xl border";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        {openOriginal ? <CardAction>{openOriginal}</CardAction> : null}
      </CardHeader>
      <CardContent>
        {!url ? (
          <DocumentEmpty
            icon={ImageIcon}
            title={`${title} unavailable`}
            copy="The uploaded file could not be loaded. Ask the supplier to resubmit."
            compact={compact}
          />
        ) : kind === "image" ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="block overflow-hidden rounded-xl border"
          >
            <img className={imageClass} src={url} alt={alt} />
          </a>
        ) : kind === "pdf" ? (
          <object className={pdfClass} data={url} type="application/pdf">
            <DocumentEmpty
              icon={FileText}
              title="PDF preview unavailable"
              compact={compact}
              action={
                <Button asChild variant="secondary" size="sm">
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    <Download data-icon="inline-start" />
                    Download file
                  </a>
                </Button>
              }
            />
          </object>
        ) : (
          <DocumentEmpty
            icon={Download}
            title="Downloadable file"
            compact={compact}
            action={
              <Button asChild variant="secondary" size="sm">
                <a href={url} target="_blank" rel="noopener noreferrer">
                  <Download data-icon="inline-start" />
                  Download file
                </a>
              </Button>
            }
          />
        )}
      </CardContent>
    </Card>
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
        eyebrow="Admin"
        title="We could not load this application."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  const shell = (children: ReactNode) => (
    <AdminWorkspaceShell
      activePath="/admin/verifications"
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      {children}
    </AdminWorkspaceShell>
  );

  if (verification === undefined) {
    return shell(<LoadingState title="Loading application…" />);
  }

  if (verification === null) {
    return shell(
      <>
        <Button asChild variant="ghost" size="sm">
          <RouterLink to="/admin/verifications">
            <ArrowLeft data-icon="inline-start" />
            Back to verifications
          </RouterLink>
        </Button>
        <PageHeader
          eyebrow="Verifications"
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
  const noteInvalid = notice?.message === "Add a reason so the supplier knows what to fix.";

  return shell(
    <>
      <Button asChild variant="ghost" size="sm">
        <RouterLink to="/admin/verifications">
          <ArrowLeft data-icon="inline-start" />
          Back to verifications
        </RouterLink>
      </Button>
      <PageHeader
        eyebrow="Verifications"
        title={verification.shop_name}
        copy="Review the trade licence number, NID card, and contact info, then approve or reject the supplier."
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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
        <div className="grid gap-6 sm:grid-cols-2">
          <DocumentPreview
            title="NID card front"
            description="Front of the national ID card."
            url={verification.nid_front_url}
            alt={`${verification.supplier_name || verification.shop_name} NID card front`}
          />
          <DocumentPreview
            title="NID card back"
            description="Back of the national ID card."
            url={verification.nid_back_url}
            alt={`${verification.supplier_name || verification.shop_name} NID card back`}
          />
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Supplier</CardTitle>
              <CardDescription>Who submitted this application.</CardDescription>
            </CardHeader>
            <CardContent>
              <Item size="sm">
                <ItemMedia>
                  <Avatar>
                    <AvatarFallback>{initials(verification.supplier_name)}</AvatarFallback>
                  </Avatar>
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{verification.supplier_name || "Unnamed supplier"}</ItemTitle>
                  <ItemDescription>{verification.supplier_email}</ItemDescription>
                </ItemContent>
              </Item>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Identity and contact</CardTitle>
              <CardDescription>
                Trade licence number, location, and how to reach this supplier.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <TradeLicenseCopyField value={verification.trade_license_number} />
              <Separator />
              <ItemGroup>
                <Item size="sm">
                  <ItemMedia variant="icon">
                    <MapPin />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>Location</ItemTitle>
                    <ItemDescription>{verification.location}</ItemDescription>
                  </ItemContent>
                </Item>
                <Item size="sm">
                  <ItemMedia variant="icon">
                    <Phone />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>Phone</ItemTitle>
                    <ItemDescription>
                      {verification.contact_phone || "Not provided"}
                    </ItemDescription>
                  </ItemContent>
                </Item>
                <Item size="sm">
                  <ItemMedia variant="icon">
                    <Mail />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>Email</ItemTitle>
                    <ItemDescription>
                      {verification.supplier_email || "Not provided"}
                    </ItemDescription>
                  </ItemContent>
                </Item>
              </ItemGroup>
              <Separator />
              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted-foreground">About the shop</span>
                <p className="text-sm leading-relaxed">{verification.shop_details}</p>
              </div>
              <ItemGroup>
                <Item size="xs">
                  <ItemContent>
                    <ItemTitle>Submitted</ItemTitle>
                    <ItemDescription>{formatDateTime(verification.created_at)}</ItemDescription>
                  </ItemContent>
                </Item>
                {decided && verification.reviewed_at ? (
                  <Item size="xs">
                    <ItemContent>
                      <ItemTitle>Last reviewed</ItemTitle>
                      <ItemDescription>{formatDateTime(verification.reviewed_at)}</ItemDescription>
                    </ItemContent>
                  </Item>
                ) : null}
              </ItemGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Review</CardTitle>
              <CardDescription>
                {decided
                  ? "This application has already been reviewed."
                  : "Approve the application or explain what the supplier needs to fix."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {decided ? (
                <Alert variant={verification.status === "rejected" ? "destructive" : "default"}>
                  <LockKeyhole />
                  <AlertTitle>
                    Already {verification.status}
                    {verification.reviewed_at
                      ? ` on ${formatDateTime(verification.reviewed_at)}`
                      : ""}
                    .
                  </AlertTitle>
                  <AlertDescription className="flex flex-col gap-2">
                    {verification.status === "rejected" && verification.review_note ? (
                      <p>
                        <strong>Reason:</strong> {verification.review_note}
                      </p>
                    ) : verification.review_note ? (
                      <p>
                        <strong>Note:</strong> {verification.review_note}
                      </p>
                    ) : null}
                    <p>
                      This application is locked. The supplier must edit and resubmit before it can
                      be reviewed again.
                    </p>
                  </AlertDescription>
                </Alert>
              ) : (
                <FieldGroup>
                  <Field data-invalid={noteInvalid || undefined}>
                    <FieldLabel htmlFor="supplier-review-note">Review note</FieldLabel>
                    <FieldDescription>Required to reject and optional to approve.</FieldDescription>
                    <Textarea
                      id="supplier-review-note"
                      rows={4}
                      maxLength={1000}
                      placeholder="Explain what looks good or what the supplier needs to fix."
                      value={note}
                      aria-invalid={noteInvalid || undefined}
                      onChange={(event) => setNote(event.target.value)}
                    />
                  </Field>
                </FieldGroup>
              )}
            </CardContent>
            {decided ? null : (
              <CardFooter className="flex-wrap gap-2">
                <Button type="button" onClick={() => runReview("approve")} disabled={busy}>
                  <Check data-icon="inline-start" />
                  Approve supplier
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => runReview("reject")}
                  disabled={busy || note.trim().length === 0}
                >
                  <X data-icon="inline-start" />
                  Reject supplier
                </Button>
              </CardFooter>
            )}
          </Card>
        </div>
      </div>
    </>,
  );
}
