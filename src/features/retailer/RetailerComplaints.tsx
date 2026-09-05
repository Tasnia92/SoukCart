import { useNavigate } from "@tanstack/react-router";
import { Download, MessageSquare, Store } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  EmptyState,
  InlineNotice,
  PageHeader,
  WorkspaceError,
  type NoticeState,
} from "../../components/ui/Workspace.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { shortId } from "../orders/order-presentation.tsx";
import { formatDateTime } from "../workspace/format.ts";
import { RouterLink } from "../workspace/WorkspaceShell.tsx";
import { loadCartCount } from "./retailer-orders-api.ts";
import {
  fileComplaint,
  loadRetailerComplaints,
  validateComplaintFile,
  type FileComplaintInput,
  type RetailerComplaint,
} from "./retailer-complaints-api.ts";
import { RetailerWorkspaceShell } from "./retailer-shared.tsx";

type RetailerComplaintsProps = {
  loadComplaints?: (retailerId: string) => Promise<RetailerComplaint[]>;
  loadCart?: (userId: string) => Promise<number>;
  submitComplaint?: (input: FileComplaintInput) => Promise<RetailerComplaint>;
};

type Notice = { message: string; state: NoticeState } | null;
type Feedback = { message: string; state: NoticeState } | null;

function readText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function linkedOrderFromLocation(): string | null {
  const orderId = new URLSearchParams(window.location.search).get("order");
  return orderId && /^[0-9a-fA-F-]{36}$/.test(orderId) ? orderId : null;
}

function ComplaintCard({ complaint }: { complaint: RetailerComplaint }) {
  return (
    <article>
      <Card size="sm">
        <CardHeader>
          <CardTitle>{complaint.subject}</CardTitle>
          <CardDescription>
            {complaint.order_id
              ? `Order #${shortId(complaint.order_id)} · order support`
              : `Filed ${formatDateTime(complaint.created_at)}`}
          </CardDescription>
          <CardAction>
            <Badge variant={complaint.status === "open" ? "outline" : "secondary"}>
              {complaint.status === "open" ? "Open" : "Resolved"}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {complaint.description}
          </p>
        </CardContent>
        <CardFooter className="justify-between gap-3">
          <small className="text-muted-foreground">
            Filed {formatDateTime(complaint.created_at)}
          </small>
          {complaint.attachment_url ? (
            <Button asChild variant="outline" size="sm">
              <a href={complaint.attachment_url} target="_blank" rel="noopener noreferrer">
                <Download data-icon="inline-start" />
                View attachment
              </a>
            </Button>
          ) : null}
        </CardFooter>
      </Card>
    </article>
  );
}

export function RetailerComplaints({
  loadComplaints = loadRetailerComplaints,
  loadCart = loadCartCount,
  submitComplaint = fileComplaint,
}: RetailerComplaintsProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/retailer/complaints" });
  const linkedOrderId = linkedOrderFromLocation();
  const [complaints, setComplaints] = useState<RetailerComplaint[] | null>(null);
  const [cartCount, setCartCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [notice, setNotice] = useState<Notice>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const retailerId = state.status === "retailer" ? state.session.user.id : "";

  useEffect(() => {
    if (!retailerId) return;
    let current = true;
    setError(null);

    void Promise.all([loadComplaints(retailerId), loadCart(retailerId)])
      .then(([nextComplaints, nextCartCount]) => {
        if (!current) return;
        setComplaints(nextComplaints);
        setCartCount(nextCartCount);
      })
      .catch((loadError: unknown) => {
        if (current) {
          setError(loadError instanceof Error ? loadError.message : "Please try again.");
        }
      });

    return () => {
      current = false;
    };
  }, [loadCart, loadComplaints, loadVersion, retailerId]);

  if (state.status !== "retailer") return null;

  const onLogout = () => {
    void store.signOut().then(() => {
      void navigate({ to: "/" });
    });
  };
  const retry = () => setLoadVersion((version) => version + 1);
  const userName = state.profile.name || state.profile.email;

  if (error) {
    return (
      <WorkspaceError
        eyebrow="Retailer workspace"
        title="We could not load your workspace."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    const formData = new FormData(form);
    const subject = readText(formData, "subject").trim();
    const description = readText(formData, "description").trim();
    const fileInput = form.querySelector<HTMLInputElement>('[name="attachment"]');
    const file = fileInput?.files?.[0] ?? null;

    if (!subject || !description) {
      setFeedback({ message: "Add a subject and some details.", state: "error" });
      return;
    }
    if (file) {
      const fileError = validateComplaintFile(file);
      if (fileError) {
        setFeedback({ message: fileError, state: "error" });
        return;
      }
    }

    setSubmitting(true);
    if (file) setFeedback({ message: "Uploading attachment…", state: "info" });
    try {
      const created = await submitComplaint({
        retailerId,
        orderId: linkedOrderId,
        subject,
        description,
        file,
      });
      setComplaints((prev) => [created, ...(prev ?? [])]);
      setNotice({
        message: linkedOrderId
          ? "Support request filed. The admin team will review it and follow up."
          : "Complaint filed. The admin team will review it.",
        state: "success",
      });
      setFeedback(null);
      form.reset();
    } catch (submitError) {
      setFeedback({
        message:
          submitError instanceof Error ? submitError.message : "The complaint could not be filed.",
        state: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <RetailerWorkspaceShell
      section="complaints"
      userName={userName}
      userEmail={state.profile.email}
      cartCount={cartCount}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Support"
        title={linkedOrderId ? `Order #${shortId(linkedOrderId)} support.` : "Help Center."}
        copy={
          linkedOrderId
            ? "Delivered orders can't be returned or refunded, but you can ask the admin team for help with any issue."
            : "Tell us what went wrong."
        }
      />
      <InlineNotice message={notice?.message} state={notice?.state} />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
        <section className="flex flex-col gap-4" aria-label="Your complaints">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Your reports</p>
              <h2 className="text-xl font-semibold tracking-tight">Filed complaints</h2>
            </div>
            <Badge variant="secondary">{complaints?.length ?? 0} filed</Badge>
          </div>
          {complaints && complaints.length ? (
            <div className="flex flex-col gap-4">
              {complaints.map((complaint) => (
                <ComplaintCard key={complaint.id} complaint={complaint} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Store}
              title="No complaints yet"
              copy="Complaints you file will show up here."
              action={
                <Button asChild>
                  <RouterLink to="/retailer/complaints">File a complaint</RouterLink>
                </Button>
              }
            />
          )}
        </section>

        <form ref={formRef} onSubmit={onSubmit} noValidate>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>{linkedOrderId ? "Contact support about this order" : "File a complaint"}</h2>
              </CardTitle>
              <CardDescription>
                {linkedOrderId
                  ? `This request is linked to order #${shortId(linkedOrderId)}. Delivered orders can't be cancelled or refunded — the admin team will review your complaint and help resolve it.`
                  : "Share the details our support team needs to investigate."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="retailer-complaint-subject">Subject</FieldLabel>
                  <Input
                    id="retailer-complaint-subject"
                    name="subject"
                    type="text"
                    maxLength={120}
                    defaultValue={linkedOrderId ? "Delivered order support" : ""}
                    placeholder="What is this about?"
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="retailer-complaint-description">Details</FieldLabel>
                  <Textarea
                    id="retailer-complaint-description"
                    name="description"
                    rows={4}
                    maxLength={2000}
                    placeholder="What happened, and what would fix it?"
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="retailer-complaint-attachment">
                    Attachment (optional)
                  </FieldLabel>
                  <Input
                    id="retailer-complaint-attachment"
                    name="attachment"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,application/pdf"
                  />
                </Field>
              </FieldGroup>
              <div className="mt-5 min-h-0" role="status" aria-live="polite">
                {feedback ? (
                  <Alert
                    variant={feedback.state === "error" ? "destructive" : "default"}
                    role="status"
                  >
                    <MessageSquare />
                    <AlertDescription>{feedback.message}</AlertDescription>
                  </Alert>
                ) : null}
              </div>
            </CardContent>
            <CardFooter className="justify-end">
              <Button type="submit" disabled={submitting}>
                {linkedOrderId ? "Submit support request" : "Submit complaint"}
              </Button>
            </CardFooter>
          </Card>
        </form>
      </div>
    </RetailerWorkspaceShell>
  );
}
