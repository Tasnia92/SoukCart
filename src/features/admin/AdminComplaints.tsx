import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Download, MessageSquare, Search } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { recordIdFromHash, searchParam } from "../workspace/search.ts";
import { AdminWorkspaceShell } from "./admin-workspace-shell.tsx";
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
  highlight,
  onResolve,
}: {
  complaint: AdminComplaint;
  busy: boolean;
  highlight: boolean;
  onResolve: (complaint: AdminComplaint) => void;
}) {
  return (
    <TableRow id={`complaint-${complaint.id}`} data-state={highlight ? "selected" : undefined}>
      <TableCell>
        <div className="flex min-w-64 flex-col gap-1">
          <strong className="font-medium">{complaint.subject}</strong>
          {complaint.order_id ? (
            <small className="text-xs text-muted-foreground">
              Order #{complaint.order_id.slice(0, 8).toUpperCase()} · cancellation/refund support
            </small>
          ) : null}
          <small className="text-sm text-muted-foreground">{complaint.description}</small>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar size="sm">
            <AvatarFallback>{initials(complaint.retailer_name)}</AvatarFallback>
          </Avatar>
          <span className="flex min-w-0 flex-col gap-1">
            <strong className="truncate font-medium">{complaint.retailer_name}</strong>
            <small className="truncate text-xs text-muted-foreground">
              {complaint.retailer_email}
            </small>
          </span>
        </div>
      </TableCell>
      <TableCell>
        {complaint.attachment_url ? (
          <Button asChild variant="link" size="sm">
            <a href={complaint.attachment_url} target="_blank" rel="noopener noreferrer">
              <Download data-icon="inline-start" />
              Attachment
            </a>
          </Button>
        ) : (
          <span className="text-muted-foreground">None</span>
        )}
      </TableCell>
      <TableCell>{formatDate(complaint.created_at)}</TableCell>
      <TableCell>
        <Badge variant={complaint.status === "open" ? "outline" : "secondary"}>
          {complaint.status === "open" ? "Open" : "Resolved"}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
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
  const location = useRouterState({ select: (routerState) => routerState.location });
  const focusedComplaintId =
    searchParam(location.searchStr, "complaint") ?? recordIdFromHash(location.hash, "complaint");
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

  useEffect(() => {
    if (!focusedComplaintId || !complaints) return;
    document.getElementById(`complaint-${focusedComplaintId}`)?.scrollIntoView({ block: "center" });
  }, [complaints, focusedComplaintId]);

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
    <AdminWorkspaceShell
      activePath="/admin/complaints"
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
              <Table className="min-w-5xl">
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
                        highlight={complaint.id === focusedComplaintId}
                        onResolve={onResolve}
                      />
                    ))
                  ) : (
                    <TableRow>
                      <TableCell className="p-0" colSpan={6}>
                        <EmptyState
                          icon={Search}
                          title="No matching complaints"
                          copy="Try a different retailer or subject."
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableShell>
          ) : (
            <EmptyState icon={MessageSquare} title="No complaints yet" />
          )}
        </>
      ) : (
        <LoadingState title="Loading the admin workspace…" />
      )}
    </AdminWorkspaceShell>
  );
}
