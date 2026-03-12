#!/bin/bash
# Quick deploy script - run this manually if sshpass doesn't work

echo "📦 Deploying updated files to server..."
echo ""
echo "Run these commands on your Linode server:"
echo ""
echo "# 1. Stop the bot"
echo "cd /opt/durianbot && docker-compose down"
echo ""
echo "# 2. Upload the updated files (run this from your LOCAL machine):"
echo "scp src/bot.ts blind@139.162.130.60:/opt/durianbot/src/"
echo "scp src/utils.ts blind@139.162.130.60:/opt/durianbot/src/"
echo ""
echo "# 3. Rebuild and start (run this on the SERVER):"
echo "cd /opt/durianbot && docker-compose build app && docker-compose up -d"
echo ""
echo "# 4. Watch logs for isOwner messages:"
echo "docker logs -f durianbot-app | grep isOwner"
echo ""
echo "Then ask @marcogirobondo to try /post_locked again!"

