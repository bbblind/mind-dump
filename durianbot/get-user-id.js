// Script per ottenere il tuo ID utente Telegram
const { Telegraf } = require('telegraf');

// Inserisci qui il token del tuo bot
const BOT_TOKEN = '7551790641:AAHR89x5lWDVpGBXACC4LZLJSTzSuxviI3A';

const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) => {
  console.log('👤 Il tuo ID Telegram è:', ctx.from.id);
  console.log('Username:', ctx.from.username || 'N/A');
  console.log('Nome:', ctx.from.first_name);
  
  ctx.reply(`Il tuo ID è: ${ctx.from.id}`);
});

bot.launch();
console.log('🤖 Bot avviato! Invia /start al bot in privato per vedere il tuo ID');
console.log('Premi Ctrl+C per fermare');
const { Telegraf } = require('telegraf');

// Inserisci qui il token del tuo bot
const BOT_TOKEN = '7551790641:AAHR89x5lWDVpGBXACC4LZLJSTzSuxviI3A';

const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) => {
  console.log('👤 Il tuo ID Telegram è:', ctx.from.id);
  console.log('Username:', ctx.from.username || 'N/A');
  console.log('Nome:', ctx.from.first_name);
  
  ctx.reply(`Il tuo ID è: ${ctx.from.id}`);
});

bot.launch();
console.log('🤖 Bot avviato! Invia /start al bot in privato per vedere il tuo ID');
console.log('Premi Ctrl+C per fermare');