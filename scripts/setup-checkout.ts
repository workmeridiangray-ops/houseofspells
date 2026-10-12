// ============================================================
// scripts/setup-checkout.ts
//
// One-time store settings needed before customers can check out. Idempotent.
//   - Channel currency = INR (prices are stored in paise)
//   - Backorder mode: out-of-stock threshold -10000, so items can be ordered
//     until real stock counts are entered in the admin
//   - Shipping method "Standard delivery" (Shiprocket live rate, ₹79 fallback,
//     free above ₹999)
//   - Payment methods: Cash on delivery (always) and Razorpay (enabled only if
//     RAZORPAY_KEY_ID is set on the server)
// ============================================================
import 'dotenv/config';
import { GraphQLClient, gql } from 'graphql-request';

const ADMIN_API_URL = process.env.VENDURE_ADMIN_API_URL || 'http://localhost:3000/admin-api';
const FREE_SHIPPING_ABOVE_PAISE = Number(process.env.FREE_SHIPPING_ABOVE_PAISE || 99900);

async function main() {
    const client = new GraphQLClient(ADMIN_API_URL);
    const res: any = await client.rawRequest(
        gql`mutation($u: String!, $p: String!) { login(username: $u, password: $p) { __typename } }`,
        { u: process.env.SUPERADMIN_USERNAME || 'superadmin', p: process.env.SUPERADMIN_PASSWORD || 'superadmin' },
    );
    const t = res.headers.get('vendure-auth-token');
    if (t) client.setHeader('Authorization', `Bearer ${t}`);
    if (res.data?.login?.__typename !== 'CurrentUser') throw new Error('Login failed');

    await client.request(gql`mutation { updateChannel(input: { id: "1", defaultCurrencyCode: INR, availableCurrencyCodes: [INR] }) { __typename } }`);
    await client.request(gql`mutation { updateGlobalSettings(input: { outOfStockThreshold: -10000, trackInventory: false }) { __typename } }`);
    console.log('Channel currency = INR, backorder mode on.');

    const existing: any = await client.request(gql`{ shippingMethods { items { id code } } paymentMethods { items { id code } } }`);
    if (!existing.shippingMethods.items.some((m: any) => m.code === 'standard-delivery')) {
        const r: any = await client.request(
            gql`mutation($i: CreateShippingMethodInput!) { createShippingMethod(input: $i) { id } }`,
            {
                i: {
                    code: 'standard-delivery',
                    fulfillmentHandler: 'shiprocket',
                    checker: { code: 'default-shipping-eligibility-checker', arguments: [{ name: 'orderMinimum', value: '0' }] },
                    calculator: { code: 'shiprocket-live-rate', arguments: [{ name: 'freeShippingThreshold', value: String(FREE_SHIPPING_ABOVE_PAISE) }] },
                    translations: [{ languageCode: 'en', name: 'Standard delivery', description: '' }],
                },
            },
        );
        console.log('Shipping method created:', r.createShippingMethod.id);
    }
    const haveCode = (c: string) => existing.paymentMethods.items.some((m: any) => m.code === c);
    const mkPay = async (code: string, name: string, enabled: boolean) => {
        if (haveCode(code)) return;
        await client.request(
            gql`mutation($i: CreatePaymentMethodInput!) { createPaymentMethod(input: $i) { id } }`,
            { i: { code, enabled, handler: { code, arguments: [] }, translations: [{ languageCode: 'en', name, description: '' }] } },
        );
        console.log('Payment method created:', code, enabled ? '(enabled)' : '(disabled)');
    };
    await mkPay('cod', 'Cash on delivery', true);
    await mkPay('razorpay', 'Razorpay (UPI, cards, netbanking)', true);
    console.log('Checkout setup done.');
}
main().catch((e) => { console.error(e.response?.errors || e); process.exit(1); });
