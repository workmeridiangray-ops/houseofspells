// ============================================================
// razorpay-client.ts
//
// Thin REST client around Razorpay's Orders API, plus the HMAC
// signature verification Razorpay requires on both the client-side
// payment callback and the server-side webhook.
//
// Docs: https://razorpay.com/docs/api/orders/
//       https://razorpay.com/docs/payments/payment-gateway/webhooks/
// ============================================================

import crypto from 'crypto';
import fetch from 'node-fetch';

const RAZORPAY_BASE_URL = 'https://api.razorpay.com/v1';

function authHeader(): string {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
        throw new Error('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set');
    }
    return 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
}

export interface RazorpayOrder {
    id: string;
    amount: number;
    currency: string;
    status: string;
}

// Amounts in Razorpay are in the smallest currency unit (paise for INR).
export async function createRazorpayOrder(amountInRupees: number, receiptId: string, currency = 'INR'): Promise<RazorpayOrder> {
    const res = await fetch(`${RAZORPAY_BASE_URL}/orders`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: authHeader(),
        },
        body: JSON.stringify({
            amount: Math.round(amountInRupees * 100),
            currency,
            receipt: receiptId,
            payment_capture: 1, // auto-capture on successful payment
        }),
    });

    const data = await res.json();
    if (!res.ok) {
        throw new Error(`Razorpay order creation failed: ${JSON.stringify(data)}`);
    }
    return data as RazorpayOrder;
}

// Verifies the signature sent back from Razorpay Checkout after a successful
// payment: hmac_sha256(order_id + "|" + payment_id, key_secret) === signature
export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) throw new Error('RAZORPAY_KEY_SECRET is not set');

    const expected = crypto
        .createHmac('sha256', keySecret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');

    return timingSafeEqualHex(expected, signature);
}

// Verifies an incoming webhook body against RAZORPAY_WEBHOOK_SECRET
// (a separate secret from the API key, configured in the Razorpay dashboard).
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) throw new Error('RAZORPAY_WEBHOOK_SECRET is not set');

    const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
    return timingSafeEqualHex(expected, signature);
}

function timingSafeEqualHex(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}
