// ============================================================
// razorpay-shop-api-extension.ts
//
// Adds one custom mutation to the shop-api: createRazorpayOrder. Call this
// right before launching Razorpay Checkout, once the active Order's total
// is final (after shipping/discounts are applied). It creates a matching
// order on Razorpay's side and hands back everything checkout.js needs.
// ============================================================

import gql from 'graphql-tag';
import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext, ActiveOrderService, UnauthorizedError } from '@vendure/core';
import { createRazorpayOrder } from './razorpay-client';

export const shopApiExtensions = gql`
    type RazorpayOrderResult {
        razorpayOrderId: String!
        amount: Int!
        currency: String!
        keyId: String!
    }

    extend type Mutation {
        createRazorpayOrder: RazorpayOrderResult!
    }
`;

@Resolver()
export class RazorpayShopResolver {
    constructor(private activeOrderService: ActiveOrderService) {}

    @Mutation()
    @Allow(Permission.Owner)
    async createRazorpayOrder(@Ctx() ctx: RequestContext) {
        const order = await this.activeOrderService.getActiveOrder(ctx, undefined);
        if (!order) {
            throw new UnauthorizedError();
        }

        const rpOrder = await createRazorpayOrder(order.totalWithTax / 100, order.code);

        return {
            razorpayOrderId: rpOrder.id,
            amount: rpOrder.amount,
            currency: rpOrder.currency,
            keyId: process.env.RAZORPAY_KEY_ID || '',
        };
    }
}
