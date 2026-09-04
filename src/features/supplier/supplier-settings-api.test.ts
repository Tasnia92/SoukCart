import { describe, expect, it } from "vite-plus/test";
import {
  deliveryCoverageValidationError,
  normalizeSellerShopSettingsUpdate,
  payoutMethodValidationError,
  processingTimeHoursValidationError,
  sellerPasswordValidationError,
  shopDetailsValidationError,
  shopLocationValidationError,
  shopNameValidationError,
  shopSettingsValidationError,
  updateSellerShopSettings,
  type SellerShopSettingsInput,
  type SupplierSettingsGateway,
} from "./supplier-settings-api.ts";

const validInput: SellerShopSettingsInput = {
  shopName: "Rahman Traders",
  shopDetails: "Wholesale rice and pulses since 2004.",
  location: "Karwan Bazar, Dhaka",
  contactPhone: "01712345678",
  deliveryCoverage: "Dhaka metro",
  processingTimeHours: 24,
  payoutMethod: "manual",
  notifyOrders: true,
  notifyStock: true,
  notifyPayouts: false,
};

describe("seller shop settings validation", () => {
  it("accepts a complete settings payload", () => {
    expect(shopSettingsValidationError(validInput)).toBeNull();
  });

  it("mirrors shop name, details, and location rules", () => {
    expect(shopNameValidationError("")).toMatch(/shop name/i);
    expect(shopDetailsValidationError("short")).toMatch(/detail/i);
    expect(shopLocationValidationError("")).toMatch(/location/i);
  });

  it("validates coverage, processing time, and payout method", () => {
    expect(deliveryCoverageValidationError("x".repeat(501))).toMatch(/500 characters/i);
    expect(processingTimeHoursValidationError(0)).toMatch(/1 and 720/i);
    expect(processingTimeHoursValidationError(24.5)).toMatch(/1 and 720/i);
    expect(payoutMethodValidationError("crypto")).toMatch(/payout method/i);
  });

  it("requires matching passwords of at least 8 characters", () => {
    expect(sellerPasswordValidationError("short", "short")).toMatch(/at least 8/i);
    expect(sellerPasswordValidationError("longenough", "different")).toMatch(/do not match/i);
    expect(sellerPasswordValidationError("longenough", "longenough")).toBeNull();
  });
});

describe("seller shop settings RPC", () => {
  it("normalizes the update response and posts trimmed values", async () => {
    let captured: Record<string, unknown> | null = null;
    const gateway: SupplierSettingsGateway = {
      from: () => {
        throw new Error("unused");
      },
      rpc: async (_fn, args) => {
        captured = args;
        return {
          data: {
            userId: "seller-1",
            shopName: "Rahman Traders",
            shopDetails: "Wholesale rice and pulses since 2004.",
            location: "Karwan Bazar, Dhaka",
            contactPhone: "01712345678",
            deliveryCoverage: "Dhaka metro",
            processingTimeHours: 24,
            payoutMethod: "manual",
            notifyOrders: true,
            notifyStock: true,
            notifyPayouts: false,
            status: "approved",
            updatedAt: "2026-09-04T12:00:00.000Z",
          },
          error: null,
        };
      },
      auth: {
        updateUser: async () => ({ error: null }),
      },
    };

    const result = await updateSellerShopSettings(
      {
        ...validInput,
        shopName: "  Rahman Traders  ",
        deliveryCoverage: "  Dhaka metro  ",
      },
      gateway,
    );

    expect(captured).toMatchObject({
      p_shop_name: "Rahman Traders",
      p_delivery_coverage: "Dhaka metro",
      p_notify_payouts: false,
    });
    expect(result.shopName).toBe("Rahman Traders");
    expect(result.notifyPayouts).toBe(false);
  });

  it("rejects empty RPC payloads", () => {
    expect(() => normalizeSellerShopSettingsUpdate(null)).toThrow(/empty/i);
  });
});
