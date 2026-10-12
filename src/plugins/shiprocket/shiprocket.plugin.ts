import { PluginCommonModule, RuntimeVendureConfig, VendurePlugin } from '@vendure/core';
import { shiprocketShippingCalculator } from './shiprocket-shipping-calculator';
import { shiprocketFulfillmentHandler } from './shiprocket-fulfillment-handler';
import { ShiprocketTrackingSyncController } from './shiprocket-tracking-sync.controller';

@VendurePlugin({
    imports: [PluginCommonModule],
    controllers: [ShiprocketTrackingSyncController],
    configuration: (config: RuntimeVendureConfig) => {
        config.shippingOptions.shippingCalculators = [
            ...(config.shippingOptions.shippingCalculators || []),
            shiprocketShippingCalculator,
        ];
        config.shippingOptions.fulfillmentHandlers = [
            ...(config.shippingOptions.fulfillmentHandlers || []),
            shiprocketFulfillmentHandler,
        ];
        return config;
    },
    compatibility: '^3.0.0',
})
export class ShiprocketPlugin {}
