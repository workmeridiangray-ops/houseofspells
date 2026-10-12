// ============================================================
// shiprocket-fulfillment-handler.ts
//
// Fires when an admin calls `addFulfillmentToOrder` with this handler
// selected (i.e. "ship this order" in the admin UI). Creates the real
// Shiprocket order/shipment and returns the AWB/tracking code, which
// Vendure stores on the Fulfillment entity.
// ============================================================

import { FulfillmentHandler, LanguageCode } from '@vendure/core';
import { createShiprocketOrder, ShiprocketOrderItem } from './shiprocket-client';

export const shiprocketFulfillmentHandler = new FulfillmentHandler({
    code: 'shiprocket',
    description: [{ languageCode: LanguageCode.en, value: 'Create a Shiprocket shipment and fetch its AWB' }],
    args: {
        paymentMethod: {
            type: 'string',
            defaultValue: 'Prepaid',
            ui: {
                component: 'select-form-input',
                options: [{ value: 'Prepaid' }, { value: 'COD' }],
            },
            label: [{ languageCode: LanguageCode.en, value: 'Payment method' }],
        },
    },
    createFulfillment: async (ctx, orders, lines, args) => {
        // addFulfillmentToOrder can span multiple orders in theory (split
        // shipments aggregated client-side) but Shiprocket wants one order_id
        // per shipment — this store only ever fulfills one order at a time,
        // so take the first.
        const order = orders[0];
        const shippingAddress = order.shippingAddress;

        const items: ShiprocketOrderItem[] = lines.map((lineInput) => {
            const orderLine = order.lines.find((l) => l.id === lineInput.orderLineId);
            return {
                name: orderLine?.productVariant.name || 'Item',
                sku: orderLine?.productVariant.sku || String(lineInput.orderLineId),
                units: lineInput.quantity,
                sellingPrice: (orderLine?.proratedUnitPriceWithTax || 0) / 100,
                weightKg: (orderLine?.productVariant as any)?.customFields?.weightKg ?? null,
            };
        });

        const result = await createShiprocketOrder({
            orderCode: order.code,
            orderDate: order.orderPlacedAt || new Date(),
            items,
            subtotal: order.subTotalWithTax / 100,
            paymentMethod: (args.paymentMethod as 'COD' | 'Prepaid') || 'Prepaid',
            shippingAddress: {
                fullName: `${shippingAddress?.fullName || ''}`.trim() || 'Customer',
                line1: shippingAddress?.streetLine1 || '',
                city: shippingAddress?.city || '',
                state: shippingAddress?.province || '',
                postalCode: shippingAddress?.postalCode || '',
                countryCode: shippingAddress?.countryCode || 'IN',
                phone: shippingAddress?.phoneNumber || '',
                email: order.customer?.emailAddress,
            },
        });

        return {
            method: `Shiprocket (${result.courier_name || 'assigned courier'})`,
            trackingCode: result.awb_code || String(result.shipment_id || result.order_id || ''),
            customFields: {},
        };
    },
    onFulfillmentTransition: async (fromState, toState, data) => {
        // Nothing to intercept yet — cancellation-sync with Shiprocket's
        // /orders/cancel endpoint can hook in here later if orders start
        // getting cancelled post-dispatch.
        return true;
    },
});
