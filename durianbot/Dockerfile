# Simple production Dockerfile using ts-node
FROM node:20-alpine

WORKDIR /app

# Install system dependencies including OpenSSL for Prisma and fonts for watermark
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    make \
    g++ \
    openssl \
    openssl-dev \
    fontconfig \
    ttf-dejavu \
    && rm -rf /var/cache/apk/*

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install all dependencies
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Create temp directory for media processing
RUN mkdir -p /app/temp

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# Start application with ts-node (skip type checking for faster startup)
CMD ["npx", "ts-node", "--transpileOnly", "src/index.ts"]


FROM node:20-alpine

WORKDIR /app

# Install system dependencies including OpenSSL for Prisma and fonts for watermark
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    make \
    g++ \
    openssl \
    openssl-dev \
    fontconfig \
    ttf-dejavu \
    && rm -rf /var/cache/apk/*

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install all dependencies
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Create temp directory for media processing
RUN mkdir -p /app/temp

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# Start application with ts-node (skip type checking for faster startup)
CMD ["npx", "ts-node", "--transpileOnly", "src/index.ts"]

