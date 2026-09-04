import { supabase } from "../../supabase.ts";
import {
  contactPhoneValidationError,
  type VerificationStatus,
} from "./supplier-verification-api.ts";

export type SellerPayoutMethod = "manual" | "bank_transfer" | "mobile_wallet";

export const SELLER_PAYOUT_METHODS = [
  "manual",
  "bank_transfer",
  "mobile_wallet",
] as const satisfies readonly SellerPayoutMethod[];

export const SUPPLIER_SHOP_SETTINGS_COLUMNS =
  "user_id, shop_name, shop_details, location, trade_license_number, nid_front_path, nid_back_path, contact_phone, status, review_note, reviewed_at, delivery_coverage, processing_time_hours, payout_method, notify_orders, notify_stock, notify_payouts, created_at, updated_at";

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
  delivery_coverage: string;
  processing_time_hours: number;
  payout_method: SellerPayoutMethod;
  notify_orders: boolean;
  notify_stock: boolean;
  notify_payouts: boolean;
  created_at: string;
  updated_at: string;
};

export type SellerShopSettingsInput = {
  shopName: string;
  shopDetails: string;
  location: string;
  contactPhone: string;
  deliveryCoverage: string;
  processingTimeHours: number;
  payoutMethod: SellerPayoutMethod;
  notifyOrders: boolean;
  notifyStock: boolean;
  notifyPayouts: boolean;
};

export type SellerShopSettingsUpdate = {
  userId: string;
  shopName: string;
  shopDetails: string;
  location: string;
  contactPhone: string;
  deliveryCoverage: string;
  processingTimeHours: number;
  payoutMethod: SellerPayoutMethod;
  notifyOrders: boolean;
  notifyStock: boolean;
  notifyPayouts: boolean;
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

export function deliveryCoverageValidationError(value: string): string | null {
  if (value.trim().length > 500) {
    return "Delivery coverage must be 500 characters or fewer.";
  }
  return null;
}

export function processingTimeHoursValidationError(value: number): string | null {
  if (!Number.isInteger(value) || value < 1 || value > 720) {
    return "Processing time must be between 1 and 720 hours.";
  }
  return null;
}

export function payoutMethodValidationError(value: string): string | null {
  if (!(SELLER_PAYOUT_METHODS as readonly string[]).includes(value)) {
    return "Choose a valid payout method.";
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
    contactPhoneValidationError(input.contactPhone) ??
    deliveryCoverageValidationError(input.deliveryCoverage) ??
    processingTimeHoursValidationError(input.processingTimeHours) ??
    payoutMethodValidationError(input.payoutMethod)
  );
}

function asPayoutMethod(value: unknown): SellerPayoutMethod {
  return value === "bank_transfer" || value === "mobile_wallet" ? value : "manual";
}

function asBool(value: unknown, fallback = true): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asHours(value: unknown): number {
  const hours = Number(value);
  return Number.isInteger(hours) && hours >= 1 ? hours : 24;
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
    delivery_coverage: typeof row.delivery_coverage === "string" ? row.delivery_coverage : "",
    processing_time_hours: asHours(row.processing_time_hours),
    payout_method: asPayoutMethod(row.payout_method),
    notify_orders: asBool(row.notify_orders),
    notify_stock: asBool(row.notify_stock),
    notify_payouts: asBool(row.notify_payouts),
    created_at: typeof row.created_at === "string" ? row.created_at : "",
    updated_at: typeof row.updated_at === "string" ? row.updated_at : "",
  };
}

export function normalizeSellerShopSettingsUpdate(data: unknown): SellerShopSettingsUpdate {
  if (!data || typeof data !== "object") {
    throw new Error("Shop settings response was empty.");
  }
  const row = data as Record<string, unknown>;
  return {
    userId: typeof row.userId === "string" ? row.userId : "",
    shopName: typeof row.shopName === "string" ? row.shopName : "",
    shopDetails: typeof row.shopDetails === "string" ? row.shopDetails : "",
    location: typeof row.location === "string" ? row.location : "",
    contactPhone: typeof row.contactPhone === "string" ? row.contactPhone : "",
    deliveryCoverage: typeof row.deliveryCoverage === "string" ? row.deliveryCoverage : "",
    processingTimeHours: asHours(row.processingTimeHours),
    payoutMethod: asPayoutMethod(row.payoutMethod),
    notifyOrders: asBool(row.notifyOrders),
    notifyStock: asBool(row.notifyStock),
    notifyPayouts: asBool(row.notifyPayouts),
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
      p_delivery_coverage: string;
      p_processing_time_hours: number;
      p_payout_method: string;
      p_notify_orders: boolean;
      p_notify_stock: boolean;
      p_notify_payouts: boolean;
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
    p_delivery_coverage: input.deliveryCoverage.trim(),
    p_processing_time_hours: input.processingTimeHours,
    p_payout_method: input.payoutMethod,
    p_notify_orders: input.notifyOrders,
    p_notify_stock: input.notifyStock,
    p_notify_payouts: input.notifyPayouts,
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

export function payoutMethodLabel(method: SellerPayoutMethod): string {
  if (method === "bank_transfer") return "Bank transfer";
  if (method === "mobile_wallet") return "Mobile wallet";
  return "Manual / on request";
}

export function verificationStatusLabel(status: VerificationStatus): string {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  return "Pending review";
}
