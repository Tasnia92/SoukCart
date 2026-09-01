import { describe, expect, it } from "vite-plus/test";
import type { AdminFunctionGateway } from "./admin-overview-api.ts";
import {
  ADMIN_COMPLAINTS_FUNCTION,
  filterComplaints,
  getComplaintStats,
  loadAdminComplaints,
  resolveComplaint,
  type AdminComplaint,
} from "./admin-complaints-api.ts";

function complaint(overrides: Partial<AdminComplaint>): AdminComplaint {
  return {
    id: "complaint-1",
    order_id: null,
    category: "general",
    subject: "Damaged crate",
    description: "The dates arrived crushed.",
    attachment_url: null,
    status: "open",
    created_at: "2026-08-30T12:00:00.000Z",
    retailer_id: "retailer-1",
    retailer_name: "Rania Retailer",
    retailer_email: "rania@example.com",
    ...overrides,
  };
}

type Request = { functionName: string; body: Record<string, unknown> };

function recordingGateway(response: unknown): {
  gateway: AdminFunctionGateway;
  requests: Request[];
} {
  const requests: Request[] = [];
  const gateway: AdminFunctionGateway = {
    functions: {
      invoke: async <T>(functionName: string, { body }: { body: Record<string, unknown> }) => {
        requests.push({ functionName, body });
        return { data: response as T, error: null };
      },
    },
  };
  return { gateway, requests };
}

describe("admin complaints API", () => {
  it("loads complaints through the admin-complaints list contract", async () => {
    const complaints = [complaint({})];
    const { gateway, requests } = recordingGateway({ complaints });

    await expect(loadAdminComplaints(gateway)).resolves.toEqual(complaints);
    expect(requests).toEqual([
      { functionName: ADMIN_COMPLAINTS_FUNCTION, body: { action: "list" } },
    ]);
  });

  it("resolves a complaint with the update contract", async () => {
    const { gateway, requests } = recordingGateway({ ok: true });

    await resolveComplaint("complaint-9", gateway);
    expect(requests).toEqual([
      {
        functionName: ADMIN_COMPLAINTS_FUNCTION,
        body: { action: "update", complaintId: "complaint-9", status: "resolved" },
      },
    ]);
  });

  it("filters across subject, description, and retailer identity", () => {
    const complaints = [
      complaint({ id: "a", subject: "Late delivery" }),
      complaint({ id: "b", description: "Wrong item shipped" }),
      complaint({ id: "c", retailer_name: "Sana Store" }),
      complaint({ id: "d", retailer_email: "help@souk.test" }),
    ];

    expect(filterComplaints(complaints, "  ").map((row) => row.id)).toEqual(["a", "b", "c", "d"]);
    expect(filterComplaints(complaints, "late").map((row) => row.id)).toEqual(["a"]);
    expect(filterComplaints(complaints, "wrong item").map((row) => row.id)).toEqual(["b"]);
    expect(filterComplaints(complaints, "sana").map((row) => row.id)).toEqual(["c"]);
    expect(filterComplaints(complaints, "souk.test").map((row) => row.id)).toEqual(["d"]);
  });

  it("derives summary counts including distinct retailers", () => {
    const stats = getComplaintStats([
      complaint({ id: "a", retailer_id: "r1", status: "open" }),
      complaint({ id: "b", retailer_id: "r1", status: "resolved" }),
      complaint({ id: "c", retailer_id: "r2", status: "open" }),
    ]);

    expect(stats).toEqual({ total: 3, open: 2, resolved: 1, retailers: 2 });
  });
});
