import { PrismaClient } from '@prisma/client';
import { stripeUtils } from '../src/stripe';
import { DEFAULT_PLANS } from '../src/config';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  try {
    // Setup Stripe products and prices
    console.log('📦 Setting up Stripe products and prices...');
    const { product, prices } = await stripeUtils.setupProducts();
    console.log(`✅ Created product: ${product.name} (${product.id})`);

    // Verify plans are in database
    const dbPlans = await prisma.plan.findMany();
    console.log(`✅ Created ${dbPlans.length} subscription plans:`);
    
    for (const plan of dbPlans) {
      const price = plan.priceCents / 100;
      console.log(`   - ${plan.name}: $${price}/${plan.interval.toLowerCase()}`);
    }

    // Create a test user (optional - for development)
    if (process.env.NODE_ENV === 'development') {
      const testTelegramId = process.env.TEST_TELEGRAM_ID;
      if (testTelegramId) {
        const testUser = await prisma.user.upsert({
          where: { telegramId: BigInt(testTelegramId) },
          update: {
            username: 'testuser',
            firstName: 'Test',
            lastName: 'User',
          },
          create: {
            telegramId: BigInt(testTelegramId),
            username: 'testuser',
            firstName: 'Test',
            lastName: 'User',
          },
        });
        console.log(`✅ Created test user: ${testUser.username} (${testUser.id})`);
      }
    }

    console.log('🎉 Database seed completed successfully!');
  } catch (error) {
    console.error('❌ Error during database seed:', error);
    throw error;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
import { stripeUtils } from '../src/stripe';
import { DEFAULT_PLANS } from '../src/config';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  try {
    // Setup Stripe products and prices
    console.log('📦 Setting up Stripe products and prices...');
    const { product, prices } = await stripeUtils.setupProducts();
    console.log(`✅ Created product: ${product.name} (${product.id})`);

    // Verify plans are in database
    const dbPlans = await prisma.plan.findMany();
    console.log(`✅ Created ${dbPlans.length} subscription plans:`);
    
    for (const plan of dbPlans) {
      const price = plan.priceCents / 100;
      console.log(`   - ${plan.name}: $${price}/${plan.interval.toLowerCase()}`);
    }

    // Create a test user (optional - for development)
    if (process.env.NODE_ENV === 'development') {
      const testTelegramId = process.env.TEST_TELEGRAM_ID;
      if (testTelegramId) {
        const testUser = await prisma.user.upsert({
          where: { telegramId: BigInt(testTelegramId) },
          update: {
            username: 'testuser',
            firstName: 'Test',
            lastName: 'User',
          },
          create: {
            telegramId: BigInt(testTelegramId),
            username: 'testuser',
            firstName: 'Test',
            lastName: 'User',
          },
        });
        console.log(`✅ Created test user: ${testUser.username} (${testUser.id})`);
      }
    }

    console.log('🎉 Database seed completed successfully!');
  } catch (error) {
    console.error('❌ Error during database seed:', error);
    throw error;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });