import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const configSchema = z.object({
  // Telegram Configuration
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'Telegram bot token is required'),
  TELEGRAM_GROUP_ID: z.string().transform((val) => parseInt(val, 10)),
  TELEGRAM_OWNER_ID: z.string().transform((val) => parseInt(val, 10)),

  // Stripe Configuration
  STRIPE_SECRET_KEY: z.string().min(1, 'Stripe secret key is required'),
  STRIPE_WEBHOOK_SECRET: z.string().min(1, 'Stripe webhook secret is required'),
  STRIPE_PUBLISHABLE_KEY: z.string().min(1, 'Stripe publishable key is required'),

  // Application Configuration
  APP_BASE_URL: z.string().url('Valid base URL is required'),
  PORT: z.string().default('3000').transform((val) => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Database Configuration
  DATABASE_URL: z.string().min(1, 'Database URL is required'),

  // Redis Configuration
  REDIS_URL: z.string().min(1, 'Redis URL is required'),

  // Content Configuration
  CONTENT_WATERMARK_TEXT: z.string().optional(),
  GRACE_HOURS_ON_FAIL: z.string().default('3').transform((val) => parseInt(val, 10)),

  // Logging
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

type Config = z.infer<typeof configSchema>;

let config: Config;

try {
  config = configSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('❌ Invalid environment configuration:');
    error.errors.forEach((err) => {
      console.error(`  ${err.path.join('.')}: ${err.message}`);
    });
    process.exit(1);
  }
  throw error;
}

export default config;

// Type-safe environment variables
export const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_GROUP_ID,
  TELEGRAM_OWNER_ID,
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  STRIPE_PUBLISHABLE_KEY,
  APP_BASE_URL,
  PORT,
  NODE_ENV,
  DATABASE_URL,
  REDIS_URL,
  CONTENT_WATERMARK_TEXT,
  GRACE_HOURS_ON_FAIL,
  LOG_LEVEL,
} = config;

// Helper functions
export const isDevelopment = () => NODE_ENV === 'development';
export const isProduction = () => NODE_ENV === 'production';
export const isTest = () => NODE_ENV === 'test';

// Validate required Telegram permissions
export const REQUIRED_BOT_PERMISSIONS = [
  'can_invite_users',
  'can_restrict_members',
  'can_delete_messages',
  'can_pin_messages',
] as const;

// Subscription plans configuration
export const DEFAULT_PLANS = [
  {
    name: 'Piano Mensile',
    interval: 'month' as const,
    priceCents: 1599, // $15.99
  },
  {
    name: 'Piano 3 Mesi',
    interval: 'month' as const,
    priceCents: 3599, // $35.99 (billed monthly for 3 months)
    intervalCount: 3,
  },
] as const;
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const configSchema = z.object({
  // Telegram Configuration
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'Telegram bot token is required'),
  TELEGRAM_GROUP_ID: z.string().transform((val) => parseInt(val, 10)),
  TELEGRAM_OWNER_ID: z.string().transform((val) => parseInt(val, 10)),

  // Stripe Configuration
  STRIPE_SECRET_KEY: z.string().min(1, 'Stripe secret key is required'),
  STRIPE_WEBHOOK_SECRET: z.string().min(1, 'Stripe webhook secret is required'),
  STRIPE_PUBLISHABLE_KEY: z.string().min(1, 'Stripe publishable key is required'),

  // Application Configuration
  APP_BASE_URL: z.string().url('Valid base URL is required'),
  PORT: z.string().default('3000').transform((val) => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Database Configuration
  DATABASE_URL: z.string().min(1, 'Database URL is required'),

  // Redis Configuration
  REDIS_URL: z.string().min(1, 'Redis URL is required'),

  // Content Configuration
  CONTENT_WATERMARK_TEXT: z.string().optional(),
  GRACE_HOURS_ON_FAIL: z.string().default('3').transform((val) => parseInt(val, 10)),

  // Logging
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

type Config = z.infer<typeof configSchema>;

let config: Config;

try {
  config = configSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('❌ Invalid environment configuration:');
    error.errors.forEach((err) => {
      console.error(`  ${err.path.join('.')}: ${err.message}`);
    });
    process.exit(1);
  }
  throw error;
}

export default config;

// Type-safe environment variables
export const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_GROUP_ID,
  TELEGRAM_OWNER_ID,
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  STRIPE_PUBLISHABLE_KEY,
  APP_BASE_URL,
  PORT,
  NODE_ENV,
  DATABASE_URL,
  REDIS_URL,
  CONTENT_WATERMARK_TEXT,
  GRACE_HOURS_ON_FAIL,
  LOG_LEVEL,
} = config;

// Helper functions
export const isDevelopment = () => NODE_ENV === 'development';
export const isProduction = () => NODE_ENV === 'production';
export const isTest = () => NODE_ENV === 'test';

// Validate required Telegram permissions
export const REQUIRED_BOT_PERMISSIONS = [
  'can_invite_users',
  'can_restrict_members',
  'can_delete_messages',
  'can_pin_messages',
] as const;

// Subscription plans configuration
export const DEFAULT_PLANS = [
  {
    name: 'Piano Mensile',
    interval: 'month' as const,
    priceCents: 1599, // $15.99
  },
  {
    name: 'Piano 3 Mesi',
    interval: 'month' as const,
    priceCents: 3599, // $35.99 (billed monthly for 3 months)
    intervalCount: 3,
  },
] as const;