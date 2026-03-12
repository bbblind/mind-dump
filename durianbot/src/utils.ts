import pino from 'pino';
import { LOG_LEVEL, NODE_ENV } from './config';

// Logger setup
export const logger = pino({
  level: LOG_LEVEL,
  transport: NODE_ENV === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss Z',
      ignore: 'pid,hostname',
    },
  } : undefined,
});

// Date utilities
export const addHours = (date: Date, hours: number): Date => {
  const result = new Date(date);
  result.setHours(result.getHours() + hours);
  return result;
};

export const addDays = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

export const addMonths = (date: Date, months: number): Date => {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
};

export const isExpired = (date: Date): boolean => {
  return date < new Date();
};

// Format utilities
export const formatCurrency = (cents: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
};

export const formatDate = (date: Date): string => {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

// Telegram utilities
export const escapeMarkdown = (text: string): string => {
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
};

// List of admin/owner Telegram IDs
const OWNER_IDS = [
  parseInt(process.env.TELEGRAM_OWNER_ID || '0', 10),
  6644911896,  // @joa dani
  894179953,   // @marcogirobondo
];

export const isOwner = (telegramId: number): boolean => {
  const result = OWNER_IDS.includes(telegramId);
  logger.info({ telegramId, OWNER_IDS, result }, 'isOwner check');
  return result;
};

// Error handling utilities
export class AppError extends Error {
  constructor(
    message: string,
    public code: string = 'UNKNOWN_ERROR',
    public statusCode: number = 500
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const handleAsyncError = <T extends any[], R>(
  fn: (...args: T) => Promise<R>
) => {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args);
    } catch (error) {
      logger.error({ error, args }, 'Async operation failed');
      throw error;
    }
  };
};

// Retry utilities
export const retry = async <T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  delayMs: number = 1000
): Promise<T> => {
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === maxAttempts) {
        break;
      }
      
      logger.warn(
        { error, attempt, maxAttempts },
        `Attempt ${attempt} failed, retrying in ${delayMs}ms`
      );
      
      await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
    }
  }
  
  throw lastError!;
};

// Validation utilities
export const validateTelegramId = (id: unknown): id is number => {
  return typeof id === 'number' && Number.isInteger(id) && id > 0;
};

export const validateStripeCustomerId = (id: unknown): id is string => {
  return typeof id === 'string' && id.startsWith('cus_');
};

export const validateStripeSubscriptionId = (id: unknown): id is string => {
  return typeof id === 'string' && id.startsWith('sub_');
};

// Sleep utility for rate limiting
export const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

// Safe JSON parsing
export const safeJsonParse = <T>(json: string, fallback: T): T => {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
};

// Generate secure random string
export const generateSecureId = (length: number = 32): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

