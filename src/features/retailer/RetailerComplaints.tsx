import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "../../components/ui/Icon.tsx";
import {
  EmptyState,
  InlineNotice,
  PageHeader,
  WorkspaceError,
  type NoticeState,
} from "../../components/ui/Workspace.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { formatDateTime } from "../workspace/format.ts";
import { RouterLink, WorkspaceShell } from "../workspace/WorkspaceShell.tsx";
import { loadCartCount } from "./retailer-orders-api.ts";
import {
  fileComplaint,
  loadRetailerComplaints,
  validateComplaintFile,
  type FileComplaintInput,
  type RetailerComplaint,
} from "./retailer-complaints-api.ts";

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

function ComplaintCard({ complaint }: { complaint: RetailerComplaint }) {
  return (
    <article className="cp-card">
      <div className="cp-card-top">
        <strong>{complaint.subject}</strong>
        <span className={`cp-status cp-status-${complaint.status}`}>
          {complaint.status === "open" ? "Open" : "Resolved"}
        </span>
      </div>
      <p>{complaint.description}</p>
      {complaint.attachment_url ? (
        <a
          className="text-button"
          href={complaint.attachment_url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Icon name="download" />
          <span>View attachment</span>
        </a>
      ) : null}
      <small>Filed {formatDateTime(complaint.created_at)}</small>
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
      const created = await submitComplaint({ retailerId, subject, description, file });
      setComplaints((prev) => [created, ...(prev ?? [])]);
      setNotice({ message: "Complaint filed. The admin team will review it.", state: "success" });
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
    <WorkspaceShell
      navigationLabel="Retailer navigation"
      items={[
        { to: "/retailer", icon: "home", label: "Overview" },
        { to: "/retailer/catalog", icon: "bag", label: "Place order" },
        {
          to: "/retailer/cart",
          icon: "cart",
          label: "Cart",
          trailing: cartCount ? <span className="rt-nav-badge">{cartCount}</span> : undefined,
        },
        { to: "/retailer/orders", icon: "package", label: "My orders" },
        { to: "/retailer/complaints", icon: "message", label: "Help Center", active: true },
      ]}
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader eyebrow="Support" title="Help Center." copy="Tell us what went wrong." />
      <InlineNotice message={notice?.message} state={notice?.state} />

      <div className="cp-layout">
        <section className="cp-list" aria-label="Your complaints">
          <div className="rt-section-heading">
            <div>
              <p className="eyebrow">Your reports</p>
              <h2 className="display-sm">Filed complaints</h2>
            </div>
            <span className="admin-result-count">{complaints?.length ?? 0} filed</span>
          </div>
          {complaints && complaints.length ? (
            <div className="cp-list-cards">
              {complaints.map((complaint) => (
                <ComplaintCard key={complaint.id} complaint={complaint} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon="store"
              title="No complaints yet"
              copy="Complaints you file will show up here."
              action={
                <RouterLink className="button button-primary" to="/retailer/complaints">
                  <span>File a complaint</span>
                </RouterLink>
              }
            />
          )}
        </section>

        <form className="cp-form-card" ref={formRef} onSubmit={onSubmit} noValidate>
          <div className="cp-form-heading">
            <p className="eyebrow">New report</p>
            <h2 className="display-sm">File a complaint</h2>
          </div>
          <label className="admin-field">
            <span>Subject</span>
            <input
              name="subject"
              type="text"
              maxLength={120}
              placeholder="What is this about?"
              required
            />
          </label>
          <label className="admin-field">
            <span>Details</span>
            <textarea
              name="description"
              rows={4}
              maxLength={2000}
              placeholder="What happened, and what would fix it?"
              required
            />
          </label>
          <label className="admin-field">
            <span>Attachment (optional)</span>
            <input
              name="attachment"
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf"
            />
          </label>
          <div className="cp-form-actions">
            <button className="button button-primary" type="submit" disabled={submitting}>
              <span>Submit complaint</span>
            </button>
          </div>
          <p
            className={`admin-form-feedback${feedback ? ` is-visible is-${feedback.state}` : ""}`}
            role="status"
            aria-live="polite"
          >
            {feedback?.message}
          </p>
        </form>
      </div>
    </WorkspaceShell>
  );
}
