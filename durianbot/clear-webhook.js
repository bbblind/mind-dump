const { Telegraf } = require('telegraf');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

bot.telegram.deleteWebhook({ drop_pending_updates: true })
  .then(() => {
    console.log('✅ Webhook deleted and all pending updates dropped!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
  });


