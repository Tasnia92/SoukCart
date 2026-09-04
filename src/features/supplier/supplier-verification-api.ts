import { supabase } from "../../supabase.ts";

export const TRADE_LICENSES_BUCKET = "trade-licenses";
export const MAX_NID_CARD_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_NID_CARD_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
] as const;

export const SUPPLIER_VERIFICATION_COLUMNS =
  "user_id, shop_name, shop_details, location, trade_license_number, nid_front_path, nid_back_path, contact_phone, status, review_note, reviewed_at, created_at, updated_at";

export type VerificationStatus = "pending" | "approved" | "rejected";

export type SupplierVerification = {
  user_id: string;
  shop_name: string;
  shop_details: string;
  location: string;
  trade_license_number: string;
  nid_front_path: string;
  nid_back_path: string;
  contact_phone: string;
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
  tradeLicenseNumber: string;
  contactPhone: string;
};

export type SupplierApplicationFiles = {
  nidFront: File | null;
  nidBack: File | null;
};

export type ExistingSupplierDocuments = {
  nidFront: boolean;
  nidBack: boolean;
};

export type SupplierApplicationDocuments = {
  nidFrontPath: string;
  nidBackPath: string;
};

/** The screen a seller should see, derived from their application row. */
export type SupplierGateStage = "onboarding" | "pending" | "rejected" | "approved";

export function resolveSupplierGate(verification: SupplierVerification | null): SupplierGateStage {
  if (!verification) return "onboarding";
  if (verification.status === "approved") return "approved";
  if (verification.status === "rejected") return "rejected";
  return "pending";
}

export function nidCardValidationError(file: File | null, side: "front" | "back"): string | null {
  const label = side === "front" ? "front" : "back";
  if (!file) return `Attach the ${label} of your NID card to continue.`;
  if (!(ACCEPTED_NID_CARD_TYPES as readonly string[]).includes(file.type)) {
    return `Upload the NID card ${label} as an image (PNG, JPG, or WebP).`;
  }
  if (file.size > MAX_NID_CARD_BYTES) {
    return `The NID card ${label} must be 5 MB or smaller.`;
  }
  return null;
}

export function tradeLicenseNumberValidationError(value: string): string | null {
  const number = value.trim();
  if (number.length < 4 || number.length > 60) {
    return "Enter your trade licence number (4–60 characters).";
  }
  return null;
}

export function contactPhoneValidationError(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) {
    return "Enter a valid contact phone number.";
  }
  return null;
}

const NO_EXISTING_DOCUMENTS: ExistingSupplierDocuments = {
  nidFront: false,
  nidBack: false,
};

/**
 * Validates the whole onboarding submission. `existing` lets a seller
 * resubmit after a rejection without re-uploading documents that are already on file.
 */
export function applicationValidationError(
  input: SupplierApplicationInput,
  files: SupplierApplicationFiles,
  existing: ExistingSupplierDocuments = NO_EXISTING_DOCUMENTS,
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

  const licenseNumberError = tradeLicenseNumberValidationError(input.tradeLicenseNumber);
  if (licenseNumberError) return licenseNumberError;

  const phoneError = contactPhoneValidationError(input.contactPhone);
  if (phoneError) return phoneError;

  if (!files.nidFront && !existing.nidFront) {
    return "Attach the front of your NID card to continue.";
  }
  if (files.nidFront) {
    const nidFrontError = nidCardValidationError(files.nidFront, "front");
    if (nidFrontError) return nidFrontError;
  }

  if (!files.nidBack && !existing.nidBack) {
    return "Attach the back of your NID card to continue.";
  }
  if (files.nidBack) {
    const nidBackError = nidCardValidationError(files.nidBack, "back");
    if (nidBackError) return nidBackError;
  }

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
  };
  rpc: (
    fn: "submit_supplier_application",
    args: {
      p_shop_name: string;
      p_shop_details: string;
      p_location: string;
      p_trade_license_number: string;
      p_contact_phone: string;
      p_nid_front_path: string;
      p_nid_back_path: string;
    },
  ) => Promise<{ error: { message: string } | null }>;
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

export async function uploadSupplierDocument(
  userId: string,
  file: File,
  kind: "nid-front" | "nid-back",
): Promise<string> {
  const validationError = nidCardValidationError(file, kind === "nid-front" ? "front" : "back");
  if (validationError) throw new Error(validationError);

  const extension = fileExtension(file);
  const objectPath = `${userId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage
    .from(TRADE_LICENSES_BUCKET)
    .upload(objectPath, file, { contentType: file.type, cacheControl: "3600", upsert: false });
  if (error) {
    const label = kind === "nid-front" ? "NID card front" : "NID card back";
    throw new Error(`The ${label} could not be uploaded. ${error.message}`);
  }
  return objectPath;
}

/** Remove an uploaded NID object after a failed submit so partial uploads do not linger. */
export async function removeSupplierDocument(objectPath: string): Promise<void> {
  if (!objectPath.trim()) return;
  await supabase.storage.from(TRADE_LICENSES_BUCKET).remove([objectPath]);
}

export async function submitSupplierApplication(
  _userId: string,
  input: SupplierApplicationInput,
  documents: SupplierApplicationDocuments,
  gateway: SupplierVerificationGateway = verificationGateway,
): Promise<void> {
  const { error } = await gateway.rpc("submit_supplier_application", {
    p_shop_name: input.shopName.trim(),
    p_shop_details: input.shopDetails.trim(),
    p_location: input.location.trim(),
    p_trade_license_number: input.tradeLicenseNumber.trim(),
    p_contact_phone: input.contactPhone.trim(),
    p_nid_front_path: documents.nidFrontPath,
    p_nid_back_path: documents.nidBackPath,
  });
  if (error) throw new Error(error.message);
}

function fileExtension(file: File): string {
  const subtype = file.type.split("/")[1] ?? "";
  if (subtype) return subtype.replace("jpeg", "jpg");
  const nameExt = file.name.split(".").pop();
  return nameExt ? nameExt.toLowerCase() : "bin";
}
