import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
    <TableRow>
      <TableCell>
        <div className="cp-cell">
          <strong>{complaint.subject}</strong>
          {complaint.order_id ? (
            <small>
              Order #{complaint.order_id.slice(0, 8).toUpperCase()} · cancellation/refund support
            </small>
          ) : null}
          <small>{complaint.description}</small>
        </div>
      </TableCell>
      <TableCell>
        <div className="admin-user-cell">
          <span className="admin-avatar">{initials(complaint.retailer_name)}</span>
          <span>
            <strong>{complaint.retailer_name}</strong>
            <small>{complaint.retailer_email}</small>
          </span>
        </div>
      </TableCell>
      <TableCell>
        {complaint.attachment_url ? (
          <Button asChild variant="link" className="h-auto p-0">
            <a href={complaint.attachment_url} target="_blank" rel="noopener noreferrer">
              <Icon name="download" />
              <span>Attachment</span>
            </a>
          </Button>
        ) : (
          <span className="admin-muted">None</span>
        )}
      </TableCell>
      <TableCell>{formatDate(complaint.created_at)}</TableCell>
      <TableCell>
        <Badge variant={complaint.status === "open" ? "outline" : "secondary"}>
          {complaint.status === "open" ? "Open" : "Resolved"}
        </Badge>
      </TableCell>
      <TableCell className="admin-action-cell">
        {complaint.status === "open" ? (
          <Button
            variant="destructive"
            size="sm"
            type="button"
            disabled={busy}
            onClick={() => onResolve(complaint)}
          >
            Mark resolved
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
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
        { to: "/admin/verifications", icon: "shield-check", label: "Supplier verifications" },
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
              <Table className="cp-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Complaint</TableHead>
                    <TableHead>Retailer</TableHead>
                    <TableHead>Attachment</TableHead>
                    <TableHead>Filed</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
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
                    <TableRow>
                      <TableCell className="admin-empty" colSpan={6}>
                        <strong>No matching complaints</strong>
                        <span>Try a different retailer or subject.</span>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
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
