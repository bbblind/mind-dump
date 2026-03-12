import express from 'express';
import { STRIPE_WEBHOOK_SECRET, PORT, APP_BASE_URL, TELEGRAM_OWNER_ID } from './config';
import { logger, handleAsyncError } from './utils';
import { checkDatabaseConnection, disconnectDatabase } from './db';
import { stripeUtils } from './stripe';
import { processWebhook } from './webhooks';
import { scheduleRecurringJobs, shutdownJobs, getJobsHealth } from './jobs';
import bot from './bot';

const app = express();

// Middleware for Stripe webhooks (raw body)
app.use('/webhook/stripe', express.raw({ type: 'application/json' }));

// Middleware for other routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  logger.info(
    {
      method: req.method,
      url: req.url,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
    },
    'HTTP request'
  );
  next();
});

// Health check endpoint
app.get('/health', handleAsyncError(async (req, res) => {
  const dbHealthy = await checkDatabaseConnection();
  const jobsHealth = await getJobsHealth();
  
  const health = {
    status: dbHealthy && jobsHealth.status === 'healthy' ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    services: {
      database: dbHealthy ? 'healthy' : 'unhealthy',
      jobs: jobsHealth,
      telegram: 'healthy', // Assume healthy if we can respond
    },
  };

  res.status(health.status === 'healthy' ? 200 : 503).json(health);
}));

// Stripe webhook endpoint
app.post('/webhook/stripe', handleAsyncError(async (req, res) => {
  const signature = req.get('stripe-signature');
  
  if (!signature) {
    logger.warn('Missing Stripe signature');
    return res.status(400).send('Missing signature');
  }

  try {
    // Verify webhook signature
    const event = stripeUtils.verifyWebhookSignature(
      req.body.toString(),
      signature,
      STRIPE_WEBHOOK_SECRET
    );

    logger.info(
      { eventId: event.id, eventType: event.type },
      'Received Stripe webhook'
    );

    // Process webhook
    const result = await processWebhook(event);
    
    if (result.success) {
      logger.info(
        { eventId: event.id, eventType: event.type, result },
        'Successfully processed Stripe webhook'
      );
      res.json({ received: true, message: result.message });
    } else {
      logger.error(
        { eventId: event.id, eventType: event.type, result },
        'Failed to process Stripe webhook'
      );
      res.status(400).json({ received: false, error: result.message });
    }
  } catch (error) {
    logger.error({ error }, 'Error processing Stripe webhook');
    res.status(400).json({ received: false, error: 'Invalid signature or payload' });
  }
}));

// Telegram webhook endpoint
app.post('/webhook/telegram', handleAsyncError(async (req, res) => {
  // Process the Telegram update
  await bot.handleUpdate(req.body);
  res.sendStatus(200);
}));

// Success page for Stripe checkout
app.get('/success', (req, res) => {
  const sessionId = req.query.session_id;
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Payment Successful!</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
                text-align: center;
                background-color: #f5f5f5;
            }
            .container {
                background: white;
                border-radius: 12px;
                padding: 40px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .success-icon {
                font-size: 64px;
                margin-bottom: 20px;
            }
            h1 {
                color: #28a745;
                margin-bottom: 20px;
            }
            p {
                color: #666;
                line-height: 1.6;
                margin-bottom: 20px;
            }
            .button {
                display: inline-block;
                background: #007bff;
                color: white;
                text-decoration: none;
                padding: 12px 24px;
                border-radius: 6px;
                font-weight: 500;
                margin-top: 20px;
            }
            .button:hover {
                background: #0056b3;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="success-icon">✅</div>
            <h1>Payment Successful!</h1>
            <p>
                <strong>Thank you for your purchase!</strong>
            </p>
            <p>
                Your content will be delivered to you via the Telegram bot within the next few minutes.
            </p>
            <p>
                If you don't receive your content, please contact support at @marcogirobondo or use the /help command in the bot.
            </p>
            <p>
                <strong>🔒 Remember:</strong> All content is protected - you cannot take screenshots or download videos.
            </p>
            <a href="https://t.me/${bot.botInfo?.username || 'bot'}" class="button">
                Back to Bot
            </a>
        </div>
    </body>
    </html>
  `);
});

// Cancel page for Stripe checkout
app.get('/cancel', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Payment Cancelled</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
                text-align: center;
                background-color: #f5f5f5;
            }
            .container {
                background: white;
                border-radius: 12px;
                padding: 40px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .cancel-icon {
                font-size: 64px;
                margin-bottom: 20px;
            }
            h1 {
                color: #dc3545;
                margin-bottom: 20px;
            }
            p {
                color: #666;
                line-height: 1.6;
                margin-bottom: 30px;
            }
            .button {
                display: inline-block;
                background: #007bff;
                color: white;
                text-decoration: none;
                padding: 12px 24px;
                border-radius: 6px;
                font-weight: 500;
                margin: 0 10px;
            }
            .button:hover {
                background: #0056b3;
            }
            .button.secondary {
                background: #6c757d;
            }
            .button.secondary:hover {
                background: #545b62;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="cancel-icon">❌</div>
            <h1>Pagamento Annullato</h1>
            <p>
                Il tuo pagamento è stato annullato. Nessun addebito è stato fatto sul tuo account.
            </p>
            <p>
                Puoi riprovare in qualsiasi momento o contattare il supporto se hai bisogno di assistenza.
            </p>
            <a href="https://t.me/${bot.botInfo?.username || 'bot'}" class="button">
                Torna al Bot
            </a>
            <a href="${APP_BASE_URL}" class="button secondary">
                Vai alla Homepage
            </a>
        </div>
    </body>
    </html>
  `);
});

// Root endpoint
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>DurianBot - Premium Membership Bot</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                max-width: 800px;
                margin: 0 auto;
                padding: 20px;
                background-color: #f5f5f5;
                line-height: 1.6;
            }
            .container {
                background: white;
                border-radius: 12px;
                padding: 40px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .header {
                text-align: center;
                margin-bottom: 40px;
            }
            .logo {
                font-size: 48px;
                margin-bottom: 10px;
            }
            h1 {
                color: #333;
                margin-bottom: 10px;
            }
            .subtitle {
                color: #666;
                font-size: 18px;
            }
            .features {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                gap: 20px;
                margin: 40px 0;
            }
            .feature {
                padding: 20px;
                background: #f8f9fa;
                border-radius: 8px;
                text-align: center;
            }
            .feature-icon {
                font-size: 32px;
                margin-bottom: 10px;
            }
            .cta {
                text-align: center;
                margin-top: 40px;
            }
            .button {
                display: inline-block;
                background: #007bff;
                color: white;
                text-decoration: none;
                padding: 15px 30px;
                border-radius: 8px;
                font-weight: 500;
                font-size: 18px;
            }
            .button:hover {
                background: #0056b3;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="logo">🤖</div>
                <h1>DurianBot</h1>
                <p class="subtitle">Premium Membership Bot for Telegram</p>
            </div>
            
            <div class="features">
                <div class="feature">
                    <div class="feature-icon">🔐</div>
                    <h3>Secure Access</h3>
                    <p>Automated subscription management with secure payment processing</p>
                </div>
                <div class="feature">
                    <div class="feature-icon">📱</div>
                    <h3>Easy Management</h3>
                    <p>Simple commands to view plans, manage subscriptions, and access content</p>
                </div>
                <div class="feature">
                    <div class="feature-icon">🎯</div>
                    <h3>Exclusive Content</h3>
                    <p>Access premium content and community with content protection</p>
                </div>
                <div class="feature">
                    <div class="feature-icon">⚡</div>
                    <h3>Instant Access</h3>
                    <p>Immediate access upon successful payment with automated invite links</p>
                </div>
            </div>
            
            <div class="cta">
                <a href="https://t.me/${bot.botInfo?.username || 'bot'}" class="button">
                    Start Your Subscription
                </a>
            </div>
        </div>
    </body>
    </html>
  `);
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error({ error, url: req.url, method: req.method }, 'Express error');
  res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info({ signal }, 'Received shutdown signal');
  
  try {
    // Stop accepting new requests
    server.close(async () => {
      logger.info('HTTP server closed');
      
      // Shutdown services
      await Promise.all([
        bot.stop(),
        shutdownJobs(),
        disconnectDatabase(),
      ]);
      
      logger.info('Graceful shutdown completed');
      process.exit(0);
    });
    
    // Force shutdown after 30 seconds
    setTimeout(() => {
      logger.error('Forced shutdown due to timeout');
      process.exit(1);
    }, 30000);
  } catch (error) {
    logger.error({ error }, 'Error during graceful shutdown');
    process.exit(1);
  }
};

// Initialize application
const initializeApp = async () => {
  try {
    logger.info('Initializing application...');
    
    // Check database connection
    const dbHealthy = await checkDatabaseConnection();
    if (!dbHealthy) {
      throw new Error('Database connection failed');
    }
    
    // Setup Stripe products and prices
    await stripeUtils.setupProducts();
    
    // Schedule recurring jobs
    await scheduleRecurringJobs();
    
    // Set up bot commands menu for regular users
    await bot.telegram.setMyCommands([
      { command: 'start', description: 'Start bot and view plans' },
      { command: 'account', description: 'View subscription details' },
      { command: 'my_unlocks', description: 'View purchased content' },
      { command: 'help', description: 'Get help information' },
    ]);
    
    // Set up admin commands menu for owner
    await bot.telegram.setMyCommands(
      [
        { command: 'start', description: 'Start bot and view plans' },
        { command: 'account', description: 'View subscription details' },
        { command: 'my_unlocks', description: 'View purchased content' },
        { command: 'post_locked', description: 'Create unlockable content (reply to media)' },
        { command: 'upload', description: 'Upload free content to group' },
        { command: 'broadcast', description: 'Send message to all subscribers' },
        { command: 'stats', description: 'View subscription statistics' },
        { command: 'analytics', description: 'View unlock analytics' },
        { command: 'help', description: 'Get help information' },
      ],
      { scope: { type: 'chat', chat_id: TELEGRAM_OWNER_ID } }
    );
    
    logger.info('Set bot commands menu');
    
    // Set up Telegram webhook if in production
    if (process.env.NODE_ENV === 'production') {
      const webhookUrl = `${APP_BASE_URL}/webhook/telegram`;
      await bot.telegram.setWebhook(webhookUrl);
      logger.info({ webhookUrl }, 'Set Telegram webhook');
    } else {
      // Start polling in development
      await bot.launch();
      logger.info('Started Telegram bot polling');
    }
    
    logger.info('Application initialized successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to initialize application');
    process.exit(1);
  }
};

// Start server
const server = app.listen(PORT, async () => {
  logger.info({ port: PORT }, 'Server started');
  await initializeApp();
});

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error({ error }, 'Uncaught exception');
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise }, 'Unhandled rejection');
  gracefulShutdown('unhandledRejection');
});

export default app;
import { STRIPE_WEBHOOK_SECRET, PORT, APP_BASE_URL, TELEGRAM_OWNER_ID } from './config';
import { logger, handleAsyncError } from './utils';
import { checkDatabaseConnection, disconnectDatabase } from './db';
import { stripeUtils } from './stripe';
import { processWebhook } from './webhooks';
import { scheduleRecurringJobs, shutdownJobs, getJobsHealth } from './jobs';
import bot from './bot';

const app = express();

// Middleware for Stripe webhooks (raw body)
app.use('/webhook/stripe', express.raw({ type: 'application/json' }));

// Middleware for other routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  logger.info(
    {
      method: req.method,
      url: req.url,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
    },
    'HTTP request'
  );
  next();
});

// Health check endpoint
app.get('/health', handleAsyncError(async (req, res) => {
  const dbHealthy = await checkDatabaseConnection();
  const jobsHealth = await getJobsHealth();
  
  const health = {
    status: dbHealthy && jobsHealth.status === 'healthy' ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    services: {
      database: dbHealthy ? 'healthy' : 'unhealthy',
      jobs: jobsHealth,
      telegram: 'healthy', // Assume healthy if we can respond
    },
  };

  res.status(health.status === 'healthy' ? 200 : 503).json(health);
}));

// Stripe webhook endpoint
app.post('/webhook/stripe', handleAsyncError(async (req, res) => {
  const signature = req.get('stripe-signature');
  
  if (!signature) {
    logger.warn('Missing Stripe signature');
    return res.status(400).send('Missing signature');
  }

  try {
    // Verify webhook signature
    const event = stripeUtils.verifyWebhookSignature(
      req.body.toString(),
      signature,
      STRIPE_WEBHOOK_SECRET
    );

    logger.info(
      { eventId: event.id, eventType: event.type },
      'Received Stripe webhook'
    );

    // Process webhook
    const result = await processWebhook(event);
    
    if (result.success) {
      logger.info(
        { eventId: event.id, eventType: event.type, result },
        'Successfully processed Stripe webhook'
      );
      res.json({ received: true, message: result.message });
    } else {
      logger.error(
        { eventId: event.id, eventType: event.type, result },
        'Failed to process Stripe webhook'
      );
      res.status(400).json({ received: false, error: result.message });
    }
  } catch (error) {
    logger.error({ error }, 'Error processing Stripe webhook');
    res.status(400).json({ received: false, error: 'Invalid signature or payload' });
  }
}));

// Telegram webhook endpoint
app.post('/webhook/telegram', handleAsyncError(async (req, res) => {
  // Process the Telegram update
  await bot.handleUpdate(req.body);
  res.sendStatus(200);
}));

// Success page for Stripe checkout
app.get('/success', (req, res) => {
  const sessionId = req.query.session_id;
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Payment Successful!</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
                text-align: center;
                background-color: #f5f5f5;
            }
            .container {
                background: white;
                border-radius: 12px;
                padding: 40px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .success-icon {
                font-size: 64px;
                margin-bottom: 20px;
            }
            h1 {
                color: #28a745;
                margin-bottom: 20px;
            }
            p {
                color: #666;
                line-height: 1.6;
                margin-bottom: 20px;
            }
            .button {
                display: inline-block;
                background: #007bff;
                color: white;
                text-decoration: none;
                padding: 12px 24px;
                border-radius: 6px;
                font-weight: 500;
                margin-top: 20px;
            }
            .button:hover {
                background: #0056b3;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="success-icon">✅</div>
            <h1>Payment Successful!</h1>
            <p>
                <strong>Thank you for your purchase!</strong>
            </p>
            <p>
                Your content will be delivered to you via the Telegram bot within the next few minutes.
            </p>
            <p>
                If you don't receive your content, please contact support at @marcogirobondo or use the /help command in the bot.
            </p>
            <p>
                <strong>🔒 Remember:</strong> All content is protected - you cannot take screenshots or download videos.
            </p>
            <a href="https://t.me/${bot.botInfo?.username || 'bot'}" class="button">
                Back to Bot
            </a>
        </div>
    </body>
    </html>
  `);
});

// Cancel page for Stripe checkout
app.get('/cancel', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Payment Cancelled</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
                text-align: center;
                background-color: #f5f5f5;
            }
            .container {
                background: white;
                border-radius: 12px;
                padding: 40px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .cancel-icon {
                font-size: 64px;
                margin-bottom: 20px;
            }
            h1 {
                color: #dc3545;
                margin-bottom: 20px;
            }
            p {
                color: #666;
                line-height: 1.6;
                margin-bottom: 30px;
            }
            .button {
                display: inline-block;
                background: #007bff;
                color: white;
                text-decoration: none;
                padding: 12px 24px;
                border-radius: 6px;
                font-weight: 500;
                margin: 0 10px;
            }
            .button:hover {
                background: #0056b3;
            }
            .button.secondary {
                background: #6c757d;
            }
            .button.secondary:hover {
                background: #545b62;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="cancel-icon">❌</div>
            <h1>Pagamento Annullato</h1>
            <p>
                Il tuo pagamento è stato annullato. Nessun addebito è stato fatto sul tuo account.
            </p>
            <p>
                Puoi riprovare in qualsiasi momento o contattare il supporto se hai bisogno di assistenza.
            </p>
            <a href="https://t.me/${bot.botInfo?.username || 'bot'}" class="button">
                Torna al Bot
            </a>
            <a href="${APP_BASE_URL}" class="button secondary">
                Vai alla Homepage
            </a>
        </div>
    </body>
    </html>
  `);
});

// Root endpoint
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>DurianBot - Premium Membership Bot</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                max-width: 800px;
                margin: 0 auto;
                padding: 20px;
                background-color: #f5f5f5;
                line-height: 1.6;
            }
            .container {
                background: white;
                border-radius: 12px;
                padding: 40px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .header {
                text-align: center;
                margin-bottom: 40px;
            }
            .logo {
                font-size: 48px;
                margin-bottom: 10px;
            }
            h1 {
                color: #333;
                margin-bottom: 10px;
            }
            .subtitle {
                color: #666;
                font-size: 18px;
            }
            .features {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                gap: 20px;
                margin: 40px 0;
            }
            .feature {
                padding: 20px;
                background: #f8f9fa;
                border-radius: 8px;
                text-align: center;
            }
            .feature-icon {
                font-size: 32px;
                margin-bottom: 10px;
            }
            .cta {
                text-align: center;
                margin-top: 40px;
            }
            .button {
                display: inline-block;
                background: #007bff;
                color: white;
                text-decoration: none;
                padding: 15px 30px;
                border-radius: 8px;
                font-weight: 500;
                font-size: 18px;
            }
            .button:hover {
                background: #0056b3;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="logo">🤖</div>
                <h1>DurianBot</h1>
                <p class="subtitle">Premium Membership Bot for Telegram</p>
            </div>
            
            <div class="features">
                <div class="feature">
                    <div class="feature-icon">🔐</div>
                    <h3>Secure Access</h3>
                    <p>Automated subscription management with secure payment processing</p>
                </div>
                <div class="feature">
                    <div class="feature-icon">📱</div>
                    <h3>Easy Management</h3>
                    <p>Simple commands to view plans, manage subscriptions, and access content</p>
                </div>
                <div class="feature">
                    <div class="feature-icon">🎯</div>
                    <h3>Exclusive Content</h3>
                    <p>Access premium content and community with content protection</p>
                </div>
                <div class="feature">
                    <div class="feature-icon">⚡</div>
                    <h3>Instant Access</h3>
                    <p>Immediate access upon successful payment with automated invite links</p>
                </div>
            </div>
            
            <div class="cta">
                <a href="https://t.me/${bot.botInfo?.username || 'bot'}" class="button">
                    Start Your Subscription
                </a>
            </div>
        </div>
    </body>
    </html>
  `);
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error({ error, url: req.url, method: req.method }, 'Express error');
  res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info({ signal }, 'Received shutdown signal');
  
  try {
    // Stop accepting new requests
    server.close(async () => {
      logger.info('HTTP server closed');
      
      // Shutdown services
      await Promise.all([
        bot.stop(),
        shutdownJobs(),
        disconnectDatabase(),
      ]);
      
      logger.info('Graceful shutdown completed');
      process.exit(0);
    });
    
    // Force shutdown after 30 seconds
    setTimeout(() => {
      logger.error('Forced shutdown due to timeout');
      process.exit(1);
    }, 30000);
  } catch (error) {
    logger.error({ error }, 'Error during graceful shutdown');
    process.exit(1);
  }
};

// Initialize application
const initializeApp = async () => {
  try {
    logger.info('Initializing application...');
    
    // Check database connection
    const dbHealthy = await checkDatabaseConnection();
    if (!dbHealthy) {
      throw new Error('Database connection failed');
    }
    
    // Setup Stripe products and prices
    await stripeUtils.setupProducts();
    
    // Schedule recurring jobs
    await scheduleRecurringJobs();
    
    // Set up bot commands menu for regular users
    await bot.telegram.setMyCommands([
      { command: 'start', description: 'Start bot and view plans' },
      { command: 'account', description: 'View subscription details' },
      { command: 'my_unlocks', description: 'View purchased content' },
      { command: 'help', description: 'Get help information' },
    ]);
    
    // Set up admin commands menu for owner
    await bot.telegram.setMyCommands(
      [
        { command: 'start', description: 'Start bot and view plans' },
        { command: 'account', description: 'View subscription details' },
        { command: 'my_unlocks', description: 'View purchased content' },
        { command: 'post_locked', description: 'Create unlockable content (reply to media)' },
        { command: 'upload', description: 'Upload free content to group' },
        { command: 'broadcast', description: 'Send message to all subscribers' },
        { command: 'stats', description: 'View subscription statistics' },
        { command: 'analytics', description: 'View unlock analytics' },
        { command: 'help', description: 'Get help information' },
      ],
      { scope: { type: 'chat', chat_id: TELEGRAM_OWNER_ID } }
    );
    
    logger.info('Set bot commands menu');
    
    // Set up Telegram webhook if in production
    if (process.env.NODE_ENV === 'production') {
      const webhookUrl = `${APP_BASE_URL}/webhook/telegram`;
      await bot.telegram.setWebhook(webhookUrl);
      logger.info({ webhookUrl }, 'Set Telegram webhook');
    } else {
      // Start polling in development
      await bot.launch();
      logger.info('Started Telegram bot polling');
    }
    
    logger.info('Application initialized successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to initialize application');
    process.exit(1);
  }
};

// Start server
const server = app.listen(PORT, async () => {
  logger.info({ port: PORT }, 'Server started');
  await initializeApp();
});

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error({ error }, 'Uncaught exception');
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise }, 'Unhandled rejection');
  gracefulShutdown('unhandledRejection');
});

export default app;