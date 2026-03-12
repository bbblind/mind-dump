import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import Stripe from 'stripe';
import { webhookHandlers } from '../src/webhooks';
import { db } from '../src/db';
import { telegramService } from '../src/bot';

// Mock dependencies
vi.mock('../src/db');
vi.mock('../src/bot');
vi.mock('../src/stripe');

const mockDb = vi.mocked(db);
const mockTelegramService = vi.mocked(telegramService);

describe('Webhook Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleCheckoutSessionCompleted', () => {
    const mockEvent: Stripe.CheckoutSessionCompletedEvent = {
      id: 'evt_test_123',
      object: 'event',
      api_version: '2023-10-16',
      created: 1234567890,
      data: {
        object: {
          id: 'cs_test_123',
          object: 'checkout.session',
          customer: 'cus_test_123',
          subscription: 'sub_test_123',
          metadata: {
            telegramId: '123456789',
            username: 'testuser',
          },
          customer_details: {
            name: 'Test User',
            email: 'test@example.com',
          },
        } as Stripe.Checkout.Session,
      },
      livemode: false,
      pending_webhooks: 1,
      request: {
        id: 'req_test_123',
        idempotency_key: null,
      },
      type: 'checkout.session.completed',
    };

    it('should successfully process checkout session', async () => {
      // Mock database responses
      const mockUser = {
        id: 'user_123',
        telegramId: BigInt(123456789),
        username: 'testuser',
        subscriptions: [],
      };

      const mockPlan = {
        id: 'plan_123',
        name: 'Monthly Premium',
        stripePriceId: 'price_123',
        priceCents: 999,
        interval: 'MONTH' as const,
        active: true,
      };

      const mockSubscription = {
        id: 'sub_123',
        userId: 'user_123',
        planId: 'plan_123',
        stripeCustomerId: 'cus_test_123',
        stripeSubId: 'sub_test_123',
        status: 'ACTIVE' as const,
        currentPeriodEnd: new Date('2024-02-01'),
        user: mockUser,
        plan: mockPlan,
      };

      // Mock Stripe subscription
      const mockStripeSubscription = {
        id: 'sub_test_123',
        customer: 'cus_test_123',
        current_period_end: 1706745600, // 2024-02-01
        cancel_at_period_end: false,
        items: {
          data: [
            {
              price: {
                id: 'price_123',
              },
            },
          ],
        },
      } as any;

      // Setup mocks
      mockDb.user.upsert.mockResolvedValue(mockUser as any);
      mockDb.plan.findByStripeId.mockResolvedValue(mockPlan as any);
      mockDb.subscription.upsert.mockResolvedValue(mockSubscription as any);
      mockTelegramService.grantAccess.mockResolvedValue(undefined);

      // Mock stripeUtils
      const { stripeUtils } = await import('../src/stripe');
      vi.mocked(stripeUtils.getSubscription).mockResolvedValue(mockStripeSubscription);

      // Execute test
      const result = await webhookHandlers.handleCheckoutSessionCompleted(mockEvent);

      // Assertions
      expect(result.success).toBe(true);
      expect(result.message).toBe('Checkout session processed successfully');
      expect(result.data).toEqual({
        userId: 'user_123',
        subscriptionId: 'sub_123',
      });

      // Verify database calls
      expect(mockDb.user.upsert).toHaveBeenCalledWith({
        telegramId: 123456789,
        username: 'testuser',
        firstName: 'Test',
        lastName: 'User',
      });

      expect(mockDb.subscription.upsert).toHaveBeenCalledWith({
        userId: 'user_123',
        planId: 'plan_123',
        stripeCustomerId: 'cus_test_123',
        stripeSubId: 'sub_test_123',
        status: 'ACTIVE',
        currentPeriodEnd: new Date(1706745600 * 1000),
        cancelAtPeriodEnd: false,
      });

      // Verify Telegram service call
      expect(mockTelegramService.grantAccess).toHaveBeenCalledWith(
        123456789,
        new Date(1706745600 * 1000)
      );
    });

    it('should handle missing telegramId in metadata', async () => {
      const eventWithoutTelegramId = {
        ...mockEvent,
        data: {
          object: {
            ...mockEvent.data.object,
            metadata: {
              username: 'testuser',
            },
          },
        },
      };

      const result = await webhookHandlers.handleCheckoutSessionCompleted(eventWithoutTelegramId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Missing telegramId in session metadata');
    });

    it('should handle plan not found', async () => {
      const mockUser = {
        id: 'user_123',
        telegramId: BigInt(123456789),
        username: 'testuser',
        subscriptions: [],
      };

      const mockStripeSubscription = {
        id: 'sub_test_123',
        customer: 'cus_test_123',
        current_period_end: 1706745600,
        cancel_at_period_end: false,
        items: {
          data: [
            {
              price: {
                id: 'price_nonexistent',
              },
            },
          ],
        },
      } as any;

      mockDb.user.upsert.mockResolvedValue(mockUser as any);
      mockDb.plan.findByStripeId.mockResolvedValue(null);

      const { stripeUtils } = await import('../src/stripe');
      vi.mocked(stripeUtils.getSubscription).mockResolvedValue(mockStripeSubscription);

      const result = await webhookHandlers.handleCheckoutSessionCompleted(mockEvent);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Plan not found for price ID: price_nonexistent');
    });
  });

  describe('handleInvoicePaymentFailed', () => {
    const mockEvent: Stripe.InvoicePaymentFailedEvent = {
      id: 'evt_test_456',
      object: 'event',
      api_version: '2023-10-16',
      created: 1234567890,
      data: {
        object: {
          id: 'in_test_123',
          object: 'invoice',
          subscription: 'sub_test_123',
        } as Stripe.Invoice,
      },
      livemode: false,
      pending_webhooks: 1,
      request: {
        id: 'req_test_456',
        idempotency_key: null,
      },
      type: 'invoice.payment_failed',
    };

    it('should successfully process invoice payment failure', async () => {
      const mockUser = {
        id: 'user_123',
        telegramId: BigInt(123456789),
        username: 'testuser',
      };

      const mockSubscription = {
        id: 'sub_123',
        userId: 'user_123',
        planId: 'plan_123',
        stripeCustomerId: 'cus_test_123',
        stripeSubId: 'sub_test_123',
        status: 'ACTIVE' as const,
        currentPeriodEnd: new Date('2024-02-01'),
        cancelAtPeriodEnd: false,
        user: mockUser,
      };

      mockDb.subscription.findByStripeId.mockResolvedValue(mockSubscription as any);
      mockDb.subscription.upsert.mockResolvedValue(mockSubscription as any);
      mockTelegramService.scheduleRemoval.mockResolvedValue(undefined);
      mockTelegramService.notifyPaymentFailed.mockResolvedValue(undefined);

      const result = await webhookHandlers.handleInvoicePaymentFailed(mockEvent);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Invoice payment failure processed successfully');

      // Verify subscription status updated to PAST_DUE
      expect(mockDb.subscription.upsert).toHaveBeenCalledWith({
        userId: 'user_123',
        planId: 'plan_123',
        stripeCustomerId: 'cus_test_123',
        stripeSubId: 'sub_test_123',
        status: 'PAST_DUE',
        currentPeriodEnd: new Date('2024-02-01'),
        cancelAtPeriodEnd: false,
      });

      // Verify removal scheduled and user notified
      expect(mockTelegramService.scheduleRemoval).toHaveBeenCalled();
      expect(mockTelegramService.notifyPaymentFailed).toHaveBeenCalledWith(123456789, 3);
    });

    it('should handle invoice without subscription', async () => {
      const eventWithoutSubscription = {
        ...mockEvent,
        data: {
          object: {
            ...mockEvent.data.object,
            subscription: null,
          },
        },
      };

      const result = await webhookHandlers.handleInvoicePaymentFailed(eventWithoutSubscription);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Invoice not associated with subscription, skipping');
    });
  });

  describe('handleSubscriptionDeleted', () => {
    const mockEvent: Stripe.CustomerSubscriptionDeletedEvent = {
      id: 'evt_test_789',
      object: 'event',
      api_version: '2023-10-16',
      created: 1234567890,
      data: {
        object: {
          id: 'sub_test_123',
          object: 'subscription',
          customer: 'cus_test_123',
          status: 'canceled',
        } as Stripe.Subscription,
      },
      livemode: false,
      pending_webhooks: 1,
      request: {
        id: 'req_test_789',
        idempotency_key: null,
      },
      type: 'customer.subscription.deleted',
    };

    it('should successfully process subscription deletion', async () => {
      const mockUser = {
        id: 'user_123',
        telegramId: BigInt(123456789),
        username: 'testuser',
      };

      const mockSubscription = {
        id: 'sub_123',
        userId: 'user_123',
        planId: 'plan_123',
        stripeCustomerId: 'cus_test_123',
        stripeSubId: 'sub_test_123',
        status: 'ACTIVE' as const,
        currentPeriodEnd: new Date('2024-02-01'),
        cancelAtPeriodEnd: false,
        user: mockUser,
      };

      mockDb.subscription.findByStripeId.mockResolvedValue(mockSubscription as any);
      mockDb.subscription.upsert.mockResolvedValue({
        ...mockSubscription,
        status: 'CANCELED',
        cancelAtPeriodEnd: true,
      } as any);
      mockTelegramService.revokeAccess.mockResolvedValue(undefined);

      const result = await webhookHandlers.handleSubscriptionDeleted(mockEvent);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Subscription deletion processed successfully');

      // Verify subscription status updated to CANCELED
      expect(mockDb.subscription.upsert).toHaveBeenCalledWith({
        userId: 'user_123',
        planId: 'plan_123',
        stripeCustomerId: 'cus_test_123',
        stripeSubId: 'sub_test_123',
        status: 'CANCELED',
        currentPeriodEnd: new Date('2024-02-01'),
        cancelAtPeriodEnd: true,
      });

      // Verify access revoked
      expect(mockTelegramService.revokeAccess).toHaveBeenCalledWith(
        123456789,
        'Subscription cancelled'
      );
    });
  });
});
import Stripe from 'stripe';
import { webhookHandlers } from '../src/webhooks';
import { db } from '../src/db';
import { telegramService } from '../src/bot';

// Mock dependencies
vi.mock('../src/db');
vi.mock('../src/bot');
vi.mock('../src/stripe');

const mockDb = vi.mocked(db);
const mockTelegramService = vi.mocked(telegramService);

describe('Webhook Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleCheckoutSessionCompleted', () => {
    const mockEvent: Stripe.CheckoutSessionCompletedEvent = {
      id: 'evt_test_123',
      object: 'event',
      api_version: '2023-10-16',
      created: 1234567890,
      data: {
        object: {
          id: 'cs_test_123',
          object: 'checkout.session',
          customer: 'cus_test_123',
          subscription: 'sub_test_123',
          metadata: {
            telegramId: '123456789',
            username: 'testuser',
          },
          customer_details: {
            name: 'Test User',
            email: 'test@example.com',
          },
        } as Stripe.Checkout.Session,
      },
      livemode: false,
      pending_webhooks: 1,
      request: {
        id: 'req_test_123',
        idempotency_key: null,
      },
      type: 'checkout.session.completed',
    };

    it('should successfully process checkout session', async () => {
      // Mock database responses
      const mockUser = {
        id: 'user_123',
        telegramId: BigInt(123456789),
        username: 'testuser',
        subscriptions: [],
      };

      const mockPlan = {
        id: 'plan_123',
        name: 'Monthly Premium',
        stripePriceId: 'price_123',
        priceCents: 999,
        interval: 'MONTH' as const,
        active: true,
      };

      const mockSubscription = {
        id: 'sub_123',
        userId: 'user_123',
        planId: 'plan_123',
        stripeCustomerId: 'cus_test_123',
        stripeSubId: 'sub_test_123',
        status: 'ACTIVE' as const,
        currentPeriodEnd: new Date('2024-02-01'),
        user: mockUser,
        plan: mockPlan,
      };

      // Mock Stripe subscription
      const mockStripeSubscription = {
        id: 'sub_test_123',
        customer: 'cus_test_123',
        current_period_end: 1706745600, // 2024-02-01
        cancel_at_period_end: false,
        items: {
          data: [
            {
              price: {
                id: 'price_123',
              },
            },
          ],
        },
      } as any;

      // Setup mocks
      mockDb.user.upsert.mockResolvedValue(mockUser as any);
      mockDb.plan.findByStripeId.mockResolvedValue(mockPlan as any);
      mockDb.subscription.upsert.mockResolvedValue(mockSubscription as any);
      mockTelegramService.grantAccess.mockResolvedValue(undefined);

      // Mock stripeUtils
      const { stripeUtils } = await import('../src/stripe');
      vi.mocked(stripeUtils.getSubscription).mockResolvedValue(mockStripeSubscription);

      // Execute test
      const result = await webhookHandlers.handleCheckoutSessionCompleted(mockEvent);

      // Assertions
      expect(result.success).toBe(true);
      expect(result.message).toBe('Checkout session processed successfully');
      expect(result.data).toEqual({
        userId: 'user_123',
        subscriptionId: 'sub_123',
      });

      // Verify database calls
      expect(mockDb.user.upsert).toHaveBeenCalledWith({
        telegramId: 123456789,
        username: 'testuser',
        firstName: 'Test',
        lastName: 'User',
      });

      expect(mockDb.subscription.upsert).toHaveBeenCalledWith({
        userId: 'user_123',
        planId: 'plan_123',
        stripeCustomerId: 'cus_test_123',
        stripeSubId: 'sub_test_123',
        status: 'ACTIVE',
        currentPeriodEnd: new Date(1706745600 * 1000),
        cancelAtPeriodEnd: false,
      });

      // Verify Telegram service call
      expect(mockTelegramService.grantAccess).toHaveBeenCalledWith(
        123456789,
        new Date(1706745600 * 1000)
      );
    });

    it('should handle missing telegramId in metadata', async () => {
      const eventWithoutTelegramId = {
        ...mockEvent,
        data: {
          object: {
            ...mockEvent.data.object,
            metadata: {
              username: 'testuser',
            },
          },
        },
      };

      const result = await webhookHandlers.handleCheckoutSessionCompleted(eventWithoutTelegramId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Missing telegramId in session metadata');
    });

    it('should handle plan not found', async () => {
      const mockUser = {
        id: 'user_123',
        telegramId: BigInt(123456789),
        username: 'testuser',
        subscriptions: [],
      };

      const mockStripeSubscription = {
        id: 'sub_test_123',
        customer: 'cus_test_123',
        current_period_end: 1706745600,
        cancel_at_period_end: false,
        items: {
          data: [
            {
              price: {
                id: 'price_nonexistent',
              },
            },
          ],
        },
      } as any;

      mockDb.user.upsert.mockResolvedValue(mockUser as any);
      mockDb.plan.findByStripeId.mockResolvedValue(null);

      const { stripeUtils } = await import('../src/stripe');
      vi.mocked(stripeUtils.getSubscription).mockResolvedValue(mockStripeSubscription);

      const result = await webhookHandlers.handleCheckoutSessionCompleted(mockEvent);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Plan not found for price ID: price_nonexistent');
    });
  });

  describe('handleInvoicePaymentFailed', () => {
    const mockEvent: Stripe.InvoicePaymentFailedEvent = {
      id: 'evt_test_456',
      object: 'event',
      api_version: '2023-10-16',
      created: 1234567890,
      data: {
        object: {
          id: 'in_test_123',
          object: 'invoice',
          subscription: 'sub_test_123',
        } as Stripe.Invoice,
      },
      livemode: false,
      pending_webhooks: 1,
      request: {
        id: 'req_test_456',
        idempotency_key: null,
      },
      type: 'invoice.payment_failed',
    };

    it('should successfully process invoice payment failure', async () => {
      const mockUser = {
        id: 'user_123',
        telegramId: BigInt(123456789),
        username: 'testuser',
      };

      const mockSubscription = {
        id: 'sub_123',
        userId: 'user_123',
        planId: 'plan_123',
        stripeCustomerId: 'cus_test_123',
        stripeSubId: 'sub_test_123',
        status: 'ACTIVE' as const,
        currentPeriodEnd: new Date('2024-02-01'),
        cancelAtPeriodEnd: false,
        user: mockUser,
      };

      mockDb.subscription.findByStripeId.mockResolvedValue(mockSubscription as any);
      mockDb.subscription.upsert.mockResolvedValue(mockSubscription as any);
      mockTelegramService.scheduleRemoval.mockResolvedValue(undefined);
      mockTelegramService.notifyPaymentFailed.mockResolvedValue(undefined);

      const result = await webhookHandlers.handleInvoicePaymentFailed(mockEvent);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Invoice payment failure processed successfully');

      // Verify subscription status updated to PAST_DUE
      expect(mockDb.subscription.upsert).toHaveBeenCalledWith({
        userId: 'user_123',
        planId: 'plan_123',
        stripeCustomerId: 'cus_test_123',
        stripeSubId: 'sub_test_123',
        status: 'PAST_DUE',
        currentPeriodEnd: new Date('2024-02-01'),
        cancelAtPeriodEnd: false,
      });

      // Verify removal scheduled and user notified
      expect(mockTelegramService.scheduleRemoval).toHaveBeenCalled();
      expect(mockTelegramService.notifyPaymentFailed).toHaveBeenCalledWith(123456789, 3);
    });

    it('should handle invoice without subscription', async () => {
      const eventWithoutSubscription = {
        ...mockEvent,
        data: {
          object: {
            ...mockEvent.data.object,
            subscription: null,
          },
        },
      };

      const result = await webhookHandlers.handleInvoicePaymentFailed(eventWithoutSubscription);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Invoice not associated with subscription, skipping');
    });
  });

  describe('handleSubscriptionDeleted', () => {
    const mockEvent: Stripe.CustomerSubscriptionDeletedEvent = {
      id: 'evt_test_789',
      object: 'event',
      api_version: '2023-10-16',
      created: 1234567890,
      data: {
        object: {
          id: 'sub_test_123',
          object: 'subscription',
          customer: 'cus_test_123',
          status: 'canceled',
        } as Stripe.Subscription,
      },
      livemode: false,
      pending_webhooks: 1,
      request: {
        id: 'req_test_789',
        idempotency_key: null,
      },
      type: 'customer.subscription.deleted',
    };

    it('should successfully process subscription deletion', async () => {
      const mockUser = {
        id: 'user_123',
        telegramId: BigInt(123456789),
        username: 'testuser',
      };

      const mockSubscription = {
        id: 'sub_123',
        userId: 'user_123',
        planId: 'plan_123',
        stripeCustomerId: 'cus_test_123',
        stripeSubId: 'sub_test_123',
        status: 'ACTIVE' as const,
        currentPeriodEnd: new Date('2024-02-01'),
        cancelAtPeriodEnd: false,
        user: mockUser,
      };

      mockDb.subscription.findByStripeId.mockResolvedValue(mockSubscription as any);
      mockDb.subscription.upsert.mockResolvedValue({
        ...mockSubscription,
        status: 'CANCELED',
        cancelAtPeriodEnd: true,
      } as any);
      mockTelegramService.revokeAccess.mockResolvedValue(undefined);

      const result = await webhookHandlers.handleSubscriptionDeleted(mockEvent);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Subscription deletion processed successfully');

      // Verify subscription status updated to CANCELED
      expect(mockDb.subscription.upsert).toHaveBeenCalledWith({
        userId: 'user_123',
        planId: 'plan_123',
        stripeCustomerId: 'cus_test_123',
        stripeSubId: 'sub_test_123',
        status: 'CANCELED',
        currentPeriodEnd: new Date('2024-02-01'),
        cancelAtPeriodEnd: true,
      });

      // Verify access revoked
      expect(mockTelegramService.revokeAccess).toHaveBeenCalledWith(
        123456789,
        'Subscription cancelled'
      );
    });
  });
});