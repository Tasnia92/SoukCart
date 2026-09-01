import { useEffect, useState } from "react";
import { Icon } from "../../components/ui/Icon.tsx";
import {
  EmptyState,
  InlineNotice,
  LoadingState,
  PageHeader,
  SearchToolbar,
  StatCard,
  StatGrid,
  TableShell,
  WorkspaceError,
  type NoticeState,
} from "../../components/ui/Workspace.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { formatDate, initials } from "../workspace/format.ts";
import { WorkspaceShell } from "../workspace/WorkspaceShell.tsx";
import {
  filterComplaints,
  getComplaintStats,
  loadAdminComplaints,
  resolveComplaint,
  type AdminComplaint,
} from "./admin-complaints-api.ts";

type AdminComplaintsProps = {
  loadComplaints?: () => Promise<AdminComplaint[]>;
  resolve?: (complaintId: string) => Promise<void>;
};

type Notice = { message: string; state: NoticeState } | null;

function ComplaintRow({
  complaint,
  busy,
  onResolve,
}: {
  complaint: AdminComplaint;
  busy: boolean;
  onResolve: (complaint: AdminComplaint) => void;
}) {
  return (
    <tr>
      <td>
        <div className="cp-cell">
          <strong>{complaint.subject}</strong>
          <small>{complaint.description}</small>
        </div>
      </td>
      <td>
        <div className="admin-user-cell">
          <span className="admin-avatar">{initials(complaint.retailer_name)}</span>
          <span>
            <strong>{complaint.retailer_name}</strong>
            <small>{complaint.retailer_email}</small>
          </span>
        </div>
      </td>
      <td>
        {complaint.attachment_url ? (
          <a
            className="text-button"
            href={complaint.attachment_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="download" />
            <span>Attachment</span>
          </a>
        ) : (
          <span className="admin-muted">None</span>
        )}
      </td>
      <td>{formatDate(complaint.created_at)}</td>
      <td>
        <span className={`cp-status cp-status-${complaint.status}`}>
          {complaint.status === "open" ? "Open" : "Resolved"}
        </span>
      </td>
      <td className="admin-action-cell">
        {complaint.status === "open" ? (
          <button
            className="delete-button"
            type="button"
            disabled={busy}
            onClick={() => onResolve(complaint)}
          >
            Mark resolved
          </button>
        ) : null}
      </td>
    </tr>
  );
}

export function AdminComplaints({
  loadComplaints = loadAdminComplaints,
  resolve = resolveComplaint,
}: AdminComplaintsProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const [complaints, setComplaints] = useState<AdminComplaint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setError(null);

    void loadComplaints()
      .then((next) => {
        if (current) setComplaints(next);
      })
      .catch((loadError: unknown) => {
        if (current) {
          setError(loadError instanceof Error ? loadError.message : "Please try again.");
        }
      });

    return () => {
      current = false;
    };
  }, [loadComplaints, loadVersion]);

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
        title="We could not load the admin workspace."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  const onResolve = (complaint: AdminComplaint) => {
    setBusyId(complaint.id);
    void resolve(complaint.id)
      .then(() => {
        setComplaints(
          (prev) =>
            prev?.map((item) =>
              item.id === complaint.id ? { ...item, status: "resolved" } : item,
            ) ?? prev,
        );
        setNotice({ message: "Complaint marked as resolved.", state: "success" });
        setBusyId(null);
      })
      .catch((resolveError: unknown) => {
        setNotice({
          message:
            resolveError instanceof Error
              ? resolveError.message
              : "The complaint could not be updated.",
          state: "error",
        });
        setBusyId(null);
      });
  };

  const stats = complaints ? getComplaintStats(complaints) : null;
  const filtered = complaints ? filterComplaints(complaints, searchTerm) : [];

  return (
    <WorkspaceShell
      navigationLabel="Admin navigation"
      items={[
        { to: "/admin", icon: "layers", label: "Overview" },
        { to: "/admin/activity", icon: "activity", label: "Order activity" },
        { to: "/admin/complaints", icon: "message", label: "Disputes & Claims", active: true },
        { to: "/admin/users", icon: "person", label: "User directory" },
      ]}
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Retailer support"
        title="Disputes & Claims."
        copy="Filed by retailers, with status."
      />
      <InlineNotice message={notice?.message} state={notice?.state} />
      {complaints && stats ? (
        <>
          <StatGrid label="Complaints summary">
            <StatCard label="Total filed" value={stats.total} />
            <StatCard label="Open" value={stats.open} />
            <StatCard label="Resolved" value={stats.resolved} />
            <StatCard label="Retailers filing" value={stats.retailers} />
          </StatGrid>

          <SearchToolbar
            label="Search complaints"
            placeholder="Search complaints"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            result={`${filtered.length} of ${complaints.length} filed`}
          />

          {complaints.length ? (
            <TableShell>
              <table className="admin-table cp-table">
                <thead>
                  <tr>
                    <th>Complaint</th>
                    <th>Retailer</th>
                    <th>Attachment</th>
                    <th>Filed</th>
                    <th>Status</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length ? (
                    filtered.map((complaint) => (
                      <ComplaintRow
                        key={complaint.id}
                        complaint={complaint}
                        busy={busyId === complaint.id}
                        onResolve={onResolve}
                      />
                    ))
                  ) : (
                    <tr>
                      <td className="admin-empty" colSpan={6}>
                        <strong>No matching complaints</strong>
                        <span>Try a different retailer or subject.</span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </TableShell>
          ) : (
            <EmptyState icon="message" title="No complaints yet" />
          )}
        </>
      ) : (
        <LoadingState title="Loading the admin workspace…" />
      )}
    </WorkspaceShell>
  );
}
