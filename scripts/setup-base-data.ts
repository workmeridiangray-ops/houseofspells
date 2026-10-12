// ============================================================
// scripts/setup-base-data.ts
//
// A fresh Vendure instance has NO countries, zones or tax categories —
// without at least one, `createProductVariants` fails with "The active tax
// zone could not be determined" (confirmed against this exact instance).
// Run this once, before scripts/import-catalog.ts, to set up:
//   - India as a Country
//   - an "India" Zone containing it
//   - that Zone as the default Channel's default tax zone (both for order
//     and seller — same zone since this is a single-country store for now)
//   - a "Standard GST" TaxCategory with a 0% TaxRate for that zone
//     (real per-category GST/HSN rates are a known gap — see README)
//
// Idempotent: safe to re-run.
// ============================================================

import 'dotenv/config';
import { GraphQLClient, gql } from 'graphql-request';

const ADMIN_API_URL = process.env.VENDURE_ADMIN_API_URL || 'http://localhost:3000/admin-api';

async function main() {
    const client = new GraphQLClient(ADMIN_API_URL);
    await login(client);

    const countryId = await ensureIndiaCountry(client);
    const zoneId = await ensureIndiaZone(client, countryId);
    await setChannelDefaultZones(client, zoneId);
    const taxCategoryId = await ensureTaxCategory(client);
    await ensureTaxRate(client, taxCategoryId, zoneId);

    console.log('Base data ready: India country/zone set as default tax zone, Standard GST tax category created.');
    console.log('You can now run: npm run import:catalog');
}

async function login(client: GraphQLClient) {
    const identifier = process.env.SUPERADMIN_USERNAME || 'superadmin';
    const password = process.env.SUPERADMIN_PASSWORD || 'superadmin';
    const mutation = gql`
        mutation Login($username: String!, $password: String!) {
            login(username: $username, password: $password) {
                __typename
                ... on ErrorResult {
                    message
                }
            }
        }
    `;
    const res: any = await client.rawRequest(mutation, { username: identifier, password });
    const authHeader = res.headers.get('vendure-auth-token');
    if (authHeader) client.setHeader('Authorization', `Bearer ${authHeader}`);
    if (res.data?.login?.__typename !== 'CurrentUser') {
        throw new Error(`Login failed: ${JSON.stringify(res.data?.login)}`);
    }
}

async function ensureIndiaCountry(client: GraphQLClient): Promise<string> {
    const findQuery = gql`
        query {
            countries(options: { filter: { code: { eq: "IN" } } }) {
                items {
                    id
                }
            }
        }
    `;
    const found: any = await client.request(findQuery);
    if (found.countries.items.length) return found.countries.items[0].id;

    const createMutation = gql`
        mutation CreateCountry($input: CreateCountryInput!) {
            createCountry(input: $input) {
                id
            }
        }
    `;
    const result: any = await client.request(createMutation, {
        input: {
            code: 'IN',
            translations: [{ languageCode: 'en', name: 'India' }],
            enabled: true,
        },
    });
    return result.createCountry.id;
}

async function ensureIndiaZone(client: GraphQLClient, countryId: string): Promise<string> {
    const findQuery = gql`
        query {
            zones(options: { filter: { name: { eq: "India" } } }) {
                items {
                    id
                    members {
                        id
                    }
                }
            }
        }
    `;
    const found: any = await client.request(findQuery);
    if (found.zones.items.length) {
        const zone = found.zones.items[0];
        if (!zone.members.some((m: any) => m.id === countryId)) {
            await addMemberToZone(client, zone.id, countryId);
        }
        return zone.id;
    }

    const createMutation = gql`
        mutation CreateZone($input: CreateZoneInput!) {
            createZone(input: $input) {
                id
            }
        }
    `;
    const result: any = await client.request(createMutation, {
        input: { name: 'India', memberIds: [countryId] },
    });
    return result.createZone.id;
}

async function addMemberToZone(client: GraphQLClient, zoneId: string, memberId: string) {
    const mutation = gql`
        mutation AddZoneMembers($zoneId: ID!, $memberIds: [ID!]!) {
            addMembersToZone(zoneId: $zoneId, memberIds: $memberIds) {
                id
            }
        }
    `;
    await client.request(mutation, { zoneId, memberIds: [memberId] });
}

async function setChannelDefaultZones(client: GraphQLClient, zoneId: string) {
    const findQuery = gql`
        query {
            channels {
                items {
                    id
                }
            }
        }
    `;
    const found: any = await client.request(findQuery);
    const defaultChannelId = found.channels.items[0].id;

    const mutation = gql`
        mutation UpdateChannel($input: UpdateChannelInput!) {
            updateChannel(input: $input) {
                __typename
            }
        }
    `;
    await client.request(mutation, {
        input: { id: defaultChannelId, defaultTaxZoneId: zoneId, defaultShippingZoneId: zoneId },
    });
}

async function ensureTaxCategory(client: GraphQLClient): Promise<string> {
    const findQuery = gql`
        query {
            taxCategories {
                items {
                    id
                    name
                }
            }
        }
    `;
    const found: any = await client.request(findQuery);
    const existing = found.taxCategories.items.find((c: any) => c.name === 'Standard GST');
    if (existing) return existing.id;

    const createMutation = gql`
        mutation CreateTaxCategory($input: CreateTaxCategoryInput!) {
            createTaxCategory(input: $input) {
                id
            }
        }
    `;
    const result: any = await client.request(createMutation, {
        input: { name: 'Standard GST', isDefault: true },
    });
    return result.createTaxCategory.id;
}

async function ensureTaxRate(client: GraphQLClient, taxCategoryId: string, zoneId: string) {
    const findQuery = gql`
        query {
            taxRates {
                items {
                    id
                    name
                }
            }
        }
    `;
    const found: any = await client.request(findQuery);
    if (found.taxRates.items.some((r: any) => r.name === 'India Standard GST')) return;

    const createMutation = gql`
        mutation CreateTaxRate($input: CreateTaxRateInput!) {
            createTaxRate(input: $input) {
                id
            }
        }
    `;
    // 0% placeholder — real per-HSN-code GST rates (most craft/jewellery
    // items run 3-18% in India) are a known gap, same as in the old Prisma
    // backend's README. Wire in real rates per category before going live.
    await client.request(createMutation, {
        input: {
            name: 'India Standard GST',
            enabled: true,
            value: 0,
            categoryId: taxCategoryId,
            zoneId,
        },
    });
}

main().catch((err) => {
    console.error('Base data setup failed:', err);
    process.exit(1);
});
