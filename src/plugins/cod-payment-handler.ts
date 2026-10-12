import { LanguageCode, PaymentMethodHandler, CreatePaymentResult } from '@vendure/core';

// Cash on delivery: the payment is recorded as "Authorized" when the order is
// placed, and an admin settles it once the courier collects the cash.
export const codPaymentHandler = new PaymentMethodHandler({
    code: 'cod',
    description: [{ languageCode: LanguageCode.en, value: 'Cash on delivery' }],
    args: {},
    createPayment: async (ctx, order, amount): Promise<CreatePaymentResult> => ({
        amount,
        state: 'Authorized',
        transactionId: `COD-${order.code}`,
        metadata: { method: 'cod' },
    }),
    settlePayment: async () => ({ success: true }),
});
