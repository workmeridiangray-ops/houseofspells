// ============================================================
// upload-remote-asset.ts
//
// Vendure's `createAssets` mutation only accepts a GraphQL `Upload` scalar
// (a real multipart file), not a remote URL string — confirmed directly
// against this instance ("Upload literal unsupported."). Since every one
// of the 30,616 catalog images lives on an external CDN (Shopify, etc.),
// this fetches each image's bytes and re-uploads them as a proper
// multipart request per the GraphQL multipart request spec:
// https://github.com/jaydenseric/graphql-multipart-request-spec
// ============================================================

import fetch from 'node-fetch';
import FormData from 'form-data';

const ADMIN_API_URL = process.env.VENDURE_ADMIN_API_URL || 'http://localhost:3000/admin-api';

let authToken: string | null = null;
export function setAuthToken(token: string) {
    authToken = token;
}

export async function uploadRemoteImageAsAsset(imageUrl: string): Promise<string | null> {
    try {
        const imgRes = await fetch(imageUrl, { timeout: 15000 } as any);
        if (!imgRes.ok) return null;
        const buffer = await imgRes.buffer();
        if (buffer.length === 0) return null;

        const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
        const filename = imageUrl.split('/').pop()?.split('?')[0] || 'image.jpg';

        const query = `
            mutation CreateAssets($input: [CreateAssetInput!]!) {
                createAssets(input: $input) {
                    ... on Asset { id }
                    ... on ErrorResult { message }
                }
            }
        `;

        const form = new FormData();
        form.append(
            'operations',
            JSON.stringify({
                query,
                variables: { input: [{ file: null }] },
            }),
        );
        form.append('map', JSON.stringify({ '0': ['variables.input.0.file'] }));
        form.append('0', buffer, { filename, contentType });

        const headers: any = form.getHeaders();
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

        const res = await fetch(ADMIN_API_URL, { method: 'POST', body: form as any, headers });
        const data: any = await res.json();

        const result = data?.data?.createAssets?.[0];
        if (result?.id) return result.id;
        return null;
    } catch {
        return null;
    }
}
