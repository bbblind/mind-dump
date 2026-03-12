# DurianBot 🤖

A production-ready Telegram membership bot with Stripe subscriptions that automatically manages access to private groups/channels. Users who stop paying are auto-removed, and the bot handles content protection with optional watermarking.

## ✨ Features

- 🔐 **Automated Access Control**: Auto-grant and revoke access based on subscription status
- 💳 **Stripe Integration**: Secure subscription payments with webhook handling
- 📱 **Content Protection**: Protected media uploads with optional watermarking
- 🔄 **Auto-Renewal**: Handles subscription renewals and failed payments
- 📊 **Analytics**: Track subscribers, revenue, and engagement
- 🚀 **Production Ready**: Docker deployment with Redis job queue
- 🛡️ **Secure**: Webhook signature verification and input validation
- 📈 **Scalable**: Built with TypeScript, Prisma, and BullMQ

## 🏗️ Architecture

- **Node.js 20** + **TypeScript** - Modern runtime and type safety
- **Telegraf** - Telegram Bot API framework
- **Express** - HTTP server for webhooks and web pages
- **Prisma** - Type-safe database ORM
- **PostgreSQL** - Production database
- **Redis** - Job queue and caching
- **BullMQ** - Background job processing
- **Stripe** - Payment processing
- **FFmpeg** - Optional media watermarking
- **Docker** - Containerized deployment

## 📋 Prerequisites

- Node.js 20+
- Docker and Docker Compose
- Telegram Bot Token (from @BotFather)
- Stripe Account with API keys
- Domain with SSL certificate (for webhooks)

## 🚀 Quick Start

### 1. Clone and Setup

```bash
git clone <repository-url>
cd durianbot
cp env.example .env
```

### 2. Configure Environment

Edit `.env` with your configuration:

```bash
# Telegram Configuration
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_GROUP_ID=-1001234567890    # Your private group/channel ID
TELEGRAM_OWNER_ID=123456789         # Your Telegram user ID

# Stripe Configuration
STRIPE_SECRET_KEY=sk_live_your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
STRIPE_PUBLISHABLE_KEY=pk_live_your_publishable_key

# Application Configuration
APP_BASE_URL=https://yourdomain.com
PORT=3000
NODE_ENV=production

# Database Configuration (auto-configured in Docker)
DATABASE_URL=postgresql://durianbot:password@db:5432/durianbot
DB_PASSWORD=your_secure_password

# Redis Configuration (auto-configured in Docker)
REDIS_URL=redis://redis:6379

# Content Configuration
CONTENT_WATERMARK_TEXT=@YourBrand   # Optional watermark text
GRACE_HOURS_ON_FAIL=3               # Hours before removal after failed payment
```

### 3. Create Telegram Bot

1. Message @BotFather on Telegram
2. Create a new bot: `/newbot`
3. Follow prompts to set name and username
4. Copy the bot token to your `.env` file
5. Set bot commands:
   ```
   /setcommands
   start - View subscription plans
   plans - Show available plans  
   account - Manage your subscription
   help - Show help message
   ```

### 4. Setup Telegram Group/Channel

1. Create a private group or channel
2. Add your bot as an administrator with these permissions:
   - ✅ Invite users via link
   - ✅ Ban users
   - ✅ Delete messages
   - ✅ Pin messages
3. Get the group/channel ID:
   - Add @userinfobot to your group
   - Copy the group ID (negative number)
   - Remove @userinfobot
   - Add the ID to `TELEGRAM_GROUP_ID` in your `.env`
4. **IMPORTANT**: Enable "Restrict Saving Content" in group settings:
   - Go to group settings → Permissions
   - Turn on "Restrict Saving Content"

### 5. Configure Stripe

1. Create a Stripe account and get your API keys
2. Add keys to your `.env` file
3. Create webhook endpoint in Stripe Dashboard:
   - URL: `https://yourdomain.com/webhook/stripe`
   - Events to send:
     - `checkout.session.completed`
     - `invoice.paid`
     - `invoice.payment_failed`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
   - Copy webhook signing secret to `.env`

### 6. Deploy with Docker

```bash
# Build and start all services
docker compose up -d

# Check logs
docker compose logs -f app

# Run database migrations
docker compose exec app npx prisma migrate deploy

# Seed initial data (creates Stripe products and plans)
docker compose exec app npm run seed
```

### 7. Set Telegram Webhook

```bash
# Set webhook (replace with your domain)
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://yourdomain.com/webhook/telegram"}'
```

### 8. Test the Bot

1. Start a chat with your bot on Telegram
2. Send `/start` to see subscription plans
3. Test the subscription flow
4. Upload media as owner to test content posting

## 🔧 Development Setup

### Local Development

```bash
# Install dependencies
npm install

# Setup database
npx prisma migrate dev
npx prisma generate

# Seed data
npm run seed

# Start development server
npm run dev
```

### Development with Docker

```bash
# Start with development profile
docker compose --profile dev up -d

# Access services:
# - App: http://localhost:3000
# - Adminer (DB): http://localhost:8080
# - Redis Commander: http://localhost:8081
```

### Running Tests

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage
```

## 📱 Bot Commands

### User Commands

- `/start` - View subscription plans and get started
- `/plans` - Show available subscription plans
- `/account` - View subscription status and manage billing
- `/help` - Show help message with available commands

### Owner Commands (Admin Only)

- `/upload` - Upload photos/videos to the group with protection
- `/broadcast <message>` - Send protected message to group
- `/stats` - View bot statistics (users, revenue, etc.)

### Usage Examples

```bash
# Owner uploads content
/upload
# Then send photo/video with optional caption

# Owner broadcasts message
/broadcast Welcome to our premium community! 🎉

# User checks subscription
/account
```

## 🔄 Subscription Flow

1. **User starts bot** → Sees available plans
2. **Selects plan** → Redirected to Stripe Checkout
3. **Completes payment** → Webhook creates subscription
4. **Bot grants access** → Creates single-use invite link
5. **User joins group** → Gets access to premium content
6. **Subscription renews** → Access automatically extended
7. **Payment fails** → Grace period starts, user notified
8. **Grace period ends** → User removed from group

## 💾 Database Schema

### Core Models

- **User** - Telegram user information
- **Plan** - Subscription plans with Stripe price IDs  
- **Subscription** - Active subscriptions with status
- **InviteToken** - Single-use group invite links
- **MediaPost** - Posted content history
- **WebhookEvent** - Webhook processing idempotency

### Key Features

- Automatic subscription status tracking
- Single-use invite links with expiration
- Webhook event deduplication
- Media content logging

## 🔐 Security Features

- **Webhook Signature Verification** - All Stripe webhooks verified
- **Input Validation** - Zod schemas for all inputs
- **Content Protection** - Telegram's built-in protection + optional watermarks
- **Single-Use Invites** - Each invite link works only once
- **Rate Limiting** - Nginx rate limiting for API endpoints
- **Access Control** - Owner-only commands properly restricted

## 🚨 Monitoring & Health Checks

### Health Check Endpoint

```bash
curl https://yourdomain.com/health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "services": {
    "database": "healthy",
    "jobs": {
      "status": "healthy",
      "queues": {
        "waiting": 0,
        "active": 1,
        "completed": 145,
        "failed": 2
      }
    },
    "telegram": "healthy"
  }
}
```

### Logs

```bash
# View application logs
docker compose logs -f app

# View all service logs
docker compose logs -f

# View specific service
docker compose logs -f db
```

## 🔧 Configuration Options

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather | Required |
| `TELEGRAM_GROUP_ID` | Private group/channel ID | Required |
| `TELEGRAM_OWNER_ID` | Owner Telegram user ID | Required |
| `STRIPE_SECRET_KEY` | Stripe secret key | Required |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook secret | Required |
| `APP_BASE_URL` | Public URL for webhooks | Required |
| `CONTENT_WATERMARK_TEXT` | Watermark text for media | Optional |
| `GRACE_HOURS_ON_FAIL` | Grace period for failed payments | `3` |
| `PORT` | HTTP server port | `3000` |
| `LOG_LEVEL` | Logging level | `info` |

### Subscription Plans

Default plans are created during seeding:
- **Piano Mensile**: $15.99/month (rinnovo automatico mensile)
- **Piano 3 Mesi**: $35.99 every 3 months (rinnovo automatico ogni 3 mesi)

Modify in `src/config.ts` and re-run seed script.

### 🇮🇹 Italian Localization
- All bot messages are in Italian
- Automatic subscription renewal messaging
- Clear content protection warnings
- Cancellation policy clearly communicated

## 🔄 Background Jobs

The bot runs several background jobs:

- **Subscription Check** (hourly) - Verify subscription status and remove expired users
- **Payment Retry** (on failure) - Retry failed payments with exponential backoff  
- **Cleanup** (daily) - Remove old webhook events and media records
- **User Removal** (scheduled) - Remove users after grace period

## 📊 Analytics & Metrics

View statistics with `/stats` command:
- Total users
- Active subscriptions  
- Monthly recurring revenue
- Recent signups (30 days)
- Failed renewals

## 🛠️ Troubleshooting

### Common Issues

**Bot not responding:**
```bash
# Check if webhook is set correctly
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"

# Check application logs
docker compose logs -f app
```

**Stripe webhooks failing:**
```bash
# Verify webhook endpoint
curl https://yourdomain.com/health

# Check webhook secret in Stripe dashboard
# Verify events are configured correctly
```

**Database connection issues:**
```bash
# Check database health
docker compose exec db pg_isready -U durianbot

# Run migrations
docker compose exec app npx prisma migrate deploy
```

**Redis connection issues:**
```bash
# Check Redis health
docker compose exec redis redis-cli ping

# View job queue status
docker compose logs -f app | grep "job"
```

### Debug Mode

Enable debug logging:
```bash
# Set in .env
LOG_LEVEL=debug

# Restart application
docker compose restart app
```

## 🚀 Deployment

### Production Checklist

- [ ] Domain with valid SSL certificate
- [ ] Stripe webhook endpoint configured
- [ ] Telegram webhook set to your domain
- [ ] Environment variables configured
- [ ] Database backups configured
- [ ] Monitoring set up
- [ ] Bot added as admin to group with correct permissions
- [ ] Group content protection enabled

### SSL Certificate Setup

Using Let's Encrypt with Certbot:

```bash
# Install certbot
sudo apt-get update
sudo apt-get install certbot

# Get certificate
sudo certbot certonly --standalone -d yourdomain.com

# Copy certificates to Docker volume
sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem docker/ssl/cert.pem
sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem docker/ssl/key.pem

# Start with nginx
docker compose --profile nginx up -d
```

### Database Backups

```bash
# Create backup
docker compose exec db pg_dump -U durianbot durianbot > backup.sql

# Restore backup
docker compose exec -T db psql -U durianbot durianbot < backup.sql
```

### Scaling

For high-traffic deployments:
- Use managed PostgreSQL (AWS RDS, Google Cloud SQL)
- Use managed Redis (AWS ElastiCache, Redis Cloud)
- Deploy multiple app instances behind load balancer
- Monitor with tools like Datadog, New Relic

## 📄 License

MIT License - see LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 🆘 Support

For issues and questions:
1. Check the troubleshooting section
2. Review application logs
3. Open an issue on GitHub
4. Join our community Discord

---

**Built with ❤️ for the Telegram community**

A production-ready Telegram membership bot with Stripe subscriptions that automatically manages access to private groups/channels. Users who stop paying are auto-removed, and the bot handles content protection with optional watermarking.

## ✨ Features

- 🔐 **Automated Access Control**: Auto-grant and revoke access based on subscription status
- 💳 **Stripe Integration**: Secure subscription payments with webhook handling
- 📱 **Content Protection**: Protected media uploads with optional watermarking
- 🔄 **Auto-Renewal**: Handles subscription renewals and failed payments
- 📊 **Analytics**: Track subscribers, revenue, and engagement
- 🚀 **Production Ready**: Docker deployment with Redis job queue
- 🛡️ **Secure**: Webhook signature verification and input validation
- 📈 **Scalable**: Built with TypeScript, Prisma, and BullMQ

## 🏗️ Architecture

- **Node.js 20** + **TypeScript** - Modern runtime and type safety
- **Telegraf** - Telegram Bot API framework
- **Express** - HTTP server for webhooks and web pages
- **Prisma** - Type-safe database ORM
- **PostgreSQL** - Production database
- **Redis** - Job queue and caching
- **BullMQ** - Background job processing
- **Stripe** - Payment processing
- **FFmpeg** - Optional media watermarking
- **Docker** - Containerized deployment

## 📋 Prerequisites

- Node.js 20+
- Docker and Docker Compose
- Telegram Bot Token (from @BotFather)
- Stripe Account with API keys
- Domain with SSL certificate (for webhooks)

## 🚀 Quick Start

### 1. Clone and Setup

```bash
git clone <repository-url>
cd durianbot
cp env.example .env
```

### 2. Configure Environment

Edit `.env` with your configuration:

```bash
# Telegram Configuration
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_GROUP_ID=-1001234567890    # Your private group/channel ID
TELEGRAM_OWNER_ID=123456789         # Your Telegram user ID

# Stripe Configuration
STRIPE_SECRET_KEY=sk_live_your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
STRIPE_PUBLISHABLE_KEY=pk_live_your_publishable_key

# Application Configuration
APP_BASE_URL=https://yourdomain.com
PORT=3000
NODE_ENV=production

# Database Configuration (auto-configured in Docker)
DATABASE_URL=postgresql://durianbot:password@db:5432/durianbot
DB_PASSWORD=your_secure_password

# Redis Configuration (auto-configured in Docker)
REDIS_URL=redis://redis:6379

# Content Configuration
CONTENT_WATERMARK_TEXT=@YourBrand   # Optional watermark text
GRACE_HOURS_ON_FAIL=3               # Hours before removal after failed payment
```

### 3. Create Telegram Bot

1. Message @BotFather on Telegram
2. Create a new bot: `/newbot`
3. Follow prompts to set name and username
4. Copy the bot token to your `.env` file
5. Set bot commands:
   ```
   /setcommands
   start - View subscription plans
   plans - Show available plans  
   account - Manage your subscription
   help - Show help message
   ```

### 4. Setup Telegram Group/Channel

1. Create a private group or channel
2. Add your bot as an administrator with these permissions:
   - ✅ Invite users via link
   - ✅ Ban users
   - ✅ Delete messages
   - ✅ Pin messages
3. Get the group/channel ID:
   - Add @userinfobot to your group
   - Copy the group ID (negative number)
   - Remove @userinfobot
   - Add the ID to `TELEGRAM_GROUP_ID` in your `.env`
4. **IMPORTANT**: Enable "Restrict Saving Content" in group settings:
   - Go to group settings → Permissions
   - Turn on "Restrict Saving Content"

### 5. Configure Stripe

1. Create a Stripe account and get your API keys
2. Add keys to your `.env` file
3. Create webhook endpoint in Stripe Dashboard:
   - URL: `https://yourdomain.com/webhook/stripe`
   - Events to send:
     - `checkout.session.completed`
     - `invoice.paid`
     - `invoice.payment_failed`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
   - Copy webhook signing secret to `.env`

### 6. Deploy with Docker

```bash
# Build and start all services
docker compose up -d

# Check logs
docker compose logs -f app

# Run database migrations
docker compose exec app npx prisma migrate deploy

# Seed initial data (creates Stripe products and plans)
docker compose exec app npm run seed
```

### 7. Set Telegram Webhook

```bash
# Set webhook (replace with your domain)
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://yourdomain.com/webhook/telegram"}'
```

### 8. Test the Bot

1. Start a chat with your bot on Telegram
2. Send `/start` to see subscription plans
3. Test the subscription flow
4. Upload media as owner to test content posting

## 🔧 Development Setup

### Local Development

```bash
# Install dependencies
npm install

# Setup database
npx prisma migrate dev
npx prisma generate

# Seed data
npm run seed

# Start development server
npm run dev
```

### Development with Docker

```bash
# Start with development profile
docker compose --profile dev up -d

# Access services:
# - App: http://localhost:3000
# - Adminer (DB): http://localhost:8080
# - Redis Commander: http://localhost:8081
```

### Running Tests

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage
```

## 📱 Bot Commands

### User Commands

- `/start` - View subscription plans and get started
- `/plans` - Show available subscription plans
- `/account` - View subscription status and manage billing
- `/help` - Show help message with available commands

### Owner Commands (Admin Only)

- `/upload` - Upload photos/videos to the group with protection
- `/broadcast <message>` - Send protected message to group
- `/stats` - View bot statistics (users, revenue, etc.)

### Usage Examples

```bash
# Owner uploads content
/upload
# Then send photo/video with optional caption

# Owner broadcasts message
/broadcast Welcome to our premium community! 🎉

# User checks subscription
/account
```

## 🔄 Subscription Flow

1. **User starts bot** → Sees available plans
2. **Selects plan** → Redirected to Stripe Checkout
3. **Completes payment** → Webhook creates subscription
4. **Bot grants access** → Creates single-use invite link
5. **User joins group** → Gets access to premium content
6. **Subscription renews** → Access automatically extended
7. **Payment fails** → Grace period starts, user notified
8. **Grace period ends** → User removed from group

## 💾 Database Schema

### Core Models

- **User** - Telegram user information
- **Plan** - Subscription plans with Stripe price IDs  
- **Subscription** - Active subscriptions with status
- **InviteToken** - Single-use group invite links
- **MediaPost** - Posted content history
- **WebhookEvent** - Webhook processing idempotency

### Key Features

- Automatic subscription status tracking
- Single-use invite links with expiration
- Webhook event deduplication
- Media content logging

## 🔐 Security Features

- **Webhook Signature Verification** - All Stripe webhooks verified
- **Input Validation** - Zod schemas for all inputs
- **Content Protection** - Telegram's built-in protection + optional watermarks
- **Single-Use Invites** - Each invite link works only once
- **Rate Limiting** - Nginx rate limiting for API endpoints
- **Access Control** - Owner-only commands properly restricted

## 🚨 Monitoring & Health Checks

### Health Check Endpoint

```bash
curl https://yourdomain.com/health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "services": {
    "database": "healthy",
    "jobs": {
      "status": "healthy",
      "queues": {
        "waiting": 0,
        "active": 1,
        "completed": 145,
        "failed": 2
      }
    },
    "telegram": "healthy"
  }
}
```

### Logs

```bash
# View application logs
docker compose logs -f app

# View all service logs
docker compose logs -f

# View specific service
docker compose logs -f db
```

## 🔧 Configuration Options

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather | Required |
| `TELEGRAM_GROUP_ID` | Private group/channel ID | Required |
| `TELEGRAM_OWNER_ID` | Owner Telegram user ID | Required |
| `STRIPE_SECRET_KEY` | Stripe secret key | Required |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook secret | Required |
| `APP_BASE_URL` | Public URL for webhooks | Required |
| `CONTENT_WATERMARK_TEXT` | Watermark text for media | Optional |
| `GRACE_HOURS_ON_FAIL` | Grace period for failed payments | `3` |
| `PORT` | HTTP server port | `3000` |
| `LOG_LEVEL` | Logging level | `info` |

### Subscription Plans

Default plans are created during seeding:
- **Piano Mensile**: $15.99/month (rinnovo automatico mensile)
- **Piano 3 Mesi**: $35.99 every 3 months (rinnovo automatico ogni 3 mesi)

Modify in `src/config.ts` and re-run seed script.

### 🇮🇹 Italian Localization
- All bot messages are in Italian
- Automatic subscription renewal messaging
- Clear content protection warnings
- Cancellation policy clearly communicated

## 🔄 Background Jobs

The bot runs several background jobs:

- **Subscription Check** (hourly) - Verify subscription status and remove expired users
- **Payment Retry** (on failure) - Retry failed payments with exponential backoff  
- **Cleanup** (daily) - Remove old webhook events and media records
- **User Removal** (scheduled) - Remove users after grace period

## 📊 Analytics & Metrics

View statistics with `/stats` command:
- Total users
- Active subscriptions  
- Monthly recurring revenue
- Recent signups (30 days)
- Failed renewals

## 🛠️ Troubleshooting

### Common Issues

**Bot not responding:**
```bash
# Check if webhook is set correctly
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"

# Check application logs
docker compose logs -f app
```

**Stripe webhooks failing:**
```bash
# Verify webhook endpoint
curl https://yourdomain.com/health

# Check webhook secret in Stripe dashboard
# Verify events are configured correctly
```

**Database connection issues:**
```bash
# Check database health
docker compose exec db pg_isready -U durianbot

# Run migrations
docker compose exec app npx prisma migrate deploy
```

**Redis connection issues:**
```bash
# Check Redis health
docker compose exec redis redis-cli ping

# View job queue status
docker compose logs -f app | grep "job"
```

### Debug Mode

Enable debug logging:
```bash
# Set in .env
LOG_LEVEL=debug

# Restart application
docker compose restart app
```

## 🚀 Deployment

### Production Checklist

- [ ] Domain with valid SSL certificate
- [ ] Stripe webhook endpoint configured
- [ ] Telegram webhook set to your domain
- [ ] Environment variables configured
- [ ] Database backups configured
- [ ] Monitoring set up
- [ ] Bot added as admin to group with correct permissions
- [ ] Group content protection enabled

### SSL Certificate Setup

Using Let's Encrypt with Certbot:

```bash
# Install certbot
sudo apt-get update
sudo apt-get install certbot

# Get certificate
sudo certbot certonly --standalone -d yourdomain.com

# Copy certificates to Docker volume
sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem docker/ssl/cert.pem
sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem docker/ssl/key.pem

# Start with nginx
docker compose --profile nginx up -d
```

### Database Backups

```bash
# Create backup
docker compose exec db pg_dump -U durianbot durianbot > backup.sql

# Restore backup
docker compose exec -T db psql -U durianbot durianbot < backup.sql
```

### Scaling

For high-traffic deployments:
- Use managed PostgreSQL (AWS RDS, Google Cloud SQL)
- Use managed Redis (AWS ElastiCache, Redis Cloud)
- Deploy multiple app instances behind load balancer
- Monitor with tools like Datadog, New Relic

## 📄 License

MIT License - see LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 🆘 Support

For issues and questions:
1. Check the troubleshooting section
2. Review application logs
3. Open an issue on GitHub
4. Join our community Discord

---

**Built with ❤️ for the Telegram community**