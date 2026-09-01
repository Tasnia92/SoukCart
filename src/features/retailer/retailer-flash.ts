export const RETAILER_NOTICE_KEY = "soukcart:notice";

export type RetailerFlashNotice = { message: string; state: "success" };

// Consumes the one-shot `soukcart:notice` flash written before COD/payment redirects.
export function consumeRetailerNotice(): RetailerFlashNotice | null {
  if (typeof sessionStorage === "undefined") return null;
  const message = sessionStorage.getItem(RETAILER_NOTICE_KEY);
  if (!message) return null;
  sessionStorage.removeItem(RETAILER_NOTICE_KEY);
  return { message, state: "success" };
}
