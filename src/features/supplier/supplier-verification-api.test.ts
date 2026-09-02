import { describe, expect, it } from "vite-plus/test";
import {
  applicationValidationError,
  loadSupplierVerification,
  resolveSupplierGate,
  submitSupplierApplication,
  SUPPLIER_VERIFICATION_COLUMNS,
  tradeLicenseValidationError,
  type SupplierVerification,
  type SupplierVerificationGateway,
} from "./supplier-verification-api.ts";

function verification(overrides: Partial<SupplierVerification> = {}): SupplierVerification {
  return {
    user_id: "seller-1",
    shop_name: "Rahman Traders",
    shop_details: "Wholesale rice and pulses since 2004.",
    location: "Karwan Bazar, Dhaka",
    trade_license_path: "seller-1/licence.pdf",
    status: "pending",
    review_note: null,
    reviewed_at: null,
    created_at: "2026-09-01T09:00:00.000Z",
    updated_at: "2026-09-01T09:00:00.000Z",
    ...overrides,
  };
}

function licenseFile(type = "application/pdf", size = 1024): File {
  return { type, size, name: "licence.pdf" } as unknown as File;
}

const validInput = {
  shopName: "Rahman Traders",
  shopDetails: "Wholesale rice and pulses since 2004.",
  location: "Karwan Bazar, Dhaka",
};

describe("supplier verification gate", () => {
  it("routes each application status to the right screen", () => {
    expect(resolveSupplierGate(null)).toBe("onboarding");
    expect(resolveSupplierGate(verification({ status: "pending" }))).toBe("pending");
    expect(resolveSupplierGate(verification({ status: "rejected" }))).toBe("rejected");
    expect(resolveSupplierGate(verification({ status: "approved" }))).toBe("approved");
  });
});

describe("supplier application validation", () => {
  it("accepts a complete first-time submission", () => {
    expect(applicationValidationError(validInput, licenseFile())).toBeNull();
  });

  it("requires shop name, details, and location", () => {
    expect(applicationValidationError({ ...validInput, shopName: "" }, licenseFile())).toMatch(
      /shop name/i,
    );
    expect(
      applicationValidationError({ ...validInput, shopDetails: "short" }, licenseFile()),
    ).toMatch(/detail/i);
    expect(applicationValidationError({ ...validInput, location: "" }, licenseFile())).toMatch(
      /location/i,
    );
  });

  it("requires a trade licence unless one was already uploaded", () => {
    expect(applicationValidationError(validInput, null)).toMatch(/trade licence/i);
    expect(applicationValidationError(validInput, null, true)).toBeNull();
  });

  it("rejects unsupported or oversized trade licences", () => {
    expect(tradeLicenseValidationError(null)).toMatch(/trade licence/i);
    expect(tradeLicenseValidationError(licenseFile("text/csv"))).toMatch(/PDF or an image/i);
    expect(tradeLicenseValidationError(licenseFile("application/pdf", 6 * 1024 * 1024))).toMatch(
      /5 MB/i,
    );
  });
});

describe("supplier verification queries", () => {
  it("loads the seller's own application with the preserved column contract", async () => {
    const calls: Array<{ method: string; values: unknown[] }> = [];
    const row = verification();
    const gateway = {
      from(table: string) {
        calls.push({ method: "from", values: [table] });
        return {
          select(columns: string) {
            calls.push({ method: "select", values: [columns] });
            return {
              eq(column: string, value: string) {
                calls.push({ method: "eq", values: [column, value] });
                return { maybeSingle: async () => ({ data: row, error: null }) };
              },
            };
          },
          upsert: async () => ({ error: null }),
        };
      },
    } as unknown as SupplierVerificationGateway;

    await expect(loadSupplierVerification("seller-1", gateway)).resolves.toEqual(row);
    expect(calls).toEqual([
      { method: "from", values: ["supplier_profiles"] },
      { method: "select", values: [SUPPLIER_VERIFICATION_COLUMNS] },
      { method: "eq", values: ["user_id", "seller-1"] },
    ]);
  });

  it("submits a trimmed, pending application keyed on user_id", async () => {
    let upserted: { values: Record<string, unknown>; options: { onConflict: string } } | null =
      null;
    const gateway = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        upsert: async (values: Record<string, unknown>, options: { onConflict: string }) => {
          upserted = { values, options };
          return { error: null };
        },
      }),
    } as unknown as SupplierVerificationGateway;

    await submitSupplierApplication(
      "seller-1",
      { shopName: "  Rahman Traders  ", shopDetails: "  Wholesale rice.  ", location: "  Dhaka  " },
      "seller-1/licence.pdf",
      gateway,
    );

    expect(upserted).toEqual({
      values: {
        user_id: "seller-1",
        shop_name: "Rahman Traders",
        shop_details: "Wholesale rice.",
        location: "Dhaka",
        trade_license_path: "seller-1/licence.pdf",
        status: "pending",
        review_note: null,
        reviewed_by: null,
        reviewed_at: null,
      },
      options: { onConflict: "user_id" },
    });
  });

  it("surfaces the load error without rewriting its message", async () => {
    const gateway = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: { message: "Row unavailable." } }),
          }),
        }),
        upsert: async () => ({ error: null }),
      }),
    } as unknown as SupplierVerificationGateway;

    await expect(loadSupplierVerification("seller-1", gateway)).rejects.toThrow("Row unavailable.");
  });
});
