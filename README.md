# 🤖 CloudNextra Bot v3.0.0

<div align="center">

![CloudNextra Bot](https://img.shields.io/badge/CloudNextra-Bot%20v3.0.0-25D366?style=for-the-badge&logo=whatsapp&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Baileys](https://img.shields.io/badge/Baileys-6.6.0-blue?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

**🚀 Advanced WhatsApp Bot with Enterprise-Grade Features**

*Built using the powerful Baileys library*

</div>

---

## ✨ Key Features

### 🎛️ **Smart Role-Based Interface**
- 👑 **Admin Panel** — Comprehensive control dashboard for bot administrators
- 👤 **User Menu** — Simplified interface for regular users
- 🔧 **Context-Aware Messages** — Different help and error messages based on user role
- 📊 **Role-Specific Information** — Debug details for admins, user-friendly guidance for others

### 🎛️ **Bot Management** *(Bot Admin Only)*
- 🔧 **Control Panel** — Comprehensive command dashboard  
- 📖 **Auto-Read** — Toggle automatic message reading
- 📞 **Anti-Call** — Block unwanted voice/video calls
- ⚡ **Toggle Bot** — Enable/disable bot functionality instantly

### 🎨 **Media Processing**
- 🏷️ **Sticker Creator** — Convert images to WhatsApp stickers
- 🖼️ **Image Converter** — Transform stickers back to images
- 📱 **Quote Support** — Works with quoted messages and direct media
- 🎭 **High Quality** — Professional media processing with Sharp

### 🛠️ **Advanced Utilities**
- 🔗 **URL Shortener** — Powered by TinyURL API integration
- 🌈 **Color Lookup** — Complete color codes (HEX, RGB, HSL)
- ⏰ **Time & Uptime** — Current time, timezone, and bot statistics
- 🔐 **Password Generator** — Cryptographically secure passwords

### 👥 **Group Management** *(Admin Only)*
- ℹ️ **Group Info** — Detailed group analytics and information
- 📢 **Tag All** — Mention all group members with custom message
- 👑 **Admin Tools** — List administrators and manage permissions
- 📊 **Member Stats** — Comprehensive member analytics
- 📜 **Group Rules** — Display and manage group guidelines
- 🚫 **Member Control** — Kick, promote, and manage members
- 🔇 **Advanced Muting** — Group and individual user mute system
- ⚠️ **Warning System** — Issue and track member warnings
- 📈 **Group Statistics** — Detailed group activity metrics
- 🔒 **Group Lock** — Control group settings and permissions
- 🚫 **Anti-Link** — Automatic link removal protection

### 🛡️ **Security & Moderation**
- 🔐 **Role-Based Access** — Smart permission system with separate interfaces for admins and users
- 📊 **Context-Aware Messaging** — Error messages and help content tailored to user privileges
- 📞 **Call Rejection** — Automatic call blocking functionality
- 🔗 **Link Protection** — Advanced anti-link system for groups
- 💾 **Secure Auth** — Authentication data protection (excluded from git)
- 🔄 **Persistent Login** — Auth data survives deployments

---

## 🚀 Quick Start

### 📋 **Prerequisites**
- 🟢 **Node.js 20+** *(Required for Baileys compatibility)*
- 📦 **npm 9+** *(Package manager)*
- 📱 **WhatsApp Account** *(For authentication)*

### ⚡ **Installation**

1. **📥 Clone Repository**
   ```bash
   git clone https://github.com/GihanPasidu/wa-bot-v3.git
   cd wa-bot-v3
   ```

2. **📦 Install Dependencies**
   ```bash
   npm install
   ```

3. **⚙️ Configure Admin**
   
   Edit `bot.js` and add your WhatsApp number:
   ```javascript
   adminJids: ['your-number@s.whatsapp.net']
   ```

4. **🚀 Start Bot**
   ```bash
   npm start
   ```

5. **📱 Authenticate**
   - **🌐 Web Interface**: Visit `http://localhost:10000`
   - **💻 Terminal**: Scan QR code in console

---

## 🌐 Cloud Deployment

### 🚀 **Deploy to Render** *(Recommended)*

<div align="center">

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com)

</div>

#### **📋 Deployment Steps:**

1. **🔗 Connect Repository**
   - Go to [Render Dashboard](https://dashboard.render.com/)
   - Select your `wa-bot-v3` repository

2. **⚙️ Configure Service**
   ```yaml
   Name: cloudnextra-bot
   Environment: Node
   Build Command: npm install
   Start Command: npm start
   Instance Type: Free (or paid for better performance)
   ```

3. **🌍 Environment Variables**
   ```bash
   NODE_ENV=production
   PORT=10000
   RENDER_EXTERNAL_URL=https://your-app-name.onrender.com
   ADMIN_JIDS=your-number@s.whatsapp.net
   ```

4. **🎉 Deploy & Authenticate**
   - Click "Create Web Service"
   - Visit your deployed URL for QR authentication
   - Bot automatically handles persistence across updates!

### 🔒 **Authentication Persistence**
- ✅ **Zero Downtime** — Auth data survives all deployments
- ✅ **No Re-scanning** — QR codes only needed once per week
- ✅ **Auto-Backup** — Intelligent auth data management
- ✅ **Security Compliant** — 7-day rotation policy

---

## 📚 Command Reference

### 🎛️ **Bot Management** *(Bot Admin Only)*
| Command | Description | Usage |
|---------|-------------|-------|
| `.panel` | 📋 Show admin control panel | `.panel` |
| `.autoread` | 📖 Toggle auto-read | `.autoread` |
| `.anticall` | 📞 Toggle call blocking | `.anticall` |
| `.on` / `.off` | ⚡ Enable/disable bot | `.on` or `.off` |

### 🔍 **Information Commands** *(Available to All)*
| Command | Description | Usage |
|---------|-------------|-------|
| `.status` | 🔍 View debug status | `.status` |
| `.help` | 📚 Role-based help guide | `.help` |
| `.panel` | 📋 User menu (for non-admins) | `.panel` |

### 🎨 **Media Commands**
| Command | Description | Usage |
|---------|-------------|-------|
| `.sticker` | 🏷️ Create sticker | `.sticker` (with image) |
| `.toimg` | 🖼️ Convert to image | `.toimg` (reply to sticker) |

### 🛠️ **Utility Commands**
| Command | Description | Usage |
|---------|-------------|-------|
| `.shorturl` | 🔗 Shorten URL | `.shorturl https://example.com` |
| `.color` | 🌈 Color lookup | `.color red` |
| `.time` | ⏰ Current time | `.time` |
| `.pass` | 🔐 Generate password | `.pass 16` |

### 👥 **Group Commands** *(Admin Only)*
| Command | Description | Usage |
|---------|-------------|-------|
| `.ginfo` | ℹ️ Group information | `.ginfo` |
| `.tagall` | 📢 Tag all members | `.tagall Meeting now!` |
| `.admins` | 👑 List admins | `.admins` |
| `.kick` | 🚫 Remove member | `.kick @user` |
| `.promote` | ⬆️ Promote to admin | `.promote @user` |
| `.mute` | 🔇 Mute group | `.mute 1h` |
| `.muteuser` | 🔇 Mute individual | `.muteuser @user 30m spam` |
| `.warn` | ⚠️ Warn member | `.warn @user` |
| `.antilink` | 🔗 Toggle link protection | `.antilink on` |

---

## 🔧 Technical Stack

### **🏗️ Core Technologies**
- **[@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys)** — WhatsApp Web API
- **[axios](https://axios-http.com/)** — HTTP client for API requests
- **[sharp](https://sharp.pixelplumbing.com/)** — High-performance image processing
- **[pino](https://getpino.io/)** — Lightning-fast logging framework
- **[qrcode](https://www.npmjs.com/package/qrcode)** — QR code generation

### **🌟 Key Features**
- 🔄 **Auto-Recovery** — Automatic reconnection handling
- 💾 **Persistent Auth** — Authentication survives deployments
- 🛡️ **Security First** — Admin validation and secure auth handling
- 📱 **Mobile Responsive** — Web QR interface works on all devices
- ⚡ **High Performance** — Optimized for production environments

---

## 🌍 Production Features

### **🔍 Monitoring & Health**
- 🩺 **Health Checks** — `/health` endpoint for monitoring
- 📊 **Status Dashboard** — Real-time bot status at web interface
- 🔄 **Auto-Recovery** — Automatic reconnection on disconnection
- 💓 **Keep-Alive** — Prevents service sleeping on free tiers

#### **⏰ External Health Monitoring with Cron-Job.org**

For enhanced reliability and automated monitoring, set up external health checks using **[cron-job.org](https://cron-job.org)**:

**🚀 Quick Setup Steps:**

1. **📝 Create Account**
   - Visit [cron-job.org](https://cron-job.org)
   - Sign up for a free account

2. **➕ Add New Cron Job**
   ```
   Title: CloudNextra Bot Health Check
   URL: https://your-app-name.onrender.com/health
   Schedule: */5 * * * * (Every 5 minutes)
   Request Method: GET
   Expected HTTP Status: 200
   ```

3. **🔔 Configure Notifications**
   ```
   Email Notifications: ✅ Enable
   Failure Notifications: ✅ Send on failure
   Success Notifications: ❌ Disable (optional)
   Notification Email: your-email@domain.com
   ```

4. **⚙️ Advanced Settings**
   ```
   Timeout: 30 seconds
   Retries: 3 attempts
   User-Agent: CloudNextra-HealthMonitor/1.0
   Follow Redirects: ✅ Yes
   ```

**📊 Expected Health Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": "2d 4h 30m",
  "whatsapp_status": "connected",
  "version": "3.0.0"
}
```

**🎯 Benefits:**
- ✅ **24/7 Monitoring** — Continuous health surveillance
- ✅ **Instant Alerts** — Email notifications on failures
- ✅ **Keep Services Active** — Prevents Render free tier sleeping
- ✅ **Performance Tracking** — Monitor response times and uptime
- ✅ **Zero Cost** — Free monitoring service
- ✅ **Global Monitoring** — Multiple server locations

**🔧 Alternative Monitoring Services:**
- **[UptimeRobot](https://uptimerobot.com/)** — 50 monitors free
- **[StatusCake](https://www.statuscake.com/)** — Free tier available
- **[Pingdom](https://www.pingdom.com/)** — Basic monitoring
- **[Better Uptime](https://betteruptime.com/)** — Modern interface

### **🔐 Security & Reliability**
- 🛡️ **Admin Only Commands** — Secure permission validation
- 🔒 **Auth Protection** — Sensitive data excluded from repository
- 🔄 **Backup System** — Automatic auth data backup and restore
- ⏰ **Session Management** — Intelligent session handling

### **📈 Scalability**
- 🚀 **Production Ready** — Optimized for cloud deployment
- 📦 **Docker Support** — Containerized deployment option
- 🔧 **Environment Config** — Flexible configuration management
- 📊 **Performance Optimized** — Efficient resource utilization

---

## 📁 Project Structure

```
wa-bot-v3/
├── 📄 bot.js                    # Main bot implementation
├── 📦 package.json              # Dependencies and scripts
├── 📚 README.md                 # This documentation
├── 🔐 PERSISTENT-AUTH.md        # Authentication persistence guide
├── 👥 USER-MUTE-FEATURE.md     # Individual user mute system
├── ⚙️  .env.example             # Environment variables template
├── 🐳 Dockerfile               # Docker containerization
├── 🚀 render.yaml              # Render deployment config
├── 🌐 public/
│   └── qr.html                 # Professional QR interface
└── 🔒 auth/                    # WhatsApp session data (auto-generated)
    ├── creds.json
    └── *.json                  # Session files
```

---

## 💡 Usage Examples

### **🎨 Media Commands**
```bash
# Convert image to sticker
Send image with caption: .sticker
# or reply to image: .sticker

# Convert sticker to image  
Reply to sticker: .toimg
```

### **🛠️ Advanced Tools**
```bash
.shorturl https://example.com/very/long/url/path
.color red
.time
.pass 16
```

### **👥 Group Management**
```bash
.ginfo
.tagall 📢 Important announcement!
.kick @spammer
.promote @trusted_user
.warn @rule_breaker Please follow group rules
.mute 1h
.muteuser @troublemaker 30m spamming
.antilink on
```

---

## 🤝 Contributing

We welcome contributions! Here's how you can help:

1. **🍴 Fork** the repository
2. **🌿 Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **💾 Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **📤 Push** to branch (`git push origin feature/amazing-feature`)
5. **🔃 Open** a Pull Request

---

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---

## 🆘 Support

### **📞 Get Help**
- 🐛 **Issues**: [GitHub Issues](https://github.com/GihanPasidu/wa-bot-v3/issues)
- 📖 **Documentation**: Check our comprehensive guides
- 💬 **Community**: Join our discussions

### **🔗 Quick Links**
- 🌐 **Live Demo**: [CloudNextra Bot Demo](https://wa-bot-v3.onrender.com)

### **🔧 Troubleshooting**
- **Build Failures**: Check Node.js version compatibility (requires 20+)
- **Memory Issues**: Consider upgrading to Render paid tier
- **Connection Issues**: Verify WhatsApp authentication and QR scanning
- **Command Errors**: Check admin JID configuration in bot.js

---

<div align="center">

**⭐ Star this repository if you found it helpful!**

Made by [CloudNextra Solutions](https://github.com/GihanPasidu)

![GitHub stars](https://img.shields.io/github/stars/GihanPasidu/wa-bot-v3?style=social)
![GitHub forks](https://img.shields.io/github/forks/GihanPasidu/wa-bot-v3?style=social)

</div>
