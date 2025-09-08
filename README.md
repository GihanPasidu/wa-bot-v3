# WhatsApp Bot v3### 🔧 Advanced Tools
- `.shorturl [url]` — URL shortener powered by TinyURL
- `.color [name]` — Comprehensive color code lookup (HEX, RGB, HSL)
- `.time` — Current date, time, timezone, and bot uptime
- `.pass [length]` — Cryptographically secure password generator feature-rich WhatsApp bot built with Baileys library, offering comprehensive group management, media processing, and advanced utility tools.

## Features

### � General Commands
- `.panel` — Control panel with all available commands
- `.autoread` — Toggle automatic read receipts
- `.anticall` — Toggle call blocking
- `.on` / `.off` — Enable/disable bot functionality

### 🎨 Media Commands
- `.sticker` — Convert images to WhatsApp stickers
- `.toimg` — Convert stickers back to images
- Supports quoted messages and direct media

### � Advanced Tools
- `.shorturl [url]` — URL shortener with demo functionality
- `.color [name]` — Comprehensive color code lookup (HEX, RGB, HSL)
- `.time` — Current date, time, timezone, and bot uptime
- `.pass [length]` — Cryptographically secure password generator

### � Group Management (Admin Only)
- `.ginfo` — Detailed group information
- `.tagall [message]` — Tag all group members
- `.admins` — List group administrators
- `.members` — Member statistics and analytics
- `.rules` — Display group rules
- `.kick @user` — Remove members from group
- `.promote @user` — Promote members to admin
- `.mute [duration]` — Temporarily mute the group
- `.warn @user` — Issue warnings to members
- `.resetwarns` — Clear all member warnings
- `.groupstats` — Comprehensive group statistics
- `.lock` / `.unlock` — Control group settings
- `.antilink on/off` — Automatic link removal protection

### 🔐 Security Features
- Admin-only commands with permission validation
- Automatic call rejection
- Anti-link protection for groups
- Secure auth data handling (not stored in git)

## Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd wa-bot-v3
```

2. Install dependencies:
```bash
npm install
```

3. Configure admin number in `bot.js`:
```javascript
adminJids: ['your-number@s.whatsapp.net']
```

4. Run the bot:
```bash
node bot.js
```

5. Scan the QR code with WhatsApp Web

## Dependencies

- `@whiskeysockets/baileys` - WhatsApp Web API
- `axios` - HTTP client for TinyURL API
- `sharp` - Image processing for stickers
- `pino` - Logging framework
- `qrcode-terminal` - QR code display
- `crypto` - Password generation

## Deployment on Render

### Prerequisites
- GitHub repository with your bot code
- Render account (free tier available)

### Step-by-Step Deployment

1. **Prepare Your Repository**
   ```bash
   git add .
   git commit -m "Prepare for Render deployment"
   git push origin main
   ```

2. **Deploy to Render**
   - Go to [Render Dashboard](https://dashboard.render.com/)
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - Select your `wa-bot-v3` repository

3. **Configure Deployment Settings**
   - **Name**: `whatsapp-bot-v3`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free` (or paid for better performance)

4. **Set Environment Variables**
   In Render dashboard, add these environment variables:
   ```
   NODE_ENV=production
   PORT=10000
   ADMIN_JIDS=your-number@s.whatsapp.net
   AUTO_READ=false
   ANTI_CALL=true
   BOT_ENABLED=true
   ```

5. **Deploy and Monitor**
   - Click "Create Web Service"
   - Monitor the build logs
   - Wait for deployment to complete
   - Your bot will be available at `https://your-app-name.onrender.com`

### First-Time Setup After Deployment

1. **Scan QR Code**
   - Check Render logs for QR code
   - Scan with WhatsApp to authenticate
   - Bot will start automatically after authentication

2. **Test Bot Commands**
   - Send `.ping` to test connectivity
   - Use `.help` to see all available commands
   - Verify all features work correctly

### Production Considerations

- **Persistent Storage**: Auth data will persist across deployments
- **Health Checks**: Automatic health monitoring at `/health`
- **Keep-Alive**: Self-ping every 5 minutes to prevent service sleeping
- **Auto-Deploy**: Automatically deploys on GitHub pushes
- **Scaling**: Upgrade to paid plans for better performance
- **Monitoring**: Use Render logs and metrics for monitoring

### Troubleshooting

- **Build Failures**: Check Node.js version compatibility
- **Memory Issues**: Consider upgrading to paid tier
- **Connection Issues**: Verify WhatsApp authentication
- **Command Errors**: Check admin JID configuration

## File Structure

```
wa-bot-v3/
├── bot.js              # Main bot implementation
├── package.json        # Dependencies and scripts
├── README.md          # Documentation
├── .gitignore         # Git ignore rules
└── auth/              # WhatsApp session data (auto-generated)
    ├── creds.json
    └── *.json         # Session files
```

## Usage Examples

### Media Commands
```
# Convert image to sticker
Send image with caption: .sticker
# or reply to image: .sticker

# Convert sticker to image  
Send sticker with caption: .toimg
# or reply to sticker: .toimg
```

### Advanced Tools
```
.shorturl https://example.com/very/long/url/path
.color red
.time
.pass 16
```

### Group Management
```
.ginfo
.tagall Hello everyone!
.kick @username
.promote @username
.warn @username spamming
.mute 1h
.antilink on
```

## Admin Configuration

The bot recognizes admins by their JID (WhatsApp ID) configured in the `adminJids` array. Admin commands are restricted to these users only.

## Notes

- Group management commands only work in WhatsApp groups
- Admin commands require both bot admin status and user admin status
- Media commands support various WhatsApp message types
- All sensitive authentication data is excluded from git tracking

## License

This project is for educational purposes. Please comply with WhatsApp's Terms of Service when using automated tools.
