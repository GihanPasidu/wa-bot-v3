# Quick deployment script for Render (PowerShell)

Write-Host "🚀 Preparing for Render deployment..." -ForegroundColor Green

# Add all changes
git add .

# Commit with timestamp
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
git commit -m "Ready for Render deployment - $timestamp"

# Push to GitHub
git push origin main

Write-Host "✅ Code pushed to GitHub!" -ForegroundColor Green
Write-Host "🌐 Now go to render.com to deploy" -ForegroundColor Yellow
Write-Host "📖 Follow RENDER_DEPLOY.md for step-by-step instructions" -ForegroundColor Cyan
