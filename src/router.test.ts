import { describe, expect, it } from "vite-plus/test";
import {
  fallbackRouteContract,
  FLASH_STORAGE_KEYS,
  getFallbackDestination,
  legacyRouteContract,
  PAYMENT_SEARCH_KEYS,
  shouldRenderPaymentResult,
} from "./router.tsx";

const expectedRoutes = {
  "/": "root",
  "/admin": "admin",
  "/admin/users": "admin",
  "/admin/activity": "admin",
  "/admin/complaints": "admin",
  "/retailer": "retailer",
  "/retailer/catalog": "retailer",
  "/retailer/cart": "retailer",
  "/retailer/orders": "retailer",
  "/retailer/orders/$orderId/invoice": "retailer",
  "/retailer/complaints": "retailer",
  "/retailer/checkout/success": "retailer",
  "/retailer/checkout/failed": "retailer",
  "/retailer/checkout/cancelled": "retailer",
  "/supplier": "supplier",
  "/supplier/orders": "supplier",
  "/supplier/products": "supplier",
  "/supplier/products/new": "supplier",
  "/supplier/products/$productId/edit": "supplier",
  "/supplier/stock": "supplier",
};

describe("legacy route contract", () => {
  it("maps every inventory route to its legacy renderer", () => {
    expect(
      Object.fromEntries(legacyRouteContract.map(({ path, target }) => [path, target])),
    ).toEqual(expectedRoutes);
  });

  it("redirects unknown paths to the safe family overview", () => {
    expect(fallbackRouteContract).toEqual([
      { path: "/admin/$", to: "/admin" },
      { path: "/retailer/$", to: "/retailer" },
      { path: "/supplier/$", to: "/supplier" },
      { path: "$", to: "/" },
    ]);
    expect(getFallbackDestination("/admin/unknown")).toBe("/admin");
    expect(getFallbackDestination("/retailer/unknown")).toBe("/retailer");
    expect(getFallbackDestination("/supplier/unknown")).toBe("/supplier");
    expect(getFallbackDestination("/adminfoo")).toBe("/");
    expect(getFallbackDestination("/unknown")).toBe("/");
  });

  it("preserves payment and flash key names", () => {
    expect(PAYMENT_SEARCH_KEYS).toEqual(["status", "tran_id", "val_id"]);
    expect(FLASH_STORAGE_KEYS).toEqual({
      notice: "soukcart:notice",
      supplierNotice: "soukcart:supplier-notice",
      paymentReturn: "soukcart:payment-return",
    });
  });
});

describe("root payment precedence", () => {
  it.each([
    ["truthy status", "/", "?status=VALID&tran_id=t&val_id=v", null, true],
    ["empty status", "/", "?status=&tran_id=t&val_id=v", null, false],
    ["payment return flag", "/", "", "1", true],
    ["transaction alone", "/", "?tran_id=t", null, false],
    ["non-root status", "/retailer", "?status=VALID", "1", false],
    ["ordinary auth", "/", "", null, false],
  ])("handles %s", (_name, pathname, search, paymentReturn, expected) => {
    expect(shouldRenderPaymentResult({ pathname, search, paymentReturn })).toBe(expected);
  });
});
