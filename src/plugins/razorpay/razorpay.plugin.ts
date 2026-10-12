import { PluginCommonModule, VendurePlugin } from '@vendure/core';
import { RazorpayWebhookController } from './razorpay-webhook.controller';
import { RazorpayShopResolver, shopApiExtensions } from './razorpay-shop-api-extension';

@VendurePlugin({
    imports: [PluginCommonModule],
    controllers: [RazorpayWebhookController],
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [RazorpayShopResolver],
    },
    compatibility: '^3.0.0',
})
export class RazorpayPlugin {}
