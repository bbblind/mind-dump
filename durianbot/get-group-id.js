// Quick script to get your Telegram Group ID
// Run this, then send a message in your group, and the bot will log the ID

require('dotenv').config({ path: 'env.production' });
const { Telegraf } = require('telegraf');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

console.log('🤖 Bot started! Now do this:');
console.log('1. Go to your private group: https://t.me/+YNro_voeEyExNWFk');
console.log('2. Send ANY message in the group');
console.log('3. Come back here and you\'ll see the GROUP_ID\n');
console.log('Waiting for messages...\n');

bot.on('message', (ctx) => {
  const chatType = ctx.chat.type;
  const chatId = ctx.chat.id;
  const chatTitle = ctx.chat.title || 'DM';
  
  console.log('\n' + '='.repeat(60));
  console.log(`📍 Chat Type: ${chatType}`);
  console.log(`📍 Chat ID: ${chatId}`);
  console.log(`📍 Chat Title: ${chatTitle}`);
  console.log('='.repeat(60));
  
  if (chatType === 'supergroup' || chatType === 'group') {
    console.log('\n✅ THIS IS YOUR GROUP ID:', chatId);
    console.log('📝 Update env.production:');
    console.log(`TELEGRAM_GROUP_ID=${chatId}\n`);
  } else {
    console.log('\n⚠️  This is not a group message. Send a message IN THE GROUP.\n');
  }
});

bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Run this, then send a message in your group, and the bot will log the ID

require('dotenv').config({ path: 'env.production' });
const { Telegraf } = require('telegraf');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

console.log('🤖 Bot started! Now do this:');
console.log('1. Go to your private group: https://t.me/+YNro_voeEyExNWFk');
console.log('2. Send ANY message in the group');
console.log('3. Come back here and you\'ll see the GROUP_ID\n');
console.log('Waiting for messages...\n');

bot.on('message', (ctx) => {
  const chatType = ctx.chat.type;
  const chatId = ctx.chat.id;
  const chatTitle = ctx.chat.title || 'DM';
  
  console.log('\n' + '='.repeat(60));
  console.log(`📍 Chat Type: ${chatType}`);
  console.log(`📍 Chat ID: ${chatId}`);
  console.log(`📍 Chat Title: ${chatTitle}`);
  console.log('='.repeat(60));
  
  if (chatType === 'supergroup' || chatType === 'group') {
    console.log('\n✅ THIS IS YOUR GROUP ID:', chatId);
    console.log('📝 Update env.production:');
    console.log(`TELEGRAM_GROUP_ID=${chatId}\n`);
  } else {
    console.log('\n⚠️  This is not a group message. Send a message IN THE GROUP.\n');
  }
});

bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
