import { invokeAdmin, type AdminFunctionGateway } from "./admin-overview-api.ts";

export const ADMIN_COMPLAINTS_FUNCTION = "admin-complaints";

export type AdminComplaint = {
  id: string;
  subject: string;
  description: string;
  attachment_url: string | null;
  status: "open" | "resolved";
  created_at: string;
  retailer_id: string;
  retailer_name: string;
  retailer_email: string;
};

export type AdminComplaintsResponse = {
  complaints: AdminComplaint[];
};

export async function loadAdminComplaints(
  gateway?: AdminFunctionGateway,
): Promise<AdminComplaint[]> {
  const response = await invokeAdmin<AdminComplaintsResponse>(
    { action: "list" },
    ADMIN_COMPLAINTS_FUNCTION,
    gateway,
  );
  return response.complaints;
}

export async function resolveComplaint(
  complaintId: string,
  gateway?: AdminFunctionGateway,
): Promise<void> {
  await invokeAdmin<unknown>(
    { action: "update", complaintId, status: "resolved" },
    ADMIN_COMPLAINTS_FUNCTION,
    gateway,
  );
}

export function filterComplaints(
  complaints: readonly AdminComplaint[],
  searchTerm: string,
): AdminComplaint[] {
  const query = searchTerm.trim().toLowerCase();
  if (!query) return [...complaints];
  return complaints.filter((complaint) =>
    [complaint.subject, complaint.description, complaint.retailer_name, complaint.retailer_email]
      .join(" ")
      .toLowerCase()
      .includes(query),
  );
}

export type ComplaintStats = {
  total: number;
  open: number;
  resolved: number;
  retailers: number;
};

export function getComplaintStats(complaints: readonly AdminComplaint[]): ComplaintStats {
  const open = complaints.filter((complaint) => complaint.status === "open").length;
  return {
    total: complaints.length,
    open,
    resolved: complaints.length - open,
    retailers: new Set(complaints.map((complaint) => complaint.retailer_id)).size,
  };
}
