// ============================================================
// shiprocket-tracking-sync.controller.ts
//
// Ported from the old Prisma backend's api/sync-tracking.js. Call this
// periodically (Vercel Cron / any scheduler, every 30-60 min) to pull the
// latest Shiprocket tracking status for orders that have a fulfillment
// but aren't yet marked Delivered, and advance them in Vendure.
//
//   POST /sync/shiprocket-tracking
//   Authorization: Bearer <CRON_SECRET>
// ============================================================

import { Controller, Post, Req, Res, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
    Logger,
    RequestContext,
    TransactionalConnection,
    OrderService,
    ChannelService,
} from '@vendure/core';
import { trackShipment } from './shiprocket-client';

const loggerCtx = 'ShiprocketTrackingSync';

@Controller('sync')
export class ShiprocketTrackingSyncController {
    constructor(
        private connection: TransactionalConnection,
        private orderService: OrderService,
        private channelService: ChannelService,
    ) {}

    @Post('shiprocket-tracking')
    async sync(@Req() req: Request, @Res() res: Response) {
        const authHeader = req.headers.authorization;
        const expected = `Bearer ${process.env.CRON_SECRET || ''}`;
        if (!process.env.CRON_SECRET || authHeader !== expected) {
            return res.status(HttpStatus.UNAUTHORIZED).send('unauthorized');
        }

        const ctx = await this.getCtx();
        const fulfillmentRepo = this.connection.getRepository(ctx, 'Fulfillment' as any);

        // Pending = has a trackingCode (AWB) but isn't Delivered/Cancelled yet.
        const pending = await fulfillmentRepo
            .createQueryBuilder('f')
            .where('f.state NOT IN (:...states)', { states: ['Delivered', 'Cancelled'] })
            .andWhere('f.trackingCode IS NOT NULL')
            .andWhere("f.trackingCode != ''")
            .getMany();

        let updated = 0;
        let errors = 0;

        for (const fulfillment of pending) {
            try {
                const result = await trackShipment(fulfillment.trackingCode);
                const currentStatus = result?.tracking_data?.shipment_track?.[0]?.current_status;

                if (currentStatus === 'Delivered' && fulfillment.state !== 'Delivered') {
                    await fulfillmentRepo.update(fulfillment.id, { state: 'Delivered' });
                    updated++;
                }
                // Other intermediate statuses (in-transit, out-for-delivery) are
                // informational in Shiprocket's model and don't map to a distinct
                // Vendure FulfillmentState — extend this if you add custom states.
            } catch (err: any) {
                Logger.error(`Tracking sync failed for fulfillment ${fulfillment.id}: ${err.message}`, loggerCtx);
                errors++;
            }
        }

        Logger.info(`Tracking sync complete: ${updated} updated, ${errors} errors, ${pending.length} checked`, loggerCtx);
        return res.status(HttpStatus.OK).json({ checked: pending.length, updated, errors });
    }

    private async getCtx(): Promise<RequestContext> {
        const channel = await this.channelService.getDefaultChannel();
        return RequestContext.empty();
    }
}
