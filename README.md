# WhatsApp Bot

A powerful WhatsApp bot that can scan QR codes, connect to your WhatsApp account, and provide various bot commands for account management.

## Features

- 🔐 **QR Code Authentication** - Scan QR code to connect your WhatsApp account
- 🤖 **Rich Command Set** - 30+ commands for various functions
- 🔧 **Utility Tools** - Calculator, password generator, time, weather info
- 🛠️ **Advanced Tools** - Base64 encoding, hash generation, IP lookup, URL shortening
- 🎨 **Media Processing** - Create stickers, convert sticker to image
- 📱 **Auto Status View** - Automatically mark status messages as read
- 📞 **Call Blocking** - Block incoming calls when enabled
- 👑 **Advanced Group Management** - Complete admin tools with member analytics
- 📊 **Statistics & Analytics** - Track bot usage, group stats, and performance
- 🛡️ **Security Features** - Anti-link protection, warning system, moderation tools
- ⚡ **Fast Response** - Built with Baileys for optimal performance

## Bot Commands

### Quick Commands
| Command | Description |
|---------|-------------|
| `.help` | Complete list of all commands |
| `.panel` | Main control panel with status |
| `.ping` | Check bot response time |
| `.stats` | Bot statistics and uptime |
| `.about` | Information about the bot |

### Utility Commands
| Command | Description |
|---------|-------------|
| `.calc [expression]` | Basic calculator |
| `.time` | Current date and time |
| `.pass [length]` | Generate secure password |
| `.weather [city]` | Weather info (demo) |
| `.qr [text]` | Generate QR code info |

### Advanced Tools
| Command | Description |
|---------|-------------|
| `.translate [text]` | Text translation (demo) |
| `.base64 encode/decode [text]` | Base64 encoder/decoder |
| `.hash [text]` | Generate MD5/SHA hashes |
| `.ip [address]` | IP address lookup |
| `.random [min] [max]` | Random number generator |
| `.shorturl [url]` | URL shortener (demo) |
| `.color [name]` | Color code lookup |

### Media Commands
| Command | Description |
|---------|-------------|
| `.sticker` | Convert image to WhatsApp sticker |
| `.toimg` | Convert sticker to image |

### Settings Commands
| Command | Description |
|---------|-------------|
| `.autoread` | Toggle auto status view |
| `.anticall` | Toggle call blocking |
| `.on` / `.off` | Enable/disable bot |

### Group Management (Admin Only)
| Command | Description |
|---------|-------------|
| `.ghelp` | Show all group commands |
| `.ginfo` | Show group information |
| `.tagall [message]` | Tag all group members |
| `.admins` | List all group admins |
| `.members` | Group member statistics |
| `.rules` | Display group rules |
| `.groupstats` | Detailed group analytics |
| `.kick @user` | Remove member from group |
| `.promote @user` | Make member admin |
| `.demote @user` | Remove admin privileges |
| `.mute [duration]` | Mute group (e.g., 5m, 1h, 1d) |
| `.unmute` | Unmute group |
| `.warn @user` | Issue warning to member |
| `.resetwarns` | Reset all group warnings |
| `.lock` / `.unlock` | Lock/unlock group |
| `.antilink on/off` | Toggle link protection |

## Installation

### 🚀 Quick Deploy (FREE)
Deploy your bot to the cloud for free in under 5 minutes:

#### 🥇 Render (Recommended - 100% FREE)
1. **Fork this repository**
2. **Go to [render.com](https://render.com)** → Sign up with GitHub
3. **Create "New Web Service"** → Connect your repository
4. **Use settings:** Build: `npm install`, Start: `npm start`
5. **Visit your Render URL** to scan QR code and connect!

#### 🥈 Railway ($5/month free credits)
1. **Go to [railway.app](https://railway.app)** → Deploy from GitHub
2. **Visit your Railway URL** to scan QR code

📖 **[Complete Render Guide →](RENDER_DEPLOY.md)** | **[All Platforms →](DEPLOYMENT.md)**

## 🔑 API Configuration (Optional)

### 🚀 Quick API Setup
```bash
npm run setup
```
This interactive script will help you configure API keys for enhanced features.

### 🌟 Enhanced Features with APIs
- 🌤️ **Real Weather Data** - OpenWeatherMap API
- 🔗 **Professional URL Shortening** - Bitly API  
- 🌐 **Advanced IP Lookup** - IP Geolocation API
- 💱 **Live Currency Exchange** - Exchange Rate API
- 📊 **API Status Monitoring** - Built-in dashboard

### 📖 Detailed Setup Guide
**[Complete API Setup Guide →](API_SETUP.md)**

> **Note:** All features work without API keys using free fallback services, but APIs provide enhanced functionality and better reliability.

### 💻 Local Development

1. **Clone or download this repository**
   ```bash
   git clone <repository-url>
   cd wa-bot-v3
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure the bot**
   - Open `bot.js` in a text editor
   - Add your phone number to the `adminJids` array if you want admin access

4. **Run the bot**
   ```bash
   npm start
   ```

## Setup Instructions

### 🌐 Cloud Deployment (Recommended)
1. **Deploy to Railway/Render** using the guide above
2. **Visit your deployment URL** (e.g., `https://your-bot.up.railway.app`)
3. **Scan QR code** from the beautiful web interface
4. **Bot is ready!** - Available 24/7

### 💻 Local Setup
1. **Run the bot locally:**
   ```bash
   npm start
   ```
2. **Open web interface:** Visit `http://localhost:3000`
3. **Scan QR code** from your browser
4. **Connect WhatsApp** and start using commands

### 📱 Connecting WhatsApp
1. **Open the web interface** (local or deployed URL)
2. **Open WhatsApp** on your phone
3. **Go to Settings** → Linked Devices → Link a Device
4. **Scan the QR code** displayed on the web page
5. **Wait for connection** - You'll see "Connected and Ready" status

## Usage Examples

### Quick Start
Send `.help` to see all available commands or `.panel` for the main control panel.

### Utility Commands
- `.calc 15 * 7 + 3` - Use the calculator
- `.pass 16` - Generate a 16-character password
- `.time` - Check current date and time

### Media Commands
1. **Create Sticker**: Send an image with `.sticker` caption
2. **Convert Sticker**: Reply to a sticker with `.toimg`

### Advanced Tools
- `.base64 encode Hello` - Encode text to base64
- `.hash mypassword` - Generate hashes for text
- `.random 1 100` - Generate number between 1-100
- `.color red` - Get hex code for red color

### Group Management
- `.tagall Important announcement!` - Tag all members
- `.groupstats` - View detailed group analytics
- `.members` - See member breakdown
- `.resetwarns` - Clear all warnings in group

## Configuration

### Admin Settings
To set up admin access, modify the `config` object in `bot.js`:

```javascript
const config = {
    autoRead: false,
    antiCall: false,
    adminNumbers: ['1234567890@c.us'] // Add your phone number here
};
```

### Phone Number Format
Use the format: `COUNTRY_CODE + PHONE_NUMBER@c.us`
- Example: `1234567890@c.us` for US number +1 (234) 567-890

## Troubleshooting

### Common Issues

1. **QR Code not appearing:**
   - Make sure you have a stable internet connection
   - Try running the bot again with `npm start`

2. **Bot not responding to commands:**
   - Check if your phone number is correctly configured
   - Ensure the bot is connected (check console for "ready" message)

3. **Sticker creation fails:**
   - Make sure you're sending a valid image file
   - Check that the image is not too large

4. **Permission errors:**
   - Some commands require admin access
   - Make sure your number is in the `adminNumbers` array

### Logs
The bot provides detailed console logs for debugging. Check the terminal output for any error messages.

## Security Notes

- The bot stores session data locally for automatic reconnection
- Admin commands are restricted to configured phone numbers
- The bot only responds to messages sent directly to it
- Session data is stored in the `.wwebjs_auth` folder

## Dependencies

- `whatsapp-web.js` - WhatsApp Web API wrapper
- `qrcode-terminal` - QR code generation for terminal
- `fs` - File system operations
- `path` - Path utilities

## License

MIT License - feel free to modify and distribute.

## Support

If you encounter any issues:
1. Check the troubleshooting section above
2. Verify your configuration settings
3. Check the console logs for error messages
4. Ensure all dependencies are properly installed

---

**Note:** This bot is for personal use only. Make sure to comply with WhatsApp's Terms of Service when using this bot.
