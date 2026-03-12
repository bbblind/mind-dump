import { vi } from 'vitest';
import dotenv from 'dotenv';

// Load test environment variables
dotenv.config({ path: '.env.test' });

// Mock external services
vi.mock('../src/config', () => ({
  TELEGRAM_BOT_TOKEN: 'test_bot_token',
  TELEGRAM_GROUP_ID: -1001234567890,
  TELEGRAM_OWNER_ID: 123456789,
  STRIPE_SECRET_KEY: 'sk_test_123',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_123',
  APP_BASE_URL: 'https://test.example.com',
  PORT: 3000,
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  CONTENT_WATERMARK_TEXT: '@TestBrand',
  GRACE_HOURS_ON_FAIL: 3,
  LOG_LEVEL: 'error',
}));

// Mock logger to reduce noise in tests
vi.mock('../src/utils', async () => {
  const actual = await vi.importActual('../src/utils');
  return {
    ...actual,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  };
});

// Global test setup
beforeEach(() => {
  // Reset all mocks before each test
  vi.clearAllMocks();
});