# WhatsApp Bot v3 - Render Deployment Guide

## 🚀 Quick Deploy to Render

Follow this step-by-step guide to deploy your WhatsApp bot to Render's free tier.

### Prerequisites ✅

- ✅ GitHub account with your bot repository
- ✅ Render account (sign up at [render.com](https://render.com))
- ✅ WhatsApp account for bot authentication

### Deployment Steps 📋

#### 1. Prepare Repository
```bash
# Ensure all files are committed
git add .
git commit -m "Ready for Render deployment"
git push origin main
```

#### 2. Create Render Service
1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub account
4. Select your `wa-bot-v3` repository
5. Click **"Connect"**

#### 3. Configure Service Settings
```yaml
Name: whatsapp-bot-v3
Environment: Node
Region: Choose closest to your location
Branch: main
Build Command: npm install
Start Command: npm start
```

#### 4. Set Environment Variables
In the Render dashboard, add these environment variables:

**Required Variables:**
```
NODE_ENV=production
PORT=10000
ADMIN_JIDS=your-whatsapp-number@s.whatsapp.net
RENDER_EXTERNAL_URL=https://your-service-name.onrender.com
```

**Optional Variables:**
```
AUTO_READ=false
ANTI_CALL=true
BOT_ENABLED=true
```

**How to add variables:**
1. Scroll to **"Environment Variables"** section
2. Click **"Add Environment Variable"**
3. Enter key-value pairs
4. Click **"Save"**

#### 5. Deploy Service
1. Click **"Create Web Service"**
2. Wait for build to complete (5-10 minutes)
3. Monitor logs for any errors
4. Service will be available at `https://your-service-name.onrender.com`

### First Setup After Deployment 🔧

#### 1. Authenticate WhatsApp
1. Go to Render logs: **Dashboard** → **Your Service** → **Logs**
2. Look for QR code in the logs (will appear as ASCII art)
3. Open WhatsApp on your phone
4. Go to **Settings** → **Linked Devices** → **Link a Device**
5. Scan the QR code from the logs
6. Wait for authentication success message

#### 2. Test Bot Functionality
Send these commands to test:
```
.ping          # Test response time
.help          # View all commands
.stats         # Check bot statistics
.about         # Bot information
```

### Configuration Options ⚙️

#### Admin Configuration
Replace `your-whatsapp-number@s.whatsapp.net` with your actual WhatsApp number:

**Finding Your WhatsApp JID:**
1. Send `.about` command after initial setup
2. Check logs for your JID format
3. Update environment variables if needed

**Multiple Admins:**
```
ADMIN_JIDS=first-admin@s.whatsapp.net,second-admin@s.whatsapp.net
```

#### Service Configuration
```yaml
Auto-Deploy: Enable (recommended)
Health Check Path: /health
Instance Type: Free (or upgrade for better performance)
```

### Monitoring & Maintenance 📊

#### Health Monitoring
- **Health Check**: `https://your-service.onrender.com/health`
- **Logs**: Available in Render dashboard
- **Metrics**: CPU, Memory, Response time tracking
- **Keep-Alive**: Automatic self-ping every 5 minutes to prevent sleeping

#### Auto-Deploy
- **Enabled**: Automatically deploys on GitHub pushes
- **Branch**: Deploys from `main` branch
- **Build Time**: ~5-10 minutes per deployment

#### Keep-Alive Mechanism
The bot includes an automatic self-ping system that:
- **Prevents Sleep**: Keeps the service active on Render's free tier
- **5-minute Interval**: Pings the health endpoint every 5 minutes
- **Production Only**: Only activates when `NODE_ENV=production`
- **Smart Logging**: Logs ping success/failure for monitoring

#### Troubleshooting Commands
```bash
# View recent logs
curl https://your-service.onrender.com/health

# Test bot response
# Send .ping command via WhatsApp
```

### Troubleshooting Guide 🔧

#### Common Issues

**Build Failures:**
```
❌ Issue: npm install fails
✅ Solution: Check Node.js version in package.json
```

**Memory Issues:**
```
❌ Issue: Service crashes due to memory
✅ Solution: Upgrade to paid tier or optimize code
```

**Authentication Problems:**
```
❌ Issue: QR code not appearing
✅ Solution: Check logs, ensure auth/ directory is accessible
```

**Command Not Working:**
```
❌ Issue: Bot doesn't respond to commands
✅ Solution: Verify admin JID configuration
```

#### Support Resources

- **Render Docs**: [render.com/docs](https://render.com/docs)
- **Bot Logs**: Check Render dashboard → Logs
- **Health Status**: `https://your-service.onrender.com/health`

### Scaling & Optimization 🚀

#### Free Tier Limitations
- **Memory**: 512 MB RAM
- **Sleep**: Service sleeps after 15 minutes of inactivity
- **Build Time**: Limited build minutes per month

#### Upgrade Benefits
- **Always-On**: No service sleeping
- **More Memory**: Better performance
- **Faster Builds**: Priority build queue
- **Custom Domains**: Use your own domain

#### Performance Tips
1. **Keep Service Active**: Use external uptime monitoring
2. **Optimize Images**: Use Sharp settings for better performance
3. **Monitor Usage**: Check logs for memory/CPU usage
4. **Update Dependencies**: Keep packages updated

### Advanced Configuration 🔧

#### Custom Domain Setup
1. Upgrade to paid tier
2. Go to **Settings** → **Custom Domains**
3. Add your domain
4. Configure DNS records
5. Enable SSL

#### Environment-Specific Settings
```bash
# Development
NODE_ENV=development
DEBUG=true

# Production  
NODE_ENV=production
DEBUG=false
```

### Quick Commands Reference 📖

#### Deployment Commands
```bash
# Redeploy service
git push origin main

# Check service status
curl https://your-service.onrender.com/health

# View logs (from dashboard)
# Dashboard → Service → Logs
```

#### Bot Commands
```
.help     - Complete command list
.stats    - Bot statistics
.ping     - Response time test
.about    - Bot information
.panel    - Control panel
```

## 🎉 Deployment Complete!

Your WhatsApp bot is now live on Render! 

**Next Steps:**
1. ✅ Test all bot commands
2. ✅ Configure admin settings
3. ✅ Set up monitoring
4. ✅ Share bot with users

**Support:**
- Create GitHub issues for bugs
- Check Render status page for platform issues
- Monitor bot logs for errors

---

**Happy Botting! 🤖✨**
