#!/bin/bash
# Quick External Monitoring Setup for CloudNextra Bot

echo "🚀 CloudNextra Bot - External Monitoring Setup"
echo "=============================================="
echo ""

# Get the Render URL
echo "📋 First, find your Render service URL:"
echo "   1. Go to your Render Dashboard"
echo "   2. Click on your wa-bot-v3 service"
echo "   3. Copy the URL (e.g., https://wa-bot-v3.onrender.com)"
echo ""

read -p "Enter your Render service URL: " RENDER_URL

if [ -z "$RENDER_URL" ]; then
    echo "❌ No URL provided. Exiting."
    exit 1
fi

# Validate URL format
if [[ ! $RENDER_URL =~ ^https?:// ]]; then
    RENDER_URL="https://$RENDER_URL"
fi

# Remove trailing slash
RENDER_URL=${RENDER_URL%/}

echo ""
echo "🔍 Testing your bot's health endpoint..."

# Test the health endpoint
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$RENDER_URL/health" || echo "000")

if [ "$HTTP_STATUS" = "200" ]; then
    echo "✅ Health endpoint is working!"
    echo ""
    echo "🌐 External Monitoring Setup Options:"
    echo ""
    echo "📊 Option 1: UptimeRobot (Recommended - Free)"
    echo "   1. Visit: https://uptimerobot.com/signUp"
    echo "   2. Create account and verify email"
    echo "   3. Click 'Add New Monitor'"
    echo "   4. Monitor Type: HTTP(s)"
    echo "   5. Friendly Name: CloudNextra Bot"
    echo "   6. URL: $RENDER_URL/health"
    echo "   7. Monitoring Interval: 5 minutes"
    echo "   8. Click 'Create Monitor'"
    echo ""
    echo "📊 Option 2: Cron-job.org (Alternative - Free)"
    echo "   1. Visit: https://cron-job.org/en/signup"
    echo "   2. Create account and verify email"
    echo "   3. Click 'Create cronjob'"
    echo "   4. Title: CloudNextra Bot Monitor"
    echo "   5. URL: $RENDER_URL/health"
    echo "   6. Schedule: */10 * * * * (every 10 minutes)"
    echo "   7. Click 'Create cronjob'"
    echo ""
    echo "✅ Choose one option above for 99.9% uptime!"
    
else
    echo "❌ Health endpoint is not responding (HTTP $HTTP_STATUS)"
    echo "   Please ensure your bot is deployed and running on Render."
    echo "   Visit: $RENDER_URL"
fi

echo ""
echo "📖 For detailed setup instructions, see: UPTIME_OPTIMIZATION.md"
echo "🎯 After setup, your bot should maintain 99.9% uptime!"