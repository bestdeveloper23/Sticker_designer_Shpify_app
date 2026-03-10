/**
 * Billing: free trial (10 sticker orders) then 1.5% commission on order total.
 * Requires an active app subscription with usage-based pricing; usage records are created per paid sticker order after trial.
 */

import db from "./db.server";

const FREE_TRIAL_STICKER_ORDERS = 10;
const COMMISSION_RATE = 0.015; // 1.5%
const SUBSCRIPTION_NAME = "Custom Sticker Designer – Commission";
const USAGE_TERMS = "1.5% of sticker order total (after first 10 orders free)";
const CAPPED_AMOUNT_USD = 999; // Max usage charges per billing period (30 days)

const STICKER_PROP_KEYS = ["_Design_URL", "Design_URL"];

// Currencies supported for app usage charges (Shopify billing). Fallback to USD if order currency is not supported.
// See https://help.shopify.com/manual/your-account/manage-billing/your-invoice/local-currency
const SUPPORTED_BILLING_CURRENCIES = new Set([
  "USD", "CAD", "EUR", "GBP", "AUD", "JPY", "CHF", "HKD", "SGD", "SEK", "NOK", "DKK", "NZD", "MXN", "BRL", "INR", "PLN", "CZK", "ILS", "THB", "TWD", "CNY",
]);

function isStickerOrder(order) {
  if (!order?.line_items?.length) return false;
  for (const line of order.line_items) {
    const attrs = line.properties || line.custom_attributes || [];
    for (const attr of attrs) {
      const name = (attr.name || attr.key || "").trim();
      if (STICKER_PROP_KEYS.includes(name) && (attr.value || "").trim())
        return true;
    }
  }
  return false;
}

function getOrderTotal(order) {
  const total = (order.total_price || order.total_price_set?.shop_money?.amount) ?? 0;
  return typeof total === "string" ? parseFloat(total) || 0 : Number(total) || 0;
}

function getOrderCurrency(order) {
  return (
    order.currency ||
    order.total_price_set?.shop_money?.currency_code ||
    "USD"
  );
}

async function getOrCreateShopBilling(shop) {
  let row = await db.shopBilling.findUnique({ where: { shop } });
  if (!row) {
    row = await db.shopBilling.create({
      data: { shop, stickerOrderCount: 0 },
    });
  }
  return row;
}

/**
 * Returns the active usage subscription line item id for the current app installation, or null.
 */
async function getActiveUsageLineItemId(admin) {
  const response = await admin.graphql(
    `#graphql
    query GetActiveUsageSubscription {
      currentAppInstallation {
        activeSubscriptions {
          id
          lineItems {
            id
            plan {
              pricingDetails {
                __typename
              }
            }
          }
        }
      }
    }`
  );
  const json = await response.json();
  const subs =
    json?.data?.currentAppInstallation?.activeSubscriptions ?? [];
  for (const sub of subs) {
    for (const item of sub.lineItems || []) {
      const typename = item?.plan?.pricingDetails?.__typename;
      if (typename === "AppUsagePricing") return item.id;
    }
  }
  return null;
}

/**
 * Ensure the shop has an active usage-based subscription.
 * If not, creates one and returns { hasSubscription: false, confirmationUrl } so the app can redirect the merchant.
 * If yes, returns { hasSubscription: true }.
 * May also return { hasSubscription: true, usageLineItemId } after creating a new subscription (we get line item id from create response).
 */
export async function ensureBillingSubscription(admin, shop, returnUrl) {
  const usageLineItemId = await getActiveUsageLineItemId(admin);
  if (usageLineItemId) {
    await db.shopBilling.upsert({
      where: { shop },
      create: { shop, stickerOrderCount: 0, usageSubscriptionLineItemId: usageLineItemId },
      update: { usageSubscriptionLineItemId: usageLineItemId },
    });
    return { hasSubscription: true, usageLineItemId };
  }

  const response = await admin.graphql(
    `#graphql
    mutation AppSubscriptionCreate($name: String!, $lineItems: [AppSubscriptionLineItemInput!]!, $returnUrl: URL!) {
      appSubscriptionCreate(name: $name, returnUrl: $returnUrl, lineItems: $lineItems) {
        userErrors { field message }
        confirmationUrl
        appSubscription {
          id
          lineItems {
            id
            plan {
              pricingDetails {
                __typename
              }
            }
          }
        }
      }
    }`,
    {
      variables: {
        name: SUBSCRIPTION_NAME,
        returnUrl,
        lineItems: [
          {
            plan: {
              appUsagePricingDetails: {
                terms: USAGE_TERMS,
                cappedAmount: {
                  amount: String(CAPPED_AMOUNT_USD),
                  currencyCode: "USD",
                },
              },
            },
          },
        ],
      },
    }
  );

  const result = await response.json();
  const create = result?.data?.appSubscriptionCreate;
  const errors = create?.userErrors ?? result?.errors ?? [];
  if (errors.length) {
    const msg = errors.map((e) => e.message).join(", ");
    throw new Error(`Failed to create billing subscription: ${msg}`);
  }

  const confirmationUrl = create?.confirmationUrl;
  const subscription = create?.appSubscription;
  let newUsageLineItemId = null;
  if (subscription?.lineItems?.length) {
    const usageItem = subscription.lineItems.find(
      (li) => li?.plan?.pricingDetails?.__typename === "AppUsagePricing"
    );
    if (usageItem?.id) newUsageLineItemId = usageItem.id;
  }

  if (newUsageLineItemId) {
    await db.shopBilling.upsert({
      where: { shop },
      create: {
        shop,
        stickerOrderCount: 0,
        usageSubscriptionLineItemId: newUsageLineItemId,
      },
      update: { usageSubscriptionLineItemId: newUsageLineItemId },
    });
  }

  return {
    hasSubscription: false,
    confirmationUrl: confirmationUrl || null,
    usageLineItemId: newUsageLineItemId,
  };
}

/**
 * Record a sticker order and, if past the free trial, create a usage charge (1.5% of order total).
 * Call this from the orders/paid webhook when the order is a sticker order.
 * Uses order.id as idempotency key to avoid duplicate charges.
 */
export async function recordStickerOrderAndCharge(admin, shop, order) {
  if (!order?.id || !isStickerOrder(order)) return;

  const billing = await getOrCreateShopBilling(shop);
  const newCount = (billing.stickerOrderCount ?? 0) + 1;
  await db.shopBilling.update({
    where: { shop },
    data: { stickerOrderCount: newCount },
  });

  if (newCount <= FREE_TRIAL_STICKER_ORDERS) return;

  const lineItemId = billing.usageSubscriptionLineItemId ?? (await getActiveUsageLineItemId(admin));
  if (!lineItemId) return;

  const total = getOrderTotal(order);
  const currency = getOrderCurrency(order);
  const amount = Math.round(total * COMMISSION_RATE * 100) / 100;
  if (amount <= 0) return;

  // Idempotency key max 255 chars (Shopify API). Prevents duplicate charges on webhook retries.
  const idempotencyKey = `sticker-order-${order.id}`.slice(0, 255);
  const description = `Sticker order #${order.name || order.id} (1.5%)`;

  const response = await admin.graphql(
    `#graphql
    mutation appUsageRecordCreate(
      $subscriptionLineItemId: ID!,
      $price: MoneyInput!,
      $description: String!,
      $idempotencyKey: String
    ) {
      appUsageRecordCreate(
        subscriptionLineItemId: $subscriptionLineItemId,
        price: $price,
        description: $description,
        idempotencyKey: $idempotencyKey
      ) {
        userErrors { field message }
        appUsageRecord { id }
      }
    }`,
    {
      variables: {
        subscriptionLineItemId: lineItemId,
        price: { amount: String(amount), currencyCode: currency },
        description,
        idempotencyKey,
      },
    }
  );

  const result = await response.json();
  const usage = result?.data?.appUsageRecordCreate;
  if (usage?.userErrors?.length) {
    console.error("[billing] appUsageRecordCreate errors:", usage.userErrors);
  }
}
