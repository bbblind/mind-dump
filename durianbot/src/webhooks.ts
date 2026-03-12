import Stripe from 'stripe';
import { db, prisma } from './db';
import { logger } from './utils';
import { stripeUtils } from './stripe';
import { telegramService } from './bot';
import { addHours } from './utils';
import { GRACE_HOURS_ON_FAIL } from './config';

export interface WebhookHandlerResult {
  success: boolean;
  message: string;
  data?: any;
}

export const webhookHandlers = {
  // Handle successful checkout session
  async handleCheckoutSessionCompleted(
    event: Stripe.CheckoutSessionCompletedEvent
  ): Promise<WebhookHandlerResult> {
    const session = event.data.object;
    
    try {
      logger.info(
        { sessionId: session.id, customerId: session.customer, metadata: session.metadata },
        'Processing checkout session completed'
      );

      // Check if this is an unlock payment (payment link)
      if (session.metadata?.type === 'post_unlock') {
        return await this.handleUnlockPayment(session);
      }

      // Extract metadata
      const telegramId = parseInt(session.metadata?.telegramId || '0', 10);
      const username = session.metadata?.username;

      if (!telegramId) {
        throw new Error('Missing telegramId in session metadata');
      }

      // Get subscription details
      const subscriptionId = session.subscription as string;
      const subscription = await stripeUtils.getSubscription(subscriptionId);
      
      if (!subscription.items.data[0]?.price.id) {
        throw new Error('No price found in subscription');
      }

      // Find or create user
      const user = await db.user.upsert({
        telegramId,
        username,
        firstName: session.customer_details?.name?.split(' ')[0],
        lastName: session.customer_details?.name?.split(' ').slice(1).join(' '),
      });

      // Find plan
      const plan = await db.plan.findByStripeId(subscription.items.data[0].price.id);
      if (!plan) {
        throw new Error(`Plan not found for price ID: ${subscription.items.data[0].price.id}`);
      }

      // Create or update subscription
      // Extract customer ID (it might be an object or string)
      const customerId = typeof subscription.customer === 'string' 
        ? subscription.customer 
        : subscription.customer?.id || '';
      
      const dbSubscription = await db.subscription.upsert({
        userId: user.id,
        planId: plan.id,
        stripeCustomerId: customerId,
        stripeSubId: subscription.id,
        status: 'active',
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      });

      // Grant access to Telegram group
      await telegramService.grantAccess(Number(user.telegramId), dbSubscription.currentPeriodEnd);

      logger.info(
        { userId: user.id, subscriptionId: dbSubscription.id, telegramId },
        'Successfully processed checkout session'
      );

      return {
        success: true,
        message: 'Checkout session processed successfully',
        data: { userId: user.id, subscriptionId: dbSubscription.id },
      };
    } catch (error) {
      logger.error({ error, sessionId: session.id }, 'Failed to process checkout session');
      return {
        success: false,
        message: `Failed to process checkout session: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },

  // Handle successful invoice payment
  async handleInvoicePaid(
    event: Stripe.InvoicePaidEvent
  ): Promise<WebhookHandlerResult> {
    const invoice = event.data.object;
    
    try {
      logger.info(
        { invoiceId: invoice.id, subscriptionId: invoice.subscription },
        'Processing invoice paid'
      );

      if (!invoice.subscription) {
        return {
          success: true,
          message: 'Invoice not associated with subscription, skipping',
        };
      }

      // Get subscription from database
      const dbSubscription = await db.subscription.findByStripeId(
        invoice.subscription as string
      );

      if (!dbSubscription) {
        logger.warn(
          { subscriptionId: invoice.subscription },
          'Subscription not found in database'
        );
        return {
          success: true,
          message: 'Subscription not found in database, skipping',
        };
      }

      // Get updated subscription from Stripe
      const stripeSubscription = await stripeUtils.getSubscription(
        invoice.subscription as string
      );

      // Update subscription status
      await db.subscription.upsert({
        userId: dbSubscription.userId,
        planId: dbSubscription.planId,
        stripeCustomerId: dbSubscription.stripeCustomerId,
        stripeSubId: dbSubscription.stripeSubId,
        status: 'active',
        currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
        cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
      });

      // Ensure user still has access
      await telegramService.grantAccess(
        Number(dbSubscription.user.telegramId),
        new Date(stripeSubscription.current_period_end * 1000)
      );

      logger.info(
        { subscriptionId: dbSubscription.id, userId: dbSubscription.userId },
        'Successfully processed invoice payment'
      );

      return {
        success: true,
        message: 'Invoice payment processed successfully',
        data: { subscriptionId: dbSubscription.id },
      };
    } catch (error) {
      logger.error({ error, invoiceId: invoice.id }, 'Failed to process invoice payment');
      return {
        success: false,
        message: `Failed to process invoice payment: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },

  // Handle unlock payment (payment link completed)
  async handleUnlockPayment(
    session: Stripe.Checkout.Session
  ): Promise<WebhookHandlerResult> {
    try {
      logger.info(
        { sessionId: session.id, metadata: session.metadata },
        'Processing unlock payment'
      );

      const postId = session.metadata?.postId;
      const telegramId = parseInt(session.metadata?.telegramId || '0', 10);
      const username = session.metadata?.username;

      if (!postId || !telegramId) {
        throw new Error('Missing metadata in unlock payment session');
      }

      // Get user
      const user = await db.user.findByTelegramId(telegramId);
      if (!user) {
        throw new Error(`User not found: ${telegramId}`);
      }

      // Get post
      const post = await prisma.unlockablePost.findUnique({
        where: { id: postId },
      });

      if (!post) {
        throw new Error(`Post not found: ${postId}`);
      }

      // Create unlock record
      const unlock = await prisma.postUnlock.create({
        data: {
          userId: user.id,
          postId: post.id,
          stripePaymentId: session.payment_intent as string || session.id,
          amountPaid: session.amount_total || post.priceUSD,
        },
      });

      // Send content to user
      const { sendUnlockedContent } = await import('./unlockable');
      await sendUnlockedContent(user.id, post.id);

      logger.info(
        { unlockId: unlock.id, userId: user.id, postId: post.id },
        'Successfully processed unlock payment'
      );

      return {
        success: true,
        message: 'Unlock payment processed successfully',
        data: { unlockId: unlock.id },
      };
    } catch (error) {
      logger.error({ error, sessionId: session.id }, 'Failed to process unlock payment');
      return {
        success: false,
        message: `Failed to process unlock payment: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },

  // Handle failed invoice payment
  async handleInvoicePaymentFailed(
    event: Stripe.InvoicePaymentFailedEvent
  ): Promise<WebhookHandlerResult> {
    const invoice = event.data.object;
    
    try {
      logger.info(
        { invoiceId: invoice.id, subscriptionId: invoice.subscription },
        'Processing invoice payment failed'
      );

      if (!invoice.subscription) {
        return {
          success: true,
          message: 'Invoice not associated with subscription, skipping',
        };
      }

      // Get subscription from database
      const dbSubscription = await db.subscription.findByStripeId(
        invoice.subscription as string
      );

      if (!dbSubscription) {
        logger.warn(
          { subscriptionId: invoice.subscription },
          'Subscription not found in database'
        );
        return {
          success: true,
          message: 'Subscription not found in database, skipping',
        };
      }

      // Update subscription status to past due
      await db.subscription.upsert({
        userId: dbSubscription.userId,
        planId: dbSubscription.planId,
        stripeCustomerId: dbSubscription.stripeCustomerId,
        stripeSubId: dbSubscription.stripeSubId,
        status: 'PAST_DUE',
        currentPeriodEnd: dbSubscription.currentPeriodEnd,
        cancelAtPeriodEnd: dbSubscription.cancelAtPeriodEnd,
      });

      // Schedule removal after grace period
      const removalTime = addHours(new Date(), GRACE_HOURS_ON_FAIL);
      await telegramService.scheduleRemoval(
        Number(dbSubscription.user.telegramId),
        removalTime,
        'Payment failed'
      );

      // Notify user about payment failure
      await telegramService.notifyPaymentFailed(
        Number(dbSubscription.user.telegramId),
        GRACE_HOURS_ON_FAIL
      );

      logger.info(
        { subscriptionId: dbSubscription.id, userId: dbSubscription.userId, removalTime },
        'Successfully processed invoice payment failure'
      );

      return {
        success: true,
        message: 'Invoice payment failure processed successfully',
        data: { subscriptionId: dbSubscription.id, removalTime },
      };
    } catch (error) {
      logger.error({ error, invoiceId: invoice.id }, 'Failed to process invoice payment failure');
      return {
        success: false,
        message: `Failed to process invoice payment failure: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },

  // Handle subscription updates
  async handleSubscriptionUpdated(
    event: Stripe.CustomerSubscriptionUpdatedEvent
  ): Promise<WebhookHandlerResult> {
    const subscription = event.data.object;
    
    try {
      logger.info(
        { subscriptionId: subscription.id, status: subscription.status },
        'Processing subscription updated'
      );

      // Get subscription from database
      const dbSubscription = await db.subscription.findByStripeId(subscription.id);

      if (!dbSubscription) {
        logger.warn(
          { subscriptionId: subscription.id },
          'Subscription not found in database'
        );
        return {
          success: true,
          message: 'Subscription not found in database, skipping',
        };
      }

      // Map Stripe status to our status
      const statusMap: Record<string, 'active' | 'canceled' | 'past_due' | 'incomplete' | 'unpaid'> = {
        active: 'active',
        canceled: 'canceled',
        incomplete: 'incomplete',
        incomplete_expired: 'incomplete',
        past_due: 'past_due',
        unpaid: 'unpaid',
        trialing: 'active',
      };

      const status = statusMap[subscription.status] || 'unpaid';

      // Update subscription
      await db.subscription.upsert({
        userId: dbSubscription.userId,
        planId: dbSubscription.planId,
        stripeCustomerId: dbSubscription.stripeCustomerId,
        stripeSubId: dbSubscription.stripeSubId,
        status,
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      });

      // Handle access based on status
      if (status === 'active') {
        // Ensure user has access
        await telegramService.grantAccess(
          Number(dbSubscription.user.telegramId),
          new Date(subscription.current_period_end * 1000)
        );
      } else if (['CANCELED', 'UNPAID'].includes(status)) {
        // Remove access immediately
        await telegramService.revokeAccess(
          Number(dbSubscription.user.telegramId),
          'Subscription ended'
        );
      }

      logger.info(
        { subscriptionId: dbSubscription.id, status, userId: dbSubscription.userId },
        'Successfully processed subscription update'
      );

      return {
        success: true,
        message: 'Subscription update processed successfully',
        data: { subscriptionId: dbSubscription.id, status },
      };
    } catch (error) {
      logger.error({ error, subscriptionId: subscription.id }, 'Failed to process subscription update');
      return {
        success: false,
        message: `Failed to process subscription update: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },

  // Handle subscription deletion
  async handleSubscriptionDeleted(
    event: Stripe.CustomerSubscriptionDeletedEvent
  ): Promise<WebhookHandlerResult> {
    const subscription = event.data.object;
    
    try {
      logger.info(
        { subscriptionId: subscription.id },
        'Processing subscription deleted'
      );

      // Get subscription from database
      const dbSubscription = await db.subscription.findByStripeId(subscription.id);

      if (!dbSubscription) {
        logger.warn(
          { subscriptionId: subscription.id },
          'Subscription not found in database'
        );
        return {
          success: true,
          message: 'Subscription not found in database, skipping',
        };
      }

      // Update subscription status
      await db.subscription.upsert({
        userId: dbSubscription.userId,
        planId: dbSubscription.planId,
        stripeCustomerId: dbSubscription.stripeCustomerId,
        stripeSubId: dbSubscription.stripeSubId,
        status: 'CANCELED',
        currentPeriodEnd: dbSubscription.currentPeriodEnd,
        cancelAtPeriodEnd: true,
      });

      // Remove access immediately
      await telegramService.revokeAccess(
        Number(dbSubscription.user.telegramId),
        'Subscription cancelled'
      );

      logger.info(
        { subscriptionId: dbSubscription.id, userId: dbSubscription.userId },
        'Successfully processed subscription deletion'
      );

      return {
        success: true,
        message: 'Subscription deletion processed successfully',
        data: { subscriptionId: dbSubscription.id },
      };
    } catch (error) {
      logger.error({ error, subscriptionId: subscription.id }, 'Failed to process subscription deletion');
      return {
        success: false,
        message: `Failed to process subscription deletion: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
};

// Main webhook processor
export const processWebhook = async (
  event: Stripe.Event
): Promise<WebhookHandlerResult> => {
  // Check if event was already processed
  const isProcessed = await db.webhookEvent.isProcessed(event.id);
  if (isProcessed) {
    logger.info({ eventId: event.id, type: event.type }, 'Webhook event already processed');
    return {
      success: true,
      message: 'Event already processed',
    };
  }

  try {
    let result: WebhookHandlerResult;

    switch (event.type) {
      case 'checkout.session.completed':
        result = await webhookHandlers.handleCheckoutSessionCompleted(event);
        break;
      case 'invoice.paid':
        result = await webhookHandlers.handleInvoicePaid(event);
        break;
      case 'invoice.payment_failed':
        result = await webhookHandlers.handleInvoicePaymentFailed(event);
        break;
      case 'customer.subscription.updated':
        result = await webhookHandlers.handleSubscriptionUpdated(event);
        break;
      case 'customer.subscription.deleted':
        result = await webhookHandlers.handleSubscriptionDeleted(event);
        break;
      default:
        logger.info({ eventType: event.type }, 'Unhandled webhook event type');
        result = {
          success: true,
          message: `Unhandled event type: ${event.type}`,
        };
    }

    // Mark event as processed
    await db.webhookEvent.markProcessed(event.id, event.type);

    return result;
  } catch (error) {
    logger.error({ error, eventId: event.id, type: event.type }, 'Failed to process webhook');
    return {
      success: false,
      message: `Failed to process webhook: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
};
import { db, prisma } from './db';
import { logger } from './utils';
import { stripeUtils } from './stripe';
import { telegramService } from './bot';
import { addHours } from './utils';
import { GRACE_HOURS_ON_FAIL } from './config';

export interface WebhookHandlerResult {
  success: boolean;
  message: string;
  data?: any;
}

export const webhookHandlers = {
  // Handle successful checkout session
  async handleCheckoutSessionCompleted(
    event: Stripe.CheckoutSessionCompletedEvent
  ): Promise<WebhookHandlerResult> {
    const session = event.data.object;
    
    try {
      logger.info(
        { sessionId: session.id, customerId: session.customer, metadata: session.metadata },
        'Processing checkout session completed'
      );

      // Check if this is an unlock payment (payment link)
      if (session.metadata?.type === 'post_unlock') {
        return await this.handleUnlockPayment(session);
      }

      // Extract metadata
      const telegramId = parseInt(session.metadata?.telegramId || '0', 10);
      const username = session.metadata?.username;

      if (!telegramId) {
        throw new Error('Missing telegramId in session metadata');
      }

      // Get subscription details
      const subscriptionId = session.subscription as string;
      const subscription = await stripeUtils.getSubscription(subscriptionId);
      
      if (!subscription.items.data[0]?.price.id) {
        throw new Error('No price found in subscription');
      }

      // Find or create user
      const user = await db.user.upsert({
        telegramId,
        username,
        firstName: session.customer_details?.name?.split(' ')[0],
        lastName: session.customer_details?.name?.split(' ').slice(1).join(' '),
      });

      // Find plan
      const plan = await db.plan.findByStripeId(subscription.items.data[0].price.id);
      if (!plan) {
        throw new Error(`Plan not found for price ID: ${subscription.items.data[0].price.id}`);
      }

      // Create or update subscription
      // Extract customer ID (it might be an object or string)
      const customerId = typeof subscription.customer === 'string' 
        ? subscription.customer 
        : subscription.customer?.id || '';
      
      const dbSubscription = await db.subscription.upsert({
        userId: user.id,
        planId: plan.id,
        stripeCustomerId: customerId,
        stripeSubId: subscription.id,
        status: 'active',
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      });

      // Grant access to Telegram group
      await telegramService.grantAccess(Number(user.telegramId), dbSubscription.currentPeriodEnd);

      logger.info(
        { userId: user.id, subscriptionId: dbSubscription.id, telegramId },
        'Successfully processed checkout session'
      );

      return {
        success: true,
        message: 'Checkout session processed successfully',
        data: { userId: user.id, subscriptionId: dbSubscription.id },
      };
    } catch (error) {
      logger.error({ error, sessionId: session.id }, 'Failed to process checkout session');
      return {
        success: false,
        message: `Failed to process checkout session: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },

  // Handle successful invoice payment
  async handleInvoicePaid(
    event: Stripe.InvoicePaidEvent
  ): Promise<WebhookHandlerResult> {
    const invoice = event.data.object;
    
    try {
      logger.info(
        { invoiceId: invoice.id, subscriptionId: invoice.subscription },
        'Processing invoice paid'
      );

      if (!invoice.subscription) {
        return {
          success: true,
          message: 'Invoice not associated with subscription, skipping',
        };
      }

      // Get subscription from database
      const dbSubscription = await db.subscription.findByStripeId(
        invoice.subscription as string
      );

      if (!dbSubscription) {
        logger.warn(
          { subscriptionId: invoice.subscription },
          'Subscription not found in database'
        );
        return {
          success: true,
          message: 'Subscription not found in database, skipping',
        };
      }

      // Get updated subscription from Stripe
      const stripeSubscription = await stripeUtils.getSubscription(
        invoice.subscription as string
      );

      // Update subscription status
      await db.subscription.upsert({
        userId: dbSubscription.userId,
        planId: dbSubscription.planId,
        stripeCustomerId: dbSubscription.stripeCustomerId,
        stripeSubId: dbSubscription.stripeSubId,
        status: 'active',
        currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
        cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
      });

      // Ensure user still has access
      await telegramService.grantAccess(
        Number(dbSubscription.user.telegramId),
        new Date(stripeSubscription.current_period_end * 1000)
      );

      logger.info(
        { subscriptionId: dbSubscription.id, userId: dbSubscription.userId },
        'Successfully processed invoice payment'
      );

      return {
        success: true,
        message: 'Invoice payment processed successfully',
        data: { subscriptionId: dbSubscription.id },
      };
    } catch (error) {
      logger.error({ error, invoiceId: invoice.id }, 'Failed to process invoice payment');
      return {
        success: false,
        message: `Failed to process invoice payment: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },

  // Handle unlock payment (payment link completed)
  async handleUnlockPayment(
    session: Stripe.Checkout.Session
  ): Promise<WebhookHandlerResult> {
    try {
      logger.info(
        { sessionId: session.id, metadata: session.metadata },
        'Processing unlock payment'
      );

      const postId = session.metadata?.postId;
      const telegramId = parseInt(session.metadata?.telegramId || '0', 10);
      const username = session.metadata?.username;

      if (!postId || !telegramId) {
        throw new Error('Missing metadata in unlock payment session');
      }

      // Get user
      const user = await db.user.findByTelegramId(telegramId);
      if (!user) {
        throw new Error(`User not found: ${telegramId}`);
      }

      // Get post
      const post = await prisma.unlockablePost.findUnique({
        where: { id: postId },
      });

      if (!post) {
        throw new Error(`Post not found: ${postId}`);
      }

      // Create unlock record
      const unlock = await prisma.postUnlock.create({
        data: {
          userId: user.id,
          postId: post.id,
          stripePaymentId: session.payment_intent as string || session.id,
          amountPaid: session.amount_total || post.priceUSD,
        },
      });

      // Send content to user
      const { sendUnlockedContent } = await import('./unlockable');
      await sendUnlockedContent(user.id, post.id);

      logger.info(
        { unlockId: unlock.id, userId: user.id, postId: post.id },
        'Successfully processed unlock payment'
      );

      return {
        success: true,
        message: 'Unlock payment processed successfully',
        data: { unlockId: unlock.id },
      };
    } catch (error) {
      logger.error({ error, sessionId: session.id }, 'Failed to process unlock payment');
      return {
        success: false,
        message: `Failed to process unlock payment: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },

  // Handle failed invoice payment
  async handleInvoicePaymentFailed(
    event: Stripe.InvoicePaymentFailedEvent
  ): Promise<WebhookHandlerResult> {
    const invoice = event.data.object;
    
    try {
      logger.info(
        { invoiceId: invoice.id, subscriptionId: invoice.subscription },
        'Processing invoice payment failed'
      );

      if (!invoice.subscription) {
        return {
          success: true,
          message: 'Invoice not associated with subscription, skipping',
        };
      }

      // Get subscription from database
      const dbSubscription = await db.subscription.findByStripeId(
        invoice.subscription as string
      );

      if (!dbSubscription) {
        logger.warn(
          { subscriptionId: invoice.subscription },
          'Subscription not found in database'
        );
        return {
          success: true,
          message: 'Subscription not found in database, skipping',
        };
      }

      // Update subscription status to past due
      await db.subscription.upsert({
        userId: dbSubscription.userId,
        planId: dbSubscription.planId,
        stripeCustomerId: dbSubscription.stripeCustomerId,
        stripeSubId: dbSubscription.stripeSubId,
        status: 'PAST_DUE',
        currentPeriodEnd: dbSubscription.currentPeriodEnd,
        cancelAtPeriodEnd: dbSubscription.cancelAtPeriodEnd,
      });

      // Schedule removal after grace period
      const removalTime = addHours(new Date(), GRACE_HOURS_ON_FAIL);
      await telegramService.scheduleRemoval(
        Number(dbSubscription.user.telegramId),
        removalTime,
        'Payment failed'
      );

      // Notify user about payment failure
      await telegramService.notifyPaymentFailed(
        Number(dbSubscription.user.telegramId),
        GRACE_HOURS_ON_FAIL
      );

      logger.info(
        { subscriptionId: dbSubscription.id, userId: dbSubscription.userId, removalTime },
        'Successfully processed invoice payment failure'
      );

      return {
        success: true,
        message: 'Invoice payment failure processed successfully',
        data: { subscriptionId: dbSubscription.id, removalTime },
      };
    } catch (error) {
      logger.error({ error, invoiceId: invoice.id }, 'Failed to process invoice payment failure');
      return {
        success: false,
        message: `Failed to process invoice payment failure: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },

  // Handle subscription updates
  async handleSubscriptionUpdated(
    event: Stripe.CustomerSubscriptionUpdatedEvent
  ): Promise<WebhookHandlerResult> {
    const subscription = event.data.object;
    
    try {
      logger.info(
        { subscriptionId: subscription.id, status: subscription.status },
        'Processing subscription updated'
      );

      // Get subscription from database
      const dbSubscription = await db.subscription.findByStripeId(subscription.id);

      if (!dbSubscription) {
        logger.warn(
          { subscriptionId: subscription.id },
          'Subscription not found in database'
        );
        return {
          success: true,
          message: 'Subscription not found in database, skipping',
        };
      }

      // Map Stripe status to our status
      const statusMap: Record<string, 'active' | 'canceled' | 'past_due' | 'incomplete' | 'unpaid'> = {
        active: 'active',
        canceled: 'canceled',
        incomplete: 'incomplete',
        incomplete_expired: 'incomplete',
        past_due: 'past_due',
        unpaid: 'unpaid',
        trialing: 'active',
      };

      const status = statusMap[subscription.status] || 'unpaid';

      // Update subscription
      await db.subscription.upsert({
        userId: dbSubscription.userId,
        planId: dbSubscription.planId,
        stripeCustomerId: dbSubscription.stripeCustomerId,
        stripeSubId: dbSubscription.stripeSubId,
        status,
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      });

      // Handle access based on status
      if (status === 'active') {
        // Ensure user has access
        await telegramService.grantAccess(
          Number(dbSubscription.user.telegramId),
          new Date(subscription.current_period_end * 1000)
        );
      } else if (['CANCELED', 'UNPAID'].includes(status)) {
        // Remove access immediately
        await telegramService.revokeAccess(
          Number(dbSubscription.user.telegramId),
          'Subscription ended'
        );
      }

      logger.info(
        { subscriptionId: dbSubscription.id, status, userId: dbSubscription.userId },
        'Successfully processed subscription update'
      );

      return {
        success: true,
        message: 'Subscription update processed successfully',
        data: { subscriptionId: dbSubscription.id, status },
      };
    } catch (error) {
      logger.error({ error, subscriptionId: subscription.id }, 'Failed to process subscription update');
      return {
        success: false,
        message: `Failed to process subscription update: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },

  // Handle subscription deletion
  async handleSubscriptionDeleted(
    event: Stripe.CustomerSubscriptionDeletedEvent
  ): Promise<WebhookHandlerResult> {
    const subscription = event.data.object;
    
    try {
      logger.info(
        { subscriptionId: subscription.id },
        'Processing subscription deleted'
      );

      // Get subscription from database
      const dbSubscription = await db.subscription.findByStripeId(subscription.id);

      if (!dbSubscription) {
        logger.warn(
          { subscriptionId: subscription.id },
          'Subscription not found in database'
        );
        return {
          success: true,
          message: 'Subscription not found in database, skipping',
        };
      }

      // Update subscription status
      await db.subscription.upsert({
        userId: dbSubscription.userId,
        planId: dbSubscription.planId,
        stripeCustomerId: dbSubscription.stripeCustomerId,
        stripeSubId: dbSubscription.stripeSubId,
        status: 'CANCELED',
        currentPeriodEnd: dbSubscription.currentPeriodEnd,
        cancelAtPeriodEnd: true,
      });

      // Remove access immediately
      await telegramService.revokeAccess(
        Number(dbSubscription.user.telegramId),
        'Subscription cancelled'
      );

      logger.info(
        { subscriptionId: dbSubscription.id, userId: dbSubscription.userId },
        'Successfully processed subscription deletion'
      );

      return {
        success: true,
        message: 'Subscription deletion processed successfully',
        data: { subscriptionId: dbSubscription.id },
      };
    } catch (error) {
      logger.error({ error, subscriptionId: subscription.id }, 'Failed to process subscription deletion');
      return {
        success: false,
        message: `Failed to process subscription deletion: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
};

// Main webhook processor
export const processWebhook = async (
  event: Stripe.Event
): Promise<WebhookHandlerResult> => {
  // Check if event was already processed
  const isProcessed = await db.webhookEvent.isProcessed(event.id);
  if (isProcessed) {
    logger.info({ eventId: event.id, type: event.type }, 'Webhook event already processed');
    return {
      success: true,
      message: 'Event already processed',
    };
  }

  try {
    let result: WebhookHandlerResult;

    switch (event.type) {
      case 'checkout.session.completed':
        result = await webhookHandlers.handleCheckoutSessionCompleted(event);
        break;
      case 'invoice.paid':
        result = await webhookHandlers.handleInvoicePaid(event);
        break;
      case 'invoice.payment_failed':
        result = await webhookHandlers.handleInvoicePaymentFailed(event);
        break;
      case 'customer.subscription.updated':
        result = await webhookHandlers.handleSubscriptionUpdated(event);
        break;
      case 'customer.subscription.deleted':
        result = await webhookHandlers.handleSubscriptionDeleted(event);
        break;
      default:
        logger.info({ eventType: event.type }, 'Unhandled webhook event type');
        result = {
          success: true,
          message: `Unhandled event type: ${event.type}`,
        };
    }

    // Mark event as processed
    await db.webhookEvent.markProcessed(event.id, event.type);

    return result;
  } catch (error) {
    logger.error({ error, eventId: event.id, type: event.type }, 'Failed to process webhook');
    return {
      success: false,
      message: `Failed to process webhook: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
};