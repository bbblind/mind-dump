import { Queue, Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { REDIS_URL } from './config';
import { db } from './db';
import { telegramService } from './bot';
import { logger, addHours } from './utils';

// Redis connection
const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,
});

// Job queues
export const jobQueue = new Queue('durianbot-jobs', {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: 50,
    removeOnFail: 100,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
});

// Job types
export interface RemoveUserJobData {
  telegramId: number;
  reason: string;
}

export interface SubscriptionCheckJobData {
  // No data needed for periodic check
}

export interface RetryPaymentJobData {
  subscriptionId: string;
  attempt: number;
}

export interface CleanupJobData {
  // No data needed for cleanup
}

// Job processors
const jobProcessors = {
  async removeUser(job: Job<RemoveUserJobData>) {
    const { telegramId, reason } = job.data;
    
    try {
      logger.info({ telegramId, reason, jobId: job.id }, 'Processing user removal job');
      
      // Check if user still has active subscription
      const user = await db.user.findByTelegramId(telegramId);
      if (!user) {
        logger.info({ telegramId }, 'User not found, skipping removal');
        return { success: true, message: 'User not found' };
      }

      const activeSubscription = user.subscriptions[0];
      if (activeSubscription?.status === 'active' && activeSubscription.currentPeriodEnd > new Date()) {
        logger.info({ telegramId, subscriptionId: activeSubscription.id }, 'User has active subscription, skipping removal');
        return { success: true, message: 'User has active subscription' };
      }

      // Remove user access
      await telegramService.revokeAccess(telegramId, reason);
      
      logger.info({ telegramId, reason }, 'Successfully removed user');
      return { success: true, message: 'User removed successfully' };
    } catch (error) {
      logger.error({ error, telegramId, reason }, 'Failed to remove user');
      throw error;
    }
  },

  async checkSubscriptions(job: Job<SubscriptionCheckJobData>) {
    try {
      logger.info({ jobId: job.id }, 'Processing subscription check job');
      
      // Get expired subscriptions
      const expiredSubscriptions = await db.subscription.getExpiredSubscriptions();
      
      let processedCount = 0;
      let errorCount = 0;

      for (const subscription of expiredSubscriptions) {
        try {
          const telegramId = Number(subscription.user.telegramId);
          
          // Check if already processed (avoid duplicate removals)
          if (subscription.status === 'CANCELED') {
            continue;
          }

          logger.info(
            { subscriptionId: subscription.id, telegramId, status: subscription.status },
            'Processing expired subscription'
          );

          // Update subscription status
          await db.subscription.upsert({
            userId: subscription.userId,
            planId: subscription.planId,
            stripeCustomerId: subscription.stripeCustomerId,
            stripeSubId: subscription.stripeSubId,
            status: 'CANCELED',
            currentPeriodEnd: subscription.currentPeriodEnd,
            cancelAtPeriodEnd: true,
          });

          // Remove user access
          await telegramService.revokeAccess(telegramId, 'Subscription expired');
          
          processedCount++;
        } catch (error) {
          logger.error(
            { error, subscriptionId: subscription.id },
            'Failed to process expired subscription'
          );
          errorCount++;
        }
      }

      logger.info(
        { processedCount, errorCount, totalFound: expiredSubscriptions.length },
        'Completed subscription check job'
      );

      return {
        success: true,
        message: `Processed ${processedCount} expired subscriptions`,
        data: { processedCount, errorCount },
      };
    } catch (error) {
      logger.error({ error }, 'Failed to process subscription check job');
      throw error;
    }
  },

  async retryPayment(job: Job<RetryPaymentJobData>) {
    const { subscriptionId, attempt } = job.data;
    
    try {
      logger.info({ subscriptionId, attempt, jobId: job.id }, 'Processing payment retry job');
      
      const subscription = await db.subscription.findByStripeId(subscriptionId);
      if (!subscription) {
        logger.warn({ subscriptionId }, 'Subscription not found for payment retry');
        return { success: true, message: 'Subscription not found' };
      }

      // Check if subscription is still in past_due status
      if (subscription.status !== 'PAST_DUE') {
        logger.info({ subscriptionId, status: subscription.status }, 'Subscription status changed, skipping retry');
        return { success: true, message: 'Subscription status changed' };
      }

      // Get latest invoices for this subscription
      const stripe = require('./stripe').stripe;
      const invoices = await stripe.invoices.list({
        subscription: subscriptionId,
        status: 'open',
        limit: 1,
      });

      if (invoices.data.length === 0) {
        logger.info({ subscriptionId }, 'No open invoices found, skipping retry');
        return { success: true, message: 'No open invoices' };
      }

      const invoice = invoices.data[0];
      
      // Try to pay the invoice
      try {
        await stripe.invoices.pay(invoice.id);
        logger.info({ subscriptionId, invoiceId: invoice.id }, 'Successfully retried payment');
        return { success: true, message: 'Payment retry successful' };
      } catch (paymentError) {
        logger.warn({ paymentError, subscriptionId, invoiceId: invoice.id }, 'Payment retry failed');
        
        // Schedule next retry if we haven't exceeded max attempts
        const maxAttempts = 3;
        if (attempt < maxAttempts) {
          const nextAttempt = attempt + 1;
          const delayHours = Math.pow(2, nextAttempt); // Exponential backoff: 2h, 4h, 8h
          
          await jobQueue.add('retryPayment', {
            subscriptionId,
            attempt: nextAttempt,
          }, {
            delay: delayHours * 60 * 60 * 1000, // Convert hours to milliseconds
          });
          
          logger.info(
            { subscriptionId, nextAttempt, delayHours },
            'Scheduled next payment retry'
          );
        } else {
          // Max attempts reached, remove user
          const telegramId = Number(subscription.user.telegramId);
          await telegramService.revokeAccess(telegramId, 'Payment failed after multiple attempts');
          
          logger.info({ subscriptionId, telegramId }, 'Removed user after max payment retry attempts');
        }
        
        return { success: true, message: 'Payment retry failed, scheduled next attempt or removed user' };
      }
    } catch (error) {
      logger.error({ error, subscriptionId, attempt }, 'Failed to process payment retry job');
      throw error;
    }
  },

  async cleanup(job: Job<CleanupJobData>) {
    try {
      logger.info({ jobId: job.id }, 'Processing cleanup job');
      
      let cleanedCount = 0;

      // Clean up expired invite tokens
      const expiredTokens = await db.prisma.inviteToken.findMany({
        where: {
          expiresAt: { lt: new Date() },
          redeemed: false,
        },
      });

      if (expiredTokens.length > 0) {
        await db.prisma.inviteToken.deleteMany({
          where: {
            id: { in: expiredTokens.map(token => token.id) },
          },
        });
        cleanedCount += expiredTokens.length;
      }

      // Clean up old webhook events (keep last 1000)
      const oldWebhookEvents = await db.prisma.webhookEvent.findMany({
        orderBy: { createdAt: 'desc' },
        skip: 1000,
        select: { id: true },
      });

      if (oldWebhookEvents.length > 0) {
        await db.prisma.webhookEvent.deleteMany({
          where: {
            id: { in: oldWebhookEvents.map(event => event.id) },
          },
        });
        cleanedCount += oldWebhookEvents.length;
      }

      // Clean up old media posts (keep last 500)
      const oldMediaPosts = await db.prisma.mediaPost.findMany({
        orderBy: { postedAt: 'desc' },
        skip: 500,
        select: { id: true },
      });

      if (oldMediaPosts.length > 0) {
        await db.prisma.mediaPost.deleteMany({
          where: {
            id: { in: oldMediaPosts.map(post => post.id) },
          },
        });
        cleanedCount += oldMediaPosts.length;
      }

      logger.info({ cleanedCount }, 'Completed cleanup job');
      return { success: true, message: `Cleaned up ${cleanedCount} old records` };
    } catch (error) {
      logger.error({ error }, 'Failed to process cleanup job');
      throw error;
    }
  },
};

// Create worker
const worker = new Worker('durianbot-jobs', async (job) => {
  const { name, data } = job;
  
  logger.info({ jobName: name, jobId: job.id }, 'Processing job');
  
  switch (name) {
    case 'removeUser':
      return await jobProcessors.removeUser(job as Job<RemoveUserJobData>);
    case 'checkSubscriptions':
      return await jobProcessors.checkSubscriptions(job as Job<SubscriptionCheckJobData>);
    case 'retryPayment':
      return await jobProcessors.retryPayment(job as Job<RetryPaymentJobData>);
    case 'cleanup':
      return await jobProcessors.cleanup(job as Job<CleanupJobData>);
    default:
      throw new Error(`Unknown job type: ${name}`);
  }
}, {
  connection: redis,
  concurrency: 5,
});

// Worker event handlers
worker.on('completed', (job, result) => {
  logger.info(
    { jobId: job.id, jobName: job.name, result },
    'Job completed successfully'
  );
});

worker.on('failed', (job, error) => {
  logger.error(
    { jobId: job?.id, jobName: job?.name, error },
    'Job failed'
  );
});

worker.on('error', (error) => {
  logger.error({ error }, 'Worker error');
});

// Schedule recurring jobs
export const scheduleRecurringJobs = async () => {
  try {
    // Schedule subscription check every hour
    await jobQueue.add('checkSubscriptions', {}, {
      repeat: {
        pattern: '0 * * * *', // Every hour at minute 0
      },
      removeOnComplete: true,
      removeOnFail: false,
    });

    // Schedule cleanup job daily at 2 AM
    await jobQueue.add('cleanup', {}, {
      repeat: {
        pattern: '0 2 * * *', // Daily at 2 AM
      },
      removeOnComplete: true,
      removeOnFail: false,
    });

    logger.info('Scheduled recurring jobs');
  } catch (error) {
    logger.error({ error }, 'Failed to schedule recurring jobs');
    throw error;
  }
};

// Graceful shutdown
export const shutdownJobs = async () => {
  try {
    await worker.close();
    await jobQueue.close();
    await redis.disconnect();
    logger.info('Jobs system shut down successfully');
  } catch (error) {
    logger.error({ error }, 'Error shutting down jobs system');
  }
};

// Health check
export const getJobsHealth = async () => {
  try {
    const waiting = await jobQueue.getWaiting();
    const active = await jobQueue.getActive();
    const completed = await jobQueue.getCompleted();
    const failed = await jobQueue.getFailed();

    return {
      status: 'healthy',
      queues: {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
      },
    };
  } catch (error) {
    logger.error({ error }, 'Failed to get jobs health');
    return {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};

export { worker, redis };
import { Redis } from 'ioredis';
import { REDIS_URL } from './config';
import { db } from './db';
import { telegramService } from './bot';
import { logger, addHours } from './utils';

// Redis connection
const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,
});

// Job queues
export const jobQueue = new Queue('durianbot-jobs', {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: 50,
    removeOnFail: 100,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
});

// Job types
export interface RemoveUserJobData {
  telegramId: number;
  reason: string;
}

export interface SubscriptionCheckJobData {
  // No data needed for periodic check
}

export interface RetryPaymentJobData {
  subscriptionId: string;
  attempt: number;
}

export interface CleanupJobData {
  // No data needed for cleanup
}

// Job processors
const jobProcessors = {
  async removeUser(job: Job<RemoveUserJobData>) {
    const { telegramId, reason } = job.data;
    
    try {
      logger.info({ telegramId, reason, jobId: job.id }, 'Processing user removal job');
      
      // Check if user still has active subscription
      const user = await db.user.findByTelegramId(telegramId);
      if (!user) {
        logger.info({ telegramId }, 'User not found, skipping removal');
        return { success: true, message: 'User not found' };
      }

      const activeSubscription = user.subscriptions[0];
      if (activeSubscription?.status === 'active' && activeSubscription.currentPeriodEnd > new Date()) {
        logger.info({ telegramId, subscriptionId: activeSubscription.id }, 'User has active subscription, skipping removal');
        return { success: true, message: 'User has active subscription' };
      }

      // Remove user access
      await telegramService.revokeAccess(telegramId, reason);
      
      logger.info({ telegramId, reason }, 'Successfully removed user');
      return { success: true, message: 'User removed successfully' };
    } catch (error) {
      logger.error({ error, telegramId, reason }, 'Failed to remove user');
      throw error;
    }
  },

  async checkSubscriptions(job: Job<SubscriptionCheckJobData>) {
    try {
      logger.info({ jobId: job.id }, 'Processing subscription check job');
      
      // Get expired subscriptions
      const expiredSubscriptions = await db.subscription.getExpiredSubscriptions();
      
      let processedCount = 0;
      let errorCount = 0;

      for (const subscription of expiredSubscriptions) {
        try {
          const telegramId = Number(subscription.user.telegramId);
          
          // Check if already processed (avoid duplicate removals)
          if (subscription.status === 'CANCELED') {
            continue;
          }

          logger.info(
            { subscriptionId: subscription.id, telegramId, status: subscription.status },
            'Processing expired subscription'
          );

          // Update subscription status
          await db.subscription.upsert({
            userId: subscription.userId,
            planId: subscription.planId,
            stripeCustomerId: subscription.stripeCustomerId,
            stripeSubId: subscription.stripeSubId,
            status: 'CANCELED',
            currentPeriodEnd: subscription.currentPeriodEnd,
            cancelAtPeriodEnd: true,
          });

          // Remove user access
          await telegramService.revokeAccess(telegramId, 'Subscription expired');
          
          processedCount++;
        } catch (error) {
          logger.error(
            { error, subscriptionId: subscription.id },
            'Failed to process expired subscription'
          );
          errorCount++;
        }
      }

      logger.info(
        { processedCount, errorCount, totalFound: expiredSubscriptions.length },
        'Completed subscription check job'
      );

      return {
        success: true,
        message: `Processed ${processedCount} expired subscriptions`,
        data: { processedCount, errorCount },
      };
    } catch (error) {
      logger.error({ error }, 'Failed to process subscription check job');
      throw error;
    }
  },

  async retryPayment(job: Job<RetryPaymentJobData>) {
    const { subscriptionId, attempt } = job.data;
    
    try {
      logger.info({ subscriptionId, attempt, jobId: job.id }, 'Processing payment retry job');
      
      const subscription = await db.subscription.findByStripeId(subscriptionId);
      if (!subscription) {
        logger.warn({ subscriptionId }, 'Subscription not found for payment retry');
        return { success: true, message: 'Subscription not found' };
      }

      // Check if subscription is still in past_due status
      if (subscription.status !== 'PAST_DUE') {
        logger.info({ subscriptionId, status: subscription.status }, 'Subscription status changed, skipping retry');
        return { success: true, message: 'Subscription status changed' };
      }

      // Get latest invoices for this subscription
      const stripe = require('./stripe').stripe;
      const invoices = await stripe.invoices.list({
        subscription: subscriptionId,
        status: 'open',
        limit: 1,
      });

      if (invoices.data.length === 0) {
        logger.info({ subscriptionId }, 'No open invoices found, skipping retry');
        return { success: true, message: 'No open invoices' };
      }

      const invoice = invoices.data[0];
      
      // Try to pay the invoice
      try {
        await stripe.invoices.pay(invoice.id);
        logger.info({ subscriptionId, invoiceId: invoice.id }, 'Successfully retried payment');
        return { success: true, message: 'Payment retry successful' };
      } catch (paymentError) {
        logger.warn({ paymentError, subscriptionId, invoiceId: invoice.id }, 'Payment retry failed');
        
        // Schedule next retry if we haven't exceeded max attempts
        const maxAttempts = 3;
        if (attempt < maxAttempts) {
          const nextAttempt = attempt + 1;
          const delayHours = Math.pow(2, nextAttempt); // Exponential backoff: 2h, 4h, 8h
          
          await jobQueue.add('retryPayment', {
            subscriptionId,
            attempt: nextAttempt,
          }, {
            delay: delayHours * 60 * 60 * 1000, // Convert hours to milliseconds
          });
          
          logger.info(
            { subscriptionId, nextAttempt, delayHours },
            'Scheduled next payment retry'
          );
        } else {
          // Max attempts reached, remove user
          const telegramId = Number(subscription.user.telegramId);
          await telegramService.revokeAccess(telegramId, 'Payment failed after multiple attempts');
          
          logger.info({ subscriptionId, telegramId }, 'Removed user after max payment retry attempts');
        }
        
        return { success: true, message: 'Payment retry failed, scheduled next attempt or removed user' };
      }
    } catch (error) {
      logger.error({ error, subscriptionId, attempt }, 'Failed to process payment retry job');
      throw error;
    }
  },

  async cleanup(job: Job<CleanupJobData>) {
    try {
      logger.info({ jobId: job.id }, 'Processing cleanup job');
      
      let cleanedCount = 0;

      // Clean up expired invite tokens
      const expiredTokens = await db.prisma.inviteToken.findMany({
        where: {
          expiresAt: { lt: new Date() },
          redeemed: false,
        },
      });

      if (expiredTokens.length > 0) {
        await db.prisma.inviteToken.deleteMany({
          where: {
            id: { in: expiredTokens.map(token => token.id) },
          },
        });
        cleanedCount += expiredTokens.length;
      }

      // Clean up old webhook events (keep last 1000)
      const oldWebhookEvents = await db.prisma.webhookEvent.findMany({
        orderBy: { createdAt: 'desc' },
        skip: 1000,
        select: { id: true },
      });

      if (oldWebhookEvents.length > 0) {
        await db.prisma.webhookEvent.deleteMany({
          where: {
            id: { in: oldWebhookEvents.map(event => event.id) },
          },
        });
        cleanedCount += oldWebhookEvents.length;
      }

      // Clean up old media posts (keep last 500)
      const oldMediaPosts = await db.prisma.mediaPost.findMany({
        orderBy: { postedAt: 'desc' },
        skip: 500,
        select: { id: true },
      });

      if (oldMediaPosts.length > 0) {
        await db.prisma.mediaPost.deleteMany({
          where: {
            id: { in: oldMediaPosts.map(post => post.id) },
          },
        });
        cleanedCount += oldMediaPosts.length;
      }

      logger.info({ cleanedCount }, 'Completed cleanup job');
      return { success: true, message: `Cleaned up ${cleanedCount} old records` };
    } catch (error) {
      logger.error({ error }, 'Failed to process cleanup job');
      throw error;
    }
  },
};

// Create worker
const worker = new Worker('durianbot-jobs', async (job) => {
  const { name, data } = job;
  
  logger.info({ jobName: name, jobId: job.id }, 'Processing job');
  
  switch (name) {
    case 'removeUser':
      return await jobProcessors.removeUser(job as Job<RemoveUserJobData>);
    case 'checkSubscriptions':
      return await jobProcessors.checkSubscriptions(job as Job<SubscriptionCheckJobData>);
    case 'retryPayment':
      return await jobProcessors.retryPayment(job as Job<RetryPaymentJobData>);
    case 'cleanup':
      return await jobProcessors.cleanup(job as Job<CleanupJobData>);
    default:
      throw new Error(`Unknown job type: ${name}`);
  }
}, {
  connection: redis,
  concurrency: 5,
});

// Worker event handlers
worker.on('completed', (job, result) => {
  logger.info(
    { jobId: job.id, jobName: job.name, result },
    'Job completed successfully'
  );
});

worker.on('failed', (job, error) => {
  logger.error(
    { jobId: job?.id, jobName: job?.name, error },
    'Job failed'
  );
});

worker.on('error', (error) => {
  logger.error({ error }, 'Worker error');
});

// Schedule recurring jobs
export const scheduleRecurringJobs = async () => {
  try {
    // Schedule subscription check every hour
    await jobQueue.add('checkSubscriptions', {}, {
      repeat: {
        pattern: '0 * * * *', // Every hour at minute 0
      },
      removeOnComplete: true,
      removeOnFail: false,
    });

    // Schedule cleanup job daily at 2 AM
    await jobQueue.add('cleanup', {}, {
      repeat: {
        pattern: '0 2 * * *', // Daily at 2 AM
      },
      removeOnComplete: true,
      removeOnFail: false,
    });

    logger.info('Scheduled recurring jobs');
  } catch (error) {
    logger.error({ error }, 'Failed to schedule recurring jobs');
    throw error;
  }
};

// Graceful shutdown
export const shutdownJobs = async () => {
  try {
    await worker.close();
    await jobQueue.close();
    await redis.disconnect();
    logger.info('Jobs system shut down successfully');
  } catch (error) {
    logger.error({ error }, 'Error shutting down jobs system');
  }
};

// Health check
export const getJobsHealth = async () => {
  try {
    const waiting = await jobQueue.getWaiting();
    const active = await jobQueue.getActive();
    const completed = await jobQueue.getCompleted();
    const failed = await jobQueue.getFailed();

    return {
      status: 'healthy',
      queues: {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
      },
    };
  } catch (error) {
    logger.error({ error }, 'Failed to get jobs health');
    return {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};

export { worker, redis };