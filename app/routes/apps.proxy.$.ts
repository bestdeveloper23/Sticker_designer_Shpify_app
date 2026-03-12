import { authenticate } from "../shopify.server";
import { calculateDraftOrderPrice } from "../pricing.server";

export const action = async ({ request }) => {
  const url = new URL(request.url);
  if (request.method !== "POST" || !url.pathname.endsWith("create-draft")) {
    return Response.json({ error: "Method or path not allowed" }, { status: 400 });
  }

  const { admin } = await authenticate.public.appProxy(request);
  if (!admin) {
    return Response.json(
      { error: "Store session not available. Ensure the app is installed." },
      { status: 503 }
    );
  }

  let body: {
    variantId?: string;
    quantity?: number;
    stickerSize?: number;
    quantityOption?: number;
    widthIn?: number;
    heightIn?: number;
    properties?: Record<string, string>;
    designUrl?: string;
    rawImageUrl?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const variantId = body.variantId;
  const quantity = body.quantity ?? 1;
  const stickerSize = body.stickerSize ?? 2;
  const quantityOption = body.quantityOption ?? 50;
  const widthIn = body.widthIn;
  const heightIn = body.heightIn;
  if (!variantId) {
    return Response.json({ error: "variantId is required" }, { status: 400 });
  }

  const price = calculateDraftOrderPrice(widthIn, heightIn, stickerSize, quantityOption);
  const variantGid =
    variantId.startsWith("gid://") ? variantId : `gid://shopify/ProductVariant/${variantId}`;

  const customAttributes: { key: string; value: string }[] = [];
  if (body.properties) {
    for (const [k, v] of Object.entries(body.properties)) {
      if (v != null && v !== "") customAttributes.push({ key: k, value: String(v) });
    }
  }

  const lineItems: {
    variantId: string;
    quantity: number;
    customAttributes?: { key: string; value: string }[];
    priceOverride?: { amount: string; currencyCode: string };
  }[] = [
    {
      variantId: variantGid,
      quantity: Math.max(1, quantity),
      priceOverride: { amount: String(price), currencyCode: "USD" },
      ...(customAttributes.length ? { customAttributes } : {}),
    },
  ];

  let result: { data?: { draftOrderCreate?: { draftOrder?: { invoiceUrl?: string }; userErrors?: { message: string }[] } }; errors?: { message: string }[] };
  try {
    const response = await admin.graphql(
      `#graphql
    mutation draftOrderCreate($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) {
        draftOrder {
          id
          invoiceUrl
        }
        userErrors {
          message
          field
        }
      }
    }`,
      {
        variables: {
          input: {
            lineItems,
          },
        },
      }
    );
    result = await response.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/scope|permission|access/i.test(msg)) {
      return Response.json(
        {
          error:
            "This app needs permission to create draft orders. Uninstall the app and reinstall it from your Shopify admin, then try again.",
        },
        { status: 403 }
      );
    }
    throw err;
  }

  const graphqlErrors = result?.errors || [];
  const scopeError = graphqlErrors.find(
    (e: { message: string }) => /scope|permission|access/i.test(e?.message || "")
  );
  if (scopeError) {
    return Response.json(
      {
        error:
          "This app needs permission to create draft orders. Uninstall the app and reinstall it from your Shopify admin, then try again.",
      },
      { status: 403 }
    );
  }

  const data = result?.data?.draftOrderCreate;
  const userErrors = data?.userErrors || [];
  if (userErrors.length > 0) {
    return Response.json(
      { error: userErrors.map((e: { message: string }) => e.message).join(", ") },
      { status: 400 }
    );
  }

  const invoiceUrl = data?.draftOrder?.invoiceUrl;
  if (!invoiceUrl) {
    return Response.json({ error: "Draft order created but no invoice URL" }, { status: 500 });
  }

  return Response.json({ checkoutUrl: invoiceUrl });
};

/** Default designer origin; also used when no custom origin is allowed. */
const DEFAULT_DESIGNER_ORIGIN =
  process.env.DESIGNER_ORIGIN || "https://stickeroutline.replit.app";

/** Allowed designer origins for proxy (avoid SSRF). Comma-separated in env. */
function getAllowedDesignerOrigins(): string[] {
  const list = [
    DEFAULT_DESIGNER_ORIGIN,
    ...(process.env.ALLOWED_DESIGNER_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ];
  return [...new Set(list)];
}

function isAllowedDesignerOrigin(origin: string | null): boolean {
  if (!origin || typeof origin !== "string") return false;
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:") return false;
    const allowed = getAllowedDesignerOrigins();
    const normalized = u.origin;
    return allowed.some((a) => new URL(a).origin === normalized);
  } catch {
    return false;
  }
}

export const loader = async ({ request }) => {
  await authenticate.public.appProxy(request);

  const url = new URL(request.url);
  const pathname = url.pathname || "";

  // Proxy GET .../designs to the designer app (avoids CORS for "My Designs")
  if (request.method === "GET" && pathname.endsWith("/designs")) {
    const customerId = url.searchParams.get("customerId") ?? "";
    const designerOriginParam = url.searchParams.get("designerOrigin");
    const designerOrigin = isAllowedDesignerOrigin(designerOriginParam)
      ? new URL(designerOriginParam!).origin
      : new URL(DEFAULT_DESIGNER_ORIGIN).origin;

    const designsUrl = `${designerOrigin}/api/designs?customerId=${encodeURIComponent(customerId)}`;
    try {
      const res = await fetch(designsUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const data = await res.json().catch(() => ({}));
      return Response.json(data, {
        status: res.status,
        headers: {
          "Cache-Control": "private, max-age=60",
        },
      });
    } catch (err) {
      return Response.json(
        { error: "Could not load designs", designs: [] },
        { status: 502 }
      );
    }
  }

  return Response.json({ ok: true, message: "Use POST to create-draft" });
};
