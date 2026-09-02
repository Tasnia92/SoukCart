import { supabase } from "../../supabase.ts";

export const TRADE_LICENSES_BUCKET = "trade-licenses";
export const MAX_TRADE_LICENSE_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_TRADE_LICENSE_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
] as const;

export const SUPPLIER_VERIFICATION_COLUMNS =
  "user_id, shop_name, shop_details, location, trade_license_path, status, review_note, reviewed_at, created_at, updated_at";

export type VerificationStatus = "pending" | "approved" | "rejected";

export type SupplierVerification = {
  user_id: string;
  shop_name: string;
  shop_details: string;
  location: string;
  trade_license_path: string;
  status: VerificationStatus;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SupplierApplicationInput = {
  shopName: string;
  shopDetails: string;
  location: string;
};

/** The screen a seller should see, derived from their application row. */
export type SupplierGateStage = "onboarding" | "pending" | "rejected" | "approved";

export function resolveSupplierGate(verification: SupplierVerification | null): SupplierGateStage {
  if (!verification) return "onboarding";
  if (verification.status === "approved") return "approved";
  if (verification.status === "rejected") return "rejected";
  return "pending";
}

export function tradeLicenseValidationError(file: File | null): string | null {
  if (!file) return "Attach your trade licence to continue.";
  if (!(ACCEPTED_TRADE_LICENSE_TYPES as readonly string[]).includes(file.type)) {
    return "Upload the trade licence as a PDF or an image (PNG, JPG, or WebP).";
  }
  if (file.size > MAX_TRADE_LICENSE_BYTES) {
    return "The trade licence must be 5 MB or smaller.";
  }
  return null;
}

/**
 * Validates the whole onboarding submission. `hasExistingLicense` lets a seller
 * resubmit after a rejection without re-uploading the same document.
 */
export function applicationValidationError(
  input: SupplierApplicationInput,
  file: File | null,
  hasExistingLicense = false,
): string | null {
  const shopName = input.shopName.trim();
  const shopDetails = input.shopDetails.trim();
  const location = input.location.trim();

  if (shopName.length < 2 || shopName.length > 120) {
    return "Enter your shop name (2–120 characters).";
  }
  if (shopDetails.length < 10 || shopDetails.length > 2000) {
    return "Describe your shop in a little detail (10–2000 characters).";
  }
  if (location.length < 2 || location.length > 200) {
    return "Enter your shop location (2–200 characters).";
  }
  if (!file && !hasExistingLicense) {
    return "Attach your trade licence to continue.";
  }
  if (file) return tradeLicenseValidationError(file);
  return null;
}

type SupplierVerificationQuery = {
  data: SupplierVerification | null;
  error: { message: string } | null;
};

export type SupplierVerificationGateway = {
  from: (table: "supplier_profiles") => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => { maybeSingle: () => Promise<SupplierVerificationQuery> };
    };
    upsert: (
      values: Record<string, unknown>,
      options: { onConflict: string },
    ) => Promise<{ error: { message: string } | null }>;
  };
};

const verificationGateway = supabase as unknown as SupplierVerificationGateway;

export async function loadSupplierVerification(
  userId: string,
  gateway: SupplierVerificationGateway = verificationGateway,
): Promise<SupplierVerification | null> {
  const { data, error } = await gateway
    .from("supplier_profiles")
    .select(SUPPLIER_VERIFICATION_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function uploadTradeLicense(userId: string, file: File): Promise<string> {
  const validationError = tradeLicenseValidationError(file);
  if (validationError) throw new Error(validationError);

  const extension = fileExtension(file);
  const objectPath = `${userId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage
    .from(TRADE_LICENSES_BUCKET)
    .upload(objectPath, file, { contentType: file.type, cacheControl: "3600", upsert: false });
  if (error) throw new Error(`The trade licence could not be uploaded. ${error.message}`);
  return objectPath;
}

export async function submitSupplierApplication(
  userId: string,
  input: SupplierApplicationInput,
  tradeLicensePath: string,
  gateway: SupplierVerificationGateway = verificationGateway,
): Promise<void> {
  const { error } = await gateway.from("supplier_profiles").upsert(
    {
      user_id: userId,
      shop_name: input.shopName.trim(),
      shop_details: input.shopDetails.trim(),
      location: input.location.trim(),
      trade_license_path: tradeLicensePath,
      status: "pending",
      review_note: null,
      reviewed_by: null,
      reviewed_at: null,
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(error.message);
}

function fileExtension(file: File): string {
  if (file.type === "application/pdf") return "pdf";
  const subtype = file.type.split("/")[1] ?? "";
  if (subtype) return subtype.replace("jpeg", "jpg");
  const nameExt = file.name.split(".").pop();
  return nameExt ? nameExt.toLowerCase() : "bin";
}
