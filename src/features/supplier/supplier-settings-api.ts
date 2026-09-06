import { supabase } from "../../supabase.ts";
import {
  contactPhoneValidationError,
  type VerificationStatus,
} from "./supplier-verification-api.ts";

export const SUPPLIER_SHOP_SETTINGS_COLUMNS =
  "user_id, shop_name, shop_details, location, trade_license_number, nid_front_path, nid_back_path, contact_phone, status, review_note, reviewed_at, created_at, updated_at";

export type SupplierShopSettings = {
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

export type SellerShopSettingsInput = {
  shopName: string;
  shopDetails: string;
  location: string;
  contactPhone: string;
};

export type SellerShopSettingsUpdate = {
  userId: string;
  shopName: string;
  shopDetails: string;
  location: string;
  contactPhone: string;
  status: VerificationStatus;
  updatedAt: string;
};

const MIN_PASSWORD_LENGTH = 8;

export function shopNameValidationError(value: string): string | null {
  const shopName = value.trim();
  if (shopName.length < 2 || shopName.length > 120) {
    return "Enter your shop name (2–120 characters).";
  }
  return null;
}

export function shopDetailsValidationError(value: string): string | null {
  const shopDetails = value.trim();
  if (shopDetails.length < 10 || shopDetails.length > 2000) {
    return "Describe your shop in a little detail (10–2000 characters).";
  }
  return null;
}

export function shopLocationValidationError(value: string): string | null {
  const location = value.trim();
  if (location.length < 2 || location.length > 200) {
    return "Enter your shop location (2–200 characters).";
  }
  return null;
}

export function sellerPasswordValidationError(
  password: string,
  confirmPassword: string,
): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password !== confirmPassword) {
    return "Passwords do not match.";
  }
  return null;
}

export function shopSettingsValidationError(input: SellerShopSettingsInput): string | null {
  return (
    shopNameValidationError(input.shopName) ??
    shopDetailsValidationError(input.shopDetails) ??
    shopLocationValidationError(input.location) ??
    contactPhoneValidationError(input.contactPhone)
  );
}

function normalizeShopSettingsRow(row: Record<string, unknown>): SupplierShopSettings {
  return {
    user_id: typeof row.user_id === "string" ? row.user_id : "",
    shop_name: typeof row.shop_name === "string" ? row.shop_name : "",
    shop_details: typeof row.shop_details === "string" ? row.shop_details : "",
    location: typeof row.location === "string" ? row.location : "",
    trade_license_number:
      typeof row.trade_license_number === "string" ? row.trade_license_number : "",
    nid_front_path: typeof row.nid_front_path === "string" ? row.nid_front_path : "",
    nid_back_path: typeof row.nid_back_path === "string" ? row.nid_back_path : "",
    contact_phone: typeof row.contact_phone === "string" ? row.contact_phone : "",
    status:
      row.status === "approved" || row.status === "rejected" || row.status === "pending"
        ? row.status
        : "pending",
    review_note: typeof row.review_note === "string" ? row.review_note : null,
    reviewed_at: typeof row.reviewed_at === "string" ? row.reviewed_at : null,
    created_at: typeof row.created_at === "string" ? row.created_at : "",
    updated_at: typeof row.updated_at === "string" ? row.updated_at : "",
  };
}

export function normalizeSellerShopSettingsUpdate(data: unknown): SellerShopSettingsUpdate {
  if (!data || typeof data !== "object") {
    throw new Error("Settings response was empty.");
  }
  const row = data as Record<string, unknown>;
  return {
    userId: typeof row.userId === "string" ? row.userId : "",
    shopName: typeof row.shopName === "string" ? row.shopName : "",
    shopDetails: typeof row.shopDetails === "string" ? row.shopDetails : "",
    location: typeof row.location === "string" ? row.location : "",
    contactPhone: typeof row.contactPhone === "string" ? row.contactPhone : "",
    status:
      row.status === "approved" || row.status === "rejected" || row.status === "pending"
        ? row.status
        : "pending",
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : "",
  };
}

type SupplierShopSettingsQuery = {
  data: Record<string, unknown> | null;
  error: { message: string } | null;
};

export type SupplierSettingsGateway = {
  from: (table: "supplier_profiles") => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => { maybeSingle: () => Promise<SupplierShopSettingsQuery> };
    };
  };
  rpc: (
    fn: "update_seller_shop_settings",
    args: {
      p_shop_name: string;
      p_shop_details: string;
      p_location: string;
      p_contact_phone: string;
    },
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  auth: {
    updateUser: (attributes: {
      password: string;
    }) => Promise<{ error: { message: string } | null }>;
  };
};

const settingsGateway = supabase as unknown as SupplierSettingsGateway;

export async function loadSupplierShopSettings(
  userId: string,
  gateway: SupplierSettingsGateway = settingsGateway,
): Promise<SupplierShopSettings | null> {
  const { data, error } = await gateway
    .from("supplier_profiles")
    .select(SUPPLIER_SHOP_SETTINGS_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return normalizeShopSettingsRow(data);
}

export async function updateSellerShopSettings(
  input: SellerShopSettingsInput,
  gateway: SupplierSettingsGateway = settingsGateway,
): Promise<SellerShopSettingsUpdate> {
  const validationError = shopSettingsValidationError(input);
  if (validationError) throw new Error(validationError);

  const { data, error } = await gateway.rpc("update_seller_shop_settings", {
    p_shop_name: input.shopName.trim(),
    p_shop_details: input.shopDetails.trim(),
    p_location: input.location.trim(),
    p_contact_phone: input.contactPhone.trim(),
  });
  if (error) throw new Error(error.message);
  return normalizeSellerShopSettingsUpdate(data);
}

export async function updateSellerPassword(
  newPassword: string,
  gateway: SupplierSettingsGateway = settingsGateway,
): Promise<void> {
  const { error } = await gateway.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);
}

export function verificationStatusLabel(status: VerificationStatus): string {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  return "Pending review";
}
