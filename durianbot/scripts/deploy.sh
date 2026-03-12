#!/bin/bash

# DurianBot Deployment Script
# This script helps deploy the bot to a production environment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if .env file exists
if [ ! -f .env ]; then
    print_error ".env file not found! Please copy env.example to .env and configure it."
    exit 1
fi

# Load environment variables
source .env

# Validate required environment variables
required_vars=(
    "TELEGRAM_BOT_TOKEN"
    "TELEGRAM_GROUP_ID"
    "TELEGRAM_OWNER_ID"
    "STRIPE_SECRET_KEY"
    "STRIPE_WEBHOOK_SECRET"
    "APP_BASE_URL"
)

print_status "Validating environment variables..."
for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        print_error "Required environment variable $var is not set!"
        exit 1
    fi
done
print_success "Environment variables validated"

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    print_error "Docker is not running! Please start Docker and try again."
    exit 1
fi

print_status "Building and starting services..."
docker compose down --remove-orphans
docker compose build --no-cache
docker compose up -d

# Wait for services to be healthy
print_status "Waiting for services to start..."
sleep 10

# Check service health
print_status "Checking service health..."
if ! docker compose exec app curl -f http://localhost:3000/health > /dev/null 2>&1; then
    print_error "Application health check failed!"
    print_status "Checking logs..."
    docker compose logs app
    exit 1
fi

# Run database migrations
print_status "Running database migrations..."
docker compose exec app npx prisma migrate deploy

# Generate Prisma client
print_status "Generating Prisma client..."
docker compose exec app npx prisma generate

# Seed database
print_status "Seeding database with initial data..."
docker compose exec app npm run seed

# Set Telegram webhook
if [ "$NODE_ENV" = "production" ]; then
    print_status "Setting Telegram webhook..."
    webhook_url="${APP_BASE_URL}/webhook/telegram"
    
    response=$(curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
        -H "Content-Type: application/json" \
        -d "{\"url\":\"${webhook_url}\"}")
    
    if echo "$response" | grep -q '"ok":true'; then
        print_success "Telegram webhook set successfully"
    else
        print_error "Failed to set Telegram webhook"
        echo "$response"
        exit 1
    fi
else
    print_warning "Skipping webhook setup in development mode"
fi

# Final health check
print_status "Performing final health check..."
sleep 5

health_response=$(curl -s "${APP_BASE_URL}/health" || echo "failed")
if echo "$health_response" | grep -q '"status":"healthy"'; then
    print_success "All services are healthy!"
else
    print_error "Health check failed!"
    echo "$health_response"
    exit 1
fi

print_success "🎉 Deployment completed successfully!"
print_status "Services are running at:"
print_status "  - Application: ${APP_BASE_URL}"
print_status "  - Health Check: ${APP_BASE_URL}/health"
print_status "  - Bot: https://t.me/$(echo ${TELEGRAM_BOT_TOKEN} | cut -d: -f1)"

if [ "$NODE_ENV" = "development" ]; then
    print_status "Development services:"
    print_status "  - Database Admin: http://localhost:8080"
    print_status "  - Redis Commander: http://localhost:8081"
fi

print_status "To view logs: docker compose logs -f app"
print_status "To stop services: docker compose down"

# DurianBot Deployment Script
# This script helps deploy the bot to a production environment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if .env file exists
if [ ! -f .env ]; then
    print_error ".env file not found! Please copy env.example to .env and configure it."
    exit 1
fi

# Load environment variables
source .env

# Validate required environment variables
required_vars=(
    "TELEGRAM_BOT_TOKEN"
    "TELEGRAM_GROUP_ID"
    "TELEGRAM_OWNER_ID"
    "STRIPE_SECRET_KEY"
    "STRIPE_WEBHOOK_SECRET"
    "APP_BASE_URL"
)

print_status "Validating environment variables..."
for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        print_error "Required environment variable $var is not set!"
        exit 1
    fi
done
print_success "Environment variables validated"

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    print_error "Docker is not running! Please start Docker and try again."
    exit 1
fi

print_status "Building and starting services..."
docker compose down --remove-orphans
docker compose build --no-cache
docker compose up -d

# Wait for services to be healthy
print_status "Waiting for services to start..."
sleep 10

# Check service health
print_status "Checking service health..."
if ! docker compose exec app curl -f http://localhost:3000/health > /dev/null 2>&1; then
    print_error "Application health check failed!"
    print_status "Checking logs..."
    docker compose logs app
    exit 1
fi

# Run database migrations
print_status "Running database migrations..."
docker compose exec app npx prisma migrate deploy

# Generate Prisma client
print_status "Generating Prisma client..."
docker compose exec app npx prisma generate

# Seed database
print_status "Seeding database with initial data..."
docker compose exec app npm run seed

# Set Telegram webhook
if [ "$NODE_ENV" = "production" ]; then
    print_status "Setting Telegram webhook..."
    webhook_url="${APP_BASE_URL}/webhook/telegram"
    
    response=$(curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
        -H "Content-Type: application/json" \
        -d "{\"url\":\"${webhook_url}\"}")
    
    if echo "$response" | grep -q '"ok":true'; then
        print_success "Telegram webhook set successfully"
    else
        print_error "Failed to set Telegram webhook"
        echo "$response"
        exit 1
    fi
else
    print_warning "Skipping webhook setup in development mode"
fi

# Final health check
print_status "Performing final health check..."
sleep 5

health_response=$(curl -s "${APP_BASE_URL}/health" || echo "failed")
if echo "$health_response" | grep -q '"status":"healthy"'; then
    print_success "All services are healthy!"
else
    print_error "Health check failed!"
    echo "$health_response"
    exit 1
fi

print_success "🎉 Deployment completed successfully!"
print_status "Services are running at:"
print_status "  - Application: ${APP_BASE_URL}"
print_status "  - Health Check: ${APP_BASE_URL}/health"
print_status "  - Bot: https://t.me/$(echo ${TELEGRAM_BOT_TOKEN} | cut -d: -f1)"

if [ "$NODE_ENV" = "development" ]; then
    print_status "Development services:"
    print_status "  - Database Admin: http://localhost:8080"
    print_status "  - Redis Commander: http://localhost:8081"
fi

print_status "To view logs: docker compose logs -f app"
print_status "To stop services: docker compose down"