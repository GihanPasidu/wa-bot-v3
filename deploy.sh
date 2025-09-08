#!/bin/bash

# Quick deployment script for Render

echo "🚀 Preparing for Render deployment..."

# Add all changes
git add .

# Commit with timestamp
git commit -m "Ready for Render deployment - $(date)"

# Push to GitHub
git push origin main

echo "✅ Code pushed to GitHub!"
echo "🌐 Now go to render.com to deploy"
echo "📖 Follow RENDER_DEPLOY.md for step-by-step instructions"
