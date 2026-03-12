import Stripe from 'stripe';
import { STRIPE_SECRET_KEY, APP_BASE_URL } from './config';
import { logger } from './utils';
import { db } from './db';

// Initialize Stripe client
export const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
  typescript: true,
});

// Stripe utilities
export const stripeUtils = {
  // Create checkout session for subscription
  async createCheckoutSession(params: {
    priceId: string;
    telegramId: number;
    username?: string;
    successUrl?: string;
    cancelUrl?: string;
  }) {
    const { priceId, telegramId, username, successUrl, cancelUrl } = params;

    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        success_url: successUrl || `${APP_BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: cancelUrl || `${APP_BASE_URL}/cancel`,
        allow_promotion_codes: true,
        automatic_tax: { enabled: true },
        metadata: {
          telegramId: telegramId.toString(),
          username: username || '',
        },
        subscription_data: {
          metadata: {
            telegramId: telegramId.toString(),
            username: username || '',
          },
        },
      });

      logger.info(
        { sessionId: session.id, telegramId, priceId },
        'Created Stripe checkout session'
      );

      return session;
    } catch (error) {
      logger.error({ error, telegramId, priceId }, 'Failed to create checkout session');
      throw error;
    }
  },

  // Create billing portal session
  async createBillingPortalSession(customerId: string, returnUrl?: string) {
    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl || APP_BASE_URL,
      });

      logger.info(
        { sessionId: session.id, customerId },
        'Created billing portal session'
      );

      return session;
    } catch (error) {
      logger.error({ error, customerId }, 'Failed to create billing portal session');
      throw error;
    }
  },

  // Get subscription details
  async getSubscription(subscriptionId: string) {
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ['customer', 'items.data.price'],
      });
      return subscription;
    } catch (error) {
      logger.error({ error, subscriptionId }, 'Failed to retrieve subscription');
      throw error;
    }
  },

  // Cancel subscription
  async cancelSubscription(subscriptionId: string, immediately: boolean = false) {
    try {
      if (immediately) {
        const subscription = await stripe.subscriptions.cancel(subscriptionId);
        logger.info({ subscriptionId }, 'Cancelled subscription immediately');
        return subscription;
      } else {
        const subscription = await stripe.subscriptions.update(subscriptionId, {
          cancel_at_period_end: true,
        });
        logger.info({ subscriptionId }, 'Scheduled subscription cancellation');
        return subscription;
      }
    } catch (error) {
      logger.error({ error, subscriptionId }, 'Failed to cancel subscription');
      throw error;
    }
  },

  // Create or update product and prices
  async setupProducts() {
    try {
      // Find existing "Premium Membership" product
      const products = await stripe.products.list({ active: true, limit: 100 });
      let product = products.data.find(p => p.name === 'Premium Membership');

      if (!product) {
        // Create product if it doesn't exist
        product = await stripe.products.create({
          name: 'Premium Membership',
          description: 'Access to exclusive content and community',
          type: 'service',
        });
        logger.info({ productId: product.id }, 'Created Stripe product');
      } else {
        logger.info({ productId: product.id }, 'Using existing Stripe product');
      }

      // Create prices if they don't exist
      const prices = await stripe.prices.list({ product: product.id, active: true });
      const existingPrices = new Map(
        prices.data.map(price => [
          `${price.unit_amount}_${price.recurring?.interval}_${price.recurring?.interval_count || 1}`,
          price
        ])
      );

      const pricesToCreate = [
        {
          unit_amount: 1599, // $15.99
          interval: 'month' as const,
          interval_count: 1,
          name: 'Piano Mensile',
        },
        {
          unit_amount: 3599, // $35.99
          interval: 'month' as const,
          interval_count: 3,
          name: 'Piano 3 Mesi',
        },
      ];

      const createdPrices = [];

      for (const priceConfig of pricesToCreate) {
        const key = `${priceConfig.unit_amount}_${priceConfig.interval}_${priceConfig.interval_count}`;
        
        if (!existingPrices.has(key)) {
          const price = await stripe.prices.create({
            product: product.id,
            unit_amount: priceConfig.unit_amount,
            currency: 'usd',
            recurring: {
              interval: priceConfig.interval,
              interval_count: priceConfig.interval_count || 1,
            },
            nickname: priceConfig.name,
          });

          createdPrices.push({
            price,
            name: priceConfig.name,
            interval: priceConfig.interval as 'month' | 'year',
          });

          logger.info(
            { priceId: price.id, amount: priceConfig.unit_amount, interval: priceConfig.interval },
            'Created Stripe price'
          );
        } else {
          const existingPrice = existingPrices.get(key)!;
          createdPrices.push({
            price: existingPrice,
            name: priceConfig.name,
            interval: priceConfig.interval as 'month' | 'year',
          });
          logger.info(
            { priceId: existingPrice.id, amount: priceConfig.unit_amount, interval: priceConfig.interval, intervalCount: priceConfig.interval_count },
            'Using existing Stripe price'
          );
        }
      }

      // Update database with plans
      for (const { price, name, interval } of createdPrices) {
        await db.plan.upsert({
          name,
          stripePriceId: price.id,
          priceCents: price.unit_amount || 0,
          interval,
        });
      }

      logger.info('Stripe products and prices setup completed');
      return { product, prices: createdPrices };
    } catch (error) {
      logger.error({ error }, 'Failed to setup Stripe products');
      throw error;
    }
  },

  // Verify webhook signature
  verifyWebhookSignature(payload: string, signature: string, secret: string): Stripe.Event {
    try {
      return stripe.webhooks.constructEvent(payload, signature, secret);
    } catch (error) {
      logger.error({ error }, 'Failed to verify webhook signature');
      throw error;
    }
  },

  // Get customer details
  async getCustomer(customerId: string) {
    try {
      const customer = await stripe.customers.retrieve(customerId);
      return customer;
    } catch (error) {
      logger.error({ error, customerId }, 'Failed to retrieve customer');
      throw error;
    }
  },

  // List customer subscriptions
  async getCustomerSubscriptions(customerId: string) {
    try {
      const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
        expand: ['data.items.data.price'],
      });
      return subscriptions.data;
    } catch (error) {
      logger.error({ error, customerId }, 'Failed to retrieve customer subscriptions');
      throw error;
    }
  },

  // Get invoice details
  async getInvoice(invoiceId: string) {
    try {
      const invoice = await stripe.invoices.retrieve(invoiceId, {
        expand: ['subscription', 'customer'],
      });
      return invoice;
    } catch (error) {
      logger.error({ error, invoiceId }, 'Failed to retrieve invoice');
      throw error;
    }
  },

  // Retry failed invoice
  async retryInvoice(invoiceId: string) {
    try {
      const invoice = await stripe.invoices.pay(invoiceId);
      logger.info({ invoiceId }, 'Retried failed invoice');
      return invoice;
    } catch (error) {
      logger.error({ error, invoiceId }, 'Failed to retry invoice');
      throw error;
    }
  },

  // Create checkout session for one-time unlock payment (with coupon support!)
  async createUnlockPaymentLink(
    postId: string,
    priceCents: number,
    telegramId: number,
    username?: string
  ) {
    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card', 'cashapp'],
        line_items: [
          {
            price_data: {
              currency: 'usd',
              unit_amount: priceCents,
              product_data: {
                name: 'Unlock Exclusive Content',
                description: 'One-time access to premium content',
              },
            },
            quantity: 1,
          },
        ],
        success_url: `${APP_BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${APP_BASE_URL}/cancel`,
        allow_promotion_codes: true, // ✅ Enable coupon codes!
        automatic_tax: { enabled: true },
        metadata: {
          type: 'post_unlock',
          postId,
          telegramId: telegramId.toString(),
          username: username || '',
        },
      });

      logger.info(
        { sessionId: session.id, telegramId, postId, priceCents },
        'Created unlock payment session'
      );

      return session;
    } catch (error) {
      logger.error({ error, telegramId, postId }, 'Failed to create unlock payment session');
      throw error;
    }
  },
};

export default stripeUtils;
import { STRIPE_SECRET_KEY, APP_BASE_URL } from './config';
import { logger } from './utils';
import { db } from './db';

// Initialize Stripe client
export const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
  typescript: true,
});

// Stripe utilities
export const stripeUtils = {
  // Create checkout session for subscription
  async createCheckoutSession(params: {
    priceId: string;
    telegramId: number;
    username?: string;
    successUrl?: string;
    cancelUrl?: string;
  }) {
    const { priceId, telegramId, username, successUrl, cancelUrl } = params;

    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        success_url: successUrl || `${APP_BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: cancelUrl || `${APP_BASE_URL}/cancel`,
        allow_promotion_codes: true,
        automatic_tax: { enabled: true },
        metadata: {
          telegramId: telegramId.toString(),
          username: username || '',
        },
        subscription_data: {
          metadata: {
            telegramId: telegramId.toString(),
            username: username || '',
          },
        },
      });

      logger.info(
        { sessionId: session.id, telegramId, priceId },
        'Created Stripe checkout session'
      );

      return session;
    } catch (error) {
      logger.error({ error, telegramId, priceId }, 'Failed to create checkout session');
      throw error;
    }
  },

  // Create billing portal session
  async createBillingPortalSession(customerId: string, returnUrl?: string) {
    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl || APP_BASE_URL,
      });

      logger.info(
        { sessionId: session.id, customerId },
        'Created billing portal session'
      );

      return session;
    } catch (error) {
      logger.error({ error, customerId }, 'Failed to create billing portal session');
      throw error;
    }
  },

  // Get subscription details
  async getSubscription(subscriptionId: string) {
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ['customer', 'items.data.price'],
      });
      return subscription;
    } catch (error) {
      logger.error({ error, subscriptionId }, 'Failed to retrieve subscription');
      throw error;
    }
  },

  // Cancel subscription
  async cancelSubscription(subscriptionId: string, immediately: boolean = false) {
    try {
      if (immediately) {
        const subscription = await stripe.subscriptions.cancel(subscriptionId);
        logger.info({ subscriptionId }, 'Cancelled subscription immediately');
        return subscription;
      } else {
        const subscription = await stripe.subscriptions.update(subscriptionId, {
          cancel_at_period_end: true,
        });
        logger.info({ subscriptionId }, 'Scheduled subscription cancellation');
        return subscription;
      }
    } catch (error) {
      logger.error({ error, subscriptionId }, 'Failed to cancel subscription');
      throw error;
    }
  },

  // Create or update product and prices
  async setupProducts() {
    try {
      // Find existing "Premium Membership" product
      const products = await stripe.products.list({ active: true, limit: 100 });
      let product = products.data.find(p => p.name === 'Premium Membership');

      if (!product) {
        // Create product if it doesn't exist
        product = await stripe.products.create({
          name: 'Premium Membership',
          description: 'Access to exclusive content and community',
          type: 'service',
        });
        logger.info({ productId: product.id }, 'Created Stripe product');
      } else {
        logger.info({ productId: product.id }, 'Using existing Stripe product');
      }

      // Create prices if they don't exist
      const prices = await stripe.prices.list({ product: product.id, active: true });
      const existingPrices = new Map(
        prices.data.map(price => [
          `${price.unit_amount}_${price.recurring?.interval}_${price.recurring?.interval_count || 1}`,
          price
        ])
      );

      const pricesToCreate = [
        {
          unit_amount: 1599, // $15.99
          interval: 'month' as const,
          interval_count: 1,
          name: 'Piano Mensile',
        },
        {
          unit_amount: 3599, // $35.99
          interval: 'month' as const,
          interval_count: 3,
          name: 'Piano 3 Mesi',
        },
      ];

      const createdPrices = [];

      for (const priceConfig of pricesToCreate) {
        const key = `${priceConfig.unit_amount}_${priceConfig.interval}_${priceConfig.interval_count}`;
        
        if (!existingPrices.has(key)) {
          const price = await stripe.prices.create({
            product: product.id,
            unit_amount: priceConfig.unit_amount,
            currency: 'usd',
            recurring: {
              interval: priceConfig.interval,
              interval_count: priceConfig.interval_count || 1,
            },
            nickname: priceConfig.name,
          });

          createdPrices.push({
            price,
            name: priceConfig.name,
            interval: priceConfig.interval as 'month' | 'year',
          });

          logger.info(
            { priceId: price.id, amount: priceConfig.unit_amount, interval: priceConfig.interval },
            'Created Stripe price'
          );
        } else {
          const existingPrice = existingPrices.get(key)!;
          createdPrices.push({
            price: existingPrice,
            name: priceConfig.name,
            interval: priceConfig.interval as 'month' | 'year',
          });
          logger.info(
            { priceId: existingPrice.id, amount: priceConfig.unit_amount, interval: priceConfig.interval, intervalCount: priceConfig.interval_count },
            'Using existing Stripe price'
          );
        }
      }

      // Update database with plans
      for (const { price, name, interval } of createdPrices) {
        await db.plan.upsert({
          name,
          stripePriceId: price.id,
          priceCents: price.unit_amount || 0,
          interval,
        });
      }

      logger.info('Stripe products and prices setup completed');
      return { product, prices: createdPrices };
    } catch (error) {
      logger.error({ error }, 'Failed to setup Stripe products');
      throw error;
    }
  },

  // Verify webhook signature
  verifyWebhookSignature(payload: string, signature: string, secret: string): Stripe.Event {
    try {
      return stripe.webhooks.constructEvent(payload, signature, secret);
    } catch (error) {
      logger.error({ error }, 'Failed to verify webhook signature');
      throw error;
    }
  },

  // Get customer details
  async getCustomer(customerId: string) {
    try {
      const customer = await stripe.customers.retrieve(customerId);
      return customer;
    } catch (error) {
      logger.error({ error, customerId }, 'Failed to retrieve customer');
      throw error;
    }
  },

  // List customer subscriptions
  async getCustomerSubscriptions(customerId: string) {
    try {
      const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
        expand: ['data.items.data.price'],
      });
      return subscriptions.data;
    } catch (error) {
      logger.error({ error, customerId }, 'Failed to retrieve customer subscriptions');
      throw error;
    }
  },

  // Get invoice details
  async getInvoice(invoiceId: string) {
    try {
      const invoice = await stripe.invoices.retrieve(invoiceId, {
        expand: ['subscription', 'customer'],
      });
      return invoice;
    } catch (error) {
      logger.error({ error, invoiceId }, 'Failed to retrieve invoice');
      throw error;
    }
  },

  // Retry failed invoice
  async retryInvoice(invoiceId: string) {
    try {
      const invoice = await stripe.invoices.pay(invoiceId);
      logger.info({ invoiceId }, 'Retried failed invoice');
      return invoice;
    } catch (error) {
      logger.error({ error, invoiceId }, 'Failed to retry invoice');
      throw error;
    }
  },

  // Create checkout session for one-time unlock payment (with coupon support!)
  async createUnlockPaymentLink(
    postId: string,
    priceCents: number,
    telegramId: number,
    username?: string
  ) {
    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card', 'cashapp'],
        line_items: [
          {
            price_data: {
              currency: 'usd',
              unit_amount: priceCents,
              product_data: {
                name: 'Unlock Exclusive Content',
                description: 'One-time access to premium content',
              },
            },
            quantity: 1,
          },
        ],
        success_url: `${APP_BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${APP_BASE_URL}/cancel`,
        allow_promotion_codes: true, // ✅ Enable coupon codes!
        automatic_tax: { enabled: true },
        metadata: {
          type: 'post_unlock',
          postId,
          telegramId: telegramId.toString(),
          username: username || '',
        },
      });

      logger.info(
        { sessionId: session.id, telegramId, postId, priceCents },
        'Created unlock payment session'
      );

      return session;
    } catch (error) {
      logger.error({ error, telegramId, postId }, 'Failed to create unlock payment session');
      throw error;
    }
  },
};

export default stripeUtils;