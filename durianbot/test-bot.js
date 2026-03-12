// Script di test semplice per il bot
require('dotenv').config();

// Verifica configurazione
console.log('🔧 Configurazione:');
console.log('Bot Token:', process.env.TELEGRAM_BOT_TOKEN ? '✅ OK' : '❌ MANCANTE');
console.log('Group ID:', process.env.TELEGRAM_GROUP_ID || '❌ MANCANTE');
console.log('Owner ID:', process.env.TELEGRAM_OWNER_ID || '❌ MANCANTE');
const { Telegraf } = require('telegraf');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Test semplice senza database
bot.start((ctx) => {
  ctx.reply(
    '🎯 **Test Bot Funzionante!**\n\n' +
    '✅ Bot configurato correttamente\n' +
    '✅ Connessione Telegram OK\n\n' +
    'Comandi disponibili:\n' +
    '• /test - Test messaggio\n' +
    '• /gruppo - Info gruppo\n' +
    '• /upload - Test upload (solo owner)',
    { parse_mode: 'Markdown' }
  );
});

bot.command('test', (ctx) => {
  ctx.reply('✅ Bot risponde correttamente!');
});

bot.command('gruppo', (ctx) => {
  if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
    ctx.reply(`📍 ID Gruppo: ${ctx.chat.id}\n📝 Nome: ${ctx.chat.title}`);
  } else {
    ctx.reply('❌ Questo comando funziona solo nei gruppi');
  }
});

bot.command('upload', (ctx) => {
  const isOwner = ctx.from.id === parseInt(process.env.TELEGRAM_OWNER_ID);
  if (isOwner) {
    ctx.reply('✅ Sei riconosciuto come owner! Invia una foto per testarla.');
  } else {
    ctx.reply('❌ Solo il proprietario può usare questo comando.');
  }
});

bot.on('photo', (ctx) => {
  const isOwner = ctx.from.id === parseInt(process.env.TELEGRAM_OWNER_ID);
  if (isOwner) {
    // Invia la foto al gruppo con protezione
    bot.telegram.sendPhoto(process.env.TELEGRAM_GROUP_ID, ctx.message.photo[0].file_id, {
      caption: 'Test foto protetta 🔒',
      protect_content: true
    }).then(() => {
      ctx.reply('✅ Foto inviata al gruppo con protezione!');
    }).catch((err) => {
      ctx.reply('❌ Errore invio foto: ' + err.message);
    });
  }
});

bot.launch();
console.log('🤖 Bot di test avviato!');
console.log('Premi Ctrl+C per fermare');

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
require('dotenv').config();

// Verifica configurazione
console.log('🔧 Configurazione:');
console.log('Bot Token:', process.env.TELEGRAM_BOT_TOKEN ? '✅ OK' : '❌ MANCANTE');
console.log('Group ID:', process.env.TELEGRAM_GROUP_ID || '❌ MANCANTE');
console.log('Owner ID:', process.env.TELEGRAM_OWNER_ID || '❌ MANCANTE');
const { Telegraf } = require('telegraf');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Test semplice senza database
bot.start((ctx) => {
  ctx.reply(
    '🎯 **Test Bot Funzionante!**\n\n' +
    '✅ Bot configurato correttamente\n' +
    '✅ Connessione Telegram OK\n\n' +
    'Comandi disponibili:\n' +
    '• /test - Test messaggio\n' +
    '• /gruppo - Info gruppo\n' +
    '• /upload - Test upload (solo owner)',
    { parse_mode: 'Markdown' }
  );
});

bot.command('test', (ctx) => {
  ctx.reply('✅ Bot risponde correttamente!');
});

bot.command('gruppo', (ctx) => {
  if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
    ctx.reply(`📍 ID Gruppo: ${ctx.chat.id}\n📝 Nome: ${ctx.chat.title}`);
  } else {
    ctx.reply('❌ Questo comando funziona solo nei gruppi');
  }
});

bot.command('upload', (ctx) => {
  const isOwner = ctx.from.id === parseInt(process.env.TELEGRAM_OWNER_ID);
  if (isOwner) {
    ctx.reply('✅ Sei riconosciuto come owner! Invia una foto per testarla.');
  } else {
    ctx.reply('❌ Solo il proprietario può usare questo comando.');
  }
});

bot.on('photo', (ctx) => {
  const isOwner = ctx.from.id === parseInt(process.env.TELEGRAM_OWNER_ID);
  if (isOwner) {
    // Invia la foto al gruppo con protezione
    bot.telegram.sendPhoto(process.env.TELEGRAM_GROUP_ID, ctx.message.photo[0].file_id, {
      caption: 'Test foto protetta 🔒',
      protect_content: true
    }).then(() => {
      ctx.reply('✅ Foto inviata al gruppo con protezione!');
    }).catch((err) => {
      ctx.reply('❌ Errore invio foto: ' + err.message);
    });
  }
});

bot.launch();
console.log('🤖 Bot di test avviato!');
console.log('Premi Ctrl+C per fermare');

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));