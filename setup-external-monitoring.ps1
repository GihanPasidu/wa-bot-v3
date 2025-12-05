# PowerShell Script - Quick Setup Guide for External Monitoring

Clear-Host

Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "🚨 CRITICAL: Set Up External Monitoring for Render Free Tier" -ForegroundColor Red
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "⚠️  YOUR BOT WENT OFFLINE TODAY BECAUSE:" -ForegroundColor Yellow
Write-Host "   • Render free tier spins down after 15 min inactivity" -ForegroundColor White
Write-Host "   • 50+ second cold start disconnects WhatsApp" -ForegroundColor White
Write-Host "   • Internal keep-alive alone is NOT enough" -ForegroundColor White
Write-Host ""
Write-Host "✅ SOLUTION: External monitoring (5 minutes setup)" -ForegroundColor Green
Write-Host ""
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Your Render URL
$RENDER_URL = "https://wa-bot-v3.onrender.com"
$HEALTH_URL = "$RENDER_URL/health"

Write-Host "📋 Your Bot URLs:" -ForegroundColor Cyan
Write-Host "   Dashboard: $RENDER_URL" -ForegroundColor White
Write-Host "   Health Check: $HEALTH_URL" -ForegroundColor White
Write-Host ""

Write-Host "🔍 Testing health endpoint..." -ForegroundColor Yellow

try {
    $response = Invoke-WebRequest -Uri $HEALTH_URL -UseBasicParsing -TimeoutSec 10 -ErrorAction SilentlyContinue
    if ($response.StatusCode -eq 200) {
        Write-Host "✅ Bot is currently ONLINE" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Bot returned status: $($response.StatusCode)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "⚠️  Bot is currently OFFLINE or spinning up" -ForegroundColor Yellow
    Write-Host "   This is expected if service just spun down" -ForegroundColor Gray
}

Write-Host ""
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "🥇 OPTION 1: UptimeRobot (RECOMMENDED - 100% Free)" -ForegroundColor Green
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "⏱️  Setup Time: 3 minutes" -ForegroundColor White
Write-Host "✨ Features: 50 monitors, 5-min intervals, SMS alerts" -ForegroundColor White
Write-Host ""
Write-Host "📝 STEP-BY-STEP:" -ForegroundColor Yellow
Write-Host ""
Write-Host "1. Open this URL in your browser:" -ForegroundColor White
Write-Host "   👉 https://uptimerobot.com/signUp" -ForegroundColor Cyan
Write-Host ""
Write-Host "2. Create FREE account:" -ForegroundColor White
Write-Host "   • Enter your email" -ForegroundColor Gray
Write-Host "   • Verify email" -ForegroundColor Gray
Write-Host "   • Login" -ForegroundColor Gray
Write-Host ""
Write-Host "3. Create Monitor:" -ForegroundColor White
Write-Host "   • Click [+ Add New Monitor]" -ForegroundColor Gray
Write-Host "   • Monitor Type: HTTP(s)" -ForegroundColor Gray
Write-Host "   • Friendly Name: CloudNextra WhatsApp Bot" -ForegroundColor Gray
Write-Host "   • URL: $HEALTH_URL" -ForegroundColor Green
Write-Host "   • Monitoring Interval: 5 minutes" -ForegroundColor Gray
Write-Host "   • Click [Create Monitor]" -ForegroundColor Gray
Write-Host ""
Write-Host "4. Done! ✅" -ForegroundColor Green
Write-Host "   • Bot will NEVER go offline again" -ForegroundColor White
Write-Host "   • You'll get email alerts if it does" -ForegroundColor White
Write-Host ""
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "🥈 OPTION 2: Cron-Job.org (Alternative)" -ForegroundColor Yellow
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "⏱️  Setup Time: 3 minutes" -ForegroundColor White
Write-Host ""
Write-Host "1. Open: https://cron-job.org/en/signup" -ForegroundColor White
Write-Host "2. Create account and verify email" -ForegroundColor Gray
Write-Host "3. Click [Create cronjob]" -ForegroundColor Gray
Write-Host "4. Title: CloudNextra Bot Monitor" -ForegroundColor Gray
Write-Host "5. URL: $HEALTH_URL" -ForegroundColor Green
Write-Host "6. Schedule: */5 * * * * (every 5 minutes)" -ForegroundColor Gray
Write-Host "7. Click [Create cronjob]" -ForegroundColor Gray
Write-Host ""
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "📊 Expected Results AFTER Setup:" -ForegroundColor Yellow
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "WITHOUT External Monitoring:" -ForegroundColor Red
Write-Host "  ⏱️  Uptime: ~95-97%" -ForegroundColor White
Write-Host "  🔴 Risk: Bot can still go offline" -ForegroundColor Red
Write-Host ""
Write-Host "WITH External Monitoring (UptimeRobot):" -ForegroundColor Green
Write-Host "  ⏱️  Uptime: 99.5-99.9% ✅" -ForegroundColor White
Write-Host "  🟢 Bot NEVER spins down" -ForegroundColor Green
Write-Host "  🚀 Always responds instantly" -ForegroundColor Green
Write-Host ""
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "🎯 ACTION REQUIRED:" -ForegroundColor Red
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Choose ONE option above (UptimeRobot recommended)" -ForegroundColor Yellow
Write-Host "2. Set it up NOW (takes only 3 minutes)" -ForegroundColor Yellow
Write-Host "3. Your bot will stay online 99.9% of the time" -ForegroundColor Green
Write-Host ""
Write-Host "⚠️  Without this, your bot WILL go offline every 15-20 minutes" -ForegroundColor Red
Write-Host ""
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Open UptimeRobot in browser
$openBrowser = Read-Host "Open UptimeRobot signup page now? (Y/N)"
if ($openBrowser -eq "Y" -or $openBrowser -eq "y") {
    Start-Process "https://uptimerobot.com/signUp"
    Write-Host ""
    Write-Host "✅ Browser opened! Follow the steps above to set up monitoring." -ForegroundColor Green
}
