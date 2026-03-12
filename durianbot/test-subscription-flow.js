// Test del flusso di abbonamento senza Stripe
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { PrismaClient } = require('@prisma/client');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const prisma = new PrismaClient();

// Crea piani di test nel database
async function setupTestPlans() {
  try {
    // Controlla se i piani esistono già
    const existingPlans = await prisma.plan.findMany();
    if (existingPlans.length > 0) {
      console.log('✅ Piani esistenti trovati:', existingPlans.map(p => p.name));
      return existingPlans;
    }
    
    // Crea piani di test solo se non esistono
    const plans = await Promise.all([
      prisma.plan.create({
        data: {
          name: 'Piano Mensile',
          stripePriceId: 'price_test_monthly',
          priceCents: 1599,
          interval: 'MONTH',
          active: true,
        },
      }),
      prisma.plan.create({
        data: {
          name: 'Piano 3 Mesi',
          stripePriceId: 'price_test_3months',
          priceCents: 3599,
          interval: 'MONTH',
          active: true,
        },
      }),
    ]);
    
    console.log('✅ Piani di test creati:', plans.map(p => p.name));
    return plans;
  } catch (error) {
    console.error('❌ Errore creazione piani:', error);
    // Ritorna piani esistenti in caso di errore
    return await prisma.plan.findMany();
  }
}

// Formatta valuta
function formatCurrency(cents) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

// Comando start
bot.start(async (ctx) => {
  const user = ctx.from;
  
  try {
    // Upsert user
    await prisma.user.upsert({
      where: { telegramId: user.id.toString() },
      update: {
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
      },
      create: {
        telegramId: user.id.toString(),
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
      },
    });

    // Controlla abbonamento esistente
    const existingSub = await prisma.subscription.findFirst({
      where: {
        user: { telegramId: user.id.toString() },
        status: 'ACTIVE',
      },
      include: { plan: true },
    });

    if (existingSub) {
      await ctx.reply(
        `✅ Welcome back! You have an active ${existingSub.plan.name} subscription.\n\n` +
        `📅 Next renewal: ${existingSub.currentPeriodEnd.toLocaleDateString()}\n\n` +
        `Use /account to manage your subscription.`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '👥 Join Group', url: `https://t.me/c/${Math.abs(process.env.TELEGRAM_GROUP_ID).toString().slice(4)}` }],
              [{ text: '⚙️ Manage Account', callback_data: 'account' }],
              [{ text: '❓ FAQ', callback_data: 'faq_menu' }],
            ],
          },
        }
      );
      return;
    }

    // Mostra piani
    await showPlans(ctx);
  } catch (error) {
    console.error('Errore start:', error);
    await ctx.reply('❌ Errore. Riprova più tardi.');
  }
});

// Mostra piani disponibili
async function showPlans(ctx) {
  try {
    const plans = await prisma.plan.findMany({
      where: { active: true },
      orderBy: { priceCents: 'asc' },
    });

    if (plans.length === 0) {
      await ctx.reply('❌ No subscription plans available at the moment.');
      return;
    }

    let message = '🎯 *Choose Your Plan*\n\n';
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

    // Invia il video con il messaggio dei piani come caption
    try {
      await ctx.replyWithVideo('BAACAgQAAxkBAAMYaLAw5SEtDImBdQSyrchAcKYTvncAAtkbAAIVn4BR8n9DY8gHaIc2BA', {
        caption: message,
        parse_mode: 'Markdown',
        protect_content: true,
        reply_markup: { inline_keyboard: keyboard },
      });
    } catch (videoError) {
      console.log('Video not available, sending text only:', videoError.message);
      // Fallback: send text only if video fails
      await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
      });
    }
  } catch (error) {
    console.error('Error showPlans:', error);
    await ctx.reply('❌ Error loading plans.');
  }
}

// Comando plans
bot.command('plans', showPlans);

// Comando account
bot.command('account', async (ctx) => {
  const user = ctx.from;
  
  try {
    const subscription = await prisma.subscription.findFirst({
      where: {
        user: { telegramId: user.id.toString() },
        status: 'ACTIVE',
      },
      include: { plan: true },
    });

    if (!subscription) {
      await ctx.reply(
        '❌ You don\'t have an active subscription.\n\n' +
        'Use /start to view available plans.',
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

    const nextRenewal = subscription.currentPeriodEnd.toLocaleDateString();
    const status = subscription.status === 'ACTIVE' ? '✅ Active' : '⚠️ ' + subscription.status;
    
    let intervalText = 'monthly';
    if (subscription.plan.name.includes('3 Mesi')) {
      intervalText = 'every 3 months';
    }

    await ctx.reply(
      `📊 *Your Account*\n\n` +
      `📋 Plan: ${subscription.plan.name}\n` +
      `💰 Price: ${formatCurrency(subscription.plan.priceCents)} ${intervalText}\n` +
      `📈 Status: ${status}\n` +
      `📅 Next renewal: ${nextRenewal}\n` +
      `🔄 Auto-renewal ${subscription.cancelAtPeriodEnd ? '❌ DISABLED' : '✅ ENABLED'}\n`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '👥 Join Group', url: `https://t.me/c/${Math.abs(process.env.TELEGRAM_GROUP_ID).toString().slice(4)}` }],
            [{ text: '🔙 Back to Plans', callback_data: 'plans' }],
          ],
        },
      }
    );
  } catch (error) {
    console.error('Error account:', error);
    await ctx.reply('❌ Error loading account.');
  }
});

// Gestione callback
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  
  try {
    await ctx.answerCbQuery();

    if (data.startsWith('subscribe_')) {
      const planId = data.replace('subscribe_', '');
      
      // Per il test, simula l'abbonamento immediato
      const plan = await prisma.plan.findUnique({ where: { id: planId } });
      if (!plan) {
        await ctx.reply('❌ Plan not found.');
        return;
      }

      // Create test subscription
      const user = await prisma.user.findUnique({
        where: { telegramId: ctx.from.id.toString() }
      });

      if (!user) {
        await ctx.reply('❌ User not found.');
        return;
      }

      // Calcola data di scadenza
      const currentPeriodEnd = new Date();
      if (plan.name.includes('3 Mesi')) {
        currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 3);
      } else {
        currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);
      }

      // Crea abbonamento
      const subscription = await prisma.subscription.create({
        data: {
          userId: user.id,
          planId: plan.id,
          stripeCustomerId: 'cus_test_' + Date.now(),
          stripeSubId: 'sub_test_' + Date.now(),
          status: 'ACTIVE',
          currentPeriodEnd,
          cancelAtPeriodEnd: false,
        },
        include: { plan: true },
      });

      await ctx.reply(
        `🎉 *Subscription Activated!*\n\n` +
        `Plan: ${plan.name}\n` +
        `Price: ${formatCurrency(plan.priceCents)}\n` +
        `Expires: ${currentPeriodEnd.toLocaleDateString()}\n\n` +
        `✅ *TEST MODE*: Simulated subscription created!\n\n` +
        `You can now enter the premium group:`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '👥 Join Group', url: `https://t.me/c/${Math.abs(process.env.TELEGRAM_GROUP_ID).toString().slice(4)}` }],
              [{ text: '📊 View Account', callback_data: 'account' }],
            ],
          },
        }
      );

      console.log(`✅ Subscription created for ${ctx.from.username}: ${plan.name}`);
    } else if (data === 'plans') {
      await showPlans(ctx);
    } else if (data === 'account') {
      // Simula comando account
      const user = ctx.from;
      const subscription = await prisma.subscription.findFirst({
        where: {
          user: { telegramId: user.id.toString() },
          status: 'ACTIVE',
        },
        include: { plan: true },
      });

      if (subscription) {
        // Translate plan name to English for display
        const englishName = subscription.plan.name === 'Piano Mensile' ? 'Monthly Plan' : 
                           subscription.plan.name === 'Piano 3 Mesi' ? '3-Month Plan' : subscription.plan.name;
        
        const accountMessage = `📊 *Your Account*\n\n` +
          `✅ *Plan:* ${englishName}\n` +
          `📅 *Active until:* ${subscription.currentPeriodEnd.toLocaleDateString()}\n` +
          `💳 *Status:* Active\n` +
          `🔄 *Auto-renewal:* Enabled\n\n` +
          `⚠️ *Note:* Canceling will immediately remove your access to the group.`;

        const keyboard = [
          [{ text: '❌ Cancel Subscription', callback_data: `cancel_sub_${subscription.id}` }],
          [{ text: '❓ FAQ', callback_data: 'faq_menu' }],
          [{ text: '🔙 Back to Plans', callback_data: 'plans' }]
        ];

        await ctx.reply(accountMessage, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: keyboard }
        });
      } else {
        await ctx.reply('❌ No active subscription');
      }
    } else if (data.startsWith('faq_')) {
      await handleFAQ(ctx, data);
    } else if (data.startsWith('cancel_sub_')) {
      await handleCancelSubscription(ctx, data);
    } else if (data.startsWith('confirm_cancel_')) {
      await handleConfirmCancel(ctx, data);
    }
  } catch (error) {
    console.error('Error callback:', error);
    await ctx.reply('❌ Error. Please try again.');
  }
});

// Help Command
bot.command('help', async (ctx) => {
  const helpMessage = `🤖 *Bot Commands*\n\n` +
    `👤 *User Commands:*\n` +
    `• /start - View subscription plans\n` +
    `• /plans - Show available plans\n` +
    `• /account - Manage your subscription\n` +
    `• /faq - Frequently asked questions\n` +
    `• /help - Show this help message\n\n` +
    `🔒 *Protected Content:*\n` +
    `• No screenshots possible\n` +
    `• No video downloads\n` +
    `• No external sharing\n` +
    `• Legal action for violations ⚖️\n\n` +
    `💬 *Need Support?* Contact @marcogirobondo`;

  await ctx.reply(helpMessage, { parse_mode: 'Markdown' });
});

// FAQ Handler Function
async function handleFAQ(ctx, category) {
  let message = '';
  let backButton = [{ text: '🔙 Back to FAQ Menu', callback_data: 'faq_menu' }];

  switch (category) {
    case 'faq_payment':
      message = `💳 *Payment & Billing FAQ*\n\n` +
        `💰 *How do I pay for my subscription?*\n` +
        `We use Stripe - the most secure payment processor worldwide! 🔐 It's our preferred method for safe transactions.\n\n` +
        
        `📅 *When will I be charged?*\n` +
        `You'll be charged every 1st of the month 📆 for monthly plans, or every 3 months for quarterly plans.\n\n` +
        
        `❌ *Can I cancel anytime?*\n` +
        `Yes, you can cancel anytime! ⚠️ But remember: once you cancel, you'll be kicked from the group immediately.\n\n` +
        
        `🏦 *What payment methods do you accept?*\n` +
        `We accept all major cards via Stripe 💳 Crypto payments are also accepted - contact @marcogirobondo for crypto options! 🪙\n\n` +
        
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
        [
          { text: '💳 Payment & Billing', callback_data: 'faq_payment' },
          { text: '🔒 Content & Features', callback_data: 'faq_content' }
        ],
        [
          { text: '📱 General Questions', callback_data: 'faq_general' }
        ],
        [
          { text: '🔙 Back to Main Menu', callback_data: 'plans' }
        ]
      ];

      // Since the original message might contain video, we can't edit it
      // Instead, send a new message
      await ctx.reply(faqMessage, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });
      return;
  }

  // Since the original message might contain video, we can't edit it
  // Instead, send a new message
  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [backButton] }
  });
}

// Cancel Subscription Handler
async function handleCancelSubscription(ctx, data) {
  try {
    const subscriptionId = data.replace('cancel_sub_', '');
    const user = ctx.from;

    // Find the subscription
    const subscription = await prisma.subscription.findFirst({
      where: {
        id: subscriptionId,
        user: { telegramId: user.id.toString() },
        status: 'ACTIVE',
      },
      include: { plan: true },
    });

    if (!subscription) {
      await ctx.reply('❌ Subscription not found or already canceled');
      return;
    }

    // Show confirmation dialog
    const englishName = subscription.plan.name === 'Piano Mensile' ? 'Monthly Plan' : 
                       subscription.plan.name === 'Piano 3 Mesi' ? '3-Month Plan' : subscription.plan.name;

    const confirmMessage = `⚠️ *Cancel Subscription*\n\n` +
      `Are you sure you want to cancel your ${englishName}?\n\n` +
      `🚨 *Warning:*\n` +
      `• You'll be immediately removed from the group\n` +
      `• No refunds will be provided\n` +
      `• You'll lose access to all premium content\n\n` +
      `This action cannot be undone!`;

    const keyboard = [
      [
        { text: '✅ Yes, Cancel', callback_data: `confirm_cancel_${subscriptionId}` },
        { text: '❌ No, Keep Active', callback_data: 'account' }
      ]
    ];

    await ctx.reply(confirmMessage, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard }
    });

  } catch (error) {
    console.error('Error handling cancel subscription:', error);
    await ctx.reply('❌ Error processing cancellation. Please try again.');
  }
}

// Confirm Cancel Subscription Handler
async function handleConfirmCancel(ctx, data) {
  try {
    const subscriptionId = data.replace('confirm_cancel_', '');
    const user = ctx.from;

    // Find and cancel the subscription
    const subscription = await prisma.subscription.findFirst({
      where: {
        id: subscriptionId,
        user: { telegramId: user.id.toString() },
        status: 'ACTIVE',
      },
      include: { plan: true },
    });

    if (!subscription) {
      await ctx.reply('❌ Subscription not found or already canceled');
      return;
    }

    // Update subscription status
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { 
        status: 'CANCELED',
      },
    });

    // In test mode, simulate kicking from group
    console.log(`🚫 User ${user.username} canceled subscription - would be kicked from group`);

    const cancelMessage = `✅ *Subscription Canceled*\n\n` +
      `Your subscription has been successfully canceled.\n\n` +
      `🚫 You have been removed from the premium group.\n` +
      `💔 We're sorry to see you go!\n\n` +
      `Want to rejoin? Use /start to subscribe again.`;

    await ctx.reply(cancelMessage, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: '🔙 Subscribe Again', callback_data: 'plans' }]]
      }
    });

  } catch (error) {
    console.error('Error confirming cancellation:', error);
    await ctx.reply('❌ Error processing cancellation. Please contact support.');
  }
}

// Test admin commands
// FAQ Command
bot.command('faq', async (ctx) => {
  const faqMessage = `❓ *Frequently Asked Questions*\n\n` +
    `Choose a category to get answers:`;

  const keyboard = [
    [
      { text: '💳 Payment & Billing', callback_data: 'faq_payment' },
      { text: '🔒 Content & Features', callback_data: 'faq_content' }
    ],
    [
      { text: '📱 General Questions', callback_data: 'faq_general' }
    ],
    [
      { text: '🔙 Back to Main Menu', callback_data: 'plans' }
    ]
  ];

  await ctx.reply(faqMessage, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard }
  });
});

bot.command('reset', async (ctx) => {
  if (ctx.from.id.toString() !== process.env.TELEGRAM_OWNER_ID) {
    await ctx.reply('❌ Admin only');
    return;
  }
  
  try {
    await prisma.subscription.deleteMany();
    await prisma.user.deleteMany();
    await ctx.reply('✅ Database reset completed');
  } catch (error) {
    await ctx.reply('❌ Reset error: ' + error.message);
  }
});

// Comando per ottenere file_id dei video
bot.on('video', async (ctx) => {
  if (ctx.from.id.toString() !== process.env.TELEGRAM_OWNER_ID) {
    return; // Solo owner può vedere i file_id
  }
  
  const video = ctx.message.video;
  await ctx.reply(
    `📹 *File ID del Video:*\n\n` +
    `\`${video.file_id}\`\n\n` +
    `Copia questo ID e sostituiscilo nel codice per usare questo video come promozionale.`,
    { parse_mode: 'Markdown' }
  );
  
  console.log('📹 Video File ID:', video.file_id);
});

// Avvio
async function start() {
  console.log('🚀 Starting test bot...');
  
  try {
    await setupTestPlans();
    await bot.launch();
    console.log('✅ Test bot started!');
    console.log('');
    console.log('🧪 **TEST MODE**');
    console.log('- Payments are simulated');
    console.log('- Subscriptions are created immediately');
    console.log('- Use /reset to clean database');
    console.log('');
    console.log('📱 **Test Flow:**');
    console.log('1. Send /start to bot');
    console.log('2. Choose a plan');
    console.log('3. Check with /account');
    console.log('4. Try to join the group');
    console.log('5. Use /faq for questions');
  } catch (error) {
    console.error('❌ Startup error:', error);
  }
}

start();

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { PrismaClient } = require('@prisma/client');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const prisma = new PrismaClient();

// Crea piani di test nel database
async function setupTestPlans() {
  try {
    // Controlla se i piani esistono già
    const existingPlans = await prisma.plan.findMany();
    if (existingPlans.length > 0) {
      console.log('✅ Piani esistenti trovati:', existingPlans.map(p => p.name));
      return existingPlans;
    }
    
    // Crea piani di test solo se non esistono
    const plans = await Promise.all([
      prisma.plan.create({
        data: {
          name: 'Piano Mensile',
          stripePriceId: 'price_test_monthly',
          priceCents: 1599,
          interval: 'MONTH',
          active: true,
        },
      }),
      prisma.plan.create({
        data: {
          name: 'Piano 3 Mesi',
          stripePriceId: 'price_test_3months',
          priceCents: 3599,
          interval: 'MONTH',
          active: true,
        },
      }),
    ]);
    
    console.log('✅ Piani di test creati:', plans.map(p => p.name));
    return plans;
  } catch (error) {
    console.error('❌ Errore creazione piani:', error);
    // Ritorna piani esistenti in caso di errore
    return await prisma.plan.findMany();
  }
}

// Formatta valuta
function formatCurrency(cents) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

// Comando start
bot.start(async (ctx) => {
  const user = ctx.from;
  
  try {
    // Upsert user
    await prisma.user.upsert({
      where: { telegramId: user.id.toString() },
      update: {
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
      },
      create: {
        telegramId: user.id.toString(),
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
      },
    });

    // Controlla abbonamento esistente
    const existingSub = await prisma.subscription.findFirst({
      where: {
        user: { telegramId: user.id.toString() },
        status: 'ACTIVE',
      },
      include: { plan: true },
    });

    if (existingSub) {
      await ctx.reply(
        `✅ Welcome back! You have an active ${existingSub.plan.name} subscription.\n\n` +
        `📅 Next renewal: ${existingSub.currentPeriodEnd.toLocaleDateString()}\n\n` +
        `Use /account to manage your subscription.`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '👥 Join Group', url: `https://t.me/c/${Math.abs(process.env.TELEGRAM_GROUP_ID).toString().slice(4)}` }],
              [{ text: '⚙️ Manage Account', callback_data: 'account' }],
              [{ text: '❓ FAQ', callback_data: 'faq_menu' }],
            ],
          },
        }
      );
      return;
    }

    // Mostra piani
    await showPlans(ctx);
  } catch (error) {
    console.error('Errore start:', error);
    await ctx.reply('❌ Errore. Riprova più tardi.');
  }
});

// Mostra piani disponibili
async function showPlans(ctx) {
  try {
    const plans = await prisma.plan.findMany({
      where: { active: true },
      orderBy: { priceCents: 'asc' },
    });

    if (plans.length === 0) {
      await ctx.reply('❌ No subscription plans available at the moment.');
      return;
    }

    let message = '🎯 *Choose Your Plan*\n\n';
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

    // Invia il video con il messaggio dei piani come caption
    try {
      await ctx.replyWithVideo('BAACAgQAAxkBAAMYaLAw5SEtDImBdQSyrchAcKYTvncAAtkbAAIVn4BR8n9DY8gHaIc2BA', {
        caption: message,
        parse_mode: 'Markdown',
        protect_content: true,
        reply_markup: { inline_keyboard: keyboard },
      });
    } catch (videoError) {
      console.log('Video not available, sending text only:', videoError.message);
      // Fallback: send text only if video fails
      await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
      });
    }
  } catch (error) {
    console.error('Error showPlans:', error);
    await ctx.reply('❌ Error loading plans.');
  }
}

// Comando plans
bot.command('plans', showPlans);

// Comando account
bot.command('account', async (ctx) => {
  const user = ctx.from;
  
  try {
    const subscription = await prisma.subscription.findFirst({
      where: {
        user: { telegramId: user.id.toString() },
        status: 'ACTIVE',
      },
      include: { plan: true },
    });

    if (!subscription) {
      await ctx.reply(
        '❌ You don\'t have an active subscription.\n\n' +
        'Use /start to view available plans.',
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

    const nextRenewal = subscription.currentPeriodEnd.toLocaleDateString();
    const status = subscription.status === 'ACTIVE' ? '✅ Active' : '⚠️ ' + subscription.status;
    
    let intervalText = 'monthly';
    if (subscription.plan.name.includes('3 Mesi')) {
      intervalText = 'every 3 months';
    }

    await ctx.reply(
      `📊 *Your Account*\n\n` +
      `📋 Plan: ${subscription.plan.name}\n` +
      `💰 Price: ${formatCurrency(subscription.plan.priceCents)} ${intervalText}\n` +
      `📈 Status: ${status}\n` +
      `📅 Next renewal: ${nextRenewal}\n` +
      `🔄 Auto-renewal ${subscription.cancelAtPeriodEnd ? '❌ DISABLED' : '✅ ENABLED'}\n`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '👥 Join Group', url: `https://t.me/c/${Math.abs(process.env.TELEGRAM_GROUP_ID).toString().slice(4)}` }],
            [{ text: '🔙 Back to Plans', callback_data: 'plans' }],
          ],
        },
      }
    );
  } catch (error) {
    console.error('Error account:', error);
    await ctx.reply('❌ Error loading account.');
  }
});

// Gestione callback
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  
  try {
    await ctx.answerCbQuery();

    if (data.startsWith('subscribe_')) {
      const planId = data.replace('subscribe_', '');
      
      // Per il test, simula l'abbonamento immediato
      const plan = await prisma.plan.findUnique({ where: { id: planId } });
      if (!plan) {
        await ctx.reply('❌ Plan not found.');
        return;
      }

      // Create test subscription
      const user = await prisma.user.findUnique({
        where: { telegramId: ctx.from.id.toString() }
      });

      if (!user) {
        await ctx.reply('❌ User not found.');
        return;
      }

      // Calcola data di scadenza
      const currentPeriodEnd = new Date();
      if (plan.name.includes('3 Mesi')) {
        currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 3);
      } else {
        currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);
      }

      // Crea abbonamento
      const subscription = await prisma.subscription.create({
        data: {
          userId: user.id,
          planId: plan.id,
          stripeCustomerId: 'cus_test_' + Date.now(),
          stripeSubId: 'sub_test_' + Date.now(),
          status: 'ACTIVE',
          currentPeriodEnd,
          cancelAtPeriodEnd: false,
        },
        include: { plan: true },
      });

      await ctx.reply(
        `🎉 *Subscription Activated!*\n\n` +
        `Plan: ${plan.name}\n` +
        `Price: ${formatCurrency(plan.priceCents)}\n` +
        `Expires: ${currentPeriodEnd.toLocaleDateString()}\n\n` +
        `✅ *TEST MODE*: Simulated subscription created!\n\n` +
        `You can now enter the premium group:`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '👥 Join Group', url: `https://t.me/c/${Math.abs(process.env.TELEGRAM_GROUP_ID).toString().slice(4)}` }],
              [{ text: '📊 View Account', callback_data: 'account' }],
            ],
          },
        }
      );

      console.log(`✅ Subscription created for ${ctx.from.username}: ${plan.name}`);
    } else if (data === 'plans') {
      await showPlans(ctx);
    } else if (data === 'account') {
      // Simula comando account
      const user = ctx.from;
      const subscription = await prisma.subscription.findFirst({
        where: {
          user: { telegramId: user.id.toString() },
          status: 'ACTIVE',
        },
        include: { plan: true },
      });

      if (subscription) {
        // Translate plan name to English for display
        const englishName = subscription.plan.name === 'Piano Mensile' ? 'Monthly Plan' : 
                           subscription.plan.name === 'Piano 3 Mesi' ? '3-Month Plan' : subscription.plan.name;
        
        const accountMessage = `📊 *Your Account*\n\n` +
          `✅ *Plan:* ${englishName}\n` +
          `📅 *Active until:* ${subscription.currentPeriodEnd.toLocaleDateString()}\n` +
          `💳 *Status:* Active\n` +
          `🔄 *Auto-renewal:* Enabled\n\n` +
          `⚠️ *Note:* Canceling will immediately remove your access to the group.`;

        const keyboard = [
          [{ text: '❌ Cancel Subscription', callback_data: `cancel_sub_${subscription.id}` }],
          [{ text: '❓ FAQ', callback_data: 'faq_menu' }],
          [{ text: '🔙 Back to Plans', callback_data: 'plans' }]
        ];

        await ctx.reply(accountMessage, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: keyboard }
        });
      } else {
        await ctx.reply('❌ No active subscription');
      }
    } else if (data.startsWith('faq_')) {
      await handleFAQ(ctx, data);
    } else if (data.startsWith('cancel_sub_')) {
      await handleCancelSubscription(ctx, data);
    } else if (data.startsWith('confirm_cancel_')) {
      await handleConfirmCancel(ctx, data);
    }
  } catch (error) {
    console.error('Error callback:', error);
    await ctx.reply('❌ Error. Please try again.');
  }
});

// Help Command
bot.command('help', async (ctx) => {
  const helpMessage = `🤖 *Bot Commands*\n\n` +
    `👤 *User Commands:*\n` +
    `• /start - View subscription plans\n` +
    `• /plans - Show available plans\n` +
    `• /account - Manage your subscription\n` +
    `• /faq - Frequently asked questions\n` +
    `• /help - Show this help message\n\n` +
    `🔒 *Protected Content:*\n` +
    `• No screenshots possible\n` +
    `• No video downloads\n` +
    `• No external sharing\n` +
    `• Legal action for violations ⚖️\n\n` +
    `💬 *Need Support?* Contact @marcogirobondo`;

  await ctx.reply(helpMessage, { parse_mode: 'Markdown' });
});

// FAQ Handler Function
async function handleFAQ(ctx, category) {
  let message = '';
  let backButton = [{ text: '🔙 Back to FAQ Menu', callback_data: 'faq_menu' }];

  switch (category) {
    case 'faq_payment':
      message = `💳 *Payment & Billing FAQ*\n\n` +
        `💰 *How do I pay for my subscription?*\n` +
        `We use Stripe - the most secure payment processor worldwide! 🔐 It's our preferred method for safe transactions.\n\n` +
        
        `📅 *When will I be charged?*\n` +
        `You'll be charged every 1st of the month 📆 for monthly plans, or every 3 months for quarterly plans.\n\n` +
        
        `❌ *Can I cancel anytime?*\n` +
        `Yes, you can cancel anytime! ⚠️ But remember: once you cancel, you'll be kicked from the group immediately.\n\n` +
        
        `🏦 *What payment methods do you accept?*\n` +
        `We accept all major cards via Stripe 💳 Crypto payments are also accepted - contact @marcogirobondo for crypto options! 🪙\n\n` +
        
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
        [
          { text: '💳 Payment & Billing', callback_data: 'faq_payment' },
          { text: '🔒 Content & Features', callback_data: 'faq_content' }
        ],
        [
          { text: '📱 General Questions', callback_data: 'faq_general' }
        ],
        [
          { text: '🔙 Back to Main Menu', callback_data: 'plans' }
        ]
      ];

      // Since the original message might contain video, we can't edit it
      // Instead, send a new message
      await ctx.reply(faqMessage, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });
      return;
  }

  // Since the original message might contain video, we can't edit it
  // Instead, send a new message
  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [backButton] }
  });
}

// Cancel Subscription Handler
async function handleCancelSubscription(ctx, data) {
  try {
    const subscriptionId = data.replace('cancel_sub_', '');
    const user = ctx.from;

    // Find the subscription
    const subscription = await prisma.subscription.findFirst({
      where: {
        id: subscriptionId,
        user: { telegramId: user.id.toString() },
        status: 'ACTIVE',
      },
      include: { plan: true },
    });

    if (!subscription) {
      await ctx.reply('❌ Subscription not found or already canceled');
      return;
    }

    // Show confirmation dialog
    const englishName = subscription.plan.name === 'Piano Mensile' ? 'Monthly Plan' : 
                       subscription.plan.name === 'Piano 3 Mesi' ? '3-Month Plan' : subscription.plan.name;

    const confirmMessage = `⚠️ *Cancel Subscription*\n\n` +
      `Are you sure you want to cancel your ${englishName}?\n\n` +
      `🚨 *Warning:*\n` +
      `• You'll be immediately removed from the group\n` +
      `• No refunds will be provided\n` +
      `• You'll lose access to all premium content\n\n` +
      `This action cannot be undone!`;

    const keyboard = [
      [
        { text: '✅ Yes, Cancel', callback_data: `confirm_cancel_${subscriptionId}` },
        { text: '❌ No, Keep Active', callback_data: 'account' }
      ]
    ];

    await ctx.reply(confirmMessage, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard }
    });

  } catch (error) {
    console.error('Error handling cancel subscription:', error);
    await ctx.reply('❌ Error processing cancellation. Please try again.');
  }
}

// Confirm Cancel Subscription Handler
async function handleConfirmCancel(ctx, data) {
  try {
    const subscriptionId = data.replace('confirm_cancel_', '');
    const user = ctx.from;

    // Find and cancel the subscription
    const subscription = await prisma.subscription.findFirst({
      where: {
        id: subscriptionId,
        user: { telegramId: user.id.toString() },
        status: 'ACTIVE',
      },
      include: { plan: true },
    });

    if (!subscription) {
      await ctx.reply('❌ Subscription not found or already canceled');
      return;
    }

    // Update subscription status
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { 
        status: 'CANCELED',
      },
    });

    // In test mode, simulate kicking from group
    console.log(`🚫 User ${user.username} canceled subscription - would be kicked from group`);

    const cancelMessage = `✅ *Subscription Canceled*\n\n` +
      `Your subscription has been successfully canceled.\n\n` +
      `🚫 You have been removed from the premium group.\n` +
      `💔 We're sorry to see you go!\n\n` +
      `Want to rejoin? Use /start to subscribe again.`;

    await ctx.reply(cancelMessage, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: '🔙 Subscribe Again', callback_data: 'plans' }]]
      }
    });

  } catch (error) {
    console.error('Error confirming cancellation:', error);
    await ctx.reply('❌ Error processing cancellation. Please contact support.');
  }
}

// Test admin commands
// FAQ Command
bot.command('faq', async (ctx) => {
  const faqMessage = `❓ *Frequently Asked Questions*\n\n` +
    `Choose a category to get answers:`;

  const keyboard = [
    [
      { text: '💳 Payment & Billing', callback_data: 'faq_payment' },
      { text: '🔒 Content & Features', callback_data: 'faq_content' }
    ],
    [
      { text: '📱 General Questions', callback_data: 'faq_general' }
    ],
    [
      { text: '🔙 Back to Main Menu', callback_data: 'plans' }
    ]
  ];

  await ctx.reply(faqMessage, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard }
  });
});

bot.command('reset', async (ctx) => {
  if (ctx.from.id.toString() !== process.env.TELEGRAM_OWNER_ID) {
    await ctx.reply('❌ Admin only');
    return;
  }
  
  try {
    await prisma.subscription.deleteMany();
    await prisma.user.deleteMany();
    await ctx.reply('✅ Database reset completed');
  } catch (error) {
    await ctx.reply('❌ Reset error: ' + error.message);
  }
});

// Comando per ottenere file_id dei video
bot.on('video', async (ctx) => {
  if (ctx.from.id.toString() !== process.env.TELEGRAM_OWNER_ID) {
    return; // Solo owner può vedere i file_id
  }
  
  const video = ctx.message.video;
  await ctx.reply(
    `📹 *File ID del Video:*\n\n` +
    `\`${video.file_id}\`\n\n` +
    `Copia questo ID e sostituiscilo nel codice per usare questo video come promozionale.`,
    { parse_mode: 'Markdown' }
  );
  
  console.log('📹 Video File ID:', video.file_id);
});

// Avvio
async function start() {
  console.log('🚀 Starting test bot...');
  
  try {
    await setupTestPlans();
    await bot.launch();
    console.log('✅ Test bot started!');
    console.log('');
    console.log('🧪 **TEST MODE**');
    console.log('- Payments are simulated');
    console.log('- Subscriptions are created immediately');
    console.log('- Use /reset to clean database');
    console.log('');
    console.log('📱 **Test Flow:**');
    console.log('1. Send /start to bot');
    console.log('2. Choose a plan');
    console.log('3. Check with /account');
    console.log('4. Try to join the group');
    console.log('5. Use /faq for questions');
  } catch (error) {
    console.error('❌ Startup error:', error);
  }
}

start();

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));