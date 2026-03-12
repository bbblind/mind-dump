#!/bin/bash

# DurianBot Backup Script
# Creates backups of the database and important files

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Configuration
BACKUP_DIR="backups"
DATE=$(date +%Y%m%d_%H%M%S)
DB_BACKUP_FILE="${BACKUP_DIR}/database_${DATE}.sql"
FILES_BACKUP_FILE="${BACKUP_DIR}/files_${DATE}.tar.gz"

# Create backup directory
mkdir -p $BACKUP_DIR

print_status "Starting backup process..."

# Database backup
print_status "Creating database backup..."
if docker compose exec -T db pg_dump -U durianbot durianbot > $DB_BACKUP_FILE; then
    print_success "Database backup created: $DB_BACKUP_FILE"
else
    print_error "Database backup failed!"
    exit 1
fi

# Files backup
print_status "Creating files backup..."
tar -czf $FILES_BACKUP_FILE \
    --exclude=node_modules \
    --exclude=dist \
    --exclude=temp \
    --exclude=.git \
    --exclude=backups \
    .

if [ $? -eq 0 ]; then
    print_success "Files backup created: $FILES_BACKUP_FILE"
else
    print_error "Files backup failed!"
    exit 1
fi

# Cleanup old backups (keep last 10)
print_status "Cleaning up old backups..."
ls -t ${BACKUP_DIR}/database_*.sql | tail -n +11 | xargs -r rm
ls -t ${BACKUP_DIR}/files_*.tar.gz | tail -n +11 | xargs -r rm

print_success "Backup completed successfully!"
print_status "Backup files:"
print_status "  - Database: $DB_BACKUP_FILE"
print_status "  - Files: $FILES_BACKUP_FILE"

# DurianBot Backup Script
# Creates backups of the database and important files

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Configuration
BACKUP_DIR="backups"
DATE=$(date +%Y%m%d_%H%M%S)
DB_BACKUP_FILE="${BACKUP_DIR}/database_${DATE}.sql"
FILES_BACKUP_FILE="${BACKUP_DIR}/files_${DATE}.tar.gz"

# Create backup directory
mkdir -p $BACKUP_DIR

print_status "Starting backup process..."

# Database backup
print_status "Creating database backup..."
if docker compose exec -T db pg_dump -U durianbot durianbot > $DB_BACKUP_FILE; then
    print_success "Database backup created: $DB_BACKUP_FILE"
else
    print_error "Database backup failed!"
    exit 1
fi

# Files backup
print_status "Creating files backup..."
tar -czf $FILES_BACKUP_FILE \
    --exclude=node_modules \
    --exclude=dist \
    --exclude=temp \
    --exclude=.git \
    --exclude=backups \
    .

if [ $? -eq 0 ]; then
    print_success "Files backup created: $FILES_BACKUP_FILE"
else
    print_error "Files backup failed!"
    exit 1
fi

# Cleanup old backups (keep last 10)
print_status "Cleaning up old backups..."
ls -t ${BACKUP_DIR}/database_*.sql | tail -n +11 | xargs -r rm
ls -t ${BACKUP_DIR}/files_*.tar.gz | tail -n +11 | xargs -r rm

print_success "Backup completed successfully!"
print_status "Backup files:"
print_status "  - Database: $DB_BACKUP_FILE"
print_status "  - Files: $FILES_BACKUP_FILE"