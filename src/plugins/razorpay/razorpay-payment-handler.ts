// ============================================================
// razorpay-payment-handler.ts
//
// Vendure PaymentMethodHandler for Razorpay.
//
// Flow:
//  1. Storefront calls the `createRazorpayOrder` custom mutation (added by
//     RazorpayPlugin's shop-api extension) once the Vendure Order is ready
//     for payment. That creates a matching Razorpay order and returns its
//     id + the publishable key_id, which the storefront hands to Razorpay
//     Checkout (checkout.js).
//  2. Razorpay Checkout completes client-side and returns
//     razorpay_payment_id / razorpay_order_id / razorpay_signature.
//  3. Storefront calls Vendure's standard `addPaymentToOrder` mutation with
//     method: 'razorpay' and those three values in `metadata`.
//  4. createPayment() below verifies the HMAC signature server-side (never
//     trust the client-side success callback alone) and settles the
//     payment immediately, since Razorpay auto-captures on order creation
//     (payment_capture: 1).
//
// A webhook (razorpay-webhook.controller.ts) provides a second, async
// confirmation path in case the client-side callback never fires (closed
// tab, network drop) — it settles the matching Vendure payment by
// transactionId if it's still Authorized.
// ============================================================

import { LanguageCode, PaymentMethodHandler, CreatePaymentResult, SettlePaymentResult } from '@vendure/core';
import { verifyPaymentSignature } from './razorpay-client';

export const razorpayPaymentHandler = new PaymentMethodHandler({
    code: 'razorpay',
    description: [{ languageCode: LanguageCode.en, value: 'Pay by card, UPI, netbanking or wallet (Razorpay)' }],
    args: {},

    createPayment: async (ctx, order, amount, args, metadata): Promise<CreatePaymentResult> => {
        const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = metadata || {};

        if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
            return {
                amount,
                state: 'Declined' as const,
                metadata: { errorMessage: 'Missing Razorpay payment confirmation fields' },
            };
        }

        const isValid = verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
        if (!isValid) {
            return {
                amount,
                state: 'Declined' as const,
                metadata: { errorMessage: 'Razorpay signature verification failed' },
            };
        }

        // Signature checks out — Razorpay already auto-captured the charge
        // (payment_capture: 1 on order creation), so this settles immediately
        // rather than going through a separate Authorized -> Settled step.
        return {
            amount,
            state: 'Settled' as const,
            transactionId: razorpay_payment_id,
            metadata: {
                razorpayOrderId: razorpay_order_id,
                razorpaySignature: razorpay_signature,
            },
        };
    },

    settlePayment: async (): Promise<SettlePaymentResult> => {
        // createPayment already settles on the auto-capture path above, so
        // this only runs if something upstream forces a two-step flow.
        return { success: true };
    },

    cancelPayment: async () => {
        // Razorpay doesn't support cancelling an already-captured payment via
        // this API — cancellations on a captured charge go through createRefund.
        return { success: true };
    },
});
