import { stripe } from './stripe';
import { db, prisma } from './db';
import { bot } from './bot';
import { logger } from './utils';
import { createBlurredImage, createVideoThumbnail, uploadBlurredPreview } from './blur';
import { TELEGRAM_GROUP_ID, TELEGRAM_OWNER_ID, APP_BASE_URL } from './config';

export interface CreateLockedPostInput {
  fileId: string;
  fileType: 'photo' | 'video';
  caption?: string;
  priceUSD: number; // In dollars (will convert to cents)
}

/**
 * Create a locked post that users can unlock for a fee
 */
export async function createLockedPost(input: CreateLockedPostInput) {
  const { fileId, fileType, caption, priceUSD } = input;
  const priceCents = Math.round(priceUSD * 100);
  
  try {
    logger.info({ fileType, priceCents, caption }, 'Creating locked post');
    
    // Step 1: Create blurred preview
    logger.info('Creating blurred preview...');
    let blurredBuffer: Buffer;
    
    if (fileType === 'photo') {
      blurredBuffer = await createBlurredImage(fileId);
    } else {
      blurredBuffer = await createVideoThumbnail(fileId);
    }
    
    // Step 2: Upload blurred preview to Telegram (send to owner's DM first)
    logger.info('Uploading blurred preview...');
    const previewFileId = await uploadBlurredPreview(TELEGRAM_OWNER_ID, blurredBuffer, fileType);
    
    // Step 3: Create Stripe product and price
    logger.info('Creating Stripe product...');
    const product = await stripe.products.create({
      name: 'Unlock Exclusive Content',
      description: caption || 'Premium exclusive content',
      metadata: {
        type: 'unlockable_content',
      },
    });
    
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: priceCents,
      currency: 'usd',
    });
    
    // Step 4: Save to database FIRST to get the post ID
    const post = await prisma.unlockablePost.create({
      data: {
        fileId,
        fileType,
        previewFileId,
        caption,
        priceUSD: priceCents,
        stripeProductId: product.id,
        stripePriceId: price.id,
        messageId: 0, // Temporary, will update after posting
      },
    });
    
    // Step 5: Post blurred version to group with CORRECT post ID in button
    logger.info('Posting to group...');
    const message = `🔒 **EXCLUSIVE CONTENT**\n\n` +
      (caption ? `${caption}\n\n` : '') +
      `💎 Unlock for just **$${priceUSD.toFixed(2)}**\n\n` +
      `Only available to premium members!\n\n` +
      `_Click "Unlock" and @DurianOnPizzaBot will send you a private message with the payment link._`;
    
    let sentMessage;
    if (fileType === 'photo') {
      sentMessage = await bot.telegram.sendPhoto(TELEGRAM_GROUP_ID, previewFileId, {
        caption: message,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: `🔓 Unlock for $${priceUSD.toFixed(2)}`, callback_data: `unlock_${post.id}` }]
          ]
        }
      });
    } else {
      // Send blurred video preview
      sentMessage = await bot.telegram.sendVideo(TELEGRAM_GROUP_ID, previewFileId, {
        caption: message,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: `🔓 Unlock for $${priceUSD.toFixed(2)}`, callback_data: `unlock_${post.id}` }]
          ]
        }
      });
    }
    
    // Step 6: Update database with the actual message ID
    await prisma.unlockablePost.update({
      where: { id: post.id },
      data: { messageId: sentMessage.message_id },
    });
    
    logger.info({ postId: post.id, messageId: sentMessage.message_id }, 'Locked post created successfully');
    
    return post;
  } catch (error) {
    logger.error({ 
      error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      input 
    }, 'Failed to create locked post');
    throw error;
  }
}

/**
 * Handle user clicking unlock button
 */
export async function handleUnlockRequest(userId: number, username: string | undefined, postId: string) {
  try {
    logger.info({ userId, postId }, 'User requested to unlock content');
    
    // Step 1: Get user from database
    const user = await db.user.findByTelegramId(userId);
    if (!user) {
      return {
        success: false,
        message: '❌ User not found. Please use /start first.',
      };
    }
    
    // Step 2: Check if user has active subscription
    const hasActiveSubscription = user.subscriptions.some(
      sub => sub.status === 'active' && sub.currentPeriodEnd > new Date()
    );
    
    if (!hasActiveSubscription) {
      return {
        success: false,
        message: '⚠️ You need an active subscription to unlock content.\n\nUse /start to subscribe!',
      };
    }
    
    // Step 3: Get the post
    const post = await prisma.unlockablePost.findUnique({
      where: { id: postId },
    });
    
    if (!post) {
      return {
        success: false,
        message: '❌ Content not found.',
      };
    }
    
    // Step 4: Check if user already unlocked this content
    const existingUnlock = await prisma.postUnlock.findUnique({
      where: {
        userId_postId: {
          userId: user.id,
          postId: post.id,
        },
      },
    });
    
    if (existingUnlock) {
      // Already unlocked - check if they've downloaded
      if (existingUnlock.downloaded) {
        return {
          success: false,
          message: '⚠️ You already unlocked and downloaded this content (1-time download limit reached).',
        };
      }
      
      // They unlocked but haven't downloaded yet - send it to them
      return {
        success: true,
        message: 'sending_content',
        post,
        unlock: existingUnlock,
      };
    }
    
    // Step 5: Create Stripe Checkout Session (supports promotion codes!)
    const { stripeUtils } = await import('./stripe');
    const session = await stripeUtils.createUnlockPaymentLink(
      post.id,
      post.priceUSD,
      userId,
      username
    );
    
    return {
      success: true,
      message: 'payment_required',
      paymentLink: session.url || '',
      price: post.priceUSD / 100,
    };
  } catch (error) {
    logger.error({ error, userId, postId }, 'Failed to handle unlock request');
    return {
      success: false,
      message: '❌ An error occurred. Please try again later.',
    };
  }
}

/**
 * Send unlocked content to user after payment
 */
export async function sendUnlockedContent(userId: string, postId: string) {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const post = await prisma.unlockablePost.findUnique({ where: { id: postId } });
    
    if (!user || !post) {
      throw new Error('User or post not found');
    }
    
    const telegramId = Number(user.telegramId);
    
    // Send content directly to user's DM (ONE message only, protected)
    if (post.fileType === 'photo') {
      // Add watermark to unlocked photo
      const { addWatermarkToImage, uploadBlurredPreview } = await import('./blur');
      const watermarkedBuffer = await addWatermarkToImage(post.fileId);
      
      // Upload watermarked image and get file ID
      const watermarkedFileId = await uploadBlurredPreview(telegramId, watermarkedBuffer, 'photo');
      
      await bot.telegram.sendPhoto(telegramId, watermarkedFileId, {
        caption: '🎉 *Payment Successful!*\n\n' + (post.caption || 'Here\'s your exclusive content') + '\n\n🔒 @DurianOnPizza',
        parse_mode: 'Markdown',
        protect_content: true,
        has_spoiler: false,
      });
    } else {
      // For videos, send original with watermark in caption
      await bot.telegram.sendVideo(telegramId, post.fileId, {
        caption: '🎉 *Payment Successful!*\n\n' + (post.caption || 'Here\'s your exclusive content') + '\n\n🔒 @DurianOnPizza',
        parse_mode: 'Markdown',
        protect_content: true,
        has_spoiler: false,
      });
    }
    
    // Mark as downloaded
    await prisma.postUnlock.update({
      where: {
        userId_postId: {
          userId: user.id,
          postId: post.id,
        },
      },
      data: {
        downloaded: true,
        downloadedAt: new Date(),
      },
    });
    
    logger.info({ userId, postId }, 'Sent unlocked content to user');
  } catch (error) {
    logger.error({ error, userId, postId }, 'Failed to send unlocked content');
    throw error;
  }
}

/**
 * Get analytics for all locked posts
 */
export async function getUnlockAnalytics() {
  try {
    const posts = await prisma.unlockablePost.findMany({
      include: {
        unlocks: {
          include: {
            user: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    
    const totalRevenue = posts.reduce((sum, post) => {
      return sum + post.unlocks.reduce((postSum, unlock) => postSum + unlock.amountPaid, 0);
    }, 0);
    
    const totalUnlocks = posts.reduce((sum, post) => sum + post.unlocks.length, 0);
    
    return {
      totalRevenue,
      totalUnlocks,
      posts: posts.map(post => ({
        id: post.id,
        caption: post.caption || 'Untitled',
        price: post.priceUSD / 100,
        unlockCount: post.unlocks.length,
        revenue: post.unlocks.reduce((sum, unlock) => sum + unlock.amountPaid, 0),
        createdAt: post.createdAt,
        unlocks: post.unlocks.map(unlock => ({
          username: unlock.user.username || unlock.user.firstName || 'Unknown',
          amountPaid: unlock.amountPaid / 100,
          unlockedAt: unlock.unlockedAt,
          downloaded: unlock.downloaded,
        })),
      })),
    };
  } catch (error) {
    logger.error({ error }, 'Failed to get unlock analytics');
    throw error;
  }
}

/**
 * Get total spending for a user (subscriptions + unlocks)
 */
export async function getUserTotalSpending(userId: string) {
  try {
    const user = await db.user.findById(userId);
    if (!user) return 0;
    
    // Get subscription spending
    const subscriptions = await prisma.subscription.findMany({
      where: { userId },
      include: { plan: true },
    });
    
    const subscriptionSpending = subscriptions.reduce((sum, sub) => {
      return sum + sub.plan.priceCents;
    }, 0);
    
    // Get unlock spending
    const unlocks = await prisma.postUnlock.findMany({
      where: { userId },
    });
    
    const unlockSpending = unlocks.reduce((sum, unlock) => {
      return sum + unlock.amountPaid;
    }, 0);
    
    return subscriptionSpending + unlockSpending;
  } catch (error) {
    logger.error({ error, userId }, 'Failed to get user total spending');
    return 0;
  }
}


import { bot } from './bot';
import { logger } from './utils';
import { createBlurredImage, createVideoThumbnail, uploadBlurredPreview } from './blur';
import { TELEGRAM_GROUP_ID, TELEGRAM_OWNER_ID, APP_BASE_URL } from './config';

export interface CreateLockedPostInput {
  fileId: string;
  fileType: 'photo' | 'video';
  caption?: string;
  priceUSD: number; // In dollars (will convert to cents)
}

/**
 * Create a locked post that users can unlock for a fee
 */
export async function createLockedPost(input: CreateLockedPostInput) {
  const { fileId, fileType, caption, priceUSD } = input;
  const priceCents = Math.round(priceUSD * 100);
  
  try {
    logger.info({ fileType, priceCents, caption }, 'Creating locked post');
    
    // Step 1: Create blurred preview
    logger.info('Creating blurred preview...');
    let blurredBuffer: Buffer;
    
    if (fileType === 'photo') {
      blurredBuffer = await createBlurredImage(fileId);
    } else {
      blurredBuffer = await createVideoThumbnail(fileId);
    }
    
    // Step 2: Upload blurred preview to Telegram (send to owner's DM first)
    logger.info('Uploading blurred preview...');
    const previewFileId = await uploadBlurredPreview(TELEGRAM_OWNER_ID, blurredBuffer, fileType);
    
    // Step 3: Create Stripe product and price
    logger.info('Creating Stripe product...');
    const product = await stripe.products.create({
      name: 'Unlock Exclusive Content',
      description: caption || 'Premium exclusive content',
      metadata: {
        type: 'unlockable_content',
      },
    });
    
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: priceCents,
      currency: 'usd',
    });
    
    // Step 4: Save to database FIRST to get the post ID
    const post = await prisma.unlockablePost.create({
      data: {
        fileId,
        fileType,
        previewFileId,
        caption,
        priceUSD: priceCents,
        stripeProductId: product.id,
        stripePriceId: price.id,
        messageId: 0, // Temporary, will update after posting
      },
    });
    
    // Step 5: Post blurred version to group with CORRECT post ID in button
    logger.info('Posting to group...');
    const message = `🔒 **EXCLUSIVE CONTENT**\n\n` +
      (caption ? `${caption}\n\n` : '') +
      `💎 Unlock for just **$${priceUSD.toFixed(2)}**\n\n` +
      `Only available to premium members!\n\n` +
      `_Click "Unlock" and @DurianOnPizzaBot will send you a private message with the payment link._`;
    
    let sentMessage;
    if (fileType === 'photo') {
      sentMessage = await bot.telegram.sendPhoto(TELEGRAM_GROUP_ID, previewFileId, {
        caption: message,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: `🔓 Unlock for $${priceUSD.toFixed(2)}`, callback_data: `unlock_${post.id}` }]
          ]
        }
      });
    } else {
      // Send blurred video preview
      sentMessage = await bot.telegram.sendVideo(TELEGRAM_GROUP_ID, previewFileId, {
        caption: message,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: `🔓 Unlock for $${priceUSD.toFixed(2)}`, callback_data: `unlock_${post.id}` }]
          ]
        }
      });
    }
    
    // Step 6: Update database with the actual message ID
    await prisma.unlockablePost.update({
      where: { id: post.id },
      data: { messageId: sentMessage.message_id },
    });
    
    logger.info({ postId: post.id, messageId: sentMessage.message_id }, 'Locked post created successfully');
    
    return post;
  } catch (error) {
    logger.error({ 
      error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      input 
    }, 'Failed to create locked post');
    throw error;
  }
}

/**
 * Handle user clicking unlock button
 */
export async function handleUnlockRequest(userId: number, username: string | undefined, postId: string) {
  try {
    logger.info({ userId, postId }, 'User requested to unlock content');
    
    // Step 1: Get user from database
    const user = await db.user.findByTelegramId(userId);
    if (!user) {
      return {
        success: false,
        message: '❌ User not found. Please use /start first.',
      };
    }
    
    // Step 2: Check if user has active subscription
    const hasActiveSubscription = user.subscriptions.some(
      sub => sub.status === 'active' && sub.currentPeriodEnd > new Date()
    );
    
    if (!hasActiveSubscription) {
      return {
        success: false,
        message: '⚠️ You need an active subscription to unlock content.\n\nUse /start to subscribe!',
      };
    }
    
    // Step 3: Get the post
    const post = await prisma.unlockablePost.findUnique({
      where: { id: postId },
    });
    
    if (!post) {
      return {
        success: false,
        message: '❌ Content not found.',
      };
    }
    
    // Step 4: Check if user already unlocked this content
    const existingUnlock = await prisma.postUnlock.findUnique({
      where: {
        userId_postId: {
          userId: user.id,
          postId: post.id,
        },
      },
    });
    
    if (existingUnlock) {
      // Already unlocked - check if they've downloaded
      if (existingUnlock.downloaded) {
        return {
          success: false,
          message: '⚠️ You already unlocked and downloaded this content (1-time download limit reached).',
        };
      }
      
      // They unlocked but haven't downloaded yet - send it to them
      return {
        success: true,
        message: 'sending_content',
        post,
        unlock: existingUnlock,
      };
    }
    
    // Step 5: Create Stripe Checkout Session (supports promotion codes!)
    const { stripeUtils } = await import('./stripe');
    const session = await stripeUtils.createUnlockPaymentLink(
      post.id,
      post.priceUSD,
      userId,
      username
    );
    
    return {
      success: true,
      message: 'payment_required',
      paymentLink: session.url || '',
      price: post.priceUSD / 100,
    };
  } catch (error) {
    logger.error({ error, userId, postId }, 'Failed to handle unlock request');
    return {
      success: false,
      message: '❌ An error occurred. Please try again later.',
    };
  }
}

/**
 * Send unlocked content to user after payment
 */
export async function sendUnlockedContent(userId: string, postId: string) {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const post = await prisma.unlockablePost.findUnique({ where: { id: postId } });
    
    if (!user || !post) {
      throw new Error('User or post not found');
    }
    
    const telegramId = Number(user.telegramId);
    
    // Send content directly to user's DM (ONE message only, protected)
    if (post.fileType === 'photo') {
      // Add watermark to unlocked photo
      const { addWatermarkToImage, uploadBlurredPreview } = await import('./blur');
      const watermarkedBuffer = await addWatermarkToImage(post.fileId);
      
      // Upload watermarked image and get file ID
      const watermarkedFileId = await uploadBlurredPreview(telegramId, watermarkedBuffer, 'photo');
      
      await bot.telegram.sendPhoto(telegramId, watermarkedFileId, {
        caption: '🎉 *Payment Successful!*\n\n' + (post.caption || 'Here\'s your exclusive content') + '\n\n🔒 @DurianOnPizza',
        parse_mode: 'Markdown',
        protect_content: true,
        has_spoiler: false,
      });
    } else {
      // For videos, send original with watermark in caption
      await bot.telegram.sendVideo(telegramId, post.fileId, {
        caption: '🎉 *Payment Successful!*\n\n' + (post.caption || 'Here\'s your exclusive content') + '\n\n🔒 @DurianOnPizza',
        parse_mode: 'Markdown',
        protect_content: true,
        has_spoiler: false,
      });
    }
    
    // Mark as downloaded
    await prisma.postUnlock.update({
      where: {
        userId_postId: {
          userId: user.id,
          postId: post.id,
        },
      },
      data: {
        downloaded: true,
        downloadedAt: new Date(),
      },
    });
    
    logger.info({ userId, postId }, 'Sent unlocked content to user');
  } catch (error) {
    logger.error({ error, userId, postId }, 'Failed to send unlocked content');
    throw error;
  }
}

/**
 * Get analytics for all locked posts
 */
export async function getUnlockAnalytics() {
  try {
    const posts = await prisma.unlockablePost.findMany({
      include: {
        unlocks: {
          include: {
            user: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    
    const totalRevenue = posts.reduce((sum, post) => {
      return sum + post.unlocks.reduce((postSum, unlock) => postSum + unlock.amountPaid, 0);
    }, 0);
    
    const totalUnlocks = posts.reduce((sum, post) => sum + post.unlocks.length, 0);
    
    return {
      totalRevenue,
      totalUnlocks,
      posts: posts.map(post => ({
        id: post.id,
        caption: post.caption || 'Untitled',
        price: post.priceUSD / 100,
        unlockCount: post.unlocks.length,
        revenue: post.unlocks.reduce((sum, unlock) => sum + unlock.amountPaid, 0),
        createdAt: post.createdAt,
        unlocks: post.unlocks.map(unlock => ({
          username: unlock.user.username || unlock.user.firstName || 'Unknown',
          amountPaid: unlock.amountPaid / 100,
          unlockedAt: unlock.unlockedAt,
          downloaded: unlock.downloaded,
        })),
      })),
    };
  } catch (error) {
    logger.error({ error }, 'Failed to get unlock analytics');
    throw error;
  }
}

/**
 * Get total spending for a user (subscriptions + unlocks)
 */
export async function getUserTotalSpending(userId: string) {
  try {
    const user = await db.user.findById(userId);
    if (!user) return 0;
    
    // Get subscription spending
    const subscriptions = await prisma.subscription.findMany({
      where: { userId },
      include: { plan: true },
    });
    
    const subscriptionSpending = subscriptions.reduce((sum, sub) => {
      return sum + sub.plan.priceCents;
    }, 0);
    
    // Get unlock spending
    const unlocks = await prisma.postUnlock.findMany({
      where: { userId },
    });
    
    const unlockSpending = unlocks.reduce((sum, unlock) => {
      return sum + unlock.amountPaid;
    }, 0);
    
    return subscriptionSpending + unlockSpending;
  } catch (error) {
    logger.error({ error, userId }, 'Failed to get user total spending');
    return 0;
  }
}
