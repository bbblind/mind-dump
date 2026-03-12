import { PrismaClient, SubscriptionStatus } from '@prisma/client';
import { logger } from './utils';

// Create Prisma client with logging
const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'info' },
    { emit: 'event', level: 'warn' },
  ],
});

// Set up logging for Prisma events
prisma.$on('query', (e) => {
  logger.debug({ query: e.query, params: e.params, duration: e.duration }, 'Database query');
});

prisma.$on('error', (e) => {
  logger.error({ target: e.target, message: e.message }, 'Database error');
});

prisma.$on('info', (e) => {
  logger.info({ target: e.target, message: e.message }, 'Database info');
});

prisma.$on('warn', (e) => {
  logger.warn({ target: e.target, message: e.message }, 'Database warning');
});

// Database connection health check
export const checkDatabaseConnection = async (): Promise<boolean> => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info('Database connection successful');
    return true;
  } catch (error) {
    logger.error({ error }, 'Database connection failed');
    return false;
  }
};

// Graceful shutdown
export const disconnectDatabase = async (): Promise<void> => {
  try {
    await prisma.$disconnect();
    logger.info('Database disconnected successfully');
  } catch (error) {
    logger.error({ error }, 'Error disconnecting from database');
  }
};

// Database utilities
export const db = {
  // User operations
  user: {
    async findByTelegramId(telegramId: number) {
      return prisma.user.findUnique({
        where: { telegramId: BigInt(telegramId) },
        include: {
          subscriptions: {
            where: { status: 'active' },
            include: { plan: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });
    },

    async upsert(data: {
      telegramId: number;
      username?: string;
      firstName?: string;
      lastName?: string;
    }) {
      return prisma.user.upsert({
        where: { telegramId: BigInt(data.telegramId) },
        update: {
          username: data.username,
          firstName: data.firstName,
          lastName: data.lastName,
          updatedAt: new Date(),
        },
        create: {
          telegramId: BigInt(data.telegramId),
          username: data.username,
          firstName: data.firstName,
          lastName: data.lastName,
        },
      });
    },
  },

  // Subscription operations
  subscription: {
    async findActiveByUserId(userId: string) {
      return prisma.subscription.findFirst({
        where: {
          userId,
          status: 'active',
        },
        include: { plan: true, user: true },
      });
    },

    async findByStripeId(stripeSubId: string) {
      return prisma.subscription.findUnique({
        where: { stripeSubId },
        include: { user: true, plan: true },
      });
    },

    async upsert(data: {
      userId: string;
      planId: string;
      stripeCustomerId: string;
      stripeSubId: string;
      status: 'active' | 'canceled' | 'past_due' | 'incomplete' | 'unpaid';
      currentPeriodEnd: Date;
      cancelAtPeriodEnd?: boolean;
    }) {
      return prisma.subscription.upsert({
        where: { stripeSubId: data.stripeSubId },
        update: {
          status: data.status,
          currentPeriodEnd: data.currentPeriodEnd,
          cancelAtPeriodEnd: data.cancelAtPeriodEnd ?? false,
          updatedAt: new Date(),
        },
        create: data,
        include: { user: true, plan: true },
      });
    },

    async getExpiredSubscriptions() {
      return prisma.subscription.findMany({
        where: {
          OR: [
            {
              currentPeriodEnd: { lt: new Date() },
              status: { in: ['active', 'past_due'] },
            },
            {
              status: { in: ['canceled', 'unpaid'] },
            },
          ],
        },
        include: { user: true, plan: true },
      });
    },

    async getActiveSubscriptions() {
      return prisma.subscription.findMany({
        where: { status: SubscriptionStatus.ACTIVE },
        include: { user: true, plan: true },
      });
    },
  },

  // Plan operations
  plan: {
    async findAll() {
      return prisma.plan.findMany({
        where: { active: true },
        orderBy: { priceCents: 'asc' },
      });
    },

    async findById(id: string) {
      return prisma.plan.findUnique({
        where: { id },
      });
    },

    async findByStripeId(stripePriceId: string) {
      return prisma.plan.findUnique({
        where: { stripePriceId },
      });
    },

    async upsert(data: {
      name: string;
      stripePriceId: string;
      priceCents: number;
      interval: 'month' | 'year';
      intervalCount?: number;
    }) {
      return prisma.plan.upsert({
        where: { stripePriceId: data.stripePriceId },
        update: {
          name: data.name,
          priceCents: data.priceCents,
          interval: data.interval,
          updatedAt: new Date(),
        },
        create: data,
      });
    },
  },

  // Invite token operations
  inviteToken: {
    async create(data: {
      userId: string;
      chatInviteLink: string;
      expiresAt: Date;
    }) {
      return prisma.inviteToken.create({
        data,
        include: { user: true },
      });
    },

    async markRedeemed(id: string) {
      return prisma.inviteToken.update({
        where: { id },
        data: {
          redeemed: true,
          redeemedAt: new Date(),
        },
      });
    },

    async revokeUserTokens(userId: string) {
      return prisma.inviteToken.updateMany({
        where: {
          userId,
          redeemed: false,
          expiresAt: { gt: new Date() },
        },
        data: {
          expiresAt: new Date(), // Expire immediately
        },
      });
    },
  },

  // Media post operations
  mediaPost: {
    async create(data: {
      type: 'PHOTO' | 'VIDEO';
      fileId: string;
      caption?: string;
      postedByUserId?: string;
    }) {
      return prisma.mediaPost.create({
        data,
        include: { postedBy: true },
      });
    },

    async getRecentPosts(limit: number = 10) {
      return prisma.mediaPost.findMany({
        orderBy: { postedAt: 'desc' },
        take: limit,
        include: { postedBy: true },
      });
    },
  },

  // Webhook event operations
  webhookEvent: {
    async isProcessed(stripeEventId: string) {
      const event = await prisma.webhookEvent.findUnique({
        where: { stripeEventId },
      });
      return event?.processed ?? false;
    },

    async markProcessed(stripeEventId: string, eventType: string) {
      return prisma.webhookEvent.upsert({
        where: { stripeEventId },
        update: {
          processed: true,
          processedAt: new Date(),
        },
        create: {
          stripeEventId,
          eventType,
          processed: true,
          processedAt: new Date(),
        },
      });
    },
  },

  // Analytics operations
  analytics: {
    async getStats() {
      const [
        totalUsers,
        activeSubscriptions,
        recentSignups,
      ] = await Promise.all([
        prisma.user.count(),
        prisma.subscription.count({
          where: { status: SubscriptionStatus.ACTIVE },
        }),
        prisma.user.count({
          where: {
            createdAt: {
              gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
            },
          },
        }),
      ]);

      return {
        totalUsers,
        activeSubscriptions,
        recentSignups,
      };
    },
  },

  // Unlockable content operations
  unlockablePost: {
    async findById(id: string) {
      return prisma.unlockablePost.findUnique({
        where: { id },
        include: {
          unlocks: {
            include: {
              user: true,
            },
          },
        },
      });
    },

    async findAll() {
      return prisma.unlockablePost.findMany({
        include: {
          unlocks: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });
    },
  },

  postUnlock: {
    async findByUserId(userId: string) {
      return prisma.postUnlock.findMany({
        where: { userId },
        include: {
          post: true,
        },
        orderBy: {
          unlockedAt: 'desc',
        },
      });
    },

    async findByPostId(postId: string) {
      return prisma.postUnlock.findMany({
        where: { postId },
        include: {
          user: true,
        },
        orderBy: {
          unlockedAt: 'desc',
        },
      });
    },
  },
};

export default prisma;
export { prisma };


