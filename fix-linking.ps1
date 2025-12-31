# Fix WhatsApp Linking Issues - Quick Reset Script
# Run this if you get "couldn't link device try again later" error

Write-Host ""
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "Fix WhatsApp Linking Issues" -ForegroundColor Yellow
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host ""

# Check if bot is running
$botProcess = Get-Process -Name "node" -ErrorAction SilentlyContinue

if ($botProcess) {
    Write-Host "Warning: Bot is currently running. Stopping it first..." -ForegroundColor Yellow
    Stop-Process -Name "node" -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Write-Host "Bot stopped" -ForegroundColor Green
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
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "Ready to restart bot with fresh QR code" -ForegroundColor Green
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host ""

# Ask user if they want to start the bot now
$response = Read-Host "Do you want to start the bot now? (Y/N)"

if ($response -eq "Y" -or $response -eq "y") {
    Write-Host ""
    Write-Host "Starting bot..." -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Instructions:" -ForegroundColor Yellow
    Write-Host "   1. Wait for the QR code to appear" -ForegroundColor White
    Write-Host "   2. Open WhatsApp on your phone" -ForegroundColor White
    Write-Host "   3. Tap Menu > Linked devices" -ForegroundColor White
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
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "Common Linking Issues and Solutions:" -ForegroundColor Yellow
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Problem: Couldn't link device try again later" -ForegroundColor Red
Write-Host "   Solution: This script already fixed it!" -ForegroundColor Green
Write-Host "   - Cleared corrupted auth state" -ForegroundColor White
Write-Host "   - Bot will generate fresh QR code" -ForegroundColor White
Write-Host ""
Write-Host "Problem: QR code expires too quickly" -ForegroundColor Red
Write-Host "   Solution: Improved timeout to 90 seconds" -ForegroundColor Green
Write-Host "   - Be ready to scan immediately" -ForegroundColor White
Write-Host "   - Have phone camera open and ready" -ForegroundColor White
Write-Host ""
Write-Host "Problem: Connection timeout error" -ForegroundColor Red
Write-Host "   Solution: Check your internet connection" -ForegroundColor Green
Write-Host "   - Ensure stable WiFi/data" -ForegroundColor White
Write-Host "   - Disable VPN if active" -ForegroundColor White
Write-Host ""
