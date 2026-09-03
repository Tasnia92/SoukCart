import { describe, expect, it } from "vite-plus/test";
import { invoiceTotal, type InvoiceOrder } from "./retailer-invoice-api.ts";
import { paymentOutcome } from "./payment-return-api.ts";

describe("payment return API", () => {
  it("maps SSLCommerz status to an outcome", () => {
    expect(paymentOutcome("VALID")).toBe("success");
    expect(paymentOutcome("valid")).toBe("success");
    expect(paymentOutcome("CANCELLED")).toBe("cancelled");
    expect(paymentOutcome("FAILED")).toBe("failed");
    expect(paymentOutcome("anything")).toBe("failed");
    expect(paymentOutcome("")).toBe("unknown");
  });
});

describe("invoice API", () => {
  it("totals paid invoice line items", () => {
    const order: InvoiceOrder = {
      id: "o1",
      created_at: "2026-08-30T12:00:00.000Z",
      paid_at: "2026-08-30T12:05:00.000Z",
      payment_method: "online",
      tran_id: "t1",
      val_id: "v1",
      bank_tran_id: "b1",
      delivery_phone: "01700000000",
      delivery_address: "12 Road",
      delivery_city: "Dhaka",
      delivery_postcode: "1205",
      items: [
        { id: "i1", product_id: "p1", quantity: 2, unit_price: 100, product_name: "Dates" },
        { id: "i2", product_id: "p2", quantity: 3, unit_price: 50, product_name: "Tea" },
      ],
    };
    expect(invoiceTotal(order)).toBe(350);
  });
});
