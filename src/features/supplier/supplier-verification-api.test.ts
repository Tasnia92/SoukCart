import { describe, expect, it } from "vite-plus/test";
import {
  applicationValidationError,
  contactPhoneValidationError,
  loadSupplierVerification,
  nidCardValidationError,
  resolveSupplierGate,
  submitSupplierApplication,
  SUPPLIER_VERIFICATION_COLUMNS,
  tradeLicenseNumberValidationError,
  type SupplierApplicationFiles,
  type SupplierApplicationInput,
  type SupplierVerification,
  type SupplierVerificationGateway,
} from "./supplier-verification-api.ts";

function verification(overrides: Partial<SupplierVerification> = {}): SupplierVerification {
  return {
    user_id: "seller-1",
    shop_name: "Rahman Traders",
    shop_details: "Wholesale rice and pulses since 2004.",
    location: "Karwan Bazar, Dhaka",
    trade_license_number: "TRAD/DNCC/1234/2024",
    nid_front_path: "seller-1/nid-front.jpg",
    nid_back_path: "seller-1/nid-back.jpg",
    contact_phone: "01712345678",
    status: "pending",
    review_note: null,
    reviewed_at: null,
    created_at: "2026-09-01T09:00:00.000Z",
    updated_at: "2026-09-01T09:00:00.000Z",
    ...overrides,
  };
}

function nidFile(name = "nid-front.jpg", type = "image/jpeg", size = 1024): File {
  return { type, size, name } as unknown as File;
}

const validInput: SupplierApplicationInput = {
  shopName: "Rahman Traders",
  shopDetails: "Wholesale rice and pulses since 2004.",
  location: "Karwan Bazar, Dhaka",
  tradeLicenseNumber: "TRAD/DNCC/1234/2024",
  contactPhone: "01712345678",
};

const validFiles: SupplierApplicationFiles = {
  nidFront: nidFile("nid-front.jpg"),
  nidBack: nidFile("nid-back.jpg"),
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
    expect(applicationValidationError(validInput, validFiles)).toBeNull();
  });

  it("requires shop name, details, and location", () => {
    expect(applicationValidationError({ ...validInput, shopName: "" }, validFiles)).toMatch(
      /shop name/i,
    );
    expect(applicationValidationError({ ...validInput, shopDetails: "short" }, validFiles)).toMatch(
      /detail/i,
    );
    expect(applicationValidationError({ ...validInput, location: "" }, validFiles)).toMatch(
      /location/i,
    );
  });

  it("requires a trade licence number", () => {
    expect(tradeLicenseNumberValidationError("")).toMatch(/trade licence number/i);
    expect(tradeLicenseNumberValidationError("ab")).toMatch(/trade licence number/i);
    expect(tradeLicenseNumberValidationError("TRAD/DNCC/1234/2024")).toBeNull();
    expect(
      applicationValidationError({ ...validInput, tradeLicenseNumber: "ab" }, validFiles),
    ).toMatch(/trade licence number/i);
  });

  it("requires a contact phone number", () => {
    expect(contactPhoneValidationError("")).toMatch(/phone/i);
    expect(contactPhoneValidationError("123")).toMatch(/phone/i);
    expect(contactPhoneValidationError("01712 345 678")).toBeNull();
    expect(contactPhoneValidationError("+8801712345678")).toBeNull();
    expect(applicationValidationError({ ...validInput, contactPhone: "12" }, validFiles)).toMatch(
      /phone/i,
    );
  });

  it("requires NID front and back unless they were already uploaded", () => {
    expect(applicationValidationError(validInput, { ...validFiles, nidFront: null })).toMatch(
      /front of your NID/i,
    );
    expect(applicationValidationError(validInput, { ...validFiles, nidBack: null })).toMatch(
      /back of your NID/i,
    );
    expect(
      applicationValidationError(
        validInput,
        { nidFront: null, nidBack: null },
        { nidFront: true, nidBack: true },
      ),
    ).toBeNull();
  });

  it("rejects unsupported or oversized NID card photos", () => {
    expect(nidCardValidationError(null, "front")).toMatch(/front of your NID/i);
    expect(nidCardValidationError(nidFile("nid.pdf", "application/pdf"), "back")).toMatch(
      /NID card back as an image/i,
    );
    expect(
      nidCardValidationError(nidFile("nid.jpg", "image/jpeg", 6 * 1024 * 1024), "front"),
    ).toMatch(/5 MB/i);
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
      {
        shopName: "  Rahman Traders  ",
        shopDetails: "  Wholesale rice.  ",
        location: "  Dhaka  ",
        tradeLicenseNumber: "  TRAD/DNCC/1234/2024  ",
        contactPhone: "  01712345678  ",
      },
      {
        nidFrontPath: "seller-1/nid-front.jpg",
        nidBackPath: "seller-1/nid-back.jpg",
      },
      gateway,
    );

    expect(upserted).toEqual({
      values: {
        user_id: "seller-1",
        shop_name: "Rahman Traders",
        shop_details: "Wholesale rice.",
        location: "Dhaka",
        trade_license_number: "TRAD/DNCC/1234/2024",
        nid_front_path: "seller-1/nid-front.jpg",
        nid_back_path: "seller-1/nid-back.jpg",
        contact_phone: "01712345678",
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
