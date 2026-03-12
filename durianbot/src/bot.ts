import { Telegraf, Context, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import { 
  TELEGRAM_BOT_TOKEN, 
  TELEGRAM_GROUP_ID, 
  TELEGRAM_OWNER_ID,
  APP_BASE_URL 
} from './config';
import { db } from './db';
import { stripeUtils } from './stripe';
import { logger, isOwner, formatCurrency, formatDate, escapeMarkdown } from './utils';
import { jobQueue } from './jobs';
import { processMedia } from './media';

// Extend context with custom properties
interface BotContext extends Context {
  user?: {
    id: string;
    telegramId: number;
    username?: string;
    subscription?: any;
  };
}

// Initialize bot
export const bot = new Telegraf<BotContext>(TELEGRAM_BOT_TOKEN);

// Middleware to load user data
bot.use(async (ctx, next) => {
  if (ctx.from) {
    const user = await db.user.findByTelegramId(ctx.from.id);
    if (user) {
      ctx.user = {
        id: user.id,
        telegramId: Number(user.telegramId),
        username: user.username || undefined,
        subscription: user.subscriptions[0] || null,
      };
    }
  }
  await next();
});

// Error handler
bot.catch((err, ctx) => {
  logger.error({ error: err, userId: ctx.from?.id }, 'Bot error occurred');
  ctx.reply('❌ An error occurred. Please try again later.');
});

// Start command
bot.command('start', async (ctx) => {
  const user = ctx.from;
  if (!user) return;

  try {
    // Check if user exists (to determine if this is first interaction)
    const existingUser = await db.user.findByTelegramId(user.id);
    const isNewUser = !existingUser;

    // Upsert user
    await db.user.upsert({
      telegramId: user.id,
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
    });

    // Check if user has active subscription
    const dbUser = await db.user.findByTelegramId(user.id);
    if (dbUser?.subscriptions[0]) {
      const sub = dbUser.subscriptions[0];
      
      // Translate plan name to English
      const englishName = sub.plan.name === 'Piano Mensile' ? 'Monthly Plan' : 
                         sub.plan.name === 'Piano 3 Mesi' ? '3-Month Plan' : sub.plan.name;
      
      await ctx.reply(
        `✅ Welcome back! You have an active ${englishName} subscription.\n\n` +
        `📅 Next renewal: ${formatDate(sub.currentPeriodEnd)}\n\n` +
        `Use /account to manage your subscription.`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '👥 Join Group', url: `https://t.me/${TELEGRAM_GROUP_ID}` }],
              [{ text: '⚙️ Manage Account', callback_data: 'account' }],
            ],
          },
        }
      );
      return;
    }

    // Show welcome message for new users
    if (isNewUser) {
      await ctx.reply(
        `🍕 *Welcome to DurianOnPizza Premium!*\n\n` +
        `Ready to join the most exclusive content club on Telegram? 🔥\n\n` +
        `We've got the spiciest, most premium content you won't find ANYWHERE else! 🌶️✨\n\n` +
        `👉👉👉 Hit /start to see our plans and join the party! 🎉\n\n` +
        `Trust me, you don't want to miss this. 😏`,
        { parse_mode: 'Markdown' }
      );
      
      // Wait a moment before showing plans
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Show available plans
    await showPlans(ctx);
  } catch (error) {
    logger.error({ error, userId: user.id }, 'Error in start command');
    await ctx.reply('❌ An error occurred. Please try again later.');
  }
});

// Plans command
bot.command('plans', showPlans);

async function showPlans(ctx: BotContext) {
  try {
    const plans = await db.plan.findAll();
    
    if (plans.length === 0) {
      await ctx.reply('❌ No subscription plans available at the moment.');
      return;
    }

    // Personalized greeting
    const firstName = ctx.from?.first_name || 'there';
    let message = `Hey ${firstName}! 👋\n\n`;
    message += '🎯 *Choose Your Plan*\n\n';
    message += '🔥 Get exclusive access to premium content and community!\n\n';
    message += '🚫 *Protected Content*: No screenshots, no downloads, no sharing\n\n';

    const keyboard = [];
    
    for (const plan of plans) {
      const price = formatCurrency(plan.priceCents);
      let description = 'monthly';
      
      if (plan.name.includes('3 Mesi')) {
        description = 'every 3 months';
      }
      
      // Translate plan names to English
      const englishName = plan.name === 'Piano Mensile' ? 'Monthly Plan' : 
                         plan.name === 'Piano 3 Mesi' ? '3-Month Plan' : plan.name;
      
      message += `💎 *${englishName}*\n`;
      message += `💰 ${price} ${description}\n`;
      message += `🔄 Auto-renewal\n\n`;
      
      keyboard.push([{
        text: `🚀 Subscribe ${englishName} (${price})`,
        callback_data: `subscribe_${plan.id}`,
      }]);
    }

    // Add FAQ button at the bottom
    keyboard.push([{ text: '❓ FAQ', callback_data: 'faq_menu' }]);

    // Send video with the message as caption
    try {
      await ctx.replyWithVideo('BAACAgQAAxkBAAMYaLAw5SEtDImBdQSyrchAcKYTvncAAtkbAAIVn4BR8n9DY8gHaIc2BA', {
        caption: message,
        parse_mode: 'Markdown',
        protect_content: true,
        reply_markup: { inline_keyboard: keyboard },
      });
    } catch (videoError) {
      logger.warn({ error: videoError }, 'Video not available, sending text only');
      // Fallback: send text only if video fails
      await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
      });
    }
  } catch (error) {
    logger.error({ error }, 'Error showing plans');
    await ctx.reply('❌ Error loading plans. Please try again later.');
  }
}

// Account command
bot.command('account', async (ctx) => {
  const user = ctx.from;
  if (!user) return;

  try {
    const dbUser = await db.user.findByTelegramId(user.id);
    if (!dbUser?.subscriptions[0]) {
      await ctx.reply(
        '❌ You don\'t have an active subscription.\n\n' +
        'Use /start to see available plans.',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🛒 View Plans', callback_data: 'plans' }],
            ],
          },
        }
      );
      return;
    }

    const sub = dbUser.subscriptions[0];
    const nextRenewal = formatDate(sub.currentPeriodEnd);
    const status = sub.status === 'active' ? '✅ Active' : '⚠️ ' + sub.status;
    
    let intervalText = 'monthly';
    if (sub.plan.name.includes('3 Mesi')) {
      intervalText = 'every 3 months';
    }

    // Translate plan name to English
    const englishName = sub.plan.name === 'Piano Mensile' ? 'Monthly Plan' : 
                       sub.plan.name === 'Piano 3 Mesi' ? '3-Month Plan' : sub.plan.name;

    await ctx.reply(
      `📊 **Your Account**\n\n` +
      `📋 Plan: ${englishName}\n` +
      `💰 Price: ${formatCurrency(sub.plan.priceCents)} ${intervalText}\n` +
      `📈 Status: ${status}\n` +
      `📅 Next renewal: ${nextRenewal}\n` +
      `🔄 Auto-renewal ${sub.cancelAtPeriodEnd ? '❌ DISABLED' : '✅ ENABLED'}\n` +
      `${sub.cancelAtPeriodEnd ? '⚠️ Subscription will expire at the end of the period' : ''}`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '⚙️ Manage Subscription', callback_data: 'billing_portal' }],
            [{ text: '👥 Join Group', url: `https://t.me/${TELEGRAM_GROUP_ID}` }],
          ],
        },
      }
    );
  } catch (error) {
    logger.error({ error, userId: user.id }, 'Error in account command');
    await ctx.reply('❌ Error loading account info. Please try again later.');
  }
});

// Owner-only commands
bot.command('upload', async (ctx) => {
  if (!isOwner(ctx.from?.id || 0)) {
    await ctx.reply('❌ This command is only available to administrators.');
    return;
  }

  await ctx.reply(
    '📤 **Upload Content**\n\n' +
    'Send me a photo or video to publish in the group.\n' +
    'You can include a caption with your content.\n\n' +
    '🔒 Content will be automatically protected (no screenshot, no download).',
    { parse_mode: 'Markdown' }
  );
});

bot.command('broadcast', async (ctx) => {
  if (!isOwner(ctx.from?.id || 0)) {
    await ctx.reply('❌ This command is only available to administrators.');
    return;
  }

  const text = ctx.message.text.replace('/broadcast', '').trim();
  if (!text) {
    await ctx.reply('❌ Please provide a message to send.\n\nExample: `/broadcast Hello everyone!`');
    return;
  }

  try {
    await bot.telegram.sendMessage(TELEGRAM_GROUP_ID, text, {
      protect_content: true,
      parse_mode: 'Markdown',
    });
    
    await ctx.reply('✅ Message sent successfully to the group!');
    logger.info({ text }, 'Broadcasted message to group');
  } catch (error) {
    logger.error({ error, text }, 'Failed to broadcast message');
    await ctx.reply('❌ Error sending message.');
  }
});

bot.command('stats', async (ctx) => {
  if (!isOwner(ctx.from?.id || 0)) {
    await ctx.reply('❌ This command is only available to administrators.');
    return;
  }

  try {
    const stats = await db.analytics.getStats();
    const activeSubscriptions = await db.subscription.getActiveSubscriptions();
    
    // Calculate MRR
    let monthlyRevenue = 0;
    for (const sub of activeSubscriptions) {
      if (sub.plan.interval === 'month') {
        monthlyRevenue += sub.plan.priceCents;
      } else if (sub.plan.interval === 'year') {
        monthlyRevenue += Math.round(sub.plan.priceCents / 12);
      }
    }

    await ctx.reply(
      `📊 **Bot Statistics**\n\n` +
      `👥 Total Users: ${stats.totalUsers}\n` +
      `✅ Active Subscriptions: ${stats.activeSubscriptions}\n` +
      `💰 Monthly Recurring Revenue: ${formatCurrency(monthlyRevenue)}\n` +
      `📈 New Users (30d): ${stats.recentSignups}\n`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    logger.error({ error }, 'Error getting stats');
    await ctx.reply('❌ Error loading statistics.');
  }
});

// Post locked content command
// Usage: Reply to a photo/video with: /post_locked 5.99
bot.command('post_locked', async (ctx) => {
  const userId = ctx.from?.id || 0;
  logger.info({ userId, username: ctx.from?.username }, 'post_locked command called');
  
  if (!isOwner(userId)) {
    logger.warn({ userId, username: ctx.from?.username }, 'Unauthorized post_locked attempt');
    await ctx.reply('❌ This command is only available to administrators.');
    return;
  }

  // Check if replying to a photo or video
  const repliedTo = ctx.message.reply_to_message;
  if (!repliedTo || (!repliedTo.photo && !repliedTo.video)) {
    await ctx.reply(
      '🔒 **Post Locked Content**\n\n' +
      '**Usage:** Reply to a photo or video with `/post_locked <price> [caption]`\n\n' +
      '**Examples:**\n' +
      '1. Send a photo with caption (caption will be used)\n' +
      '2. Reply: `/post_locked 5.99`\n\n' +
      '**OR**\n\n' +
      '1. Send a photo without caption\n' +
      '2. Reply: `/post_locked 9.99 Check this out!`\n\n' +
      '💰 Price in USD (e.g., 5.99, 10, 15.50)',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Parse price and optional caption from command
  const fullText = ctx.message.text || '';
  const args = fullText.split(' ').slice(1); // Remove /post_locked
  const priceStr = args[0];
  const customCaption = args.slice(1).join(' '); // Everything after price is caption
  
  if (!priceStr || isNaN(parseFloat(priceStr))) {
    await ctx.reply('❌ Please provide a valid price (e.g., `/post_locked 5.99` or `/post_locked 5.99 Your caption`)');
    return;
  }

  const price = parseFloat(priceStr);
  if (price <= 0 || price > 10000) {
    await ctx.reply('❌ Price must be between $0.01 and $10,000');
    return;
  }
  
  // Use custom caption from command, or original media caption, or no caption
  const finalCaption = customCaption || repliedTo.caption || undefined;

  try {
    const statusMsg = await ctx.reply('⏳ Creating locked post...');

    const { createLockedPost } = await import('./unlockable');
    
    let fileId: string;
    let fileType: 'photo' | 'video';
    
    if (repliedTo.photo) {
      fileId = repliedTo.photo[repliedTo.photo.length - 1].file_id;
      fileType = 'photo';
    } else {
      fileId = repliedTo.video!.file_id;
      fileType = 'video';
    }

    // Process asynchronously to avoid blocking Telegram webhook
    createLockedPost({
      fileId,
      fileType,
      caption: finalCaption,
      priceUSD: price,
    }).then(async (post) => {
      await bot.telegram.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        undefined,
        `✅ **Locked post created!**\n\n` +
        `💰 Price: $${price.toFixed(2)}\n` +
        `🔒 Posted to group with blur\n` +
        `📊 ID: ${post.id.substring(0, 8)}...`,
        { parse_mode: 'Markdown' }
      );
    }).catch(async (error) => {
      logger.error({ error }, 'Failed to create locked post');
      await bot.telegram.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        undefined,
        '❌ An error occurred. Please try again later.'
      );
    });
  } catch (error) {
    logger.error({ error }, 'Error creating locked post');
    await ctx.reply('❌ Error creating locked post. Please try again.');
  }
});

// Analytics command for unlock stats
bot.command('analytics', async (ctx) => {
  if (!isOwner(ctx.from?.id || 0)) {
    await ctx.reply('❌ This command is only available to administrators.');
    return;
  }

  try {
    const { getUnlockAnalytics } = await import('./unlockable');
    const analytics = await getUnlockAnalytics();
    
    const totalRevenue = analytics.totalRevenue / 100;
    const avgPrice = analytics.totalUnlocks > 0 
      ? (analytics.totalRevenue / analytics.totalUnlocks / 100).toFixed(2)
      : '0.00';
    
    let message = `📊 **UNLOCK ANALYTICS**\n\n`;
    message += `💰 Total Unlock Revenue: $${totalRevenue.toFixed(2)}\n`;
    message += `🔓 Total Unlocks: ${analytics.totalUnlocks}\n`;
    message += `📈 Average Price: $${avgPrice}\n\n`;
    
    if (analytics.posts.length > 0) {
      message += `📦 **TOP PERFORMING POSTS:**\n\n`;
      
      const topPosts = analytics.posts
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5);
      
      topPosts.forEach((post, i) => {
        const revenue = (post.revenue / 100).toFixed(2);
        const caption = post.caption ? post.caption.substring(0, 30) : 'Untitled';
        message += `${i + 1}️⃣ ${caption}... - $${revenue} (${post.unlockCount} unlocks @ $${post.price})\n`;
      });
    }
    
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📈 View Detailed Report', callback_data: 'analytics_detail' }],
        ],
      },
    });
  } catch (error) {
    logger.error({ error }, 'Error getting analytics.');
  }
});

// My unlocks command for users
bot.command('my_unlocks', async (ctx) => {
  const user = ctx.from;
  if (!user) return;

  try {
    const dbUser = await db.user.findByTelegramId(user.id);
    if (!dbUser) {
      await ctx.reply('❌ User not found. Please use /start first.');
      return;
    }

    const unlocks = await db.postUnlock.findByUserId(dbUser.id);

    if (unlocks.length === 0) {
      await ctx.reply(
        '🔒 You haven\'t unlocked any content yet!\n\n' +
        'Check the group for locked posts you can unlock.',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    let message = `🔓 **Your Unlocked Content** (${unlocks.length} items)\n\n`;
    message += 'Tap any item below to re-download (1-time limit):\n\n';

    const keyboard = unlocks.map((unlock, i) => {
      const caption = unlock.post.caption ? unlock.post.caption.substring(0, 40) : 'Untitled';
      const status = unlock.downloaded ? '✅ Downloaded' : '📥 Available';
      return [{
        text: `${i + 1}. ${caption}... - ${status}`,
        callback_data: `redownload_${unlock.post.id}`
      }];
    });

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: keyboard
      }
    });
  } catch (error) {
    logger.error({ error, userId: user.id }, 'Error in my_unlocks command');
    await ctx.reply('❌ Error loading your unlocks. Please try again later.');
  }
});

// Help command
bot.command('help', async (ctx) => {
  const isAdmin = isOwner(ctx.from?.id || 0);
  
  let message = '🤖 **Bot Commands**\n\n';
  message += '👤 **User Commands:**\n';
  message += '• `/start` - View subscription plans\n';
  message += '• `/plans` - Show available plans\n';
  message += '• `/account` - Manage your subscription\n';
  message += '• `/help` - Show this help message\n\n';
  message += '🔒 **Protected Content:**\n';
  message += '• No screenshots possible\n';
  message += '• No video downloads\n';
  message += '• No external sharing\n';
  
  if (isAdmin) {
    message += '\n🔧 **Admin Commands:**\n';
    message += '• `/upload` - Upload content to group\n';
    message += '• `/broadcast <message>` - Send message to group\n';
    message += '• `/stats` - View bot statistics\n';
  }

  await ctx.reply(message, { parse_mode: 'Markdown' });
});

// Handle callback queries
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  if (!data) return;

  try {
    await ctx.answerCbQuery();

    if (data.startsWith('subscribe_')) {
      const planId = data.replace('subscribe_', '');
      await handleSubscribe(ctx, planId);
    } else if (data === 'account') {
      // Show account info
      const user = ctx.from;
      if (!user) return;

      const dbUser = await db.user.findByTelegramId(user.id);
      const sub = dbUser?.subscriptions[0];

      if (!sub) {
        await ctx.editMessageText(
          '❌ No active subscription found.\n\nUse /start to view available plans.',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      // Translate plan name to English
      const englishName = sub.plan.name === 'Piano Mensile' ? 'Monthly Plan' : 
                         sub.plan.name === 'Piano 3 Mesi' ? '3-Month Plan' : sub.plan.name;
      
      const status = sub.status === 'active' ? '✅ Active' : '⚠️ ' + sub.status;
      const autoRenew = sub.cancelAtPeriodEnd ? '❌ Will cancel' : '✅ Enabled';

      const message = 
        `📊 *Your Account*\n\n` +
        `📋 Plan: ${englishName}\n` +
        `💰 Price: ${formatCurrency(sub.plan.priceCents)} per ${sub.plan.interval}\n` +
        `📈 Status: ${status}\n` +
        `📅 Next renewal: ${formatDate(sub.currentPeriodEnd)}\n` +
        `🔄 Auto-renewal: ${autoRenew}\n\n` +
        `Use the buttons below to manage your subscription.`;

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '⚙️ Manage Subscription', callback_data: 'billing_portal' }],
            [{ text: '👥 Join Group', callback_data: 'join_group' }],
            [{ text: '🔙 Back to Plans', callback_data: 'plans' }],
          ],
        },
      });
    } else if (data === 'plans') {
      await ctx.deleteMessage();
      await showPlans(ctx);
    } else if (data === 'billing_portal') {
      await handleBillingPortal(ctx);
    } else if (data.startsWith('faq_')) {
      await handleFAQ(ctx, data);
    } else if (data.startsWith('unlock_')) {
      const postId = data.replace('unlock_', '');
      await handleUnlockClick(ctx, postId);
    } else if (data.startsWith('redownload_')) {
      const postId = data.replace('redownload_', '');
      await handleRedownload(ctx, postId);
    } else if (data === 'analytics_detail') {
      await handleAnalyticsDetail(ctx);
    } else if (data === 'join_group') {
      await ctx.answerCbQuery('Opening group link...', { show_alert: false });
      // User needs to use the invite link from their subscription confirmation
      await ctx.reply(
        '👥 **Join Our Private Group**\n\n' +
        'You should have received a private invite link when you subscribed.\n\n' +
        'If you can\'t find it, please contact support: @marcogirobondo',
        { parse_mode: 'Markdown' }
      );
    }
  } catch (error) {
    logger.error({ error, data }, 'Error handling callback query');
    await ctx.answerCbQuery('❌ An error occurred. Please try again.');
  }
});

async function handleSubscribe(ctx: BotContext, planId: string) {
  const user = ctx.from;
  if (!user) return;

  try {
    const plan = await db.plan.findById?.(planId);
    if (!plan) {
      await ctx.reply('❌ Plan not found.');
      return;
    }

    // Create Stripe checkout session
    const session = await stripeUtils.createCheckoutSession({
      priceId: plan.stripePriceId,
      telegramId: user.id,
      username: user.username,
      successUrl: `${APP_BASE_URL}/success`,
      cancelUrl: `${APP_BASE_URL}/cancel`,
    });

    let intervalText = 'monthly';
    if (plan.name.includes('3 Mesi')) {
      intervalText = 'every 3 months';
    }

    // Translate plan name to English
    const englishName = plan.name === 'Piano Mensile' ? 'Monthly Plan' : 
                       plan.name === 'Piano 3 Mesi' ? '3-Month Plan' : plan.name;

    await ctx.reply(
      `🛒 **Checkout Link Created**\n\n` +
      `Plan: ${englishName}\n` +
      `Price: ${formatCurrency(plan.priceCents)} ${intervalText}\n` +
      `🔄 Auto-renewal\n` +
      `🔒 Protected content (no screenshot/download)\n\n` +
      `Click the button below to complete your subscription:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '💳 Complete Payment', url: session.url! }],
            [{ text: '🔙 Back to Plans', callback_data: 'plans' }],
          ],
        },
      }
    );

    logger.info(
      { sessionId: session.id, planId, userId: user.id },
      'Created checkout session for user'
    );
  } catch (error) {
    logger.error({ error, planId, userId: user.id }, 'Error creating checkout session');
    await ctx.reply('❌ Error creating checkout session. Please try again later.');
  }
}

async function handleBillingPortal(ctx: BotContext) {
  const user = ctx.from;
  if (!user) return;

  try {
    const dbUser = await db.user.findByTelegramId(user.id);
    if (!dbUser?.subscriptions[0]) {
      await ctx.reply('❌ No active subscription found.');
      return;
    }

    const session = await stripeUtils.createBillingPortalSession(
      dbUser.subscriptions[0].stripeCustomerId,
      APP_BASE_URL
    );

    await ctx.reply(
      '⚙️ **Manage Your Subscription**\n\n' +
      'Click the button below to access the billing portal where you can:\n' +
      '• Update payment method\n' +
      '• Download invoices\n' +
      '• Cancel subscription\n' +
      '• Update billing information\n\n' +
      '⚠️ **WARNING**: If you cancel your subscription, you will be automatically removed from the group at the end of the current billing period.',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '⚙️ Open Billing Portal', url: session.url }],
          ],
        },
      }
    );
  } catch (error) {
    logger.error({ error, userId: user.id }, 'Error creating billing portal session');
    await ctx.reply('❌ Error accessing billing portal. Please try again later.');
  }
}

async function handleFAQ(ctx: BotContext, category: string) {
  let message = '';
  let backButton = [{ text: '🔙 Back to FAQ Menu', callback_data: 'faq_menu' }];

  switch (category) {
    case 'faq_payment':
      message = `💳 *Payment & Billing FAQ*\n\n` +
        `💰 *How do I pay for my subscription?*\n` +
        `We use Stripe - the most secure payment processor worldwide! 🔐 Your payment info is safe with us.\n\n` +
        
        `📅 *When will I be charged?*\n` +
        `You'll be charged every 1st of the month 📆 for monthly plans, or every 3 months for quarterly plans.\n\n` +
        
        `❌ *Can I cancel anytime?*\n` +
        `Yes, you can cancel anytime! ⚠️ But remember: once you cancel, you'll be kicked from the group immediately.\n\n` +
        
        `🏦 *What payment methods do you accept?*\n` +
        `We accept all major cards via Stripe 💳 Visa, Mastercard, American Express - you name it!\n\n` +
        
        `💸 *Will I get a refund if I cancel?*\n` +
        `Sorry, no refunds! 🚫 All sales are final. Make sure you're ready to commit! 💪`;
      break;

    case 'faq_content':
      message = `🔒 *Content & Features FAQ*\n\n` +
        `🎯 *What type of content will I get?*\n` +
        `Super exclusive and premium content by DurianOnPizza! 🍕✨ Content you won't find anywhere else!\n\n` +
        
        `📱 *Can I download videos?*\n` +
        `NO! 🚨 All videos are protected. Any attempts to download or record will result in legal action! ⚖️ We take this seriously.\n\n` +
        
        `📈 *How often is new content posted?*\n` +
        `Multiple premium contents weekly! 🔥 Always fresh, always exclusive! 📅`;
      break;

    case 'faq_general':
      message = `📱 *General Questions FAQ*\n\n` +
        `🤖 *How does the bot work?*\n` +
        `Simple: Pay = Access ✅ Don't pay = Get kicked ❌ It's automatic and fair! 🎯\n\n` +
        
        `💬 *Who can I contact for support?*\n` +
        `Need help? Contact @marcogirobondo 👨‍💻 He'll sort you out!`;
      break;

    case 'faq_menu':
      // Return to main FAQ menu
      const faqMessage = `❓ *Frequently Asked Questions*\n\n` +
        `Choose a category to get answers:`;

      const keyboard = [
        [{ text: '💳 Payment & Billing', callback_data: 'faq_payment' }],
        [{ text: '🔒 Content & Features', callback_data: 'faq_content' }],
        [{ text: '📱 General Questions', callback_data: 'faq_general' }],
        [{ text: '🔙 Back to Main Menu', callback_data: 'plans' }]
      ];

      await ctx.reply(faqMessage, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });
      return;
  }

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [backButton] }
  });
}

// Handle text messages (for collecting price in post_locked workflow)
bot.on(message('text'), async (ctx) => {
  const user = ctx.from;
  if (!user || !isOwner(user.id)) return;

  const text = ctx.message.text;

  // Check if owner is in post_locked workflow and providing price
  if (text.startsWith('$') || /^\d+(\.\d{1,2})?$/.test(text)) {
    // This looks like a price, but we need a simpler workflow
    // For now, we'll use a direct command approach
    return;
  }
});

// Handle media uploads from owner
// Photos and videos should ONLY be posted via:
// 1. /post_locked command (reply to media)
// 2. /upload command workflow (not auto-posted)
bot.on(message('photo'), async (ctx) => {
  if (!isOwner(ctx.from?.id || 0)) return;

  // Don't auto-post! Show instructions instead
  await ctx.reply(
    '📸 **Photo Received**\n\n' +
    'To post this photo, choose an option:\n\n' +
    '🔒 **For unlockable content:**\n' +
    'Reply to this photo with `/post_locked <price>`\n' +
    'Example: `/post_locked 9.99`\n\n' +
    '🆓 **For free group content:**\n' +
    'Use `/upload` and follow the instructions.\n\n' +
    '💡 Tip: The photo will be posted with content protection and watermark!',
    { parse_mode: 'Markdown' }
  );
});

bot.on(message('video'), async (ctx) => {
  if (!isOwner(ctx.from?.id || 0)) return;

  // Don't auto-post! Show instructions instead
  await ctx.reply(
    '🎥 **Video Received**\n\n' +
    'To post this video, choose an option:\n\n' +
    '🔒 **For unlockable content:**\n' +
    'Reply to this video with `/post_locked <price>`\n' +
    'Example: `/post_locked 14.99`\n\n' +
    '🆓 **For free group content:**\n' +
    'Use `/upload` and follow the instructions.\n\n' +
    '💡 Tip: The video will be posted with content protection and watermark!',
    { parse_mode: 'Markdown' }
  );
});

// Handle unlock button click
async function handleUnlockClick(ctx: BotContext, postId: string) {
  const user = ctx.from;
  if (!user) return;

  try {
    const { handleUnlockRequest } = await import('./unlockable');
    const result = await handleUnlockRequest(user.id, user.username, postId);

    if (!result.success) {
      await bot.telegram.sendMessage(user.id, result.message);
      return;
    }

    if (result.message === 'sending_content') {
      // User already unlocked - send content
      const { sendUnlockedContent } = await import('./unlockable');
      const dbUser = await db.user.findByTelegramId(user.id);
      if (dbUser) {
        await sendUnlockedContent(dbUser.id, postId);
      }
    } else if (result.message === 'payment_required') {
      // Send payment link
      await bot.telegram.sendMessage(
        user.id,
        `💳 **Unlock Content**\n\n` +
        `Price: $${result.price?.toFixed(2)}\n\n` +
        `Click the link below to complete your payment:\n\n` +
        `👉 [Pay Now](${result.paymentLink})\n\n` +
        `After payment, I'll send you the full content here in this private chat!`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (error) {
    logger.error({ error, userId: user.id, postId }, 'Error handling unlock click');
    await bot.telegram.sendMessage(user.id, '❌ An error occurred. Please try again later.');
  }
}

// Handle redownload request
async function handleRedownload(ctx: BotContext, postId: string) {
  const user = ctx.from;
  if (!user) return;

  try {
    const dbUser = await db.user.findByTelegramId(user.id);
    if (!dbUser) {
      await ctx.answerCbQuery('❌ User not found.');
      return;
    }

    const unlock = await db.prisma.postUnlock.findUnique({
      where: {
        userId_postId: {
          userId: dbUser.id,
          postId,
        },
      },
      include: {
        post: true,
      },
    });

    if (!unlock) {
      await ctx.answerCbQuery('❌ You haven\'t unlocked this content.');
      return;
    }

    if (unlock.downloaded) {
      await ctx.answerCbQuery('⚠️ You already downloaded this content (1-time limit).');
      return;
    }

    // Send the content
    const { sendUnlockedContent } = await import('./unlockable');
    await sendUnlockedContent(dbUser.id, postId);
    await ctx.answerCbQuery('✅ Content sent!');
  } catch (error) {
    logger.error({ error, userId: user.id, postId }, 'Error handling redownload');
    await ctx.answerCbQuery('❌ An error occurred.');
  }
}

// Handle detailed analytics view
async function handleAnalyticsDetail(ctx: BotContext) {
  const user = ctx.from;
  if (!user || !isOwner(user.id)) return;

  try {
    const { getUnlockAnalytics, getUserTotalSpending } = await import('./unlockable');
    const analytics = await getUnlockAnalytics();

    if (analytics.posts.length === 0) {
      await ctx.reply('No locked posts yet!');
      return;
    }

    // Show details for each post
    for (const post of analytics.posts.slice(0, 3)) {
      const revenue = (post.revenue / 100).toFixed(2);
      let message = `📦 **Post Analytics**\n\n`;
      message += `Caption: ${post.caption || 'Untitled'}\n`;
      message += `Price: $${post.price}\n`;
      message += `Unlocks: ${post.unlockCount}\n`;
      message += `Revenue: $${revenue}\n\n`;

      if (post.unlocks.length > 0) {
        message += `👥 **Unlocked by:**\n`;
        post.unlocks.forEach((unlock, i) => {
          const date = new Date(unlock.unlockedAt).toLocaleDateString();
          message += `${i + 1}. @${unlock.username} - $${unlock.amountPaid} (${date}) ${unlock.downloaded ? '✅' : '📥'}\n`;
        });
      }

      await ctx.reply(message, { parse_mode: 'Markdown' });
    }
  } catch (error) {
    logger.error({ error }, 'Error showing analytics detail');
    await ctx.reply('❌ Error loading detailed analytics.');
  }
}

// Telegram service for external use
export const telegramService = {
  async grantAccess(telegramId: number, expiresAt: Date) {
    try {
      // Check if user is already in the group
      let isAlreadyMember = false;
      try {
        const member = await bot.telegram.getChatMember(TELEGRAM_GROUP_ID, telegramId);
        isAlreadyMember = ['member', 'administrator', 'creator'].includes(member.status);
      } catch (error) {
        // User is not in group or error checking
        isAlreadyMember = false;
      }

      const user = await db.user.findByTelegramId(telegramId);
      
      if (isAlreadyMember) {
        // User is already in the group, just confirm their access
        if (user) {
          await bot.telegram.sendMessage(telegramId, 
            `🎉 **Welcome Back to Premium!**\n\n` +
            `Your subscription is now active until ${formatDate(expiresAt)}.\n\n` +
            `✅ You're already a member of our exclusive group!\n\n` +
            `🔒 **Protected content**: You cannot screenshot, download videos, or share content outside the group.`,
            { parse_mode: 'Markdown' }
          );
        }
        logger.info({ telegramId, expiresAt, alreadyMember: true }, 'Granted access to existing member');
        return;
      }

      // User is not in group yet, create invite link
      const inviteLink = await bot.telegram.createChatInviteLink(TELEGRAM_GROUP_ID, {
        member_limit: 1,
        expire_date: Math.floor(expiresAt.getTime() / 1000),
      });

      // Save invite token
      if (user) {
        await db.inviteToken.create({
          userId: user.id,
          chatInviteLink: inviteLink.invite_link,
          expiresAt,
        });

        // Send invite link to user
        await bot.telegram.sendMessage(telegramId, 
          `🎉 **Welcome to Premium!**\n\n` +
          `Your subscription is now active. Click the link below to join our exclusive group:\n\n` +
          `🔗 ${inviteLink.invite_link}\n\n` +
          `⚠️ This link is personal and expires on ${formatDate(expiresAt)}\n\n` +
          `🔒 **Protected content**: You will not be able to screenshot, download videos, or share content outside the group.`,
          { parse_mode: 'Markdown' }
        );
      }

      logger.info({ telegramId, expiresAt, alreadyMember: false }, 'Granted access to new user');
    } catch (error) {
      logger.error({ error, telegramId }, 'Failed to grant access');
      throw error;
    }
  },

  async revokeAccess(telegramId: number, reason: string) {
    try {
      // Try to kick user from group
      try {
        await bot.telegram.banChatMember(TELEGRAM_GROUP_ID, telegramId);
        await bot.telegram.unbanChatMember(TELEGRAM_GROUP_ID, telegramId);
      } catch (error) {
        // User might not be in group, continue
        logger.warn({ error, telegramId }, 'Could not kick user from group');
      }

      // Revoke all invite tokens
      const user = await db.user.findByTelegramId(telegramId);
      if (user) {
        await db.inviteToken.revokeUserTokens(user.id);
      }

      // Notify user
      await bot.telegram.sendMessage(telegramId,
        `❌ **Access Revoked**\n\n` +
        `Your access has been revoked: ${reason}\n\n` +
        `To regain access, renew your subscription using /start\n\n` +
        `💬 If you have questions, contact support.`,
        { parse_mode: 'Markdown' }
      );

      logger.info({ telegramId, reason }, 'Revoked access for user');
    } catch (error) {
      logger.error({ error, telegramId, reason }, 'Failed to revoke access');
      throw error;
    }
  },

  async scheduleRemoval(telegramId: number, removalTime: Date, reason: string) {
    try {
      // Schedule job for removal
      await jobQueue.add('removeUser', {
        telegramId,
        reason,
      }, {
        delay: removalTime.getTime() - Date.now(),
        removeOnComplete: true,
        removeOnFail: false,
      });

      logger.info({ telegramId, removalTime, reason }, 'Scheduled user removal');
    } catch (error) {
      logger.error({ error, telegramId, removalTime, reason }, 'Failed to schedule removal');
      throw error;
    }
  },

  async notifyPaymentFailed(telegramId: number, graceHours: number) {
    try {
      await bot.telegram.sendMessage(telegramId,
        `⚠️ **Pagamento Fallito**\n\n` +
        `Non siamo riusciti a elaborare il tuo ultimo pagamento. Hai ${graceHours} ore per aggiornare il metodo di pagamento prima che l'accesso venga revocato.\n\n` +
        `🔄 **Rinnovo automatico**: Il tuo abbonamento si rinnoverà automaticamente una volta risolto il problema di pagamento.\n\n` +
        `Usa /account per gestire il tuo abbonamento.`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '⚙️ Aggiorna Pagamento', callback_data: 'billing_portal' }],
            ],
          },
        }
      );

      logger.info({ telegramId, graceHours }, 'Notified user about payment failure');
    } catch (error) {
      logger.error({ error, telegramId }, 'Failed to notify about payment failure');
      throw error;
    }
  },
};

// Export bot instance
export default bot;