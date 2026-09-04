// @ts-expect-error Deno resolves npm imports in the Edge runtime.
import { createClient } from "npm:@supabase/supabase-js@2";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

// Sandbox demo default — same idea as SSLCommerz sandbox credentials.
// Override with PATHAO_WEBHOOK_SECRET in a real deployment.
const integrationSecret =
  Deno.env.get("PATHAO_WEBHOOK_INTEGRATION_SECRET") ?? "f3992ecc-59da-4cbe-a049-a13da2018d51";
const webhookSecret = Deno.env.get("PATHAO_WEBHOOK_SECRET") ?? integrationSecret;

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = getServiceKey();
const admin = createClient(supabaseUrl, serviceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type, x-pathao-signature, x-pathao-merchant-webhook-integration-secret",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  if (request.method !== "POST") {
    return json({ message: "Method not allowed" }, 405);
  }

  try {
    const body = await readBody(request);
    const event = readText(body.event).trim();

    // Pathao merchant panel webhook URL verification handshake.
    if (event === "webhook_integration") {
      return new Response(
        JSON.stringify({ message: "Successfully accepted webhook_integration" }),
        {
          status: 202,
          headers: {
            "Content-Type": "application/json",
            "X-Pathao-Merchant-Webhook-Integration-Secret": integrationSecret,
          },
        },
      );
    }

    const signature =
      request.headers.get("X-Pathao-Signature") ??
      request.headers.get("x-pathao-merchant-webhook-integration-secret") ??
      "";
    if (!signature || signature !== webhookSecret) {
      console.error("Pathao webhook rejected: invalid signature");
      return json({ message: "Invalid webhook signature" }, 401);
    }

    const consignmentId = readText(body.consignment_id).trim();
    const merchantOrderId = readText(body.merchant_order_id).trim();
    if (!consignmentId && !merchantOrderId) {
      return json({ message: "Missing consignment or merchant order id" }, 400);
    }

    const collectedAmount = readNumber(body.collected_amount);
    const deliveryFee = readNumber(body.delivery_fee);
    const pathaoStatus = readText(body.order_status).trim() || null;
    const occurredAt = readText(body.timestamp).trim() || readText(body.updated_at).trim() || null;

    const { data, error } = await admin.rpc("service_apply_pathao_event", {
      p_consignment_id: consignmentId || null,
      p_merchant_order_id: merchantOrderId || null,
      p_event: event || null,
      p_pathao_status: pathaoStatus,
      p_delivery_fee: deliveryFee,
      p_collected_amount: collectedAmount,
      p_message: event
        ? `Pathao: ${event}${pathaoStatus ? ` (${pathaoStatus})` : ""}`
        : pathaoStatus
          ? `Pathao status: ${pathaoStatus}`
          : "Pathao webhook update",
      p_occurred_at: occurredAt,
    });

    if (error) {
      // Unknown consignments should not fail Pathao retries forever during setup.
      if (/not found/i.test(error.message)) {
        console.error("Pathao webhook for unknown shipment", {
          consignmentId,
          merchantOrderId,
          event,
        });
        return json({ message: "Shipment not found", ignored: true }, 202);
      }
      console.error("Pathao webhook apply failed", error);
      return json({ message: error.message }, 500);
    }

    return json({ message: "ok", result: data });
  } catch (error) {
    console.error("Pathao webhook failed", error);
    return json({ message: "Webhook processing failed" }, 500);
  }
});

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    return isRecord(body) ? body : {};
  } catch {
    return {};
  }
}

function readText(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getServiceKey(): string {
  const legacyKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacyKey) return legacyKey;

  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    try {
      const parsed: unknown = JSON.parse(secretKeys);
      if (isRecord(parsed) && typeof parsed.default === "string") {
        return parsed.default;
      }
    } catch {
      // Fall through.
    }
  }

  throw new Error("No Supabase service key is configured.");
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
