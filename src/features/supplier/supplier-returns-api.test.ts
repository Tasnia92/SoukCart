import { describe, expect, it } from "vite-plus/test";
import {
  isOpenReturnStatus,
  nextReturnActions,
  normalizeSellerReturn,
  normalizeSellerReturns,
  returnStatusLabel,
} from "./supplier-returns-api.ts";

describe("isOpenReturnStatus", () => {
  it("treats requested through refunded as open", () => {
    expect(isOpenReturnStatus("requested")).toBe(true);
    expect(isOpenReturnStatus("approved")).toBe(true);
    expect(isOpenReturnStatus("received")).toBe(true);
    expect(isOpenReturnStatus("refunded")).toBe(true);
  });

  it("treats rejected and closed as terminal", () => {
    expect(isOpenReturnStatus("rejected")).toBe(false);
    expect(isOpenReturnStatus("closed")).toBe(false);
  });
});

describe("nextReturnActions", () => {
  it("allows approve or reject from requested", () => {
    expect(nextReturnActions("requested")).toEqual([
      { status: "approved", label: "Approve" },
      { status: "rejected", label: "Reject" },
    ]);
  });

  it("allows received, reject, or close from approved", () => {
    expect(nextReturnActions("approved")).toEqual([
      { status: "received", label: "Mark received" },
      { status: "rejected", label: "Reject" },
      { status: "closed", label: "Close" },
    ]);
  });

  it("allows refund or close from received", () => {
    expect(nextReturnActions("received")).toEqual([
      { status: "refunded", label: "Record refund" },
      { status: "closed", label: "Close" },
    ]);
  });

  it("allows only close from refunded", () => {
    expect(nextReturnActions("refunded")).toEqual([{ status: "closed", label: "Close" }]);
  });

  it("returns no actions for terminal statuses", () => {
    expect(nextReturnActions("rejected")).toEqual([]);
    expect(nextReturnActions("closed")).toEqual([]);
  });
});

describe("normalizeSellerReturns", () => {
  it("normalizes numeric fields and items from snake_case rows", () => {
    const rows = normalizeSellerReturns([
      {
        id: "ret-1",
        order_id: "ord-1",
        status: "requested",
        reason: "Damaged box",
        seller_note: "",
        refund_amount: "120.50",
        requested_at: "2026-09-04T10:00:00.000Z",
        resolved_at: null,
        updated_at: "2026-09-04T10:00:00.000Z",
        requested_by: "buyer-1",
        retailer_name: "Rani Retail",
        retailer_email: "rani@example.com",
        supplier_total: "250",
        items: [
          {
            id: "item-1",
            product_name: "Atlas dates",
            quantity: "2",
            unit_price: "60.25",
            line_total: "120.50",
          },
        ],
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "ret-1",
      refund_amount: 120.5,
      supplier_total: 250,
      retailer_name: "Rani Retail",
    });
    expect(rows[0]?.items[0]).toEqual({
      id: "item-1",
      product_name: "Atlas dates",
      quantity: 2,
      unit_price: 60.25,
      line_total: 120.5,
    });
  });

  it("drops malformed rows and defaults empty payloads", () => {
    expect(normalizeSellerReturns(null)).toEqual([]);
    expect(normalizeSellerReturns([{ order_id: "missing-id" }])).toEqual([]);
    expect(normalizeSellerReturn(null)).toBeNull();
  });

  it("falls back unknown status to requested", () => {
    const row = normalizeSellerReturn({
      id: "ret-2",
      order_id: "ord-2",
      status: "mystery",
      reason: "n/a",
    });
    expect(row?.status).toBe("requested");
    expect(returnStatusLabel("approved")).toBe("Approved");
  });
});
