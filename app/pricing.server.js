/**
 * Sticker pricing calculation. Tiered pricing by quantity and area.
 * Shared between app proxy (draft orders) and any future admin/designer integration.
 */

const PRICING_TIERS = [
  { qtyMin: 1000, base: 0.06, rate: 0.0092, minPer: 0.1 },
  { qtyMin: 500, base: 0.09, rate: 0.0086, minPer: 0.12 },
  { qtyMin: 300, base: 0.11, rate: 0.0074, minPer: 0.15 },
  { qtyMin: 200, base: 0.12, rate: 0.01, minPer: 0.175 },
  { qtyMin: 100, base: 0.15, rate: 0.018, minPer: 0.26 },
  { qtyMin: 50, base: 0.23, rate: 0.028, minPer: 0.38 },
  { qtyMin: 25, base: 0.52, rate: 0.027, minPer: 0.6 },
];

export const QUANTITY_OPTIONS = [25, 50, 100, 150, 200, 250, 300, 350, 500, 750, 1000];

function roundCents(x) {
  return Math.round(x * 100) / 100;
}

function pickTier(qty) {
  return (
    PRICING_TIERS.find((t) => qty >= t.qtyMin) ||
    PRICING_TIERS[PRICING_TIERS.length - 1]
  );
}

/**
 * Calculate sticker price from dimensions (inches) and quantity.
 * @param {number} widthIn - Width in inches
 * @param {number} heightIn - Height in inches
 * @param {number} qty - Quantity
 * @returns {{ perSticker: number; total: number; area: number; tierUsed: number }}
 */
export function calcStickerPrice(widthIn, heightIn, qty) {
  widthIn = Number(widthIn);
  heightIn = Number(heightIn);
  qty = Math.max(1, Math.round(qty));

  if (
    !Number.isFinite(widthIn) ||
    !Number.isFinite(heightIn) ||
    widthIn <= 0 ||
    heightIn <= 0
  ) {
    return { perSticker: 0, total: 0, area: 0, tierUsed: 0 };
  }

  const area = widthIn * heightIn;
  const tier = pickTier(qty);

  const perStickerRaw = tier.base + tier.rate * area;
  const perSticker = Math.max(tier.minPer, perStickerRaw);

  const total = roundCents(perSticker * qty);

  return {
    area: roundCents(area),
    perSticker: roundCents(perSticker),
    total,
    tierUsed: tier.qtyMin,
  };
}

/**
 * Get the closest quantity from QUANTITY_OPTIONS.
 * @param {number} qty - Desired quantity
 * @returns {number}
 */
export function getClosestQuantity(qty) {
  return QUANTITY_OPTIONS.reduce((prev, curr) =>
    Math.abs(curr - qty) < Math.abs(prev - qty) ? curr : prev
  );
}

/**
 * Calculate total price for draft order. Accepts stickerSize (single number for square)
 * or widthIn/heightIn for custom dimensions. Falls back to square if only stickerSize.
 * @param {number} widthIn - Width in inches (optional)
 * @param {number} heightIn - Height in inches (optional)
 * @param {number} stickerSize - Size in inches (e.g. 2 for 2x2) when width/height not provided
 * @param {number} quantity - Quantity
 * @returns {number} Total price in USD
 */
export function calculateDraftOrderPrice(widthIn, heightIn, stickerSize, quantity) {
  const w = Number(widthIn);
  const h = Number(heightIn);
  const size = Number(stickerSize) || 2;
  const qty = Math.max(1, Math.round(Number(quantity) || 50));

  const width = Number.isFinite(w) && w > 0 ? w : size;
  const height = Number.isFinite(h) && h > 0 ? h : size;

  const { total } = calcStickerPrice(width, height, qty);
  return total;
}
