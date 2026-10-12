// ============================================================
// razorpay-webhook.controller.ts
//
// Async fallback confirmation path for Razorpay payments. The primary path
// is the client-side addPaymentToOrder call in razorpay-payment-handler.ts;
// this webhook exists for the case where that call never reaches Vendure
// (tab closed mid-checkout, flaky network) but the payment still succeeded
// on Razorpay's end.
//
// Configure this URL in the Razorpay dashboard: Settings -> Webhooks
//   https://<your-domain>/payments/razorpay/webhook
// Subscribe to the "payment.captured" event.
// ============================================================

import { Controller, Post, Req, Res, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Logger, RequestContext, TransactionalConnection } from '@vendure/core';
import { verifyWebhookSignature } from './razorpay-client';

const loggerCtx = 'RazorpayWebhook';

@Controller('payments/razorpay')
export class RazorpayWebhookController {
    constructor(private connection: TransactionalConnection) {}

    @Post('webhook')
    async handleWebhook(@Req() req: Request, @Res() res: Response) {
        const signature = req.headers['x-razorpay-signature'] as string | undefined;
        const rawBody = (req as any).rawBody ?? JSON.stringify(req.body);

        if (!signature || !verifyWebhookSignature(rawBody, signature)) {
            Logger.warn('Rejected Razorpay webhook: bad signature', loggerCtx);
            return res.status(HttpStatus.UNAUTHORIZED).send('invalid signature');
        }

        const event = req.body;
        if (event.event !== 'payment.captured') {
            // Nothing to do for other event types yet (refunds, failures) —
            // acknowledge so Razorpay doesn't keep retrying.
            return res.status(HttpStatus.OK).send('ignored');
        }

        const paymentEntity = event.payload?.payment?.entity;
        const razorpayPaymentId = paymentEntity?.id;
        if (!razorpayPaymentId) {
            return res.status(HttpStatus.OK).send('no payment id');
        }

        try {
            // Find the matching Vendure Payment by the transactionId we stored
            // in createPayment(). If it's already Settled (the normal client-side
            // path beat the webhook here, as usual), there's nothing to do.
            const ctx = RequestContext.empty();
            const paymentRepo = this.connection.getRepository(ctx, 'Payment' as any);
            const existing = await paymentRepo.findOne({ where: { transactionId: razorpayPaymentId } });

            if (!existing) {
                Logger.info(`Webhook for unknown payment ${razorpayPaymentId} — order not yet created in Vendure`, loggerCtx);
                return res.status(HttpStatus.OK).send('unknown payment, ignored');
            }

            if (existing.state !== 'Settled') {
                existing.state = 'Settled';
                await paymentRepo.save(existing);
                Logger.info(`Settled payment ${razorpayPaymentId} via webhook fallback`, loggerCtx);
            }

            return res.status(HttpStatus.OK).send('ok');
        } catch (err: any) {
            Logger.error(`Error processing Razorpay webhook: ${err.message}`, loggerCtx);
            return res.status(HttpStatus.INTERNAL_SERVER_ERROR).send('error');
        }
    }
}
