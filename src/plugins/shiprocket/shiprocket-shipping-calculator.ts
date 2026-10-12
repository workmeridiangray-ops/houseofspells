// ============================================================
// shiprocket-shipping-calculator.ts
//
// Quotes a real Shiprocket courier rate at checkout using the order's
// real total weight (summed from each line's ProductVariant.customFields
// .weightKg, same per-product weight the old Prisma backend captured from
// the master catalog) and destination pincode, falling back to a flat rate
// if Shiprocket's serviceability check fails or times out (keeps checkout
// from breaking on an API hiccup).
// ============================================================

import { LanguageCode, ShippingCalculator } from '@vendure/core';
import { checkServiceability, computeTotalWeightKg } from './shiprocket-client';

const FALLBACK_FLAT_RATE_PAISE = 7900; // ₹79, used only if the live rate check fails

export const shiprocketShippingCalculator = new ShippingCalculator({
    code: 'shiprocket-live-rate',
    description: [{ languageCode: LanguageCode.en, value: 'Live Shiprocket courier rate' }],
    args: {
        freeShippingThreshold: {
            type: 'int',
            defaultValue: 0,
            ui: { component: 'currency-form-input' },
            label: [{ languageCode: LanguageCode.en, value: 'Free shipping above (0 = disabled)' }],
        },
    },
    calculate: async (ctx, order, args) => {
        const threshold = args.freeShippingThreshold || 0;
        if (threshold > 0 && order.subTotalWithTax >= threshold) {
            return { price: 0, priceIncludesTax: true, taxRate: 0 };
        }

        const address = order.shippingAddress;
        const deliveryPostcode = address?.postalCode;
        const pickupPostcode = process.env.SHIPROCKET_PICKUP_PINCODE;

        if (!deliveryPostcode || !pickupPostcode) {
            // No destination yet (early in checkout) — quote the fallback so
            // the UI has something to show before the address step completes.
            return { price: FALLBACK_FLAT_RATE_PAISE, priceIncludesTax: false, taxRate: 0 };
        }

        const items = order.lines.map((line) => ({
            name: line.productVariant.name,
            sku: line.productVariant.sku,
            units: line.quantity,
            sellingPrice: line.proratedUnitPriceWithTax / 100,
            weightKg: (line.productVariant as any).customFields?.weightKg ?? null,
        }));
        const totalWeightKg = computeTotalWeightKg(items);

        try {
            const result = await checkServiceability({
                pickupPostcode,
                deliveryPostcode,
                weightKg: totalWeightKg,
                cod: false,
                declaredValue: order.subTotalWithTax / 100,
            });

            const cheapest = result?.data?.available_courier_companies
                ?.slice()
                .sort((a: any, b: any) => a.rate - b.rate)[0];

            if (cheapest?.rate != null) {
                return {
                    price: Math.round(cheapest.rate * 100),
                    priceIncludesTax: false,
                    taxRate: 0,
                };
            }
        } catch {
            // Fall through to the flat-rate fallback below — a live API hiccup
            // should never block checkout.
        }

        return { price: FALLBACK_FLAT_RATE_PAISE, priceIncludesTax: false, taxRate: 0 };
    },
});
