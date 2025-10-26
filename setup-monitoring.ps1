# PowerShell version of the monitoring setup script
# Quick External Monitoring Setup for CloudNextra Bot

Write-Host "🚀 CloudNextra Bot - External Monitoring Setup" -ForegroundColor Green
Write-Host "=============================================="
Write-Host ""

# Your Render URL
$RENDER_URL = "https://wa-bot-v3.onrender.com"

Write-Host "📋 Using your Render service URL: $RENDER_URL" -ForegroundColor Cyan
Write-Host ""

Write-Host "🔍 Testing your bot's health endpoint..." -ForegroundColor Yellow

try {
    $response = Invoke-WebRequest -Uri "$RENDER_URL/health" -UseBasicParsing -TimeoutSec 10
    $statusCode = $response.StatusCode
    
    if ($statusCode -eq 200) {
        Write-Host "✅ Health endpoint is working!" -ForegroundColor Green
        Write-Host ""
        Write-Host "🌐 External Monitoring Setup Options:" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "📊 Option 1: UptimeRobot (Recommended - Free)" -ForegroundColor Yellow
        Write-Host "   1. Visit: https://uptimerobot.com/signUp" -ForegroundColor White
        Write-Host "   2. Create account and verify email" -ForegroundColor White
        Write-Host "   3. Click 'Add New Monitor'" -ForegroundColor White
        Write-Host "   4. Monitor Type: HTTP(s)" -ForegroundColor White
        Write-Host "   5. Friendly Name: CloudNextra Bot" -ForegroundColor White
        Write-Host "   6. URL: $RENDER_URL/health" -ForegroundColor Green
        Write-Host "   7. Monitoring Interval: 5 minutes" -ForegroundColor White
        Write-Host "   8. Click 'Create Monitor'" -ForegroundColor White
        Write-Host ""
        Write-Host "📊 Option 2: Cron-job.org (Alternative - Free)" -ForegroundColor Yellow
        Write-Host "   1. Visit: https://cron-job.org/en/signup" -ForegroundColor White
        Write-Host "   2. Create account and verify email" -ForegroundColor White
        Write-Host "   3. Click 'Create cronjob'" -ForegroundColor White
        Write-Host "   4. Title: CloudNextra Bot Monitor" -ForegroundColor White
        Write-Host "   5. URL: $RENDER_URL/health" -ForegroundColor Green
        Write-Host "   6. Schedule: */10 * * * * (every 10 minutes)" -ForegroundColor White
        Write-Host "   7. Click 'Create cronjob'" -ForegroundColor White
        Write-Host ""
        Write-Host "✅ Choose one option above for 99.9% uptime!" -ForegroundColor Green
        
        # Show current health status
        Write-Host ""
        Write-Host "🔍 Current Bot Status:" -ForegroundColor Cyan
        try {
            $healthData = $response.Content | ConvertFrom-Json
            Write-Host "   Status: $($healthData.status)" -ForegroundColor Green
            Write-Host "   Uptime: $($healthData.uptimeFormatted)" -ForegroundColor Green
            Write-Host "   Connection: $($healthData.connection.status)" -ForegroundColor Green
        } catch {
            Write-Host "   Basic health check: ✅ Passed" -ForegroundColor Green
        }
        
    } else {
        Write-Host "❌ Health endpoint returned HTTP $statusCode" -ForegroundColor Red
        Write-Host "   Please check your bot deployment on Render." -ForegroundColor Yellow
    }
} catch {
    Write-Host "❌ Health endpoint is not responding: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "   Please ensure your bot is deployed and running on Render." -ForegroundColor Yellow
    Write-Host "   Visit: $RENDER_URL" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "📖 For detailed setup instructions, see: UPTIME_OPTIMIZATION.md" -ForegroundColor Cyan
Write-Host "🎯 After setup, your bot should maintain 99.9% uptime!" -ForegroundColor Green

# Quick links for easy access
Write-Host ""
Write-Host "🔗 Quick Links:" -ForegroundColor Cyan
Write-Host "   • Health Check: $RENDER_URL/health" -ForegroundColor White
Write-Host "   • QR Interface: $RENDER_URL" -ForegroundColor White
Write-Host "   • UptimeRobot: https://uptimerobot.com/signUp" -ForegroundColor White
Write-Host "   • Cron-job.org: https://cron-job.org/en/signup" -ForegroundColor White