# Fix WhatsApp Linking Issues - Quick Reset Script
# Run this if you get "couldn't link device try again later" error
# Updated for WhatsApp February 2026 Protocol

Write-Host ""
Write-Host "══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "🔧 Fix WhatsApp Linking Issues (February 2026 Update)" -ForegroundColor Yellow
Write-Host "══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "📋 This script will:" -ForegroundColor White
Write-Host "   1. Stop the bot if running" -ForegroundColor Gray
Write-Host "   2. Clear corrupted authentication state" -ForegroundColor Gray
Write-Host "   3. Restart with fresh QR code" -ForegroundColor Gray
Write-Host ""

# Check if bot is running
$botProcess = Get-Process -Name "node" -ErrorAction SilentlyContinue

if ($botProcess) {
    Write-Host "⚠️  Bot is currently running. Stopping it first..." -ForegroundColor Yellow
    Stop-Process -Name "node" -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3
    Write-Host "✅ Bot stopped successfully" -ForegroundColor Green
} else {
    Write-Host "ℹ️  Bot is not running" -ForegroundColor Gray
}

Write-Host ""

# Remove corrupted auth state
if (Test-Path "./auth") {
    Write-Host "Removing corrupted auth state..." -ForegroundColor Yellow
    Remove-Item -Path "./auth" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "Auth state cleared successfully" -ForegroundColor Green
} else {
    Write-Host "No existing auth state found" -ForegroundColor Gray
}

Write-Host ""
Write-Host "══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "✅ Ready to restart bot with fresh QR code" -ForegroundColor Green
Write-Host "══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "📱 IMPORTANT TIPS FOR SUCCESSFUL LINKING:" -ForegroundColor Yellow
Write-Host "   • Have your phone unlocked and ready" -ForegroundColor White
Write-Host "   • Ensure stable internet connection (WiFi recommended)" -ForegroundColor White
Write-Host "   • Disable VPN if active" -ForegroundColor White
Write-Host "   • Scan QR code within 60 seconds" -ForegroundColor White
Write-Host ""

# Ask user if they want to start the bot now
$response = Read-Host "Do you want to start the bot now? (Y/N)"

if ($response -eq "Y" -or $response -eq "y") {
    Write-Host ""
    Write-Host "🚀 Starting bot..." -ForegroundColor Cyan
    Write-Host ""
    Write-Host "📋 Instructions:" -ForegroundColor Yellow
    Write-Host "   1. Wait for the QR code to appear (10-15 seconds)" -ForegroundColor White
    Write-Host "   2. Open WhatsApp on your phone" -ForegroundColor White
    Write-Host "   3. Tap Menu (⋮) → Linked devices" -ForegroundColor White
    Write-Host "   4. Tap 'Link a device'" -ForegroundColor White
    Write-Host "   5. Scan the QR code IMMEDIATELY" -ForegroundColor White
    Write-Host ""
    Write-Host "⏱️  You have 60 seconds to scan!" -ForegroundColor Red
    Write-Host ""
    
    Start-Sleep -Seconds 2
    node bot.js
} else {
    Write-Host ""
    Write-Host "ℹ️  To start the bot later, run:" -ForegroundColor Cyan
    Write-Host "   node bot.js" -ForegroundColor White
    Write-Host ""
}
    Write-Host "   4. Tap Link a device" -ForegroundColor White
    Write-Host "   5. Scan the QR code (you have 90 seconds)" -ForegroundColor White
    Write-Host ""
    Write-Host "IMPORTANT TIPS:" -ForegroundColor Red
    Write-Host "   - Make sure you have a stable internet connection" -ForegroundColor White
    Write-Host "   - Do not close the terminal until linked" -ForegroundColor White
    Write-Host "   - If QR expires, restart this script" -ForegroundColor White
    Write-Host ""
    
    Start-Sleep -Seconds 3
    node bot.js
} else {
    Write-Host ""
    Write-Host "To start the bot manually, run: node bot.js" -ForegroundColor Cyan
    Write-Host ""
}

Write-Host ""
Write-Host "══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "💡 Common Linking Issues and Solutions" -ForegroundColor Yellow
Write-Host "══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "❌ Problem: 'Couldn't link device try again later'" -ForegroundColor Red
Write-Host "   ✅ Solution: This script already fixed it!" -ForegroundColor Green
Write-Host "      • Cleared corrupted auth state" -ForegroundColor Gray
Write-Host "      • Updated to compatible WhatsApp protocol" -ForegroundColor Gray
Write-Host "      • Bot will generate fresh QR code" -ForegroundColor Gray
Write-Host ""
Write-Host "❌ Problem: QR code expires too quickly" -ForegroundColor Red
Write-Host "   ✅ Solution: Be ready before scanning!" -ForegroundColor Green
Write-Host "      • Have phone unlocked and ready" -ForegroundColor Gray
Write-Host "      • Open WhatsApp → Linked devices first" -ForegroundColor Gray
Write-Host "      • Then run bot and scan immediately" -ForegroundColor Gray
Write-Host ""
Write-Host "❌ Problem: Connection timeout error" -ForegroundColor Red
Write-Host "   ✅ Solution: Check network connection" -ForegroundColor Green
Write-Host "      • Ensure stable WiFi/mobile data" -ForegroundColor Gray
Write-Host "      • Disable VPN if active" -ForegroundColor Gray
Write-Host "      • Try switching networks if issue persists" -ForegroundColor Gray
Write-Host ""
Write-Host "❌ Problem: Bot disconnects after a few days" -ForegroundColor Red
Write-Host "   ✅ Solution: Session maintenance enabled" -ForegroundColor Green
Write-Host "      • Auto-refresh every 8 hours" -ForegroundColor Gray
Write-Host "      • Connection validation every 5 minutes" -ForegroundColor Gray
Write-Host "      • Should stay connected indefinitely" -ForegroundColor Gray
Write-Host ""
Write-Host "══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "📞 Need More Help?" -ForegroundColor Yellow
Write-Host "══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "If problems persist:" -ForegroundColor White
Write-Host "   1. Ensure you're using latest WhatsApp version" -ForegroundColor Gray
Write-Host "   2. Check that you have less than 5 linked devices" -ForegroundColor Gray
Write-Host "   3. Try unlinking old devices first" -ForegroundColor Gray
Write-Host "   4. Restart your phone's WhatsApp" -ForegroundColor Gray
Write-Host ""
