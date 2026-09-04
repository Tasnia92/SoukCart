import { supabase } from "../../supabase.ts";

export type RetailerShippingAddress = {
  id: string;
  user_id: string;
  label: string;
  phone: string;
  address: string;
  city: string;
  postcode: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export type RetailerAddressInput = {
  label: string;
  phone: string;
  address: string;
  city: string;
  postcode: string;
  isDefault?: boolean;
};

export function retailerPasswordValidationError(
  newPassword: string,
  confirmPassword: string,
): string | null {
  if (newPassword.length < 8) return "Password must be at least 8 characters.";
  if (newPassword !== confirmPassword) return "Passwords do not match.";
  return null;
}

export function retailerNameValidationError(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 2) return "Enter a name with at least 2 characters.";
  if (trimmed.length > 120) return "Name must be 120 characters or fewer.";
  return null;
}

export function retailerAddressValidationError(input: RetailerAddressInput): string | null {
  if (!input.label.trim()) return "Enter a short label for this address.";
  if (!input.phone.trim()) return "Enter a phone number.";
  if (!input.address.trim()) return "Enter a delivery address.";
  if (!input.city.trim()) return "Enter a city.";
  if (!input.postcode.trim()) return "Enter a postcode.";
  return null;
}

function normalizeAddress(row: Record<string, unknown>): RetailerShippingAddress {
  return {
    id: String(row.id ?? ""),
    user_id: String(row.user_id ?? ""),
    label: String(row.label ?? "Address"),
    phone: String(row.phone ?? ""),
    address: String(row.address ?? ""),
    city: String(row.city ?? ""),
    postcode: String(row.postcode ?? ""),
    is_default: Boolean(row.is_default),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

export async function updateRetailerName(userId: string, name: string): Promise<string> {
  const validationError = retailerNameValidationError(name);
  if (validationError) throw new Error(validationError);
  const trimmed = name.trim();
  const { data, error } = await supabase
    .from("users")
    .update({ name: trimmed })
    .eq("id", userId)
    .select("name")
    .single();
  if (error) throw new Error(error.message);
  return String((data as { name?: string } | null)?.name ?? trimmed);
}

export async function updateRetailerPassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);
}

export async function loadRetailerShippingAddresses(
  userId: string,
): Promise<RetailerShippingAddress[]> {
  const { data, error } = await supabase
    .from("retailer_shipping_addresses")
    .select(
      "id, user_id, label, phone, address, city, postcode, is_default, created_at, updated_at",
    )
    .eq("user_id", userId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => normalizeAddress(row as Record<string, unknown>));
}

export async function createRetailerShippingAddress(
  userId: string,
  input: RetailerAddressInput,
): Promise<RetailerShippingAddress> {
  const validationError = retailerAddressValidationError(input);
  if (validationError) throw new Error(validationError);

  const { data, error } = await supabase
    .from("retailer_shipping_addresses")
    .insert({
      user_id: userId,
      label: input.label.trim(),
      phone: input.phone.trim(),
      address: input.address.trim(),
      city: input.city.trim(),
      postcode: input.postcode.trim(),
      is_default: Boolean(input.isDefault),
    })
    .select(
      "id, user_id, label, phone, address, city, postcode, is_default, created_at, updated_at",
    )
    .single();
  if (error) throw new Error(error.message);
  return normalizeAddress(data as Record<string, unknown>);
}

export async function updateRetailerShippingAddress(
  addressId: string,
  input: RetailerAddressInput,
): Promise<RetailerShippingAddress> {
  const validationError = retailerAddressValidationError(input);
  if (validationError) throw new Error(validationError);

  const { data, error } = await supabase
    .from("retailer_shipping_addresses")
    .update({
      label: input.label.trim(),
      phone: input.phone.trim(),
      address: input.address.trim(),
      city: input.city.trim(),
      postcode: input.postcode.trim(),
      is_default: Boolean(input.isDefault),
    })
    .eq("id", addressId)
    .select(
      "id, user_id, label, phone, address, city, postcode, is_default, created_at, updated_at",
    )
    .single();
  if (error) throw new Error(error.message);
  return normalizeAddress(data as Record<string, unknown>);
}

export async function setDefaultRetailerShippingAddress(
  userId: string,
  addressId: string,
): Promise<void> {
  const { error } = await supabase
    .from("retailer_shipping_addresses")
    .update({ is_default: true })
    .eq("id", addressId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export async function deleteRetailerShippingAddress(addressId: string): Promise<void> {
  const { error } = await supabase.from("retailer_shipping_addresses").delete().eq("id", addressId);
  if (error) throw new Error(error.message);
}
