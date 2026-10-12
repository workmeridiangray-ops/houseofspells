// ============================================================
// shiprocket-client.ts
//
// Ported from the old Prisma backend's lib/shiprocket.js, adapted to call
// against Vendure Order/OrderLine/ProductVariant shapes instead. Same auth
// caching, same real-weight-over-flat-estimate logic.
//
// Docs: https://apidocs.shiprocket.in/
// ============================================================

import fetch from 'node-fetch';

const SHIPROCKET_BASE_URL = 'https://apiv2.shiprocket.in/v1/external';
const FALLBACK_WEIGHT_PER_UNIT_KG = 0.25;

let cachedToken: string | null = null;
let tokenExpiresAt: number | null = null;

async function getAuthToken(): Promise<string> {
    if (cachedToken && tokenExpiresAt && Date.now() < tokenExpiresAt) {
        return cachedToken;
    }

    const res = await fetch(`${SHIPROCKET_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: process.env.SHIPROCKET_EMAIL,
            password: process.env.SHIPROCKET_PASSWORD,
        }),
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Shiprocket auth failed: ${res.status} ${body}`);
    }

    const data: any = await res.json();
    cachedToken = data.token;
    tokenExpiresAt = Date.now() + 9 * 24 * 60 * 60 * 1000;
    return cachedToken as string;
}

async function shiprocketRequest(path: string, options: any = {}): Promise<any> {
    const token = await getAuthToken();
    const res = await fetch(`${SHIPROCKET_BASE_URL}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            ...(options.headers || {}),
        },
    });

    const data = await res.json();
    if (!res.ok) {
        throw new Error(`Shiprocket API error (${path}): ${JSON.stringify(data)}`);
    }
    return data;
}

export interface ShiprocketOrderItem {
    name: string;
    sku: string;
    units: number;
    sellingPrice: number;
    weightKg?: number | null;
}

export interface CreateShiprocketOrderInput {
    orderCode: string;
    orderDate: Date;
    items: ShiprocketOrderItem[];
    subtotal: number;
    paymentMethod: 'COD' | 'Prepaid';
    shippingAddress: {
        fullName: string;
        line1: string;
        city: string;
        state: string;
        postalCode: string;
        countryCode: string;
        phone: string;
        email?: string;
    };
    pickupLocationName?: string;
}

export function computeTotalWeightKg(items: ShiprocketOrderItem[]): number {
    const total = items.reduce((sum, item) => {
        const perUnit = item.weightKg != null ? Number(item.weightKg) : FALLBACK_WEIGHT_PER_UNIT_KG;
        return sum + perUnit * item.units;
    }, 0);
    return Math.max(0.1, Math.round(total * 1000) / 1000);
}

export async function createShiprocketOrder(input: CreateShiprocketOrderInput) {
    const orderItems = input.items.map((item) => ({
        name: item.name,
        sku: item.sku,
        units: item.units,
        selling_price: item.sellingPrice,
    }));

    const totalWeightKg = computeTotalWeightKg(input.items);

    const payload = {
        order_id: input.orderCode,
        order_date: input.orderDate.toISOString().slice(0, 19).replace('T', ' '),
        pickup_location: input.pickupLocationName || process.env.SHIPROCKET_PICKUP_LOCATION,
        billing_customer_name: input.shippingAddress.fullName,
        billing_last_name: '',
        billing_address: input.shippingAddress.line1,
        billing_city: input.shippingAddress.city,
        billing_pincode: input.shippingAddress.postalCode,
        billing_state: input.shippingAddress.state,
        billing_country: input.shippingAddress.countryCode === 'IN' ? 'India' : input.shippingAddress.countryCode,
        billing_email: input.shippingAddress.email || undefined,
        billing_phone: input.shippingAddress.phone,
        shipping_is_billing: true,
        order_items: orderItems,
        payment_method: input.paymentMethod,
        sub_total: input.subtotal,
        // Still a flat placeholder — the catalog has per-product weight but not
        // box dimensions, so this stays an estimate until real packaging data exists.
        length: 15,
        breadth: 10,
        height: 8,
        weight: totalWeightKg,
    };

    return shiprocketRequest('/orders/create/adhoc', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export async function trackShipment(shipmentId: string) {
    return shiprocketRequest(`/courier/track/shipment/${shipmentId}`, { method: 'GET' });
}

export async function cancelShiprocketOrder(orderIds: string[] | string) {
    return shiprocketRequest('/orders/cancel', {
        method: 'POST',
        body: JSON.stringify({ ids: Array.isArray(orderIds) ? orderIds : [orderIds] }),
    });
}

// Serviceability + rate check — used by the ShippingCalculator to quote a
// real courier rate for the destination pincode instead of a flat fee.
export async function checkServiceability(params: {
    pickupPostcode: string;
    deliveryPostcode: string;
    weightKg: number;
    cod: boolean;
    declaredValue: number;
}) {
    const qs = new URLSearchParams({
        pickup_postcode: params.pickupPostcode,
        delivery_postcode: params.deliveryPostcode,
        weight: String(params.weightKg),
        cod: params.cod ? '1' : '0',
        declared_value: String(params.declaredValue),
    });
    return shiprocketRequest(`/courier/serviceability/?${qs.toString()}`, { method: 'GET' });
}
